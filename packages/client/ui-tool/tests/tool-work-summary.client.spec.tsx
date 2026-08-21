// @vitest-environment jsdom
// The collapsed work-group activity line contributed for `tool-call` Nodes.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import type { ToolWorkSummaryProps } from '../src/client/contract/slots.ts'
import { ToolWorkSummary } from '../src/client/tool/ToolWorkSummary.tsx'

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh, commonZh) as ToolWorkSummaryProps['t']

/** Framework session kit the slot supplies in production; unused by this renderer. */
const kit = {} as Omit<ToolWorkSummaryProps, 'node' | 'cwd' | 't'>

function summaryNode(root: ToolResultNode | RunningToolCall): ToolWorkSummaryProps['node'] {
  return {
    key: `tool:${root.callId}`,
    kind: 'tool-call',
    id: root.callId,
    target: 'chat',
    anchorSeq: 1,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { root },
  }
}

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'read', argsRaw: '{"path":"/w/People/Chris.md"}' },
  callTime: 1_000,
  content: [], isError: false, callView: null, resultView: null, subCalls: [], ...over,
})

describe('ToolWorkSummary', () => {
  it('names a settled call by its row title and path summary', () => {
    const view = render(<ToolWorkSummary {...kit} node={summaryNode(settled())} cwd="/w" t={t} />)
    expect(view.container.textContent).toBe('ReadPeople/Chris.md')
  })

  it('reads the wire name off a still-running call', () => {
    const root: RunningToolCall = {
      callId: 'c2', name: 'bash', argsRaw: '{"description":"List files"}',
      turn: 1, step: 1, time: 1_000, callView: null, subCalls: [],
    }
    const view = render(<ToolWorkSummary {...kit} node={summaryNode(root)} t={t} />)
    expect(view.container.textContent).toBe('BashList files')
  })

  it('falls back to the call identity when window truncation dropped the call head', () => {
    const view = render(<ToolWorkSummary {...kit} node={summaryNode(settled({ call: null }))} t={t} />)
    expect(view.container.textContent).toBe('Tool callc1')
  })
})
