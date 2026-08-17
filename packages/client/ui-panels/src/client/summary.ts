/**
 * Per-panel AI summary: ask the panel's OWN agent to summarize its
 * conversation, then capture the reply into the panel summary block.
 *
 * The model call rides the existing agent pipeline (the only way a model
 * call happens in the harness): a queued prompt through the panel session's
 * conversation service. The reply lands in the session log as an ordinary
 * assistant message — a deliberate, user-chosen trade-off (no new host RPC
 * surface). Capture waits for the next completed turn, then reads the last
 * assistant message text off the session snapshot.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ISessions, ObservableSnapshot, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Structural face of the scope-addressed conversation service (avoids a cross-package value/type import). */
interface PanelConversation {
  send(text: string): Promise<void>
}

/** How long to wait for the summarizing turn to complete. */
const SUMMARY_TIMEOUT_MS = 120_000

/** Resolve the panel session's conversation service through its agent scope. */
function scopedConversation(sessions: ISessions, sessionId: SessionId): PanelConversation | undefined {
  const scope = sessions.scope(sessionId)
  if (scope === undefined) return undefined
  return scope.get('conversation') as PanelConversation | undefined
}

/** Resolve once the predicate holds, or reject after the timeout. */
function waitForSnapshot<T>(
  session: ObservableSnapshot<T>,
  predicate: (snapshot: T) => boolean,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (predicate(session.getSnapshot())) {
      resolve()
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      unsubscribe()
      reject(new Error('summary wait timed out'))
    }, timeoutMs)
    const unsubscribe = session.subscribe(() => {
      if (settled) return
      if (!predicate(session.getSnapshot())) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}

/** Extract the last finalized assistant text from the snapshot's ordered nodes. */
function lastAssistantText(snapshot: { nodes: readonly { kind: string; blocks?: readonly { kind: string; text?: string }[] }[] }): string | undefined {
  for (let index = snapshot.nodes.length - 1; index >= 0; index--) {
    const node = snapshot.nodes[index]
    if (node?.kind !== 'assistant' || node.blocks === undefined) continue
    const text = node.blocks
      .filter(block => block.kind === 'text' && block.text !== undefined)
      .map(block => block.text)
      .join('')
      .trim()
    if (text !== '') return text
  }
  return undefined
}

/**
 * Generate a one-line AI summary of a panel's session: send the summary
 * prompt through the session's agent, wait for the turn to complete, and
 * return the agent's reply text.
 * @param sessions - the sessions service (scope/binding resolution).
 * @param t - the panels namespace translator (provides the prompt text).
 * @param sessionId - the panel's session.
 * @returns the summary text.
 * @throws when the session or its conversation service is unavailable, the
 * turn does not complete in time, or the send fails.
 */
export async function summarizeSession(
  sessions: ISessions,
  t: TranslateNS<'panels'>,
  sessionId: SessionId,
): Promise<string> {
  const conversation = scopedConversation(sessions, sessionId)
  const session = sessions.binding(sessionId)?.session
  if (conversation === undefined || session === undefined) {
    throw new Error(`ui-panels: session ${sessionId} is not addressable`)
  }
  // The capture below waits on turnEnds, which arrive through the event
  // window — make sure it is open (idempotent) even if the panel was never
  // focused.
  sessions.openWindow(sessionId)
  const before = session.getSnapshot().turnEnds.size
  await conversation.send(t('summary.prompt'))
  await waitForSnapshot(
    session,
    snapshot => snapshot.turnEnds.size > before,
    SUMMARY_TIMEOUT_MS,
  )
  return lastAssistantText(session.getSnapshot() as Parameters<typeof lastAssistantText>[0]) ?? ''
}
