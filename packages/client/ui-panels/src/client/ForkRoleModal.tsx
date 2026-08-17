/**
 * ForkRoleModal: modal dialog allowing the user to select a specialized pathway
 * (Code Reviewer, Brainstorm, Docs, Plain, or Custom Goal) when branching a session.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ForkRole } from './contract.ts'
import css from './ForkRoleModal.module.css'

export interface ForkRoleModalProps {
  open: boolean
  onSelectRole: (role: ForkRole, customGoal?: string | undefined) => void
  onClose: () => void
  t: TranslateNS<'panels'>
}

export function ForkRoleModal({ open, onSelectRole, onClose, t }: ForkRoleModalProps) {
  const [customGoal, setCustomGoal] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  const handleCustomSubmit = (e: FormEvent): void => {
    e.preventDefault()
    const trimmed = customGoal.trim()
    if (trimmed === '') return
    onSelectRole('custom', trimmed)
  }

  return (
    <div
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fork-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={css.modal} ref={modalRef}>
        <header className={css.header}>
          <div className={css.titleRow}>
            <h2 id="fork-modal-title" className={css.title}>{t('fork.modal.title')}</h2>
            <button
              type="button"
              className={css.closeButton}
              onClick={onClose}
              aria-label={t('fork.modal.cancel')}
            >
              ✕
            </button>
          </div>
          <p className={css.subtitle}>{t('fork.modal.subtitle')}</p>
        </header>

        <div className={css.grid}>
          <button
            type="button"
            className={css.card}
            onClick={() => onSelectRole('reviewer')}
          >
            <span className={css.cardIcon}>🔍</span>
            <span className={css.cardTitle}>{t('fork.role.reviewer.title')}</span>
            <span className={css.cardDesc}>{t('fork.role.reviewer.desc')}</span>
          </button>

          <button
            type="button"
            className={css.card}
            onClick={() => onSelectRole('brainstorm')}
          >
            <span className={css.cardIcon}>💡</span>
            <span className={css.cardTitle}>{t('fork.role.brainstorm.title')}</span>
            <span className={css.cardDesc}>{t('fork.role.brainstorm.desc')}</span>
          </button>

          <button
            type="button"
            className={css.card}
            onClick={() => onSelectRole('docs')}
          >
            <span className={css.cardIcon}>📝</span>
            <span className={css.cardTitle}>{t('fork.role.docs.title')}</span>
            <span className={css.cardDesc}>{t('fork.role.docs.desc')}</span>
          </button>

          <button
            type="button"
            className={css.card}
            onClick={() => onSelectRole('plain')}
          >
            <span className={css.cardIcon}>🚀</span>
            <span className={css.cardTitle}>{t('fork.role.plain.title')}</span>
            <span className={css.cardDesc}>{t('fork.role.plain.desc')}</span>
          </button>
        </div>

        <div className={css.customSection}>
          <label htmlFor="custom-fork-input" className={css.customLabel}>
            ✍️ {t('fork.role.custom.title')}
          </label>
          <form className={css.customForm} onSubmit={handleCustomSubmit}>
            <input
              id="custom-fork-input"
              className={css.customInput}
              type="text"
              placeholder={t('fork.role.custom.placeholder')}
              value={customGoal}
              onChange={(e) => setCustomGoal(e.target.value)}
            />
            <button
              type="submit"
              className={css.customButton}
              disabled={customGoal.trim() === ''}
            >
              {t('fork.role.custom.launch')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
