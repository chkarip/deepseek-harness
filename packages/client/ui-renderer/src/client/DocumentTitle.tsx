import { useEffect } from 'react'
import { updateFavicon, type FaviconStatus } from './favicon.ts'

const DEFAULT_CLIENT_TITLE = 'DSH Local Build'

/** Execution status projected onto the browser tab. */
export type ExecutionStatus = FaviconStatus

/** Props for the browser title projection. */
export interface DocumentTitleProps {
  /** Durable title of the selected session, or undefined for the product title. */
  title?: string
  /** Execution status of the selected session and its jobs. */
  status?: ExecutionStatus
  /** Invoked when the tab regains focus while a completion is still unacknowledged. */
  onAcknowledgeCompletion?: () => void
}

/**
 * Project the selected durable session title and execution status into the
 * browser title and favicon, and restore the build-selected product title and
 * the document's original favicon when unmounted.
 * @param props - Selected session title and status projection.
 * @returns No rendered content.
 */
export function DocumentTitle({ title, status = 'idle', onAcknowledgeCompletion }: DocumentTitleProps): null {
  const productTitle = process.env.DSH_CLIENT_TITLE ?? DEFAULT_CLIENT_TITLE

  useEffect(() => {
    const baseTitle = title === undefined ? productTitle : `${title} — ${productTitle}`
    const prefix = status === 'running' ? '● ' : status === 'completed' ? '✓ ' : ''
    document.title = `${prefix}${baseTitle}`
    updateFavicon(status)
    return () => {
      document.title = productTitle
      updateFavicon('idle')
    }
  }, [productTitle, title, status])

  useEffect(() => {
    if (status !== 'completed' || onAcknowledgeCompletion === undefined) return
    const handleFocus = (): void => { onAcknowledgeCompletion() }
    window.addEventListener('focus', handleFocus)
    return () => { window.removeEventListener('focus', handleFocus) }
  }, [status, onAcknowledgeCompletion])

  return null
}
