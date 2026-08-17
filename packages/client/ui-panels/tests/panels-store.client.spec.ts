/**
 * Panels workspace store spec: panel roster mutations (add/remove/rename/
 * rebind), focus movement, layout switching, and summary lifecycle writes.
 * Engine path only (createPanelsStore().create() — the test-sanctioned
 * zero-machinery route); persistence itself is the snapshot-store engine's
 * tested contract.
 */
import { describe, expect, it } from 'vitest'
import { createPanelsStore } from '../src/client/panels-store.ts'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

const sid = (n: number): SessionId => `s-${n}` as SessionId

function fresh() {
  return createPanelsStore().create()
}

describe('panels store', () => {
  it('adds a panel with a name and optional session, and focuses it', () => {
    const instance = fresh()
    expect(instance.getSnapshot()).toEqual({ layout: 'tiled', activePanelId: undefined, panels: [] })
    instance.actions.addPanel('p1', 'review', sid(1))
    const state = instance.getSnapshot()
    expect(state.panels).toEqual([{ id: 'p1', name: 'review', sessionId: sid(1), summary: undefined, summaryState: 'idle' }])
    expect(state.activePanelId).toBe('p1')
  })

  it('removes a panel and moves focus to the nearest survivor (or none)', () => {
    const instance = fresh()
    instance.actions.addPanel('p1', 'one')
    instance.actions.addPanel('p2', 'two')
    instance.actions.addPanel('p3', 'three')
    // Remove the focused middle panel: focus falls to the panel at the same
    // index in the survivor list.
    instance.actions.focusPanel('p2')
    instance.actions.removePanel('p2')
    expect(instance.getSnapshot().panels.map(panel => panel.id)).toEqual(['p1', 'p3'])
    expect(instance.getSnapshot().activePanelId).toBe('p3')
    // Removing the last panel clears the focus.
    instance.actions.removePanel('p1')
    instance.actions.removePanel('p3')
    expect(instance.getSnapshot().panels).toEqual([])
    expect(instance.getSnapshot().activePanelId).toBeUndefined()
  })

  it('renames a panel in place', () => {
    const instance = fresh()
    instance.actions.addPanel('p1', 'old')
    instance.actions.renamePanel('p1', 'planner')
    expect(instance.getSnapshot().panels[0]!.name).toBe('planner')
  })

  it('rebinding a session clears the stored summary', () => {
    const instance = fresh()
    instance.actions.addPanel('p1', 'review', sid(1))
    instance.actions.setPanelSummary('p1', 'working on review')
    expect(instance.getSnapshot().panels[0]!.summary).toBe('working on review')
    instance.actions.setPanelSession('p1', sid(2))
    const panel = instance.getSnapshot().panels[0]!
    expect(panel.sessionId).toBe(sid(2))
    expect(panel.summary).toBeUndefined()
    expect(panel.summaryState).toBe('idle')
  })

  it('tracks the summary lifecycle independently per panel', () => {
    const instance = fresh()
    instance.actions.addPanel('p1', 'one', sid(1))
    instance.actions.addPanel('p2', 'two', sid(2))
    instance.actions.setSummaryState('p1', 'generating')
    expect(instance.getSnapshot().panels[0]!.summaryState).toBe('generating')
    expect(instance.getSnapshot().panels[1]!.summaryState).toBe('idle')
    instance.actions.setPanelSummary('p1', 'done')
    expect(instance.getSnapshot().panels[0]!.summaryState).toBe('idle')
    expect(instance.getSnapshot().panels[0]!.summary).toBe('done')
  })

  it('switches the layout mode', () => {
    const instance = fresh()
    instance.actions.setLayout('tabbed')
    expect(instance.getSnapshot().layout).toBe('tabbed')
    instance.actions.setLayout('tiled')
    expect(instance.getSnapshot().layout).toBe('tiled')
  })

  it('ignores mutations for unknown panel ids', () => {
    const instance = fresh()
    instance.actions.renamePanel('ghost', 'x')
    instance.actions.setSummaryState('ghost', 'error')
    instance.actions.removePanel('ghost')
    expect(instance.getSnapshot().panels).toEqual([])
  })
})
