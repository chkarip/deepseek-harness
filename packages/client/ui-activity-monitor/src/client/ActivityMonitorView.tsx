/**
 * Full Activity Monitor and mascot view, registered as a `conversation.view` tab.
 */

import { memo, useSyncExternalStore } from 'react'
import type { ConversationSnapshot, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { playRetroSound } from './audio/retro-synth.ts'
import type { NS } from './locales.ts'
import { PixelMascotCanvas } from './mascot/PixelMascotCanvas.tsx'
import { tamagotchiStore, type MascotSkin } from './mascot/tamagotchi-store.ts'
import { PricingPanel } from './PricingPanel.tsx'
import { ActivityPipelineView } from './telemetry/ActivityPipelineView.tsx'
import { LiveTokenGraph } from './telemetry/LiveTokenGraph.tsx'
import { useLiveTelemetry } from './telemetry/telemetry-state.ts'
import css from './ActivityMonitorView.module.css'

/** The skins offered by the picker, in display order. */
const SKINS: readonly MascotSkin[] = ['byte', 'kraken', 'neko', 'ni']

export interface ActivityMonitorViewProps {
  /** Conversation snapshot selector from the session standard kit. */
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  /** Key-addressed projection reader from the standard kit. */
  useProjection: UseProjection
  /** Activity-monitor namespace translate. */
  t: TranslateNS<typeof NS>
}

export const ActivityMonitorView = memo(function ActivityMonitorView({
  useSession,
  useProjection,
  t,
}: ActivityMonitorViewProps) {
  const snapshot = useSession(s => s)
  const petState = useSyncExternalStore(tamagotchiStore.subscribe, tamagotchiStore.getSnapshot)
  const telemetry = useLiveTelemetry(snapshot)

  const { skin, happiness, coffees, pets, tokensFed, soundEnabled } = petState
  const { mascotState, estimatedSpeed, peakSpeed, avgSpeed, speedHistory } = telemetry

  const handleCoffee = (): void => {
    tamagotchiStore.feedCoffee()
    playRetroSound('coffee', soundEnabled)
  }

  const handleSkinChange = (newSkin: MascotSkin): void => {
    tamagotchiStore.setSkin(newSkin)
    playRetroSound('blip', soundEnabled)
  }

  return (
    <div className={css.root}>
      <div className={css.container}>
        <div className={css.heroCard}>
          <div className={css.mascotPane}>
            <PixelMascotCanvas skin={skin} state={mascotState} scale={6} interactive={true} />
            <div className={css.mascotStatus}>
              <span className={css.statusPill}>{t(`mascot.state.${mascotState}`)}</span>
            </div>
          </div>

          <div className={css.controlsPane}>
            <div className={css.paneHeader}>
              <h2>{t('dock.title')}</h2>
              <div className={css.headerActions}>
                <button
                  type="button"
                  className={css.toggleBtn}
                  title={t(soundEnabled ? 'mascot.action.sound.on' : 'mascot.action.sound.off')}
                  onClick={() => { tamagotchiStore.toggleSound() }}
                >
                  {soundEnabled ? '🔊' : '🔇'} {t(soundEnabled ? 'mascot.state.soundOn' : 'mascot.state.soundOff')}
                </button>
              </div>
            </div>

            <div className={css.statsGrid}>
              <div className={css.statCard}>
                <span className={css.statLabel}>{t('mascot.stats.happiness')}</span>
                <span className={css.statNum}>💖 {happiness}%</span>
              </div>
              <div className={css.statCard}>
                <span className={css.statLabel}>{t('mascot.stats.coffee')}</span>
                <span className={css.statNum}>☕ {coffees}</span>
              </div>
              <div className={css.statCard}>
                <span className={css.statLabel}>{t('mascot.stats.pets')}</span>
                <span className={css.statNum}>🐾 {pets}</span>
              </div>
              <div className={css.statCard}>
                <span className={css.statLabel}>{t('mascot.stats.tokensFed')}</span>
                <span className={css.statNum}>⚡ {tokensFed}</span>
              </div>
            </div>

            <div className={css.actionsSection}>
              <div className={css.skinRow}>
                <span className={css.rowLabel}>{t('mascot.stats.skin')}</span>
                <div className={css.skinButtonGroup}>
                  {SKINS.map(candidate => (
                    <button
                      key={candidate}
                      type="button"
                      className={`${css.skinBtn} ${skin === candidate ? css.skinActive : ''}`}
                      aria-pressed={skin === candidate}
                      onClick={() => { handleSkinChange(candidate) }}
                    >
                      {t(`mascot.name.${candidate}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={css.interactRow}>
                <button type="button" className={css.coffeeBtn} onClick={handleCoffee}>
                  ☕ {t('mascot.action.coffee')}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className={css.telemetryCard}>
          <div className={css.cardTitle}>{t('telemetry.liveSpeed')}</div>
          <LiveTokenGraph
            samples={speedHistory}
            estimatedSpeed={estimatedSpeed}
            peakSpeed={peakSpeed}
            avgSpeed={avgSpeed}
            height={120}
            t={t}
          />
        </div>

        <div className={css.pipelineCard}>
          <ActivityPipelineView
            telemetry={telemetry}
            snapshot={snapshot}
            useProjection={useProjection}
            t={t}
          />
        </div>

        <div className={css.pipelineCard}>
          <PricingPanel t={t} />
        </div>
      </div>
    </div>
  )
})
