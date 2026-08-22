/**
 * Session header utility pill: compact live mascot avatar plus the current
 * request's estimated token total, expanding into the mascot playground and
 * telemetry panel.
 *
 * This is the mascot's ONE always-mounted surface, so it is also the ONE mount
 * that sounds the turn-completion cue: the view tab renders the same mascot,
 * and every mount that asked for the cue would sound its own.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ConversationSnapshot, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { playRetroSound } from './audio/retro-synth.ts'
import type { NS } from './locales.ts'
import { PixelMascotCanvas } from './mascot/PixelMascotCanvas.tsx'
import { tamagotchiStore, type MascotSkin } from './mascot/tamagotchi-store.ts'
import { PricingPanel } from './PricingPanel.tsx'
import { currentChatOutputPrice, formatUsd, usdPerToken } from './pricing.ts'
import { ActivityPipelineView } from './telemetry/ActivityPipelineView.tsx'
import { LiveTokenGraph } from './telemetry/LiveTokenGraph.tsx'
import { useCompletionCue, useLiveTelemetry } from './telemetry/telemetry-state.ts'
import css from './ActivityHeaderPill.module.css'

/** Threshold above which the pill abbreviates the token total to thousands. */
const COMPACT_TOKENS_FROM = 10_000

/**
 * @param tokens - estimated token count.
 * @returns the count for the pill's fixed width: exact below {@link COMPACT_TOKENS_FROM}, otherwise thousands.
 */
function formatTokens(tokens: number): string {
  return tokens < COMPACT_TOKENS_FROM ? String(tokens) : `${Math.round(tokens / 1000)}k`
}

/** The skins offered by the picker, in display order. */
const SKINS: readonly MascotSkin[] = ['byte', 'kraken', 'neko', 'ni']

export interface ActivityHeaderPillProps {
  /** Conversation snapshot selector from the session standard kit. */
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  /** Key-addressed projection reader from the standard kit. */
  useProjection: UseProjection
  /** Activity-monitor namespace translate. */
  t: TranslateNS<typeof NS>
}

export function ActivityHeaderPill({ useSession, useProjection, t }: ActivityHeaderPillProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const petState = useSyncExternalStore(tamagotchiStore.subscribe, tamagotchiStore.getSnapshot)

  const snapshot = useSession(s => s)
  const telemetry = useLiveTelemetry(snapshot)
  const { skin, happiness, coffees, pets, tokensFed, soundEnabled } = petState
  const { mascotState, estimatedSpeed, turnTokens, peakSpeed, avgSpeed, speedHistory } = telemetry

  useCompletionCue(telemetry.currentStage)

  useEffect(() => {
    if (!modalOpen) return
    const handlePointerDown = (e: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        setModalOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => { document.removeEventListener('pointerdown', handlePointerDown) }
  }, [modalOpen])

  const handleCoffee = (): void => {
    tamagotchiStore.feedCoffee()
    playRetroSound('coffee', soundEnabled)
  }

  const handleSkinChange = (newSkin: MascotSkin): void => {
    tamagotchiStore.setSkin(newSkin)
    playRetroSound('blip', soundEnabled)
  }

  // Rough cost of the answer's estimated output tokens at the current tier.
  const lastAnswerPrice = formatUsd(turnTokens * usdPerToken(currentChatOutputPrice()))

  return (
    <div ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.pillBtn}
        aria-expanded={modalOpen}
        aria-label={t('header.pill.label')}
        title={t('header.pill.tooltip')}
        onClick={() => { setModalOpen(open => !open) }}
      >
        <PixelMascotCanvas skin={skin} state={mascotState} scale={1.8} interactive={false} />
        {turnTokens > 0 ? (
          <span className={css.tokenText}>{t('header.pill.tokens', { tokens: formatTokens(turnTokens), price: lastAnswerPrice })}</span>
        ) : (
          <span className={css.idleText}>{happiness}%</span>
        )}
      </button>

      {modalOpen && (
        <div className={css.modalBackdrop}>
          <div className={css.modalCard}>
            <div className={css.modalHeader}>
              <div className={css.modalTitle}>
                <span>👾 {t('header.pill.label')}</span>
              </div>
              <button
                type="button"
                className={css.closeBtn}
                aria-label={t('header.pill.close')}
                onClick={() => { setModalOpen(false) }}
              >
                ✕
              </button>
            </div>

            <div className={css.modalBody}>
              <div className={css.mascotPlayground}>
                <div className={css.mascotCenter}>
                  <PixelMascotCanvas skin={skin} state={mascotState} scale={5} interactive={true} />
                  <div className={css.petPrompt}>{t('mascot.action.petHint')}</div>
                </div>

                <div className={css.petStats}>
                  <div className={css.statRow}>
                    <span>{t('mascot.stats.happiness')}</span>
                    <span className={css.statVal}>{happiness}%</span>
                  </div>
                  <div className={css.statRow}>
                    <span>{t('mascot.stats.coffee')}</span>
                    <span className={css.statVal}>☕ {coffees}</span>
                  </div>
                  <div className={css.statRow}>
                    <span>{t('mascot.stats.pets')}</span>
                    <span className={css.statVal}>🐾 {pets}</span>
                  </div>
                  <div className={css.statRow}>
                    <span>{t('mascot.stats.tokensFed')}</span>
                    <span className={css.statVal}>⚡ {tokensFed}</span>
                  </div>

                  <div className={css.skinPicker}>
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

                  <div className={css.playgroundActions}>
                    <button type="button" className={css.feedBtn} onClick={handleCoffee}>
                      ☕ {t('mascot.action.coffee')}
                    </button>
                    <button
                      type="button"
                      className={css.soundBtn}
                      title={t(soundEnabled ? 'mascot.action.sound.on' : 'mascot.action.sound.off')}
                      onClick={() => { tamagotchiStore.toggleSound() }}
                    >
                      {soundEnabled ? '🔊' : '🔇'} {t(soundEnabled ? 'mascot.state.soundOn' : 'mascot.state.soundOff')}
                    </button>
                  </div>
                </div>
              </div>

              <div className={css.graphSection}>
                <div className={css.sectionLabel}>{t('telemetry.liveSpeed')}</div>
                <LiveTokenGraph
                  samples={speedHistory}
                  estimatedSpeed={estimatedSpeed}
                  peakSpeed={peakSpeed}
                  avgSpeed={avgSpeed}
                  height={100}
                  t={t}
                />
              </div>

              <ActivityPipelineView
                telemetry={telemetry}
                snapshot={snapshot}
                useProjection={useProjection}
                t={t}
              />

              <PricingPanel t={t} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
