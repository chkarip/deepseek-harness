/**
 * PanelWorkspace: the center-column panels surface (occupant of the 'panels'
 * slot). Owns the toolbar (+ Add panel, Tiled/Tabbed toggle), the tiled row
 * or tabbed strip of named PanelFrames, and the no-panels fallback (exactly
 * the pre-panels single current-session conversation).
 *
 * Pure presentation: panel state arrives through the declared store, session
 * facts through the standard useSessions hook, and every domain verb
 * (summarize / create / open) through the injected face.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { SessionId, SessionSummary, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ForkRole, PanelWorkspaceProps } from './contract.ts'
import { ForkRoleModal } from './ForkRoleModal.tsx'
import { PanelFrame, type PanelFrameProps } from './PanelFrame.tsx'
import { WorkspaceStep } from './WorkspaceStep.tsx'
import css from './PanelWorkspace.module.css'

/** Generate the next default panel name from the current roster size. */
function nextDefaultName(panelCount: number, t: (key: 'panel.defaultName') => string): string {
  return `${t('panel.defaultName')} ${panelCount + 1}`
}

/**
 * Session rows the picker lists (stable order from the list snapshot).
 * Archived sessions are excluded — the app-wide rule is that archived
 * sessions are visible nowhere, so no surface (sidebar, panels picker)
 * may offer one for binding.
 */
function sessionRows(
  list: { ids: readonly string[]; byId: Record<string, SessionSummary> },
  archivedSessionIds: readonly SessionId[],
): readonly SessionSummary[] {
  const archived = new Set(archivedSessionIds)
  return list.ids
    .map(id => list.byId[id])
    .filter((row): row is SessionSummary => row !== undefined && !archived.has(row.id))
}

/** Idle window after the agent's last answer before the auto-recap fires. */
const RECAP_IDLE_MS = 60_000

