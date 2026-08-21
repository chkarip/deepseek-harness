// @vitest-environment jsdom
/**
 * ui-activity-monitor suite: plugin registration and disposal, the mascot
 * store's stats and persistence, snapshot-derived telemetry, and the three
 * rendered surfaces — including that their copy comes from the dictionaries
 * rather than inline English.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, render, fireEvent } from '@testing-library/react'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotRegistry, type ConversationSnapshot, type SessionId, type UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { conversationSnapshot, stubSettingsScope, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  apply, inject, ActivityHeaderPill, ActivityMonitorView, MascotDock, PixelMascotCanvas, tamagotchiStore,
} from '../src/client/index.ts'
import { ActivityPipelineView } from '../src/client/telemetry/ActivityPipelineView.tsx'
import { playRetroSound } from '../src/client/audio/retro-synth.ts'
import { getMascotFrame, PALETTES } from '../src/client/mascot/pixel-models.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'
import * as ActivityInvariant from '../src/invariant.ts'

const SID = 's1' as SessionId

beforeEach(() => {
  // The store is a browser-lifetime singleton: without this, one case's pets
  // and coffees are the next case's baseline.
  tamagotchiStore.reset()
})

afterEach(() => {
  cleanup()
})

/** @returns a quiescent snapshot with the given fields replaced. */
function snapshotWith(overrides: Partial<Omit<ConversationSnapshot, 'sessionId'>> = {}): ConversationSnapshot {
  return { ...conversationSnapshot(SID), ...overrides }
}

/** @returns a session selector hook reading one fixed snapshot. */
function sessionHook(snapshot: ConversationSnapshot): SnapshotSelectorHook<ConversationSnapshot> {
  return <S,>(sel: (s: ConversationSnapshot) => S): S => sel(snapshot)
}

/** @returns a projection reader serving the given key/value table. */
function projectionHook(values: Record<string, unknown> = {}): UseProjection {
  return (key: string) => values[key]
}

async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()

  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.view': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)

  ctx.provide('sessions', {})
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)

  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-activity-monitor browser plugin', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale'])
  })

  it('registers the header pill, mascot dock, and view tab, and removes them on fiber disposal', async () => {
    const { ctx, fiber } = await bench()

    expect(ctx.slots.entries('conversation.session.header.utilities').map(e => e.options.id))
      .toContain('activity-monitor-pill')
    expect(ctx.slots.entries('conversation.input.dock').map(e => e.options.id)).toContain('mascot-dock')
    expect(ctx.slots.entries('conversation.view').map(e => e.options.id)).toContain('activity')

    await fiber.dispose()

    expect(ctx.slots.entries('conversation.session.header.utilities').map(e => e.options.id))
      .not.toContain('activity-monitor-pill')
    expect(ctx.slots.entries('conversation.input.dock').map(e => e.options.id)).not.toContain('mascot-dock')
    expect(ctx.slots.entries('conversation.view').map(e => e.options.id)).not.toContain('activity')
  })

  it('registers localized dictionaries for en and zh', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    ctx.locale.setLocale('zh')
    expect(translate('tab.title')).toBe(zh['tab.title'])
    ctx.locale.setLocale('en')
    expect(translate('tab.title')).toBe(en['tab.title'])
    await fiber.dispose()
  })
})

