// WorkGroup: one collapsible box over a run of intermediate work rows
// (reasoning steps and tool calls) inside a single turn. Membership is decided
// by the Chat snapshot builder; this component owns only disclosure state and
// the collapsed activity line.
//
// Disclosure policy: the box is compact by default — collapsed to its "N
// steps" activity line regardless of turn state — so a turn's intermediate
// work stays scannable. A reader toggle expands it to watch the full work
// stream; the override outlives the turn it was made in.
//
// Members mount only while open: a collapsed group is one row, so long
// histories pay for the summary alone.

import { memo, useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatWorkGroupRow } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import css from './WorkGroup.module.css'

type RoutedWorkSummaryOwner = {
  [Kind in ChatNode['kind']]: { readonly cwd?: string | undefined; readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

interface WorkSummaryLineProps {
  readonly nodeKey: string
  readonly cwd?: string | undefined
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
}

/** The group's last activity, dispatched on that member's own renderer kind. */
const WorkSummaryLine = memo(function WorkSummaryLine({
  nodeKey, cwd, useSession, renderSlot,
}: WorkSummaryLineProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey)) as ChatNode | undefined
  if (node === undefined) return null
  // Same correlation as ChatNodeSeat: the discriminant IS the entry key, and
  // TypeScript does not distribute an object containing a union.
  const routed = { cwd, node } as RoutedWorkSummaryOwner
  return (
    <span className={css.summary}>
      {renderSlot('conversation.chat.workSummary', routed, { entryKey: node.kind })}
    </span>
  )
})

interface WorkGroupProps extends ChatNodeOwnerProps {
  readonly group: ChatWorkGroupRow
  /** Whether the owning turn is still open. */
  readonly running: boolean
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

/**
 * Render one run of intermediate work rows as a single collapsible row.
 * @param props.group - member keys and owning turn from the Chat snapshot.
 * @param props.running - whether the owning turn is still open.
 * @returns the work-group disclosure.
 */
export const WorkGroup = memo(function WorkGroup({
  group, running, useSession, renderSlot, t, ...owner
}: WorkGroupProps) {
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? false
  const last = group.keys[group.keys.length - 1]
  return (
    <div
      className={css.root}
      data-chat-anchor-key={group.id}
      data-chat-work-group={group.id}
      data-state={running ? 'running' : 'ok'}
    >
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={t('chat.work.steps', { count: group.keys.length })}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOverride(!open) }}
        collapsedContent={last === undefined ? null : (
          <>
            <span className={css.separator} aria-hidden />
            <WorkSummaryLine
              nodeKey={last}
              cwd={owner.cwd}
              useSession={useSession}
              renderSlot={renderSlot}
            />
          </>
        )}
      >
        <div className={css.members}>
          {group.keys.map(key => (
            <ChatNodeSeat
              key={key}
              nodeKey={key}
              useSession={useSession}
              renderSlot={renderSlot}
              t={t}
              {...owner}
            />
          ))}
        </div>
      </DisclosureRow>
    </div>
  )
})
