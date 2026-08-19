/** Public session-handoff request, result, and durable source types. */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Which parts of the source conversation to include in the handoff. */
export interface SessionHandoffInclude {
  /** Include the finalized assistant answer text. */
  answer: boolean
  /** Include the preceding direct user question text. */
  question: boolean
  /** Include the session summary text. */
  summary: boolean
}

/** Delivery strategy into the target conversation. */
export type SessionHandoffDelivery = 'attach' | 'attach-and-ask'

/** Request payload for relaying an answer from one session to another. */
export interface SessionHandoffRequest {
  /** Opaque source session identity. */
  sourceSessionId: SessionId
  /** Finalized assistant message identity in the source session. */
  messageId: MessageId
  /** Opaque target session identity. */
  targetSessionId: SessionId
  /** Human-facing display label for the source session / panel. */
  senderLabel: string
  /** Selection of components to relay. */
  include: SessionHandoffInclude
  /** Optional caller-supplied summary text (falls back to log-backed title). */
  summaryText?: string | undefined
  /** Optional human note for the target agent (used as prompt in 'attach-and-ask'). */
  note?: string | undefined
  /** Whether to inject context silently or inject and immediately trigger a turn. */
  delivery: SessionHandoffDelivery
}

/** Acknowledgement of one successful handoff relay. */
export interface SessionHandoffRelayResult {
  ok: true
  injectedMessageId: MessageId
}

/** Durable message source stored on the target conversation's injected context. */
export interface SessionHandoffSource {
  kind: 'session-handoff'
  /** Relayed material addressed from one agent to another. */
  form: 'relay'
  senderSessionId: string
  senderLabel: string
  messageId: string
  includes: SessionHandoffInclude
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'session-handoff': SessionHandoffSource
  }
}

/** Snapshot data serialized inside the untrusted model-visible prompt. */
export interface RelayedHandoffData {
  sessionId: string
  label: string
  messageId: string
  cwd?: string | null
  summary?: string
  question?: string
  answer?: string
}