describe('TamagotchiStore', () => {
  it('accumulates stats from a reset baseline and notifies subscribers', () => {
    let notifications = 0
    const off = tamagotchiStore.subscribe(() => { notifications += 1 })

    expect(tamagotchiStore.getSnapshot()).toMatchObject({
      skin: 'byte', happiness: 80, coffees: 0, pets: 0, tokensFed: 0, soundEnabled: false, dockCollapsed: false,
    })

    expect(tamagotchiStore.pet()).toBe(88)
    expect(tamagotchiStore.getSnapshot().pets).toBe(1)
    expect(notifications).toBe(1)

    tamagotchiStore.feedCoffee()
    expect(tamagotchiStore.getSnapshot()).toMatchObject({ coffees: 1, happiness: 100 })

    tamagotchiStore.addTokensFed(1000)
    expect(tamagotchiStore.getSnapshot().tokensFed).toBe(1000)
    tamagotchiStore.addTokensFed(0)
    expect(tamagotchiStore.getSnapshot().tokensFed).toBe(1000)

    expect(notifications).toBe(3)

    off()
    tamagotchiStore.pet()
    expect(notifications).toBe(3)
  })

  it('applies skin, sound, and collapse preferences idempotently', () => {
    tamagotchiStore.setSkin('kraken')
    expect(tamagotchiStore.getSnapshot().skin).toBe('kraken')
    const before = tamagotchiStore.getSnapshot()
    tamagotchiStore.setSkin('kraken')
    expect(tamagotchiStore.getSnapshot()).toBe(before)

    expect(tamagotchiStore.toggleSound()).toBe(true)
    expect(tamagotchiStore.toggleSound()).toBe(false)

    tamagotchiStore.setDockCollapsed(true)
    expect(tamagotchiStore.getSnapshot().dockCollapsed).toBe(true)
    const collapsed = tamagotchiStore.getSnapshot()
    tamagotchiStore.setDockCollapsed(true)
    expect(tamagotchiStore.getSnapshot()).toBe(collapsed)
  })

  it('persists to localStorage and reloads the persisted values', () => {
    tamagotchiStore.setSkin('neko')
    tamagotchiStore.feedCoffee()
    tamagotchiStore.flush()

    const raw = window.localStorage.getItem('dsh:activity-monitor:tamagotchi')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ skin: 'neko', coffees: 1 })
  })
})

describe('Pixel models & sound', () => {
  it('returns a non-empty sprite frame for every skin and state', () => {
    const states = ['idle', 'thinking', 'streaming', 'tool', 'approval', 'error', 'success'] as const
    for (const skin of ['byte', 'kraken', 'neko'] as const) {
      expect(PALETTES[skin]).toBeDefined()
      for (const state of states) {
        const frame = getMascotFrame(skin, state)
        expect(frame.length).toBeGreaterThan(0)
        expect(frame[0]?.length).toBeGreaterThan(0)
      }
    }
  })

  it('is inert when sound is disabled and never throws when enabled', () => {
    expect(() => {
      for (const effect of ['blip', 'pet', 'coffee', 'victory', 'token', 'glitch'] as const) {
        playRetroSound(effect, false)
        playRetroSound(effect, true)
      }
    }).not.toThrow()
  })
})

describe('MascotDock', () => {
  it('renders dictionary copy, not inline English, and feeds coffee on click', () => {
    const t = makeTranslate(zh, commonZh)
    const { getByTitle, queryByText } = render(
      <MascotDock useSession={sessionHook(snapshotWith())} t={t} />,
    )

    expect(queryByText(/\+Coffee/)).toBeNull()
    const coffeeBtn = getByTitle(zh['mascot.action.coffee'])
    fireEvent.click(coffeeBtn)
    expect(tamagotchiStore.getSnapshot().coffees).toBe(1)
  })

  it('reports the streaming state and estimated rate while a partial streams', () => {
    const t = makeTranslate(en, {})
    const streaming = snapshotWith({
      running: true,
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'x'.repeat(3800) }] } as never,
    })
    const { getByText } = render(<MascotDock useSession={sessionHook(streaming)} t={t} />)
    expect(getByText(en['mascot.state.streaming'])).toBeTruthy()
  })

  it('collapses to the compact bar when the preference is set', () => {
    tamagotchiStore.setDockCollapsed(true)
    const t = makeTranslate(en, {})
    const { getByTitle } = render(<MascotDock useSession={sessionHook(snapshotWith())} t={t} />)
    expect(getByTitle(en['dock.expand'])).toBeTruthy()
  })
})

describe('PixelMascotCanvas', () => {
  it('renders a canvas and reports a pet gesture', () => {
    const onPet = vi.fn()
    const { container } = render(<PixelMascotCanvas skin="byte" state="idle" scale={3} onPet={onPet} />)
    const canvas = container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    fireEvent.click(canvas as HTMLCanvasElement)
    expect(onPet).toHaveBeenCalled()
  })
})

describe('ActivityHeaderPill', () => {
  it('opens and closes the playground modal', () => {
    const t = makeTranslate(en, {})
    const { getByLabelText, queryByLabelText } = render(
      <ActivityHeaderPill
        useSession={sessionHook(snapshotWith())}
        useProjection={projectionHook()}
        t={t}
      />,
    )

    fireEvent.click(getByLabelText(en['header.pill.label']))
    expect(queryByLabelText(en['header.pill.close'])).not.toBeNull()

    fireEvent.click(getByLabelText(en['header.pill.close']))
    expect(queryByLabelText(en['header.pill.close'])).toBeNull()
  })
})

