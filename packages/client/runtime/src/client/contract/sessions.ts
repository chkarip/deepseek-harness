/**
 * The outward sessions-service face — what `ctx.sessions` exposes to feature
 * packages and the renderer host, and therefore exactly what the test
 * runtime's sessions double must implement. Wire-pump entry points
 * (handleMuxEnvelope/handleConnected/refresh) and runtime internals stay on
 * the concrete class; cross-domain consumers keep the narrower
 * [SessionsPort](./sessions-port.ts). Widening this interface is the
 * explicit act of widening what features may do to the sessions domain.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  RpcResult, SessionId, SubagentAddress, WorkspaceId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable, SessionMaybeProvideInfo, SessionProvideInfo } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentContext } from '../agents/scope.ts'
import type { SessionSearchResultItem } from '../sessions/manager.ts'
import type {
  SessionBinding, SessionListState, SessionProvideDescriptor,
} from '../sessions/service.ts'
import type { SessionFace } from './session.ts'
import type { ObservableSnapshot } from './store.ts'

export type { AgentContext } from '../agents/scope.ts'

/** One fork merged into its parent by {@link ISessions.mergeForks}. */
export interface ForkMergeResult {
  /** The merged fork session id (deleted after the merge). */
  forkSessionId: SessionId
  /** Number of own-work events replayed into the parent's log. */
  appendedEvents: number
}

/** One fork {@link ISessions.mergeForks} could not merge (left intact). */
export interface ForkMergeFailure {
  /** The unmerged fork session id. */
  forkSessionId: SessionId
  /** Why the fork cannot be merged. */
  reason: string
}

/** The outcome of {@link ISessions.mergeForks}. */
export interface ForkMergeOutcome {
  /** Forks merged into the parent and deleted. */
  merged: readonly ForkMergeResult[]
  /** Forks that could not be merged and remain in the list. */
  failed: readonly ForkMergeFailure[]
}

