/**
 * Per-message handoff action: sends a finalized assistant message to another panel.
 * Rendered inside the assistant message's IconActions row.
 *
 * @module @deepseek-ai/dsh-client-ui-panels/client/PanelHandoffAction
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IconCloseOutline16, IconShareOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionHandoffDelivery } from '@deepseek-ai/dsh-session-handoff/types'
import type { PanelHandoffActionProps } from './contract.ts'
import css from './PanelHandoffAction.module.css'

export function PanelHandoffAction({
  messageId,
  sessionId,
  getPanels,
  subscribePanels,
  relay,
  summarize,
  t,
}: PanelHandoffActionProps) {
  const [open, setOpen] = useState(false)
  const [targetPanelId, setTargetPanelId] = useState<string>('')
  const [includeQuestion, setIncludeQuestion] = useState(true)
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeAnswer, setIncludeAnswer] = useState(true)
  const [note, setNote] = useState('')
  const [delivery, setDelivery] = useState<SessionHandoffDelivery>('attach')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const panels = useSyncExternalStore(subscribePanels, getPanels)
  const otherPanels = panels.filter(p => p.sessionId !== undefined && p.sessionId !== sessionId)
  const currentPanel = panels.find(p => p.sessionId === sessionId)

  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  if (otherPanels.length === 0) {
    return null
  }

  // Sync default target panel when opening or panels change
  useEffect(() => {
    if (open) {
      if (otherPanels.length > 0 && (!targetPanelId || !otherPanels.some(p => p.id === targetPanelId))) {
        setTargetPanelId(otherPanels[0]?.id ?? '')
      }
    }
  }, [open, otherPanels, targetPanelId])

  // Outside click & escape listener to close popover
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null
      if (target === null) return
      if (containerRef.current?.contains(target) ?? false) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const onOpen = useCallback(() => {
    setStatus('idle')
    setErrorMessage(null)
    setOpen(true)
  }, [])

  const onClose = useCallback(() => {
    setOpen(false)
  }, [])

  const onSummarizeSource = useCallback(() => {
    if (currentPanel !== undefined && sessionId !== undefined) {
      void summarize(currentPanel.id, sessionId)
    }
  }, [currentPanel, sessionId, summarize])

  const onSend = useCallback(async () => {
    const targetPanel = otherPanels.find(p => p.id === targetPanelId)
    if (targetPanel?.sessionId === undefined) {
      setErrorMessage(t('handoff.error.noTarget'))
      return
    }

    setStatus('sending')
    setErrorMessage(null)

    try {
      const res = await relay({
        sourceSessionId: sessionId,
        messageId,
        targetSessionId: targetPanel.sessionId,
        senderLabel: currentPanel?.name ?? t('panel.defaultName'),
        include: {
          answer: includeAnswer,
          question: includeQuestion,
          summary: includeSummary,
        },
        ...(currentPanel?.summary ? { summaryText: currentPanel.summary } : {}),
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        delivery,
      })

      if ('ok' in res && res.ok === false) {
        setStatus('error')
        setErrorMessage(res.error.message || t('handoff.error.generic'))
        return
      }

      setStatus('sent')
      setTimeout(() => {
        setOpen(false)
        setStatus('idle')
      }, 1000)
    } catch (err: unknown) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : t('handoff.error.generic'))
    }
  }, [
    currentPanel,
    delivery,
    includeAnswer,
    includeQuestion,
    includeSummary,
    messageId,
    note,
    otherPanels,
    relay,
    sessionId,
    t,
    targetPanelId,
  ])

  const actionLabel = t('handoff.action')

  return (
    <div className={css.wrapper} ref={containerRef}>
      <Tooltip label={actionLabel} side="bottom">
        <button
          ref={buttonRef}
          type="button"
          className={css.action}
          aria-label={actionLabel}
          aria-expanded={open}
          data-active={open || undefined}
          onClick={() => {
            if (open) onClose()
            else onOpen()
          }}
        >
          <IconShareOutline16 />
        </button>
      </Tooltip>

      {open && (
        <div className={css.popover} role="dialog" aria-label={t('handoff.popover.title')}>
          <div className={css.popoverHeader}>
            <span>{t('handoff.popover.title')}</span>
            <button type="button" className={css.closeButton} onClick={onClose} aria-label={t('handoff.cancel')}>
              <IconCloseOutline16 />
            </button>
          </div>

          <div className={css.field}>
            <label className={css.fieldLabel}>{t('handoff.targetPanel')}</label>
            {otherPanels.length === 0 ? (
              <span className={css.fieldLabel}>{t('handoff.noOtherPanels')}</span>
            ) : (
              <select
                className={css.select}
                value={targetPanelId}
                onChange={e => setTargetPanelId(e.target.value)}
                disabled={status === 'sending'}
              >
                {otherPanels.map(panel => (
                  <option key={panel.id} value={panel.id}>
                    {panel.name || t('panel.untitled')}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className={css.checkboxGroup}>
            <label className={css.checkboxRow}>
              <input
                type="checkbox"
                checked={includeAnswer}
                onChange={e => setIncludeAnswer(e.target.checked)}
                disabled={status === 'sending'}
              />
              <span>{t('handoff.includeAnswer')}</span>
            </label>

            <label className={css.checkboxRow}>
              <input
                type="checkbox"
                checked={includeQuestion}
                onChange={e => setIncludeQuestion(e.target.checked)}
                disabled={status === 'sending'}
              />
              <span>{t('handoff.includeQuestion')}</span>
            </label>

            <label className={css.checkboxRow}>
              <input
                type="checkbox"
                checked={includeSummary}
                onChange={e => setIncludeSummary(e.target.checked)}
                disabled={status === 'sending'}
              />
              <span>{t('handoff.includeSummary')}</span>
            </label>

            {includeSummary && (
              <div className={css.summaryBox}>
                {currentPanel?.summaryState === 'generating' ? (
                  <span>{t('handoff.summary.generating')}</span>
                ) : currentPanel?.summary ? (
                  <div className={css.summaryText}>{currentPanel.summary}</div>
                ) : (
                  <span>{t('handoff.summary.empty')}</span>
                )}
                {currentPanel?.summaryState !== 'generating' && (
                  <button
                    type="button"
                    className={css.summarizeBtn}
                    onClick={onSummarizeSource}
                    disabled={status === 'sending'}
                  >
                    {t('handoff.summary.button')}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={css.field}>
            <label className={css.fieldLabel}>{t('handoff.note.label')}</label>
            <textarea
              className={css.textarea}
              placeholder={t('handoff.note.placeholder')}
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={status === 'sending'}
              rows={2}
            />
          </div>

          <div className={css.field}>
            <label className={css.fieldLabel}>{t('handoff.delivery.label')}</label>
            <div className={css.deliveryOptions}>
              <label className={css.radioRow}>
                <input
                  type="radio"
                  name={`handoff-delivery-${messageId}`}
                  value="attach"
                  checked={delivery === 'attach'}
                  onChange={() => setDelivery('attach')}
                  disabled={status === 'sending'}
                />
                <span>{t('handoff.delivery.attach')}</span>
              </label>
              <label className={css.radioRow}>
                <input
                  type="radio"
                  name={`handoff-delivery-${messageId}`}
                  value="attach-and-ask"
                  checked={delivery === 'attach-and-ask'}
                  onChange={() => setDelivery('attach-and-ask')}
                  disabled={status === 'sending'}
                />
                <span>{t('handoff.delivery.attachAndAsk')}</span>
              </label>
            </div>
          </div>

          <div className={css.footer}>
            {status === 'error' && errorMessage && (
              <span className={`${css.statusMessage} ${css.error}`} role="alert">
                {errorMessage}
              </span>
            )}
            {status === 'sent' && (
              <span className={`${css.statusMessage} ${css.success}`} role="status">
                {t('handoff.sent')}
              </span>
            )}

            <button
              type="button"
              className={css.cancelBtn}
              onClick={onClose}
              disabled={status === 'sending'}
            >
              {t('handoff.cancel')}
            </button>
            <button
              type="button"
              className={css.sendBtn}
              onClick={onSend}
              disabled={status === 'sending' || otherPanels.length === 0 || (!includeAnswer && !includeQuestion && !includeSummary)}
            >
              {status === 'sending' ? t('handoff.sending') : t('handoff.send')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
