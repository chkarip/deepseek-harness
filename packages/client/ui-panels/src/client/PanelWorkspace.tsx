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
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { ForkRole, PanelWorkspaceProps } from './contract.ts'
import { ForkRoleModal } from './ForkRoleModal.tsx'
import { PanelFrame, type PanelFrameProps } from './PanelFrame.tsx'
import css from './PanelWorkspace.module.css'

/** Generate the next default panel name from the current roster size. */
function nextDefaultName(panelCount: number, t: (key: 'panel.defaultName') => string): string {
  return `${t('panel.defaultName')} ${panelCount + 1}`
}

/** Session rows the picker lists (stable order from the list snapshot). */
function sessionRows(list: { ids: readonly string[]; byId: Record<string, SessionSummary> }): readonly SessionSummary[] {
  return list.ids
    .map(id => list.byId[id])
    .filter((row): row is SessionSummary => row !== undefined)
}

export function PanelWorkspace({
  renderConversation, useStore, actions, useSessions, summarize, createSession, forkSession, openSession, openWindow, t,
}: PanelWorkspaceProps) {
  const state = useStore(store => store)
  const sessions = useSessions(store => store)
  const [autoPickerPanelId, setAutoPickerPanelId] = useState<string | undefined>(undefined)
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

  const addPanel = (): void => {
    const id = crypto.randomUUID()
    actions.addPanel(id, nextDefaultName(state.panels.length, key => t(key)))
    // The fresh panel opens its session picker immediately: one click to
    // bind an existing conversation or create a new one.
    setAutoPickerPanelId(id)
  }

  /** Focus a panel: select its session as current and mark it active. */
  const focusPanel = (panelId: string): void => {
    actions.focusPanel(panelId)
    const panel = state.panels.find(candidate => candidate.id === panelId)
    if (panel?.sessionId !== undefined) openSession(panel.sessionId)
  }

  /** Bind a session to a panel, focus it, and focus the panel. If the session is already open in another panel, open fork pathway modal. */
  const pickSession = async (panelId: string, sessionId: SessionId): Promise<void> => {
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

  /** Handle fork pathway selection from the ForkRoleModal. */
  const handleSelectForkRole = async (role: ForkRole, customGoal?: string | undefined): Promise<void> => {
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
  const rows = sessionRows(sessions)
  const active = state.layout === 'tabbed'
    ? state.panels.find(panel => panel.id === state.activePanelId) ?? state.panels[0]
    : undefined
  const frameProps = (panelId: string): PanelFrameProps => ({
    panel: state.panels.find(panel => panel.id === panelId)!,
    rows,
    currentSessionId: sessions.current,
    pickerAutoOpen: autoPickerPanelId === panelId,
    onPickerAutoOpened: () => setAutoPickerPanelId(current => current === panelId ? undefined : current),
    onFocus: () => focusPanel(panelId),
    onPickSession: (sessionId) => { void pickSession(panelId, sessionId) },
    onCreateSession: async () => {
      try {
        const sessionId = await createSession()
        await pickSession(panelId, sessionId)
      } catch (error) {
        // The panel stays unbound (its hero lets the user pick a workspace).
        console.error('[ui-panels] create conversation failed:', error)
      }
    },
    onCreateFork: () => {
      const source = sessions.current
      if (source === undefined) return
      setForkModal({ panelId, sourceSessionId: source })
    },
    onClose: () => actions.removePanel(panelId),
    onRename: (name) => actions.renamePanel(panelId, name),
    onSummarize: () => {
      const panel = state.panels.find(candidate => candidate.id === panelId)
      if (panel?.sessionId !== undefined) void summarize(panelId, panel.sessionId)
    },
    renderConversation,
    t,
  })
  const body = state.panels.length === 0
    ? <div className={css.singleFallback}>{renderConversation(undefined)}</div>
    : state.layout === 'tiled' ? (
      <div className={css.tiledRow}>
        {state.panels.map(panel => (
          <PanelFrame key={panel.id} {...frameProps(panel.id)} />
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
              onClick={() => focusPanel(panel.id)}
            >
              {panel.name}
            </button>
          ))}
        </div>
        {active !== undefined && (
          <PanelFrame key={active.id} {...frameProps(active.id)} />
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
            onClick={() => actions.setLayout('tiled')}
          >
            {t('toolbar.layout.tiled')}
          </button>
          <button
            type="button"
            className={clsx(css.layoutButton, state.layout === 'tabbed' && css.layoutActive)}
            aria-pressed={state.layout === 'tabbed'}
            onClick={() => actions.setLayout('tabbed')}
          >
            {t('toolbar.layout.tabbed')}
          </button>
        </div>
      </div>
      {body}
      <ForkRoleModal
        open={forkModal !== null}
        onSelectRole={(role, customGoal) => { void handleSelectForkRole(role, customGoal) }}
        onClose={() => setForkModal(null)}
        t={t}
      />
    </div>
  )
}
