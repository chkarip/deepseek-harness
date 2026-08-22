/**
 * Fork-merge planning: the pure remapping between a fork child's own-work
 * events and the append stream that replays them into the parent's log.
 *
 * A fork child shares the parent's history up to its seed boundary
 * (`header.seedLength`), then diverges. "Merging a fork into its original"
 * appends the child's own-work events — the events after the seed boundary —
 * to the parent's log so the original conversation continues with the fork's
 * turns, then the fork session itself is deleted.
 *
 * The remapping is mechanical but must be exact:
 *
 * - `seq` is not carried: `Session.append` assigns the next log position, so
 *   the plan returns the child's own-work events in order and the caller
 *   appends them sequentially.
 * - `sourceEventSeqs` cites seqs in the CHILD's numbering. A citation below
 *   the own-work boundary refers to an inherited seed event, which exists at
 *   the SAME seq in the parent (forking preserves the seed prefix verbatim
 *   and the parent log is append-only). A citation at or above the boundary
 *   refers to an own-work event, remapped by the caller's append position.
 * - `turn` numbers continue the parent's numbering: the child's own turns
 *   started right after the fork boundary, so they are shifted so the first
 *   own turn lands one past the parent's current last turn. When several
 *   forks merge sequentially, each shift is computed against the parent's
 *   state at ITS merge moment.
 * - `time` is preserved so merged turns keep their original chronology
 *   instead of appearing "now".
 * - `session/end-seed` markers are stripped: the merged parent owns its own
 *   seed boundary, and a stray marker would mislabel later resume/telemetry
 *   reads that locate the LAST such marker.
 *
 * A fork whose own-work segment contains a surface-replacing compaction
 * event (`surfaceOp = { op: 'replace', ... }`) cannot be merged: the replace
 * ranges refer to the child's surface positions, which are not valid against
 * the parent's surface, and replaying it could shadow parent history. Such a
 * fork is rejected with a structured failure rather than merged corruptly.
 *
 * @module @deepseek-ai/dsh-session/merge
 */
import type { SessionEvent, SessionEventType, SessionHeader, SessionId } from './types.ts'

/** Event types whose `data` carries a `turn` number. */
const TURN_BEARING_EVENT_TYPES = new Set<SessionEventType>([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'assistant/chunk',
  'assistant/message',
  'tool/call',
  'tool/result',
])

/** Whether an event's data carries a numeric `turn` field. */
function eventTurn(event: SessionEvent): number | undefined {
  if (!TURN_BEARING_EVENT_TYPES.has(event.type)) return undefined
  const turn = (event.data as { turn?: unknown }).turn
  return typeof turn === 'number' ? turn : undefined
}

/** Surface metadata of any event (absent on non-surface events). */
function surfaceMetadata(event: SessionEvent): {
  surfaceOp?: unknown
  sourceEventSeqs?: readonly number[] | undefined
} {
  return event as SessionEvent & { surfaceOp?: unknown; sourceEventSeqs?: readonly number[] | undefined }
}

/**
 * The highest turn number present in a log (-1 when none). Turn numbers are
 * contiguous from 0, so this is the parent's current last turn.
 * @param events - the session's event log (or a slice of it).
 * @returns the last turn, or -1 for a turn-less log.
 */
export function lastTurnOf(events: readonly SessionEvent[]): number {
  let last = -1
  for (const event of events) {
    const turn = eventTurn(event)
    if (turn !== undefined && turn > last) last = turn
  }
  return last
}

/**
 * The first own-work event seq of a fork: the seed boundary from the header
 * (`seedLength`), skipping the boundary `session/end-seed` marker the
 * constructor appends at that exact seq when the seed did not already end
 * with one. Falls back to scanning for the last marker when the header
 * carries no boundary (defensive — forked sessions always record it).
 * @param events - the fork child's event log.
 * @param header - the child's header.
 * @returns the seq of the first event the child itself produced.
 */
export function forkOwnStart(events: readonly SessionEvent[], header: SessionHeader): number {
  if (header.seedLength !== undefined) {
    return header.seedLength + (events[header.seedLength]?.type === 'session/end-seed' ? 1 : 0)
  }
  let boundary = -1
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 'session/end-seed') {
      // The loop only enters with a defined event, so the ?? -1 fallback is
      // unreachable; kept so the defensive contract is explicit.
      /* v8 ignore next 3 -- events[index] is defined (the loop guards on the element before entering) */
      boundary = events[index]?.seq ?? -1
      break
    }
  }
  return boundary + 1
}

