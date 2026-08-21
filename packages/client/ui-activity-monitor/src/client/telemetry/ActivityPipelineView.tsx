/**
 * Turn-execution pipeline, running tool list, and provider-reported context
 * and billing gauges.
 *
 * Two accounting planes meet here and stay labelled apart: the stage strip and
 * the sparkline come from the browser's own snapshot-derived estimates, while
 * every figure in the gauges and the timing row comes from the host's durable
 * `tokenUsage`, `contextPressure`, and `sessionStats` projections. A gauge with
 * no projection value is omitted, never defaulted.
 */

import { memo } from 'react'
import type { ConversationSnapshot, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merge the tokenUsage / contextPressure keys into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-token-meter/client'
// Type-only: merge the sessionStats key into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { NS } from '../locales.ts'
import type { LiveTelemetry } from './telemetry-state.ts'
import css from './ActivityPipelineView.module.css'

export interface ActivityPipelineViewProps {
  /** Snapshot-derived stage and estimated decode rate. */
  telemetry: LiveTelemetry
  /** The session's conversation snapshot, or undefined with no session. */
  snapshot: ConversationSnapshot | undefined
  /** Key-addressed projection reader from the standard kit. */
  useProjection: UseProjection
  /** Activity-monitor namespace translate. */
  t: TranslateNS<typeof NS>
}

/**
 * @param ms - a duration in milliseconds.
 * @returns the duration as seconds with one decimal, or milliseconds under a second.
 */
function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export const ActivityPipelineView = memo(function ActivityPipelineView({
  telemetry,
  snapshot,
  useProjection,
  t,
}: ActivityPipelineViewProps) {
  const usage = useProjection('tokenUsage')
  const pressure = useProjection('contextPressure')
  const stats = useProjection('sessionStats')

  const { currentStage } = telemetry
  const runningCalls = snapshot?.runningCalls ?? []

  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  const contextWindow = pressure?.contextWindow
  // Both halves must be present: an occupancy percentage against an assumed
  // window would read as a measurement while being a guess.
  const occupancyPercent = usedTokens !== undefined && contextWindow !== undefined && contextWindow > 0
    ? Math.min(100, Math.round((usedTokens / contextWindow) * 100))
    : null

  const billedInput = usage === undefined
    ? 0
    : usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const cacheHitPercent = usage !== undefined && billedInput > 0
    ? Math.round((usage.cacheReadTokens / billedInput) * 100)
    : null

  const avgTtftMs = stats !== undefined && stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : null
  const decodeRate = stats !== undefined && stats.decodeMs > 0
    ? Math.round(stats.decodeTokens / (stats.decodeMs / 1000))
    : null

  return (
    <div className={css.root}>
      <div className={css.section}>
        <div className={css.sectionTitle}>{t('telemetry.pipeline.title')}</div>
        <div className={css.pipelineGrid}>
          <div className={`${css.stageCard} ${currentStage !== 'idle' ? css.stageDone : ''}`}>
            <div className={css.stageIcon}>📥</div>
            <div className={css.stageName}>{t('telemetry.pipeline.prompt')}</div>
          </div>
          <div className={`${css.stageCard} ${currentStage === 'thinking' ? css.stageActive : currentStage === 'streaming' || currentStage === 'tool' || currentStage === 'settled' ? css.stageDone : ''}`}>
            <div className={css.stageIcon}>🧠</div>
            <div className={css.stageName}>{t('telemetry.pipeline.ttft')}</div>
          </div>
          <div className={`${css.stageCard} ${currentStage === 'streaming' ? css.stageActive : currentStage === 'tool' || currentStage === 'settled' ? css.stageDone : ''}`}>
            <div className={css.stageIcon}>⚡</div>
            <div className={css.stageName}>{t('telemetry.pipeline.streaming')}</div>
          </div>
          <div className={`${css.stageCard} ${currentStage === 'tool' ? css.stageActive : currentStage === 'settled' ? css.stageDone : ''}`}>
            <div className={css.stageIcon}>🛠️</div>
            <div className={css.stageName}>{t('telemetry.pipeline.tools', { count: runningCalls.length })}</div>
          </div>
          <div className={`${css.stageCard} ${currentStage === 'settled' ? css.stageDone : ''}`}>
            <div className={css.stageIcon}>✅</div>
            <div className={css.stageName}>{t('telemetry.pipeline.settled')}</div>
          </div>
        </div>
      </div>

      {(avgTtftMs !== null || decodeRate !== null) && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('telemetry.measured.title')}</div>
          <div className={css.measuredRow}>
            {avgTtftMs !== null && (
              <span className={css.measuredItem}>{t('telemetry.measured.ttft', { duration: formatDuration(avgTtftMs) })}</span>
            )}
            {decodeRate !== null && (
              <span className={css.measuredItem}>{t('telemetry.measured.decodeRate', { speed: decodeRate })}</span>
            )}
          </div>
        </div>
      )}

      {runningCalls.length > 0 && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('telemetry.tools.title')}</div>
          <div className={css.toolList}>
            {runningCalls.map(call => (
              <div key={call.callId} className={css.toolItem}>
                <span className={css.toolPulse} />
                <span className={css.toolName}>{call.name}</span>
                <span className={css.toolArgs}>{call.argsRaw.slice(0, 60)}{call.argsRaw.length > 60 ? '…' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(occupancyPercent !== null || cacheHitPercent !== null) && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('telemetry.context.title')}</div>
          <div className={css.contextGauges}>
            {occupancyPercent !== null && (
              <div className={css.gaugeItem}>
                <div className={css.gaugeHeader}>
                  <span>{t('telemetry.context.occupancyLabel')}</span>
                  <span className={css.gaugeVal}>{occupancyPercent}%</span>
                </div>
                <div className={css.progressBar}>
                  <div className={css.progressFill} style={{ width: `${occupancyPercent}%` }} />
                </div>
              </div>
            )}

            {cacheHitPercent !== null && (
              <div className={css.gaugeItem}>
                <div className={css.gaugeHeader}>
                  <span>{t('telemetry.context.cacheHitLabel')}</span>
                  <span className={css.gaugeVal}>{cacheHitPercent}%</span>
                </div>
                <div className={css.progressBar}>
                  <div className={`${css.progressFill} ${css.cacheFill}`} style={{ width: `${cacheHitPercent}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
