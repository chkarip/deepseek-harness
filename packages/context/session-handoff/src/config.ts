/** Configuration and diagnostic error types for session handoff. */

/** Default UTF-8 budget for one rendered handoff JSON object. */
export const DEFAULT_MAX_RELAY_BYTES = 65_536

/** Default setting for cross-workspace handoff permission. */
export const DEFAULT_ALLOW_CROSS_WORKSPACE = false

/** Session-handoff service configuration. */
export interface Config {
  /** Maximum UTF-8 bytes for one rendered relay payload. */
  maxRelayBytes?: number
  /** Whether to allow relaying to a session in a different workspace. */
  allowCrossWorkspace?: boolean
}

/** Stable failure codes exposed for session handoff operations. */
export type SessionHandoffErrorCode =
  | 'SESSION_HANDOFF_INVALID_CONFIG'
  | 'SESSION_HANDOFF_INVALID_REQUEST'
  | 'SESSION_HANDOFF_SELF_RELAY'
  | 'SESSION_HANDOFF_TARGET_NOT_FOUND'
  | 'SESSION_HANDOFF_TARGET_DISPOSED'
  | 'SESSION_HANDOFF_SOURCE_NOT_FOUND'
  | 'SESSION_HANDOFF_MESSAGE_NOT_FOUND'
  | 'SESSION_HANDOFF_CROSS_WORKSPACE_DISALLOWED'
  | 'SESSION_HANDOFF_BUDGET_EXCEEDED'

/** Typed session-handoff failure suitable for host protocol error mapping. */
export class SessionHandoffError extends Error {
  /** @param message Human-readable diagnosis. @param code Stable routing code. @param options Optional cause. */
  constructor(
    message: string,
    readonly code: SessionHandoffErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SessionHandoffError'
  }
}
