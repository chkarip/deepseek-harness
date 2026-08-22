// @vitest-environment jsdom
// Work-group folding: which rows the Chat layout collapses, and how the
// resulting disclosure follows its turn.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, type RenderResult } from '@testing-library/react'
import type {
  ChatConversationViewNode, ChatNodeStore, ChatRow, ConversationLocation,
  ConversationSnapshot, ChatWorkGroupRow,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ChatNode, ChatViewSlotProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { chatRowLayout } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { WorkGroup } from '../src/client/chat/WorkGroup.tsx'
import { ReasoningWorkSummary } from '../src/client/chat/WorkSummaryViews.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh, commonZh) as ChatViewSlotProps['t']

/** Framework session kit the slot supplies in production; unused by this renderer. */
const summaryKit = {} as Omit<Parameters<typeof ReasoningWorkSummary>[0], 'node' | 'cwd' | 't'>

function stepLocation(turn: number, step = 1): ConversationLocation {
  return { kind: 'step', turn: { turn }, step: { step } } as unknown as ConversationLocation
}

function node(
  key: string,
  kind: ChatNode['kind'],
  location: ConversationLocation,
  data: unknown,
): ChatConversationViewNode {
  return { key, kind, id: key, target: 'chat', anchorSeq: 1, location, visibility: 'visible', data }
}

function toolNode(key: string, turn: number): ChatConversationViewNode {
  return node(key, 'tool-call', stepLocation(turn), {
    root: { callId: key, name: 'bash', argsRaw: '{}', turn, step: 1, time: 1, callView: null, subCalls: [] },
  })
}

function reasoningNode(key: string, turn: number, text = '想一想'): ChatConversationViewNode {
  return node(key, 'assistant-step', stepLocation(turn), {
    status: 'settled', turn, step: 1, time: 1, blocks: [{ kind: 'reasoning', text }],
  })
}

function answerNode(key: string, turn: number): ChatConversationViewNode {
  return node(key, 'assistant-step', stepLocation(turn), {
    status: 'settled', turn, step: 2, time: 1, blocks: [{ kind: 'text', text: '答案' }],
  })
}

function storeOf(nodes: readonly ChatConversationViewNode[]): ChatNodeStore {
  const byKey = new Map(nodes.map(value => [value.key, value]))
  return { get: key => byKey.get(key), values: () => nodes }
}

function layout(nodes: readonly ChatConversationViewNode[], previous?: readonly ChatRow[]): readonly ChatRow[] {
  return chatRowLayout(nodes.map(value => value.key), storeOf(nodes), previous)
}

function shape(rows: readonly ChatRow[]): readonly string[] {
  return rows.map(row => row.kind === 'node' ? row.key : `[${row.keys.join(',')}]`)
}

describe('chatRowLayout', () => {
  it('folds adjacent reasoning and tool rows of one turn into a single group', () => {
    const rows = layout([
      node('user:1', 'user', { kind: 'session' }, {}),
      reasoningNode('think:1', 1),
      toolNode('tool:1', 1),
      reasoningNode('think:2', 1),
      answerNode('answer:1', 1),
    ])
    expect(shape(rows)).toEqual(['user:1', '[think:1,tool:1,think:2]', 'answer:1'])
    expect((rows[1] as ChatWorkGroupRow).id).toBe('1:think:1')
    expect((rows[1] as ChatWorkGroupRow).turn).toBe(1)
  })

  it('never spans two turns with one group', () => {
    expect(shape(layout([toolNode('tool:1', 1), toolNode('tool:2', 2)])))
      .toEqual(['[tool:1]', '[tool:2]'])
  })

  it('keeps a work Node without a resolved turn as its own row', () => {
    expect(shape(layout([node('tool:x', 'tool-call', { kind: 'session' }, {
      root: { callId: 'x', name: 'bash', argsRaw: '{}', turn: 1, step: 1, time: 1, callView: null, subCalls: [] },
    })]))).toEqual(['tool:x'])
  })

  it('keeps an interrupted step out of the group it would otherwise join', () => {
    const interrupted = node('think:1', 'assistant-step', stepLocation(1), {
      status: 'interrupted', turn: 1, step: 1, time: 1, blocks: [{ kind: 'reasoning', text: '半句' }],
    })
    expect(shape(layout([interrupted, toolNode('tool:1', 1)]))).toEqual(['think:1', '[tool:1]'])
  })

  it('drops a step out of its group once it starts speaking', () => {
    const before = layout([reasoningNode('think:1', 1), toolNode('tool:1', 1)])
    const after = layout([
      reasoningNode('think:1', 1),
      node('tool:1', 'assistant-step', stepLocation(1), {
        status: 'running', turn: 1, step: 1, time: 1, blocks: [{ kind: 'text', text: '答' }],
      }),
    ], before)
    expect(shape(after)).toEqual(['[think:1]', 'tool:1'])
  })

  it('reuses unmoved rows by reference so members never remount', () => {
    const nodes = [reasoningNode('think:1', 1), toolNode('tool:1', 1), answerNode('answer:1', 1)]
    const first = layout(nodes)
    expect(layout(nodes, first)).toBe(first)
  })

  it('ignores a key the store no longer materializes', () => {
    expect(shape(chatRowLayout(['gone'], storeOf([])))).toEqual(['gone'])
  })
})

/** Static snapshot seat: the group reads only its members through this. */
function harness(nodes: readonly ChatConversationViewNode[]) {
  const store = storeOf(nodes)
  const useSession = ((selector: (snapshot: ConversationSnapshot) => unknown) =>
    selector({ chat: { nodes: store } } as unknown as ConversationSnapshot)) as ChatViewSlotProps['useSession']
  const renderSlot = ((key: string, owner: { node?: ChatNode }) => {
    if (key === 'conversation.chat.workSummary' && owner.node?.kind === 'assistant-step') {
      return <ReasoningWorkSummary {...summaryKit} node={owner.node} t={t} />
    }
    return <div data-row={owner.node?.key} />
  }) as unknown as ChatViewSlotProps['renderSlot']
  return { useSession, renderSlot }
}

function renderGroup(
  nodes: readonly ChatConversationViewNode[],
  running: boolean,
  keys = nodes.map(value => value.key),
) {
  const { useSession, renderSlot } = harness(nodes)
  const group: ChatWorkGroupRow = { kind: 'work-group', id: '1:first', turn: 1, keys }
  return render(
    <WorkGroup
      group={group}
      running={running}
      useSession={useSession}
      renderSlot={renderSlot}
      t={t}
      openFile={vi.fn()}
      inspectCall={vi.fn()}
      forkAt={vi.fn()}
      renderMessageImages={vi.fn()}
      fileMentions={vi.fn()}
    />,
  )
}

describe('WorkGroup', () => {
  it('stays collapsed by default even while the turn runs, titled with the step count', () => {
    const view = renderGroup([reasoningNode('think:1', 1), toolNode('tool:1', 1)], true)
    expect(view.container.querySelector('[data-disclosure-row]')?.getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText('2 个步骤')).toBeTruthy()
  })

  it('collapses to its last activity once the turn closes', () => {
    const view = renderGroup([toolNode('tool:1', 1), reasoningNode('think:1', 1, '读一下日志\n继续')], false)
    expect(view.container.querySelectorAll('[data-row]')).toHaveLength(0)
    expect(view.getByText('读一下日志')).toBeTruthy()
  })

  it('lets a reader override the turn-derived state', () => {
    const view = renderGroup([toolNode('tool:1', 1)], false)
    const row = view.container.querySelector('[data-disclosure-row]')
    expect(row).toBeTruthy()
    fireEvent.click(row as Element)
    expect(view.container.querySelectorAll('[data-row]')).toHaveLength(1)
  })

  it('keeps the reader override across the turn opening and closing again', () => {
    const nodes = [toolNode('tool:1', 1)]
    const { useSession, renderSlot } = harness(nodes)
    const group: ChatWorkGroupRow = { kind: 'work-group', id: '1:first', turn: 1, keys: nodes.map(n => n.key) }
    const props = {
      group, useSession, renderSlot, t,
      openFile: vi.fn(), inspectCall: vi.fn(), forkAt: vi.fn(), renderMessageImages: vi.fn(), fileMentions: vi.fn(),
    }
    const expanded = (view: RenderResult): string | null =>
      view.container.querySelector('[data-disclosure-row]')?.getAttribute('aria-expanded') ?? null

    const view = render(<WorkGroup {...props} running />)
    expect(expanded(view)).toBe('false')

    // A reader expands the group while the turn is still running.
    fireEvent.click(view.container.querySelector('[data-disclosure-row]') as Element)
    expect(expanded(view)).toBe('true')

    // The turn closing, and a later turn reopening, must not take the group back.
    view.rerender(<WorkGroup {...props} running={false} />)
    expect(expanded(view)).toBe('true')
    view.rerender(<WorkGroup {...props} running />)
    expect(expanded(view)).toBe('true')
  })

  it('renders no activity line for a group whose members left the window', () => {
    const view = renderGroup([], false, ['gone'])
    expect(view.container.textContent).toBe('1 个步骤')
  })

  it('renders no activity line for a step with no reasoning yet', () => {
    const empty = node('think:1', 'assistant-step', stepLocation(1), {
      status: 'running', turn: 1, step: 1, time: 1, blocks: [],
    })
    const view = renderGroup([empty], false)
    expect(view.container.textContent).toBe('1 个步骤')
  })
})
