/**
 * Composer dock companion: interactive mascot and estimated-throughput bar
 * above the input.
 *
 * This is also the ONE mount that sounds the turn-completion cue: the pill and
 * the view tab render the same mascot, and every mount that asked for the cue
 * would sound its own.
 */

import { memo, useSyncExternalStore } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { playRetroSound } from '../audio/retro-synth.ts'
import type { NS } from '../locales.ts'
import { useCompletionCue, useLiveTelemetry } from '../telemetry/telemetry-state.ts'
import { PixelMascotCanvas } from './PixelMascotCanvas.tsx'
import { tamagotchiStore } from './tamagotchi-store.ts'
import css from './MascotDock.module.css'

export interface MascotDockProps {
  /** Conversation snapshot selector from the session standard kit. */
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  /** Activity-monitor namespace translate. */
  t: TranslateNS<typeof NS>
}

export const MascotDock = memo(function MascotDock({ useSession, t }: MascotDockProps) {
  const snapshot = useSession(s => s)
  const petState = useSyncExternalStore(tamagotchiStore.subscribe, tamagotchiStore.getSnapshot)
  const telemetry = useLiveTelemetry(snapshot)
  useCompletionCue(telemetry.currentStage)

  const { skin, happiness, coffees, pets, soundEnabled, dockCollapsed } = petState
  const { mascotState, estimatedSpeed } = telemetry

  const stateLabel = t(`mascot.state.${mascotState}`)

  const handleCoffee = (): void => {
    tamagotchiStore.feedCoffee()
    playRetroSound('coffee', soundEnabled)
  }

  const handleToggleSound = (): void => {
    tamagotchiStore.toggleSound()
  }

  const handleToggleCollapse = (): void => {
    tamagotchiStore.setDockCollapsed(!dockCollapsed)
  }

  if (dockCollapsed) {
    return (
      <div className={css.collapsedBar}>
        <button
          type="button"
          className={css.expandBtn}
          onClick={handleToggleCollapse}
          title={t('dock.expand')}
        >
          <PixelMascotCanvas skin={skin} state={mascotState} scale={2} interactive={false} />
          <span className={css.collapsedText}>{stateLabel}</span>
          {estimatedSpeed > 0 && (
            <span className={css.collapsedSpeed}>{t('header.pill.speed', { speed: estimatedSpeed })}</span>
          )}
        </button>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.mascotCol}>
        <PixelMascotCanvas skin={skin} state={mascotState} scale={3} interactive={true} />
      </div>

      <div className={css.infoCol}>
        <div className={css.statusRow}>
          <span className={css.stateText}>{stateLabel}</span>
          {estimatedSpeed > 0 && (
            <span className={css.speedBadge} title={t('telemetry.liveSpeed')}>
              <span className={css.speedDot} />
              {t('header.pill.speed', { speed: estimatedSpeed })}
            </span>
          )}
        </div>

        <div className={css.statsBar}>
          <div className={css.statPill} title={t('mascot.stats.happiness')}>
            <span>💖</span>
            <span>{happiness}%</span>
          </div>
          <div className={css.statPill} title={t('mascot.stats.coffee')}>
            <span>☕</span>
            <span>{coffees}</span>
          </div>
          <div className={css.statPill} title={t('mascot.stats.pets')}>
            <span>🐾</span>
            <span>{pets}</span>
          </div>
        </div>

        <div className={css.actionsRow}>
          <button
            type="button"
            className={css.actionBtn}
            onClick={handleCoffee}
            title={t('mascot.action.coffee')}
          >
            ☕ {t('mascot.action.coffeeShort')}
          </button>
          <button
            type="button"
            className={css.iconBtn}
            onClick={handleToggleSound}
            title={t(soundEnabled ? 'mascot.action.sound.on' : 'mascot.action.sound.off')}
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>
          <button
            type="button"
            className={css.iconBtn}
            onClick={handleToggleCollapse}
            title={t('dock.collapse')}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
})
