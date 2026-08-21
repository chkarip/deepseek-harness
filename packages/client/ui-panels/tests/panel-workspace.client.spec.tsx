// @vitest-environment jsdom
/**
 * PanelWorkspace presentation and interaction spec:
 * - Empty panels fallback renders single conversation
 * - Adding panels, tiled/tabbed layouts
 * - Fork role modal and pathway branching (Reviewer, Brainstorm, Docs, Plain, Custom)
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { SessionId, SessionSummary, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ForkOptions, ForkResult } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { createPanelsStore, type PanelsState } from '../src/client/panels-store.ts'
import { PanelWorkspace } from '../src/client/PanelWorkspace.tsx'

const t = ((key: string, params?: Record<string, string | number>) => {
  const base = zh[key as keyof typeof zh]
  if (base === undefined) return key
  return params === undefined ? base : base.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}) as never

const sid = (n: number | string): SessionId => `s-${n}` as SessionId

function row(id: SessionId, title: string, blank = false): SessionSummary {
  return { id, displayTitle: title, running: false, blank, updatedAt: 1 }
}

function makeSessionList(
  current: SessionId | undefined,
  rows: SessionSummary[],
): SessionListState {
  const ids = rows.map(r => r.id)
  const byId = Object.fromEntries(rows.map(r => [r.id, r])) as Record<SessionId, SessionSummary>
  return {
    current,
    ids,
    byId,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

const defaultWorkspaces: WorkspaceListState = {
  items: [],
  archivedSessionIds: [],
  state: 'idle',
  phase: 'ready',
  error: null,
  baselinesReady: true,
  recentWorkspaceId: undefined,
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function WorkspaceHarness({
  store,
  sessions,
  renderConv = vi.fn((sessionId?: SessionId) => <div data-testid={`conv-${sessionId}`}>{sessionId ?? 'fallback'}</div>),
  forkSession = vi.fn().mockResolvedValue({ sessionId: sid('forked-1'), panelName: 'Forked' }),
  openSession = vi.fn(),
  createSession = vi.fn(),
  summarize = vi.fn(),
  openWindow = vi.fn(),
}: {
  store: ReturnType<ReturnType<typeof createPanelsStore>['create']>
  sessions: SessionListState
  renderConv?: (sessionId?: SessionId) => React.ReactNode
  forkSession?: (opts: SessionId | ForkOptions) => Promise<ForkResult>
  openSession?: (sessionId: SessionId) => void
  createSession?: () => Promise<SessionId>
  summarize?: (panelId: string, sessionId: SessionId) => Promise<void>
  openWindow?: (sessionId: SessionId) => void
}) {
  const state = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
  const useStore = <T,>(sel: (s: PanelsState) => T) => sel(state)
  return (
    <PanelWorkspace
      renderConversation={renderConv}
      useStore={useStore}
      actions={store.actions}
      useSessions={sel => sel(sessions)}
      useWorkspaces={sel => sel(defaultWorkspaces)}
      summarize={summarize}
      createSession={createSession}
      forkSession={forkSession}
      openSession={openSession}
      openWindow={openWindow}
      t={t}
    />
  )
}

describe('PanelWorkspace', () => {
  it('renders single fallback when no panels are open', () => {
    const store = createPanelsStore().create()
    const renderConv = vi.fn((sessionId?: SessionId) => <div data-testid="conv">{sessionId ?? 'fallback'}</div>)
    const view = render(
      <WorkspaceHarness
        store={store}
        renderConv={renderConv}
        sessions={makeSessionList(sid(1), [row(sid(1), 'First')])}
      />,
    )
    expect(view.getByTestId('conv').textContent).toBe('fallback')
    expect(renderConv).toHaveBeenCalledWith(undefined)
  })

  it('opens fork modal and branches with reviewer role when picking an already-open session', async () => {
    const store = createPanelsStore().create()
    store.actions.addPanel('p1', 'Panel 1')
    store.actions.setPanelSession('p1', sid(1))
    store.actions.addPanel('p2', 'Panel 2')

    const forkSession = vi.fn().mockResolvedValue({
      sessionId: sid('forked-reviewer'),
      panelName: '代码评审',
    })
    const openSession = vi.fn()

    const view = render(
      <WorkspaceHarness
        store={store}
        forkSession={forkSession}
        openSession={openSession}
        sessions={makeSessionList(sid(1), [
          row(sid(1), 'Session 1'),
          row(sid(2), 'Session 2'),
        ])}
      />,
    )

    // Panel 2 picks Session 1 (which is already open in Panel 1)
    const p2Element = view.container.querySelector('section[data-panel-id="p2"]')!
    const noSessionButton = p2Element.querySelector('button[class*="sessionChip"]')!
    fireEvent.click(noSessionButton)

    const session1Item = view.getByRole('menuitem', { name: /Session 1/ })
    fireEvent.click(session1Item)

    // Modal is now open, click "代码评审" (Code Reviewer)
    const reviewerButton = view.getByRole('button', { name: /代码评审/ })
    fireEvent.click(reviewerButton)

    expect(forkSession).toHaveBeenCalledWith({
      sourceSessionId: sid(1),
      role: 'reviewer',
      customGoal: undefined,
    })
    await vi.waitFor(() => {
      expect(store.getSnapshot().panels.find(p => p.id === 'p2')?.sessionId).toBe(sid('forked-reviewer'))
      expect(store.getSnapshot().panels.find(p => p.id === 'p2')?.name).toBe('代码评审')
      expect(openSession).toHaveBeenCalledWith(sid('forked-reviewer'))
    })
  })

  it('branches from current session with custom goal', async () => {
    const store = createPanelsStore().create()
    store.actions.addPanel('p1', 'Panel 1')
    store.actions.setPanelSession('p1', sid(1))
    store.actions.addPanel('p2', 'Panel 2')

    const forkSession = vi.fn().mockResolvedValue({
      sessionId: sid('forked-custom'),
      panelName: '性能专项',
    })
    const openSession = vi.fn()

    const view = render(
      <WorkspaceHarness
        store={store}
        forkSession={forkSession}
        openSession={openSession}
        sessions={makeSessionList(sid(1), [
          row(sid(1), 'Session 1'),
        ])}
      />,
    )

    // In Panel 2, click session chip and select "Branch from current conversation"
    const p2Element = view.container.querySelector('section[data-panel-id="p2"]')!
    const sessionChip = p2Element.querySelector('button[class*="sessionChip"]')!
    fireEvent.click(sessionChip)

    const forkItem = view.getByRole('menuitem', { name: /从当前对话分支/ })
    fireEvent.click(forkItem)

    // Enter custom goal in the modal
    const input = view.getByPlaceholderText(/例如：性能调优/)
    fireEvent.change(input, { target: { value: '性能专项' } })

    const launchButton = view.getByRole('button', { name: /启动分支/ })
    fireEvent.click(launchButton)

    expect(forkSession).toHaveBeenCalledWith({
      sourceSessionId: sid(1),
      role: 'custom',
      customGoal: '性能专项',
    })
    await vi.waitFor(() => {
      expect(store.getSnapshot().panels.find(p => p.id === 'p2')?.sessionId).toBe(sid('forked-custom'))
      expect(store.getSnapshot().panels.find(p => p.id === 'p2')?.name).toBe('性能专项')
    })
  })

  it('binds session directly when not open in any other panel', async () => {
    const store = createPanelsStore().create()
    store.actions.addPanel('p1', 'Panel 1')
    store.actions.setPanelSession('p1', sid(1))
    store.actions.addPanel('p2', 'Panel 2')

    const forkSession = vi.fn()
    const openSession = vi.fn()

    const view = render(
      <WorkspaceHarness
        store={store}
        forkSession={forkSession}
        openSession={openSession}
        sessions={makeSessionList(sid(1), [
          row(sid(1), 'Session 1'),
          row(sid(2), 'Session 2'),
        ])}
      />,
    )

    // Panel 2 picks Session 2 (which is NOT open in Panel 1)
    const p2Element = view.container.querySelector('section[data-panel-id="p2"]')!
    const noSessionButton = p2Element.querySelector('button[class*="sessionChip"]')!
    fireEvent.click(noSessionButton)

    const session2Item = view.getByRole('menuitem', { name: /Session 2/ })
    fireEvent.click(session2Item)

    expect(forkSession).not.toHaveBeenCalled()
    expect(store.getSnapshot().panels.find(p => p.id === 'p2')?.sessionId).toBe(sid(2))
    expect(openSession).toHaveBeenCalledWith(sid(2))
  })
})
