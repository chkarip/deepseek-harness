/**
 * Activity Monitor & Tamagotchi Mascot plugin, browser half.
 * Registers:
 * - Header pill in 'conversation.session.header.utilities'
 * - Activity view in 'conversation.view'
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ActivityHeaderPill } from './ActivityHeaderPill.tsx'
import { ActivityMonitorView } from './ActivityMonitorView.tsx'
import { en, NS, zh, type ActivityMonitorKey } from './locales.ts'

export { ActivityHeaderPill } from './ActivityHeaderPill.tsx'
export { ActivityMonitorView } from './ActivityMonitorView.tsx'
export { PixelMascotCanvas } from './mascot/PixelMascotCanvas.tsx'
export { LiveTokenGraph } from './telemetry/LiveTokenGraph.tsx'
export { ActivityPipelineView } from './telemetry/ActivityPipelineView.tsx'
export { tamagotchiStore, TamagotchiStore, type MascotSkin, type TamagotchiState } from './mascot/tamagotchi-store.ts'
export { useCompletionCue, useLiveTelemetry } from './telemetry/telemetry-state.ts'
export type { LiveTelemetry, SpeedSample, TurnStage } from './telemetry/telemetry-state.ts'
export type { ActivityMonitorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The activity monitor and mascot copy. */
    'activity-monitor': ActivityMonitorKey
  }
}

/** Required services for the Activity Monitor & Mascot plugin. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Client plugin body: register the header pill and the activity view.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-activity-monitor: dictionaries')

  const t = ctx.locale.bind(NS)

  // 1. Session header utility pill (compact avatar + speed indicator)
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'activity-monitor-pill',
    order: 30,
    locale: NS,
  }, ActivityHeaderPill))

  // 2. Dedicated Activity & Mascot view tab
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'activity',
    order: 20,
    locale: NS,
    label: () => t('tab.title'),
  }, ActivityMonitorView))
}
