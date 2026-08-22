/**
 * ui-panels contracts: the slot props of the panels workspace and the
 * injected business face (callbacks closed over the apply ctx).
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionHandoffRelayResult, SessionHandoffRequest } from '@deepseek-ai/dsh-session-handoff/types'
import type { PanelsKey } from './locales.ts'
import type { createPanelsStore, PanelRecord } from './panels-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The panels workspace toolbar, panel chrome, picker, and summary copy. */
    panels: PanelsKey
  }
}

/** Specialized pathway roles for forked branches. */
export type ForkRole = 'reviewer' | 'brainstorm' | 'docs' | 'plain' | 'custom'

/** Options when forking a session into a new branch. */
export interface ForkOptions {
  sourceSessionId: SessionId
  role?: ForkRole | undefined
  customGoal?: string | undefined
}

/** Result of forking a session. */
export interface ForkResult {
  sessionId: SessionId
  panelName?: string | undefined
}

/**
 * Injected business face of the panels workspace: the verbs that must reach
 * the sessions/workspaces domain (they live in the apply closure, never in a
 * component). Components receive these as plain callbacks.
 */
export interface PanelsInjected {
  /**
   * Generate the AI summary for one panel: send the summary prompt through
   * the panel session's own agent, capture the reply, and store it on the
   * panel record (summaryState drives the block's lifecycle).
   * @param panelId - the panel to update.
   * @param sessionId - the panel's session to summarize.
   */
  summarize: (panelId: string, sessionId: SessionId) => Promise<void>
  /**
   * Create a fresh conversation for a new panel (host-side session birth).
   * @param workspaceId - explicit target Workspace; absent = the current
   * session's Workspace, then the recent Workspace.
   * @returns the new session id.
   */
  createSession: (workspaceId?: WorkspaceId) => Promise<SessionId>
  /**
   * Fork the source session into a child that SHARES its context (history
   * up to the last completed turn, cwd, model target) and optionally seeds
   * it with a specialized role directive.
   * @param opts - the source session or fork options with role.
   * @returns the child session id and suggested panel name.
   */
  forkSession: (opts: SessionId | ForkOptions) => Promise<ForkResult>
  /**
   * Focus a session by making it the current selection (the sidebar
   * highlight and the details panel follow the focused panel).
   * @param sessionId - the session to select.
   */
  openSession: (sessionId: SessionId) => void
  /**
   * Open a session's event window without changing the selection — the
   * multi-pane seat: every VISIBLE panel's session streams live even when
   * it is not the focused one. Idempotent; unknown ids are no-ops.
   * @param sessionId - the panel's session.
   */
  openWindow: (sessionId: SessionId) => void
  /**
   * Extract the auto-recap of a panel's last answer (goal + result) locally
   * from the session snapshot — no model call, so no prompt is sent into the
   * conversation. Goal = last user message, result = last assistant message.
   * @param sessionId - the panel's session.
   * @returns the goal/result pair, or undefined when there is no completed answer yet.
   */
  extractRecap: (sessionId: SessionId) => { goal: string; result: string } | undefined
  /**
   * Number of completed turns in a session (undefined when not addressable).
   * The auto-recap uses it as a stable, monotonic per-turn fingerprint so a
   * recap fires once per answer.
   */
  getTurnCount: (sessionId: SessionId) => number | undefined
  /**
   * Register a picked directory as a Host Workspace.
   * @param input - the Host create payload.
   * @returns the created (or idempotently resolved) Workspace.
   */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  /**
   * Resolve the conversation a new Workspace lands in: reuse its existing
   * blank session when present, else mint a fresh one on the host.
   * @param workspaceId - the Workspace to connect.
   * @returns the reused or newly created session id.
   */
  connectWorkspace: (workspaceId: WorkspaceId) => Promise<SessionId>
  /**
   * Open the Host's native directory picker for a new Workspace.
   * @returns the selected absolute path, or null when cancelled.
   */
  pickDirectory: () => Promise<string | null>
}

/** Full panels-slot props: runtime share (owner renderConversation + global hooks), store share, injected face, locale seat. */
export type PanelWorkspaceProps =
  PropsRuntime<'panels'>
  & PropsStore<ReturnType<typeof createPanelsStore>>
  & PanelsInjected
  & PropsLocale<'panels'>

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Injected business face of the panel handoff assistant action entry. */
export interface PanelHandoffInjected {
  getPanels: () => readonly PanelRecord[]
  subscribePanels: (onChange: () => void) => () => void
  relay: (request: SessionHandoffRequest) => Promise<RemoteResult<SessionHandoffRelayResult>>
  summarize: (panelId: string, sessionId: SessionId) => Promise<void>
}

/** Full props of the panel handoff assistant action. */
export type PanelHandoffActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & PanelHandoffInjected
  & PropsLocale<'panels'>

/** Injected business face of the sidebar session-row add-in-panel action. */
export interface SidebarSessionActionInjected {
  /**
   * Create a new panel hosting the session and focus it (the panels store is
   * persisted, so the panel survives reloads; the session becomes current).
   * @param sessionId - the session to host in the new panel.
   */
  addToPanel: (sessionId: SessionId) => void
}

/** Full props of the sidebar session-row add-in-panel action (owner share + injected + locale). */
export type SidebarAddPanelActionProps =
  PropsRuntime<'sidebar.workspaces.session-actions'>
  & SidebarSessionActionInjected
  & PropsLocale<'panels'>
