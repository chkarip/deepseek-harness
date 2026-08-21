// @vitest-environment jsdom
/**
 * SessionPicker presentation spec: the two creation actions (fresh
 * conversation always; shared-context fork only when the focused session
 * has history), session-row picking, and the Escape dismissal path.
 */
import { useRef, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { zh } from '../src/client/locales.ts'
import { SessionPicker } from '../src/client/SessionPicker.tsx'

/** Test-local translator over the zh dictionary (params interpolated). */
const t = ((key: string, params?: Record<string, string | number>) => {
  const base = zh[key as keyof typeof zh]
  if (base === undefined) return key
  return params === undefined ? base : base.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}) as never

const sid = (n: number): SessionId => `s-${n}` as SessionId

function row(id: SessionId, blank: boolean): SessionSummary {
  return { id, displayTitle: id, running: false, blank, updatedAt: 1 }
}

/** Ref-owning host: the picker needs an anchor RefObject, which must live in a component. */
function Host(props: Omit<ComponentProps<typeof SessionPicker>, 'anchorRef'>) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button type="button" ref={anchorRef}>chip</button>
      <SessionPicker {...props} anchorRef={anchorRef} />
    </>
  )
}

function mountPicker(props: Partial<Omit<ComponentProps<typeof SessionPicker>, 'anchorRef'>> = {}) {
  const onPick = vi.fn()
  const onNew = vi.fn()
  const onFork = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <Host
      open
      rows={[row(sid(1), false), row(sid(2), true)]}
      selectedId={sid(1)}
      canFork
      onPick={onPick}
      onNew={onNew}
      onFork={onFork}
      onClose={onClose}
      t={t}
      {...props}
    />,
  )
  return { view, onPick, onNew, onFork, onClose }
}

afterEach(cleanup)

describe('SessionPicker', () => {
  it('always offers New conversation, lists every session row, and offers the fork only when canFork', () => {
    const { view } = mountPicker()
    expect(view.getByRole('menuitem', { name: '新建对话' })).toBeTruthy()
    expect(view.getByRole('menuitem', { name: '从当前对话分支（共享上下文）' })).toBeTruthy()
    expect(view.getByRole('menuitem', { name: /s-1/ })).toBeTruthy()
    expect(view.getByRole('menuitem', { name: /s-2/ })).toBeTruthy()
    cleanup()
    const withoutFork = mountPicker({ canFork: false })
    expect(withoutFork.view.queryByRole('menuitem', { name: '从当前对话分支（共享上下文）' })).toBeNull()
  })

  it('routes the actions: new, fork, and session rows', () => {
    const { view, onNew, onFork, onPick } = mountPicker()
    fireEvent.click(view.getByRole('menuitem', { name: '新建对话' }))
    expect(onNew).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByRole('menuitem', { name: '从当前对话分支（共享上下文）' }))
    expect(onFork).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByRole('menuitem', { name: /s-2/ }))
    expect(onPick).toHaveBeenCalledWith(sid(2))
  })

  it('closes on Escape', () => {
    const { onClose } = mountPicker()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
