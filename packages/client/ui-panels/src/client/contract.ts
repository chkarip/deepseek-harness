/**
 * ui-panels contracts: the slot props of the panels workspace and the
 * injected business face (callbacks closed over the apply ctx).
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PanelsKey } from './locales.ts'
import type { createPanelsStore } from './panels-store.ts'

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
   * @returns the new session id.
   */
  createSession: () => Promise<SessionId>
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
}

/** Full panels-slot props: runtime share (owner renderConversation + global hooks), store share, injected face, locale seat. */
export type PanelWorkspaceProps =
  PropsRuntime<'panels'>
  & PropsStore<ReturnType<typeof createPanelsStore>>
  & PanelsInjected
  & PropsLocale<'panels'>
