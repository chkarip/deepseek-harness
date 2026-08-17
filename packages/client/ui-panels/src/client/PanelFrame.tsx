/**
 * PanelFrame: one named panel — header chrome (editable name, session chip
 * with picker, AI-summarize, close), the collapsible summary block, and the
 * panel's conversation body (rendered by the frame's own renderConversation
 * owner share, bound to the panel's session).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { PanelRecord } from './panels-store.ts'
import { SessionPicker } from './SessionPicker.tsx'
import css from './PanelFrame.module.css'

/** Full props of one panel frame (composed by PanelWorkspace). */
export interface PanelFrameProps {
  panel: PanelRecord
  /** Session rows for the picker (stable order). */
  rows: readonly SessionSummary[]
  /** The currently selected session (frame highlight + focus marker). */
  currentSessionId: SessionId | undefined
  /** Open the picker on mount (a freshly added panel). */
  pickerAutoOpen: boolean
  /** Acknowledge the auto-open so it does not re-open on re-render. */
  onPickerAutoOpened: () => void
  /** Focus this panel (selects its session as current). */
  onFocus: () => void
  /** Bind a session to this panel. */
  onPickSession: (sessionId: SessionId) => void
  /** Create a fresh conversation and bind it to this panel. */
  onCreateSession: () => void
  /** Branch the focused conversation (shared context) and bind the child. */
  onCreateFork: () => void
  /** Remove this panel. */
  onClose: () => void
  /** Persist a renamed panel label. */
  onRename: (name: string) => void
  /** Ask this panel's agent for an AI summary of its conversation. */
  onSummarize: () => void
  /** The frame's own conversation renderer (bound to the panel session). */
  renderConversation: (sessionId?: SessionId) => ReactNode
  t: TranslateNS<'panels'>
}

export function PanelFrame({
  panel, rows, currentSessionId, pickerAutoOpen, onPickerAutoOpened, onFocus,
  onPickSession, onCreateSession, onCreateFork, onClose, onRename, onSummarize, renderConversation, t,
}: PanelFrameProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(panel.name)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerAnchor = useRef<HTMLButtonElement>(null)

  // Freshly added panels open their picker once (mount-scoped).
  useEffect(() => {
    if (!pickerAutoOpen) return
    setPickerOpen(true)
    onPickerAutoOpened()
  }, [pickerAutoOpen, onPickerAutoOpened])

  const sessionAvailable = panel.sessionId === undefined || rows.some(row => row.id === panel.sessionId)
  const boundRow = panel.sessionId === undefined ? undefined : rows.find(row => row.id === panel.sessionId)
  const isCurrent = panel.sessionId !== undefined && panel.sessionId === currentSessionId
  // Fork needs a focused source with actual history (blank sessions have no
  // completed turn to branch from).
  const currentRow = currentSessionId === undefined ? undefined : rows.find(row => row.id === currentSessionId)
  const canFork = currentRow !== undefined && currentRow.blank === false

  const commitRename = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next !== '' && next !== panel.name) onRename(next)
  }

  return (
    <section
      className={clsx(css.frame, isCurrent && css.frameCurrent)}
      data-panel-id={panel.id}
      data-session-id={panel.sessionId}
      onClick={() => onFocus()}
    >
      <header className={css.header}>
        {editing ? (
          <input
            className={css.nameInput}
            value={draft}
            autoFocus
            aria-label={t('panel.name')}
            onFocus={(event) => { event.currentTarget.select() }}
            onChange={(event) => { setDraft(event.currentTarget.value) }}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              else if (event.key === 'Escape') { setDraft(panel.name); setEditing(false) }
            }}
          />
        ) : (
          <button
            type="button"
            className={css.nameButton}
            title={t('panel.renameHint') ?? panel.name}
            onClick={(event) => { event.stopPropagation(); setDraft(panel.name); setEditing(true) }}
          >
            {panel.name}
          </button>
        )}
        <button
          type="button"
          ref={pickerAnchor}
          className={clsx(css.sessionChip, boundRow === undefined && css.sessionChipEmpty)}
          onClick={(event) => { event.stopPropagation(); setPickerOpen(open => !open) }}
        >
          {boundRow?.displayTitle ?? t('panel.session.none')}
        </button>
        <SessionPicker
          open={pickerOpen}
          anchorRef={pickerAnchor}
          rows={rows}
          selectedId={panel.sessionId}
          onPick={(sessionId) => { setPickerOpen(false); onPickSession(sessionId) }}
          onNew={() => { setPickerOpen(false); void onCreateSession() }}
          canFork={canFork}
          onFork={() => { setPickerOpen(false); void onCreateFork() }}
          onClose={() => { setPickerOpen(false) }}
          t={t}
        />
        <span className={css.spacer} />
        <button
          type="button"
          className={css.summarizeButton}
          disabled={panel.sessionId === undefined || panel.summaryState === 'generating'}
          title={t('panel.summarizeLabel', { name: panel.name })}
          onClick={(event) => { event.stopPropagation(); onSummarize() }}
        >
          {t('panel.summarize')}
        </button>
        <button
          type="button"
          className={css.closeButton}
          title={t('panel.closeLabel', { name: panel.name })}
          aria-label={t('panel.closeLabel', { name: panel.name })}
          onClick={(event) => { event.stopPropagation(); onClose() }}
        >
          ✕
        </button>
      </header>
      {(panel.summaryState === 'generating' || panel.summaryState === 'error' || panel.summary !== undefined) && (
        <div className={css.summaryArea} data-panel-chrome>
          {panel.summaryState === 'generating' && (
            <div className={css.summaryStatus} role="status">{t('panel.summary.generating')}</div>
          )}
          {panel.summaryState === 'error' && (
            <div className={clsx(css.summaryStatus, css.summaryError)} role="alert">{t('panel.summary.error')}</div>
          )}
          {panel.summary !== undefined && (
            <details className={css.summaryBlock} open>
              <summary>{t('panel.summary.title')}</summary>
              <p className={css.summaryText}>{panel.summary}</p>
            </details>
          )}
        </div>
      )}
      <div className={css.body}>
        {panel.sessionId === undefined
          // Unbound panel: a panel-owned empty state, NEVER the ambient
          // current conversation (rendering the slot without an override
          // would mirror the focused chat into this panel).
          ? (
            <div className={css.unavailable} data-panel-empty>
              <span className={css.unavailableTitle}>{t('panel.session.none')}</span>
              <span className={css.unavailableHint}>{t('panel.empty.hint')}</span>
            </div>
          )
          : sessionAvailable
            ? renderConversation(panel.sessionId)
            : <div className={css.unavailable}>{t('panel.session.unavailable')}</div>}
      </div>
    </section>
  )
}
