/**
 * Real-UI assembly closure, invoked by the app-shell plugin once its inject
 * set is active: the whole layout tree hangs off the built-in 'root' slot
 * (ui-layout registers AppFrame there and renders the child slots
 * internally) — the shell's render is the one ctx-level renderSlot call in
 * the program. The shell also owns the browser-tab status projection —
 * title and favicon — for the current session.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import { DocumentTitle, type ExecutionStatus } from './DocumentTitle.tsx'
// Type-only: pulls the runtime's SlotMap declaration merge (the 'root' key) into this program.
import type {} from '@deepseek-ai/dsh-client-runtime/client'

/** Assembly inputs: the active app-shell plugin ctx (slots/sessions/layout services provided). */
export interface AssemblyDeps {
  /** Client context with the assembly's inject set active. */
  ctx: Context
}

/**
 * Build the renderApp factory the app-shell plugin provides to AppRoot.
 * @param deps - assembly inputs.
 * @returns factory producing the real UI tree (called once per AppRoot render after settled).
 */
export function buildRenderApp(deps: AssemblyDeps): () => ReactNode {
  const { ctx } = deps
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('shell assembly: sessions service unavailable')
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

      if (prevRunning.current && !running) {
        setCompleted(true)
      } else if (running && completed) {
        setCompleted(false)
      }
      prevRunning.current = running
    }, [running, currentId, completed])

    const onAcknowledgeCompletion = useCallback(() => {
      setCompleted(false)
    }, [])

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
