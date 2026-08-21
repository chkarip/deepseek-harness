import { useEffect, useRef } from 'react'
import { updateFavicon, type FaviconStatus } from './favicon.ts'

export type ExecutionStatus = FaviconStatus

/** Props for the shell-owned browser title projection. */
export interface DocumentTitleProps {
  /** Durable title of the selected session, or undefined for the product title. */
  title?: string
  /** Execution status of the selected session / jobs. */
  status?: ExecutionStatus
  /** Optional callback fired when tab focus acknowledges completion. */
  onAcknowledgeCompletion?: () => void
}

/**
 * Project the selected durable session title and status into the browser title and favicon,
 * and restore the shell's original product title and favicon when unmounted.
 * @param props - selected session title and status projection.
 * @returns no rendered content.
 */
export function DocumentTitle({ title, status = 'idle', onAcknowledgeCompletion }: DocumentTitleProps): null {
  const original = useRef(document.title)

  useEffect(() => {
    const baseTitle = title === undefined ? original.current : `${title} — ${original.current}`
    const prefix = status === 'running' ? '● ' : status === 'completed' ? '✓ ' : ''
    document.title = `${prefix}${baseTitle}`
    updateFavicon(status)

    return () => {
      document.title = original.current
      updateFavicon('idle')
    }
  }, [title, status])

  useEffect(() => {
    if (status !== 'completed' || !onAcknowledgeCompletion) return
    const handleFocus = (): void => {
      onAcknowledgeCompletion()
    }
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [status, onAcknowledgeCompletion])

  return null
}