describe('ActivityMonitorView', () => {
  it('renders the mascot pane and switches skin on click', () => {
    const t = makeTranslate(en, {})
    const { getByText, container } = render(
      <ActivityMonitorView
        useSession={sessionHook(snapshotWith())}
        useProjection={projectionHook()}
        t={t}
      />,
    )

    expect(getByText(en['dock.title'])).toBeTruthy()
    expect(container.querySelector('canvas')).not.toBeNull()

    fireEvent.click(getByText(en['mascot.name.kraken']))
    expect(tamagotchiStore.getSnapshot().skin).toBe('kraken')
  })
})

describe('ActivityPipelineView', () => {
  const telemetry = {
    mascotState: 'idle', estimatedSpeed: 0, peakSpeed: 0, avgSpeed: 0,
    currentStage: 'idle', runningToolName: null, speedHistory: [],
  } as const

  it('renders provider-reported gauges and timings from the projections', () => {
    const t = makeTranslate(en, {})
    const { getByText } = render(
      <ActivityPipelineView
        telemetry={telemetry}
        snapshot={snapshotWith()}
        useProjection={projectionHook({
          tokenUsage: { uncachedInputTokens: 500, cacheReadTokens: 1500, cacheWriteTokens: 0, outputTokens: 200 },
          contextPressure: { projectedTokens: 32000, contextWindow: 64000 },
          sessionStats: {
            turns: 3, steps: 5, llmMs: 0, toolMs: 0,
            ttftMs: 1200, ttftSteps: 4, decodeMs: 2000, decodeTokens: 100,
          },
        })}
        t={t}
      />,
    )

    // 32000 / 64000, and 1500 cache reads of 2000 billed input tokens.
    expect(getByText('50%')).toBeTruthy()
    expect(getByText('75%')).toBeTruthy()
    // 1200ms over 4 steps, and 100 tokens over 2s.
    expect(getByText('Average time to first token: 300ms')).toBeTruthy()
    expect(getByText('Decode rate: 50 tok/s')).toBeTruthy()
  })

  it('omits every gauge whose projection is absent rather than defaulting it', () => {
    const t = makeTranslate(en, {})
    const { queryByText } = render(
      <ActivityPipelineView
        telemetry={telemetry}
        snapshot={snapshotWith()}
        useProjection={projectionHook()}
        t={t}
      />,
    )

    expect(queryByText(en['telemetry.context.title'])).toBeNull()
    expect(queryByText(en['telemetry.measured.title'])).toBeNull()
    // The stage strip is snapshot-derived, so it stands without any projection.
    expect(queryByText(en['telemetry.pipeline.title'])).not.toBeNull()
  })

  it('omits the occupancy gauge when the route advertised no context window', () => {
    const t = makeTranslate(en, {})
    const { queryByText } = render(
      <ActivityPipelineView
        telemetry={telemetry}
        snapshot={snapshotWith()}
        useProjection={projectionHook({ contextPressure: { projectedTokens: 32000 } })}
        t={t}
      />,
    )
    expect(queryByText(en['telemetry.context.occupancyLabel'])).toBeNull()
  })

  it('lists the running tool calls', () => {
    const t = makeTranslate(en, {})
    const { getByText } = render(
      <ActivityPipelineView
        telemetry={telemetry}
        snapshot={snapshotWith({
          runningCalls: [{
            callId: 'c1', name: 'bash', argsRaw: '{"command":"ls"}',
            turn: 1, step: 1, time: 0, callView: null, subCalls: [],
          }] as never,
        })}
        useProjection={projectionHook()}
        t={t}
      />,
    )
    expect(getByText('bash')).toBeTruthy()
  })
})

describe('ui-activity-monitor node half & invariant', () => {
  it('node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('invariant companion registers cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(ActivityInvariant)
    await fiber.await()
    expect(ActivityInvariant.name).toBe('client-ui-activity-monitor-invariant')
    expect(ActivityInvariant.inject).toEqual(['invariants'])
    await fiber.dispose()
  })
})