/** A fork whose own-work cannot be replayed into its parent, with the reason. */
export interface ForkMergeRejection {
  /** The child session being merged. */
  readonly forkSessionId: SessionId
  /** Why this fork cannot be merged (also surfaced to the caller as an error). */
  readonly reason: string
}

/**
 * One remapped own-work event ready to append to the parent. `seq` is
 * deliberately absent — the append assigns it. `sourceEventSeqs` below the
 * own-work boundary keep the child's values (they name seed events that exist
 * at the same seq in the parent); at-or-above values are expressed relative
 * to the first own-work event (`seq - ownStart`) so the caller can offset
 * them by the parent's log length at append time without re-plumbing.
 */
export interface MergeEvent {
  readonly type: SessionEventType
  readonly data: SessionEvent['data']
  readonly time: number
  /** Remapped own-work citation (child seq minus ownStart); seed citations unchanged. */
  readonly sourceEventSeqs?: readonly number[] | undefined
}

/** The planned append stream for one fork child. */
export interface ForkMergePlan {
  /** Remapped own-work events, in child order; appended sequentially. */
  readonly events: readonly MergeEvent[]
  /** Number of own-work events appended (for reporting). */
  readonly appendedCount: number
}

/**
 * The parent snapshot a plan is computed against. Both fields are read
 * BEFORE appending; the caller must append the returned events synchronously
 * (no await between) so the offset stays exact.
 */
export interface MergeParentState {
  /** Current parent log length — the seq the first appended event will take. */
  readonly length: number
  /** Current parent last turn (see {@link lastTurnOf}); -1 for a turn-less log. */
  readonly lastTurn: number
}

/**
 * Plan replaying one fork child's own work into its parent.
 * @param parent - the parent's log state at plan time.
 * @param childEvents - the fork child's complete event log.
 * @param childHeader - the fork child's header (seed boundary source).
 * @returns the plan, or a rejection when the fork cannot be merged.
 */
export function planForkMerge(
  parent: MergeParentState,
  childEvents: readonly SessionEvent[],
  childHeader: SessionHeader,
): { ok: true; plan: ForkMergePlan } | { ok: false; rejection: ForkMergeRejection } {
  const ownStart = forkOwnStart(childEvents, childHeader)
  const ownWork = childEvents.filter(event => event.seq >= ownStart && event.type !== 'session/end-seed')
  if (ownWork.length === 0) {
    return { ok: true, plan: { events: [], appendedCount: 0 } }
  }
  for (const event of ownWork) {
    const { surfaceOp } = surfaceMetadata(event)
    if (surfaceOp !== undefined && surfaceOp !== null && typeof surfaceOp === 'object'
      && 'op' in surfaceOp && surfaceOp.op !== 'append') {
      return {
        ok: false,
        rejection: {
          forkSessionId: childHeader.id,
          reason: `fork "${childHeader.id}" contains a surface-replacing compaction event (seq ${event.seq}) `
            + 'in its own work and cannot be merged into the original without corrupting it',
        },
      }
    }
  }
  // The fork's own turns continue from the fork boundary, so the FIRST own
  // turn is the shift base (the min across the own work — the max would
  // mis-shift a multi-turn fork). -1 means the fork has no own turns.
  let childFirstTurn = -1
  for (const event of ownWork) {
    const turn = eventTurn(event)
    if (turn === undefined) continue
    if (childFirstTurn === -1 || turn < childFirstTurn) childFirstTurn = turn
  }
  const parentLastTurn = parent.lastTurn
  const turnDelta = childFirstTurn === -1 ? 0 : parentLastTurn + 1 - childFirstTurn
  const events: MergeEvent[] = ownWork.map((event) => {
    const { sourceEventSeqs } = surfaceMetadata(event)
    const remappedSeqs = sourceEventSeqs === undefined
      ? undefined
      : sourceEventSeqs.map(seq => seq < ownStart ? seq : seq - ownStart)
    const data = turnDelta === 0
      ? event.data
      : remapTurn(event, turnDelta)
    return {
      type: event.type,
      data,
      time: event.time,
      ...remappedSeqs === undefined ? {} : { sourceEventSeqs: remappedSeqs },
    }
  })
  return { ok: true, plan: { events, appendedCount: events.length } }
}

/** Shift one event's `turn` (and `step` grouping is untouched — steps are per turn) by `delta`. */
function remapTurn(event: SessionEvent, delta: number): SessionEvent['data'] {
  const turn = eventTurn(event)
  if (turn === undefined) return event.data
  return { ...(event.data as object), turn: turn + delta } as SessionEvent['data']
}
