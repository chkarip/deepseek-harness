/**
 * Real-UI assembly closure. The whole layout tree hangs from the built-in
 * `root` slot, which is the only ctx-level slot render in the application.
 * The assembly also owns the browser-tab status projection, title and favicon,
 * for the currently selected session.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from './bind.ts'
import { DocumentTitle, type ExecutionStatus } from './DocumentTitle.tsx'
import type {} from '@deepseek-ai/dsh-client-runtime/client'

/** Inputs available after the UI renderer's inject set activates. */
export interface AssemblyDeps {
  /** Client context carrying the slots and sessions services. */
  ctx: Context
}

/**
 * Build the assembled application factory.
 * @param deps - Active UI-renderer dependencies.
 * @returns Factory producing the application React tree.
 */
export function buildRenderApp(deps: AssemblyDeps): () => ReactNode {
  const { ctx } = deps
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('ui renderer: sessions service unavailable')
  const useSessions = bindSnapshotSelector(sessions.list)

  const SessionDocumentTitle = (): ReactNode => {
    // The selector builds a fresh object each read, so it needs the shallow
    // comparison: without it every unrelated session-list change re-renders.
    const { title, running, currentId } = useSessions((state) => {
      const id = state.current
      if (id === undefined) return { title: undefined, running: false, currentId: undefined }
      const summary = state.byId[id]
      const hasLiveJob = state.jobsBySession[id]
        ?.some(job => job.status === 'running' || job.status === 'stopping') ?? false
      return { title: summary?.title, running: (summary?.running ?? false) || hasLiveJob, currentId: id }
    }, shallowEqual)

    const [completed, setCompleted] = useState(false)
    const prevRunning = useRef(false)
    const prevId = useRef(currentId)

    useEffect(() => {
      if (prevId.current !== currentId) {
        prevId.current = currentId
        prevRunning.current = running
        setCompleted(false)
        return
      }
      if (prevRunning.current && !running) setCompleted(true)
      else if (running && completed) setCompleted(false)
      prevRunning.current = running
    }, [running, currentId, completed])

    const onAcknowledgeCompletion = useCallback(() => { setCompleted(false) }, [])

    const status: ExecutionStatus = running ? 'running' : completed ? 'completed' : 'idle'

    return (
      <DocumentTitle
        {...title === undefined ? {} : { title }}
        status={status}
        onAcknowledgeCompletion={onAcknowledgeCompletion}
      />
    )
  }

  return () => (
    <>
      <SessionDocumentTitle />
      {ctx.slots.renderSlot('root', {})}
    </>
  )
}