export function PanelWorkspace({
  renderConversation, useStore, actions, useSessions, useWorkspaces,
  summarize, extractRecap, getTurnCount, createSession, createWorkspace, connectWorkspace, pickDirectory,
  forkSession, openSession, openWindow, t,
}: PanelWorkspaceProps) {
  const state = useStore(store => store)
  const sessions = useSessions(store => store)
  const workspaces = useWorkspaces(store => store)
  const [autoPickerPanelId, setAutoPickerPanelId] = useState<string | undefined>(undefined)
  const [workspaceStepPanelId, setWorkspaceStepPanelId] = useState<string | undefined>(undefined)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>(undefined)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [forkModal, setForkModal] = useState<{ panelId: string; sourceSessionId: SessionId } | null>(null)

  // Multi-pane liveness: every bound panel's session opens its event window
  // (idempotent) so ALL visible panels stream, not just the focused one.
  // The roster's identity only changes on panel mutations, and openWindow
  // no-ops on an already-open window, so repeats are harmless.
  useEffect(() => {
    for (const panel of state.panels) {
      if (panel.sessionId !== undefined) openWindow(panel.sessionId)
    }
  }, [state.panels, openWindow])

  // External navigation sync: when a session is selected externally (e.g.
  // "+ New session" in the sidebar, or clicking a session row in the sidebar),
  // focus the matching panel if already open, or bind it to the active panel.
  useEffect(() => {
    if (sessions.current === undefined || state.panels.length === 0) return
    const matchingPanel = state.panels.find(panel => panel.sessionId === sessions.current)
    if (matchingPanel !== undefined) {
      if (state.activePanelId !== matchingPanel.id) {
        actions.focusPanel(matchingPanel.id)
      }
    } else {
      const targetPanelId = state.activePanelId ?? state.panels[0]?.id
      if (targetPanelId !== undefined) {
        actions.setPanelSession(targetPanelId, sessions.current)
      }
    }
  }, [sessions.current, state.panels, state.activePanelId, actions])

  // Auto-recap: after a bound panel's session sits idle for RECAP_IDLE_MS
  // following an answer, extract the last answer's goal + result locally from
  // the session snapshot (no model call, so nothing is sent into the
  // conversation). A per-panel turn fingerprint (`turnEnds.size`) ensures the
  // recap fires once per answer.
  const recapTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const recapTurn = useRef<Map<string, { sessionId: SessionId; turn: number }>>(new Map())
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const clearTimer = (panelId: string): void => {
      const timer = recapTimers.current.get(panelId)
      if (timer === undefined) return
      clearTimeout(timer)
      recapTimers.current.delete(panelId)
    }

    for (const panel of state.panels) {
      const sessionId = panel.sessionId
      if (sessionId === undefined) continue
      const summary = sessions.byId[sessionId]
      if (summary === undefined || summary.blank || summary.running) {
        clearTimer(panel.id)
        continue
      }
      const turn = getTurnCount(sessionId)
      if (turn === undefined) continue
      const done = recapTurn.current.get(panel.id)
      if (done !== undefined && done.sessionId === sessionId && done.turn === turn) continue
      // A new answer supersedes any previous recap.
      if (panel.recapGoal !== undefined || panel.recapResult !== undefined) {
        actions.setPanelRecap(panel.id, undefined, undefined)
      }
      // Arm the idle timer once for this turn.
      if (recapTimers.current.has(panel.id)) continue
      const timer = setTimeout(() => {
        recapTimers.current.delete(panel.id)
        const live = stateRef.current.panels.find(candidate => candidate.id === panel.id)
        if (live?.sessionId !== sessionId) return
        // Mark the turn as handled even when nothing is extractable, so a
        // text-less answer cannot re-arm the timer every idle window.
        recapTurn.current.set(panel.id, { sessionId, turn })
        const recap = extractRecap(sessionId)
        if (recap !== undefined) actions.setPanelRecap(panel.id, recap.goal, recap.result)
      }, RECAP_IDLE_MS)
      recapTimers.current.set(panel.id, timer)
    }

    // Drop timers/state for panels that were removed or unbound.
    const bound = new Set(state.panels.filter(panel => panel.sessionId !== undefined).map(panel => panel.id))
    for (const panelId of [...recapTimers.current.keys()]) {
      if (!bound.has(panelId)) clearTimer(panelId)
    }
    for (const panelId of [...recapTurn.current.keys()]) {
      if (!bound.has(panelId)) recapTurn.current.delete(panelId)
    }
  }, [sessions, state.panels, actions, extractRecap, getTurnCount])

  // Clear any pending recap timers on unmount.
  useEffect(() => () => {
    for (const timer of recapTimers.current.values()) clearTimeout(timer)
    recapTimers.current.clear()
  }, [])

  const addPanel = (): void => {
    const id = crypto.randomUUID()
    actions.addPanel(id, nextDefaultName(state.panels.length, key => t(key)))
    // First choose a workspace: an existing one advances to the conversation
    // picker; a new one is created and auto-binds a fresh conversation.
    setWorkspaceStepPanelId(id)
  }

  /** Focus a panel: select its session as current and mark it active. */
  const focusPanel = (panelId: string): void => {
    actions.focusPanel(panelId)
    const panel = state.panels.find(candidate => candidate.id === panelId)
    if (panel?.sessionId !== undefined) openSession(panel.sessionId)
  }

  /** Bind a session to a panel, focus it, and focus the panel. If the session is already open in another panel, open fork pathway modal. */
  const pickSession = (panelId: string, sessionId: SessionId): void => {
    // The pending workspace choice only matters until a session is bound; a
    // later "New conversation" falls back to the current/recent workspace.
    setPendingWorkspaceId(undefined)
    const isAlreadyOpen = state.panels.some(
      candidate => candidate.id !== panelId && candidate.sessionId === sessionId,
    )
    if (isAlreadyOpen) {
      setForkModal({ panelId, sourceSessionId: sessionId })
      return
    }
    actions.setPanelSession(panelId, sessionId)
    openSession(sessionId)
    actions.focusPanel(panelId)
  }

  /** Existing workspace chosen: remember it as the panel's "New conversation" target and advance to the session picker. */
  const pickWorkspace = (workspaceId: WorkspaceId): void => {
    const panelId = workspaceStepPanelId
    if (panelId === undefined) return
    setPendingWorkspaceId(workspaceId)
    setWorkspaceStepPanelId(undefined)
    setAutoPickerPanelId(panelId)
  }

  /** New workspace: pick a directory, register it, and auto-bind a fresh conversation. */
  const createNewWorkspace = (): void => {
    const panelId = workspaceStepPanelId
    if (panelId === undefined) return
    setWorkspaceBusy(true)
    setWorkspaceError(null)
    void (async () => {
      try {
        const path = await pickDirectory()
        if (path === null) return
        const workspace = await createWorkspace({ path })
        const sessionId = await connectWorkspace(workspace.workspaceId)
        setWorkspaceStepPanelId(undefined)
        pickSession(panelId, sessionId)
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error))
      } finally {
        setWorkspaceBusy(false)
      }
    })()
  }

  /** Handle fork pathway selection from the ForkRoleModal. */
  const handleSelectForkRole = async (role: ForkRole, customGoal?: string  ): Promise<void> => {
    if (forkModal === null) return
    const { panelId, sourceSessionId } = forkModal
    setForkModal(null)
    try {
      const result = await forkSession({ sourceSessionId, role, customGoal })
      actions.setPanelSession(panelId, result.sessionId)
      if (result.panelName !== undefined && result.panelName !== '') {
        actions.renamePanel(panelId, result.panelName)
      }
      openSession(result.sessionId)
      actions.focusPanel(panelId)
    } catch (error) {
      console.error('[ui-panels] fork with role failed:', error)
    }
  }

  // No panels: the body is the plain single current-session conversation —
  // the exact pre-panels center column, so the cold-start and
  // single-session flows are unchanged. The toolbar stays mounted so the
  // "+ Add panel" affordance is always discoverable.
  const rows = sessionRows(sessions, workspaces.archivedSessionIds)
  const active = state.layout === 'tabbed'
    ? state.panels.find(panel => panel.id === state.activePanelId) ?? state.panels[0]
    : undefined
  const frameProps = (panel: PanelFrameProps['panel']): PanelFrameProps => {
    const panelId = panel.id
    return {
      panel,
      rows,
      currentSessionId: sessions.current,
      pickerAutoOpen: autoPickerPanelId === panelId,
      onPickerAutoOpened: () =>{  setAutoPickerPanelId(current => current === panelId ? undefined : current) },
      onFocus: () =>{  focusPanel(panelId) },
      onPickSession: (sessionId) => { pickSession(panelId, sessionId) },
      onCreateSession: () => {
        void (async () => {
          try {
            const sessionId = await createSession(pendingWorkspaceId)
            setPendingWorkspaceId(undefined)
            pickSession(panelId, sessionId)
          } catch (error) {
            // The panel stays unbound (its hero lets the user pick a workspace).
            console.error('[ui-panels] create conversation failed:', error)
          }
        })()
      },
      onCreateFork: () => {
        const source = sessions.current
        if (source === undefined) return
        setForkModal({ panelId, sourceSessionId: source })
      },
      onClose: () =>{  actions.removePanel(panelId) },
      onRename: (name) =>{  actions.renamePanel(panelId, name) },
      onSummarize: () => {
        if (panel.sessionId !== undefined) void summarize(panelId, panel.sessionId)
      },
      renderConversation,
      t,
    }
  }
  const body = state.panels.length === 0
    ? <div className={css.singleFallback}>{renderConversation(undefined)}</div>
    : state.layout === 'tiled' ? (
      <div className={css.tiledRow}>
        {state.panels.map(panel => (
          <PanelFrame key={panel.id} {...frameProps(panel)} />
        ))}
      </div>
    ) : (
      <div className={css.tabbedBody}>
        <div className={css.tabStrip} role="tablist" aria-label={t('panel.tabs')}>
          {state.panels.map(panel => (
            <button
              type="button"
              key={panel.id}
              role="tab"
              aria-selected={panel.id === active?.id}
              className={clsx(css.tab, panel.id === active?.id && css.tabActive)}
              onClick={() =>{  focusPanel(panel.id) }}
            >
              {panel.name}
            </button>
          ))}
        </div>
        {active !== undefined && (
          <PanelFrame key={active.id} {...frameProps(active)} />
        )}
      </div>
    )

  return (
    <div className={css.workspace} data-layout={state.layout}>
      <div className={css.toolbar}>
        <button type="button" className={css.addButton} onClick={addPanel}>
          {t('toolbar.add')}
        </button>
        <div className={css.layoutToggle} role="group" aria-label={t('toolbar.layout')}>
          <button
            type="button"
            className={clsx(css.layoutButton, state.layout === 'tiled' && css.layoutActive)}
            aria-pressed={state.layout === 'tiled'}
            onClick={() =>{  actions.setLayout('tiled') }}
          >
            {t('toolbar.layout.tiled')}
          </button>
          <button
            type="button"
            className={clsx(css.layoutButton, state.layout === 'tabbed' && css.layoutActive)}
            aria-pressed={state.layout === 'tabbed'}
            onClick={() =>{  actions.setLayout('tabbed') }}
          >
            {t('toolbar.layout.tabbed')}
          </button>
        </div>
      </div>
      {body}
      <ForkRoleModal
        open={forkModal !== null}
        onSelectRole={(role, customGoal) => { void handleSelectForkRole(role, customGoal) }}
        onClose={() =>{  setForkModal(null) }}
        t={t}
      />
      <WorkspaceStep
        open={workspaceStepPanelId !== undefined}
        workspaces={workspaces.items}
        loading={workspaces.phase !== 'ready'}
        busy={workspaceBusy}
        error={workspaceError}
        onPickWorkspace={pickWorkspace}
        onNewWorkspace={createNewWorkspace}
        onClose={() =>{  setWorkspaceStepPanelId(undefined); setWorkspaceError(null) }}
        t={t}
      />
    </div>
  )
}
