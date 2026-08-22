/**
 * The panels workspace store: the named panel list, the layout mode, and the
 * focused panel. Root scope (one instance per plugin fiber); persisted to
 * localStorage so a reload restores the user's workspace (names + session
 * bindings — the sessions themselves are durable on the host).
 *
 * Module level exports the factory only — a module-level handle would pin the
 * store's identity in the module cache (a de-facto singleton surviving plugin
 * reloads). register() receives the factory (exclusive use: the framework
 * instantiates per entry), and PanelWorkspace derives its PropsStore share
 * from the return type; the inject factory receives the bound actions.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Workspace layout mode: all panels visible, or one at a time with tabs. */
export type PanelLayoutMode = 'tiled' | 'tabbed'

/** Per-panel summary lifecycle (the block under the panel header). */
export type PanelSummaryState = 'idle' | 'generating' | 'error'

/** One named panel: a user label plus the session it hosts. */
export interface PanelRecord {
  /** Stable panel identity (crypto-random at creation; survives reloads). */
  id: string
  /** User-chosen panel name ("review", "planner", …). */
  name: string
  /** The session this panel hosts; absent = the hero/new-session state. */
  sessionId?: SessionId | undefined
  /** Last AI-generated summary of the panel's conversation. */
  summary?: string | undefined
  /** Summary generation lifecycle. */
  summaryState: PanelSummaryState
  /** Auto-recap goal of the last answer (the user's request). */
  recapGoal?: string | undefined
  /** Auto-recap result of the last answer (what the assistant delivered). */
  recapResult?: string | undefined
}

/** Panels workspace state. */
export interface PanelsState {
  layout: PanelLayoutMode
  /** Focused panel id (the tabbed view shows it; the sidebar highlight follows its session). */
  activePanelId: string | undefined
  panels: PanelRecord[]
}

/** The complete mutation set (the audit face; PanelWorkspace writes through these only). */
export type PanelsActions = {
  /** Append a panel (caller supplies id + name, and the optional initial session). */
  addPanel: (draft: PanelsState, id: string, name: string, sessionId?: SessionId) => void
  /** Remove a panel; the focus moves to the nearest survivor. */
  removePanel: (draft: PanelsState, id: string) => void
  /** Rename a panel. */
  renamePanel: (draft: PanelsState, id: string, name: string) => void
  /** Rebind a panel to another session (or unbind with undefined); clears its summary. */
  setPanelSession: (draft: PanelsState, id: string, sessionId?: SessionId) => void
  /** Store the AI-generated summary of a panel's conversation. */
  setPanelSummary: (draft: PanelsState, id: string, summary: string | undefined) => void
  /** Mark a summary generation lifecycle state. */
  setSummaryState: (draft: PanelsState, id: string, state: PanelSummaryState) => void
  /** Store the auto-extracted last-answer recap (undefined clears both). */
  setPanelRecap: (draft: PanelsState, id: string, goal: string | undefined, result: string | undefined) => void
  /** Switch the workspace layout mode. */
  setLayout: (draft: PanelsState, layout: PanelLayoutMode) => void
  /** Focus a panel (drives the tabbed view and the active marker). */
  focusPanel: (draft: PanelsState, id: string) => void
}

/**
 * Create the panels workspace store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createPanelsStore(): EngineStoreHandle<PanelsState, PanelsActions> {
  return defineStore({
    persist: 'dsh.ui-panels.v1',
    init: (): PanelsState => ({ layout: 'tiled', activePanelId: undefined, panels: [] }),
    actions: {
      addPanel: (d, id, name, sessionId) => {
        d.panels.push({ id, name, sessionId, summary: undefined, summaryState: 'idle', recapGoal: undefined, recapResult: undefined })
        d.activePanelId = id
      },
      removePanel: (d, id) => {
        const at = d.panels.findIndex(panel => panel.id === id)
        if (at < 0) return
        d.panels.splice(at, 1)
        if (d.activePanelId === id) {
          d.activePanelId = d.panels[Math.min(at, d.panels.length - 1)]?.id
        }
      },
      renamePanel: (d, id, name) => {
        const panel = d.panels.find(candidate => candidate.id === id)
        if (panel !== undefined) panel.name = name
      },
      setPanelSession: (d, id, sessionId) => {
        const panel = d.panels.find(candidate => candidate.id === id)
        if (panel === undefined) return
        panel.sessionId = sessionId
        // A different conversation invalidates the previous summary and recap.
        panel.summary = undefined
        panel.summaryState = 'idle'
        panel.recapGoal = undefined
        panel.recapResult = undefined
      },
      setPanelSummary: (d, id, summary) => {
        const panel = d.panels.find(candidate => candidate.id === id)
        if (panel === undefined) return
        panel.summary = summary
        panel.summaryState = 'idle'
      },
      setSummaryState: (d, id, state) => {
        const panel = d.panels.find(candidate => candidate.id === id)
        if (panel !== undefined) panel.summaryState = state
      },
      setPanelRecap: (d, id, goal, result) => {
        const panel = d.panels.find(candidate => candidate.id === id)
        if (panel === undefined) return
        panel.recapGoal = goal
        panel.recapResult = result
      },
      setLayout: (d, layout) => { d.layout = layout },
      focusPanel: (d, id) => { d.activePanelId = id },
    },
  })
}