/** The sessions-service face injected as `ctx.sessions`. */
export interface ISessions {
  /** The useSessions standard feed (list rows + current selection; read face — writes stay inside the domain). */
  readonly list: ObservableSnapshot<SessionListState>
  /** Atomic current-session provide projection (the renderer host's `sessions.provideInfo` feed). */
  readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>
  /**
   * The `session.search` result bound the wire schema fixes, exposed to
   * presentation as injected data. Not per-connection state: every transport
   * (fixture included) reports the same number.
   */
  readonly searchResultLimit: number
  /**
   * Select a session as current.
   * @param id - session id (must exist in the list; unknown ids fail loud).
   */
  open(id: SessionId): void
  /**
   * Open a session's event window WITHOUT changing the current selection —
   * the multi-pane seat: a panel hosting a non-current session still receives
   * its live stream (the window is what delivers events; selection is what
   * stages it). Idempotent: an already-open window is untouched. Only listed
   * sessions are eligible; an unknown id is a no-op.
   * @param id - session id.
   */
  openWindow(id: SessionId): void
  /**
   * Birth a FRESH session on the host — the multi-pane "New conversation"
   * path, distinct from the workspaces New Session flow's blank-session
   * reuse: every call mints a new session. On resolution the session is in
   * the list store and `binding(id)` resolves synchronously.
   * @param opts - target workspace, working directory, or a caller-owned id.
   * @returns the new session id.
   * @throws {SessionCreateError} on business/transport failure.
   */
  create(opts?: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId }): Promise<SessionId>
  /**
   * Open a healthy catalog child through its exact direct-parent address.
   * @param address - catalog-derived parent and child ids.
   */
  openSubagent(address: SubagentAddress): void
  /**
   * Resolve an already discovered direct-parent address without opening it.
   * @param id - possible addressed child id.
   * @returns the retained address, when present.
   */
  subagentAddress(id: SessionId): SubagentAddress | undefined
  /**
   * Mark whether a catalog menu is consuming live membership updates.
   * @param parentSessionId - catalog owner.
   * @param open - current menu state.
   */
  setSubagentCatalogOpen(parentSessionId: SessionId, open: boolean): void
  /**
   * Refresh one direct-child catalog.
   * @param parentSessionId - catalog owner.
   * @returns completion of the current or newly started refresh.
   */
  refreshSubagents(parentSessionId: SessionId): Promise<void>

  /**
   * Record the composition one session now runs. The agent-preset seat calls
   * this after a successful blank-session switch, so the header label moves
   * with the composition instead of waiting for the next full list refresh.
   * @param sessionId - the switched session.
   * @param agentPreset - the preset id the host confirmed.
   */
  noteAgentPreset(sessionId: SessionId, agentPreset: string): void
  /** Clear the current selection into the no-session view state. */
  clear(): void
  /**
   * Search the Host's visible message-content index. Results stay
   * request-local; the list snapshot remains the metadata authority.
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for a superseded search.
   * @returns bounded results, or a business/transport error.
   */
  search(
    query: string,
    signal: AbortSignal,
  ): Promise<RpcResult<{ items: SessionSearchResultItem[]; hasMore: boolean }>>
  /**
   * Fork a session from a completed-turn prefix of the source; on resolution
   * the child is in the list store and `open()` can target it.
   * @param opts - source session id, the optional event seq anchoring the
   *   cut (the boundary is the first turn/end at or after it; an in-log
   *   anchor in an open turn is unavailable rather than clipped backward),
   *   and whether to increment an inherited durable title before resolving.
   * @returns the child session id.
   * @throws when the fork fails, or when a requested child-title rename fails after creation.
   */
  fork(opts: { sessionId: SessionId; atSeq?: number; increaseTitle?: boolean }): Promise<SessionId>
  /**
   * Merge every direct fork of a session into it and delete the merged forks.
   * The host replays each fork's own-work turns into the original's log,
   * disposes the fork agents, removes their durable logs, and detaches their
   * workspace accounting; on resolution the deleted forks are gone from the
   * list store. Forks that cannot be merged (e.g. surface-replacing
   * compaction in their own work) are reported in `failed` and left intact.
   * @param sessionId - the session whose forks merge into it.
   * @returns the merged and unmerged fork accounts.
   * @throws when the parent is unknown or running, when the session has no
   *   forks, or when every fork is unmergeable.
   */
  mergeForks(sessionId: SessionId): Promise<ForkMergeOutcome>
  /**
   * Register a per-session standard-props provider (hooks become `use<Name>`
   * selector hooks on the render side; props spread verbatim).
   * @param descriptor - static member roster plus per-session resolver.
   * @returns disposer removing the provider.
   */
  provide(descriptor: SessionProvideDescriptor): () => void
  /**
   * Resolve an Agent-scoped context view (use-and-discard).
   * @param id - session id.
   * @returns scoped ctx, or undefined for a session neither listed nor already scoped.
   */
  scope(id: SessionId): AgentContext | undefined
  /**
   * Read the Agent scope tag off a context (service-method boundary: fetch
   * bundles must reach scope resolution through ctx.sessions).
   * @param ctx - any client context.
   * @returns the session id, or undefined on root contexts.
   */
  scopeOf(ctx: Context): SessionId | undefined
  /**
   * Resolve the session face behind an Agent-scoped context.
   * @param ctx - an Agent-scoped context.
   * @returns the session face, or undefined when the ctx is untagged or its scope was pruned.
   */
  sessionOf(ctx: Context): SessionFace | undefined
  /**
   * Resolve the stable session binding (scope-addressed assembly feed).
   * @param id - session id.
   * @returns binding, or undefined for a session neither listed nor already scoped.
   */
  binding(id: SessionId): SessionBinding | undefined
  /**
   * Resolve one session's render-layer standard-props bundle (the multi-pane
   * seat: the renderer renders a subtree against a specific session instead
   * of the ambient current one). Pure resolution — render-safe; the scope
   * mints lazily for any eligible session, as with {@link ISessions.binding}.
   * @param id - session id.
   * @returns the bundle, or undefined for a session neither listed nor already scoped.
   */
  provideInfo(id: SessionId): SessionProvideInfo | undefined
}
