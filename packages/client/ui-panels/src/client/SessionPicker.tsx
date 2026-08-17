/**
 * SessionPicker: the popup menu listing existing sessions plus a "New
 * conversation" action, used to bind a panel to its conversation. Outside
 * clicks close it; the anchor (the panel's session chip) is excluded from
 * the click-away check so toggling keeps working.
 */
import { useEffect, useRef, type RefObject } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import css from './SessionPicker.module.css'

/** Full props of the session picker popup. */
export interface SessionPickerProps {
  /** Whether the popup is open. */
  open: boolean
  /** The chip that toggles the popup (excluded from click-away). */
  anchorRef: RefObject<HTMLElement>
  /** Session rows to offer (stable order). */
  rows: readonly SessionSummary[]
  /** The panel's currently bound session (highlighted with a check). */
  selectedId: SessionId | undefined
  /** Bind the picked session to the panel. */
  onPick: (sessionId: SessionId) => void
  /** Create a fresh conversation and bind it. */
  onNew: () => void
  /** Branch the current conversation (shared context) and bind the child. */
  canFork: boolean
  /** Fork the focused session into a shared-context child and bind it. */
  onFork: () => void
  /** Close the popup. */
  onClose: () => void
  t: TranslateNS<'panels'>
}

export function SessionPicker({
  open, anchorRef, rows, selectedId, onPick, onNew, canFork, onFork, onClose, t,
}: SessionPickerProps) {
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null
      if (target === null) return
      if (anchorRef.current?.contains(target) ?? false) return
      if (popupRef.current?.contains(target) ?? false) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, anchorRef, onClose])

  if (!open) return null

  return (
    <div className={css.popup} ref={popupRef} role="menu" aria-label={t('panel.session.pick')}>
      <button type="button" role="menuitem" className={css.newRow} onClick={onNew}>
        {t('panel.session.new')}
      </button>
      {canFork && (
        <button type="button" role="menuitem" className={css.forkRow} onClick={onFork}>
          {t('panel.session.fork')}
        </button>
      )}
      <div className={css.list} role="presentation">
        {rows.map(row => (
          <button
            type="button"
            role="menuitem"
            key={row.id}
            className={clsx(css.row, row.id === selectedId && css.rowSelected)}
            onClick={() => { onPick(row.id) }}
          >
            <span className={css.rowTitle}>{row.displayTitle}</span>
            {row.running && <span className={css.rowRunning} aria-label="running" />}
          </button>
        ))}
        {rows.length === 0 && <div className={css.empty}>{t('panel.session.empty')}</div>}
      </div>
    </div>
  )
}
