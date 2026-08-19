// @vitest-environment jsdom
/**
 * PanelHandoffAction presentation and interaction spec:
 * - Hidden when fewer than 2 panels exist in the store
 * - Opens popover on trigger click
 * - Shows available target panels (excluding current session's panel)
 * - Toggles inclusion checkboxes (answer, question, summary)
 * - Handles inline AI summary generation
 * - Toggles delivery modes (attach vs attach-and-ask) and note input
 * - Calls injected relay callback with formatted payload
 * - Displays success and error feedback
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PanelHandoffInjected } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { createPanelsStore, type PanelsState } from '../src/client/panels-store.ts'
import { PanelHandoffAction } from '../src/client/PanelHandoffAction.tsx'

const t = ((key: string, params?: Record<string, unknown>) => {
  const base = zh[key as keyof typeof zh]
  if (base === undefined) return key
  return params === undefined ? base : base.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}) as never

const sid = (n: number | string): SessionId => `s-${n}` as SessionId
const mid = (n: number | string): MessageId => `m-${n}` as MessageId

function Harness({
  handle,
  messageId,
  sessionId,
  relay = vi.fn(),
  summarize = vi.fn(),
}: {
  handle: ReturnType<ReturnType<typeof createPanelsStore>['create']>
  messageId: MessageId
  sessionId: SessionId
  relay?: PanelHandoffInjected['relay']
  summarize?: (panelId: string, sessionId: SessionId) => Promise<void>
}) {
  const state = useSyncExternalStore(handle.subscribe, handle.getSnapshot)
  const useStore = <T,>(sel: (s: PanelsState) => T) => sel(state)

  return (
    <PanelHandoffAction
      messageId={messageId}
      sessionId={sessionId}
      useSession={vi.fn() as never}
      useProjection={vi.fn() as never}
      useInput={vi.fn() as never}
      inputActions={{} as never}
      useSessions={vi.fn() as never}
      useWorkspaces={vi.fn() as never}
      useStore={useStore}
      actions={handle.actions}
      relay={relay}
      summarize={summarize}
      t={t as never}
    />
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('PanelHandoffAction', () => {
  it('renders nothing when fewer than 2 panels exist', () => {
    const handle = createPanelsStore().create()

    const { container } = render(
      <Harness
        handle={handle}
        messageId={mid(1)}
        sessionId={sid(1)}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders handoff button when 2+ panels exist and opens popover', () => {
    const handle = createPanelsStore().create()
    handle.actions.addPanel('p1', 'Panel 1')
    handle.actions.setPanelSession('p1', sid(1))
    handle.actions.addPanel('p2', 'Panel 2')
    handle.actions.setPanelSession('p2', sid(2))

    render(
      <Harness
        handle={handle}
        messageId={mid(1)}
        sessionId={sid(1)}
      />,
    )

    const btn = screen.getByLabelText('转发至面板')
    expect(btn).toBeTruthy()

    fireEvent.click(btn)

    expect(screen.getAllByText('转发回答至面板').length).toBeGreaterThan(0)
    expect(screen.getByText('Panel 2')).toBeTruthy()
  })

  it('toggles inclusions and summary generation', async () => {
    const handle = createPanelsStore().create()
    handle.actions.addPanel('p1', 'Panel 1')
    handle.actions.setPanelSession('p1', sid(1))
    handle.actions.addPanel('p2', 'Panel 2')
    handle.actions.setPanelSession('p2', sid(2))

    const summarizeMock = vi.fn().mockImplementation(async (panelId: string) => {
      handle.actions.setPanelSummary(panelId, 'Generated AI Summary for Panel 1')
    })

    render(
      <Harness
        handle={handle}
        messageId={mid(1)}
        sessionId={sid(1)}
        summarize={summarizeMock}
      />,
    )

    fireEvent.click(screen.getByLabelText('转发至面板'))

    // Check summary generate button
    const summaryBtn = screen.getByText('生成 AI 摘要')
    fireEvent.click(summaryBtn)

    expect(summarizeMock).toHaveBeenCalledWith('p1', sid(1))
  })

  it('submits relay in attach mode', async () => {
    const handle = createPanelsStore().create()
    handle.actions.addPanel('p1', 'Panel 1')
    handle.actions.setPanelSession('p1', sid(1))
    handle.actions.addPanel('p2', 'Panel 2')
    handle.actions.setPanelSession('p2', sid(2))

    const relayMock = vi.fn().mockResolvedValue({ ok: true, injectedMessageId: mid(99) })

    render(
      <Harness
        handle={handle}
        messageId={mid(10)}
        sessionId={sid(1)}
        relay={relayMock}
      />,
    )

    fireEvent.click(screen.getByLabelText('转发至面板'))

    // Click submit
    const sendBtn = screen.getByText('发送')
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(relayMock).toHaveBeenCalledWith({
        sourceSessionId: sid(1),
        messageId: mid(10),
        targetSessionId: sid(2),
        senderLabel: 'Panel 1',
        include: {
          answer: true,
          question: true,
          summary: true,
        },
        delivery: 'attach',
      })
    })

    expect(screen.getByText('已发送')).toBeTruthy()
  })

  it('submits relay in attach-and-ask mode with custom note', async () => {
    const handle = createPanelsStore().create()
    handle.actions.addPanel('p1', 'Source')
    handle.actions.setPanelSession('p1', sid(1))
    handle.actions.addPanel('p2', 'Reviewer')
    handle.actions.setPanelSession('p2', sid(2))

    const relayMock = vi.fn().mockResolvedValue({ ok: true, injectedMessageId: mid(100) })

    render(
      <Harness
        handle={handle}
        messageId={mid(20)}
        sessionId={sid(1)}
        relay={relayMock}
      />,
    )

    fireEvent.click(screen.getByLabelText('转发至面板'))

    // Select attach-and-ask radio
    const askRadio = screen.getByDisplayValue('attach-and-ask')
    fireEvent.click(askRadio)

    // Type note
    const noteInput = screen.getByPlaceholderText('向目标会话提出具体问题或指引…')
    fireEvent.change(noteInput, { target: { value: 'Please review this code implementation.' } })

    // Click submit
    fireEvent.click(screen.getByText('发送'))

    await waitFor(() => {
      expect(relayMock).toHaveBeenCalledWith({
        sourceSessionId: sid(1),
        messageId: mid(20),
        targetSessionId: sid(2),
        senderLabel: 'Source',
        include: {
          answer: true,
          question: true,
          summary: true,
        },
        note: 'Please review this code implementation.',
        delivery: 'attach-and-ask',
      })
    })
  })

  it('displays error feedback when relay fails', async () => {
    const handle = createPanelsStore().create()
    handle.actions.addPanel('p1', 'Panel 1')
    handle.actions.setPanelSession('p1', sid(1))
    handle.actions.addPanel('p2', 'Panel 2')
    handle.actions.setPanelSession('p2', sid(2))

    const relayMock = vi.fn().mockRejectedValue(new Error('Relay payload exceeds budget'))

    render(
      <Harness
        handle={handle}
        messageId={mid(10)}
        sessionId={sid(1)}
        relay={relayMock}
      />,
    )

    fireEvent.click(screen.getByLabelText('转发至面板'))
    fireEvent.click(screen.getByText('发送'))

    await waitFor(() => {
      expect(screen.getByText('Relay payload exceeds budget')).toBeTruthy()
    })
  })
})
