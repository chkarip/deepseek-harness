/**
 * WorkspaceStep: the modal shown after "+ Add panel" before any conversation
 * binding. The operator either picks an existing Workspace (which advances to
 * the conversation picker) or creates a new one (which adopts the picked
 * directory and auto-binds a fresh conversation in it).
 */
import { useEffect } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import css from './WorkspaceStep.module.css'

/** Full props of the workspace-selection step. */
export interface WorkspaceStepProps {
  /** Whether the modal is open. */
  open: boolean
  /** Existing workspaces to choose from (stable order). */
  workspaces: readonly WorkspaceView[]
  /** True while the workspace list baseline is still loading. */
  loading: boolean
  /** True while a directory pick / workspace create / conversation connect is in flight. */
  busy: boolean
  /** Adoption error message (directory picker failure, create failure). */
  error: string | null
  /** Bind to an existing workspace (advances to the conversation step). */
  onPickWorkspace: (workspaceId: WorkspaceId) => void
  /** Create a new workspace (opens the directory picker). */
  onNewWorkspace: () => void
  /** Close the modal without binding. */
  onClose: () => void
  t: TranslateNS<'panels'>
}

export function WorkspaceStep({
  open, workspaces, loading, busy, error, onPickWorkspace, onNewWorkspace, onClose, t,
}: WorkspaceStepProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, busy, onClose])

  if (!open) return null

  return (
    <div
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-step-title"
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}
    >
      <div className={css.modal}>
        <header className={css.header}>
          <div className={css.titleRow}>
            <h2 id="workspace-step-title" className={css.title}>{t('workspace.title')}</h2>
            <button
              type="button"
              className={css.closeButton}
              onClick={onClose}
              disabled={busy}
              aria-label={t('cancel')}
            >
              ✕
            </button>
          </div>
          <p className={css.subtitle}>{t('workspace.subtitle')}</p>
        </header>

        <div className={css.list}>
          {workspaces.map(workspace => (
            <button
              type="button"
              key={workspace.workspaceId}
              className={css.row}
              disabled={busy}
              onClick={() => { onPickWorkspace(workspace.workspaceId) }}
            >
              <span className={css.rowIcon} aria-hidden="true">📁</span>
              <span className={css.rowText}>
                <span className={css.rowTitle}>{workspace.title}</span>
                <span className={css.rowPath}>{workspace.path}</span>
              </span>
            </button>
          ))}
          {loading && <div className={css.empty} role="status">{t('workspace.loading')}</div>}
          {!loading && workspaces.length === 0 && <div className={css.empty}>{t('workspace.empty')}</div>}
        </div>

        {error !== null && <div className={css.error} role="alert">{error}</div>}

        <div className={css.actions}>
          <button type="button" className={css.cancelButton} disabled={busy} onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className={css.newButton} disabled={busy} onClick={onNewWorkspace}>
            {busy ? t('workspace.busy') : t('workspace.new')}
          </button>
        </div>
      </div>
    </div>
  )
}
