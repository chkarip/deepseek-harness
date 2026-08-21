/**
 * Sparkline of the ESTIMATED decode rate (see telemetry-state.ts): tokens are
 * approximated from streamed character counts, never provider accounting.
 */

import { useEffect, useRef } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import type { SpeedSample } from './telemetry-state.ts'
import css from './LiveTokenGraph.module.css'

export interface LiveTokenGraphProps {
  /** The retained sample window, oldest first. */
  samples: readonly SpeedSample[]
  /** Estimated tokens per second over the latest interval. */
  estimatedSpeed: number
  /** Highest estimated rate observed; also sets the vertical scale. */
  peakSpeed: number
  /** Mean estimated rate over the non-zero samples in the window. */
  avgSpeed: number
  /** Canvas height in CSS pixels. */
  height?: number
  className?: string
  /** Activity-monitor namespace translate. */
  t: TranslateNS<typeof NS>
}

export function LiveTokenGraph({
  samples,
  estimatedSpeed,
  peakSpeed,
  avgSpeed,
  height = 80,
  className,
  t,
}: LiveTokenGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const width = rect.width || 300
    const h = height

    canvas.width = width * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, h)

    // Background grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let y = 20; y < h; y += 20) {
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
    }
    ctx.stroke()

    if (samples.length < 2) {
      // Draw flatline baseline
      ctx.strokeStyle = 'rgba(77, 136, 255, 0.3)'
      ctx.beginPath()
      ctx.moveTo(0, h - 10)
      ctx.lineTo(width, h - 10)
      ctx.stroke()
      return
    }

    const maxVal = Math.max(60, peakSpeed * 1.15)
    const stepX = width / Math.max(1, samples.length - 1)

    // Build curve points
    const points: { x: number; y: number }[] = samples.map((s, i) => {
      const x = i * stepX
      const normalized = Math.min(1, s.speed / maxVal)
      const y = h - 10 - normalized * (h - 22)
      return { x, y }
    })

    // Create gradient area fill
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(0, 229, 255, 0.45)')
    grad.addColorStop(0.6, 'rgba(77, 136, 255, 0.2)')
    grad.addColorStop(1, 'rgba(77, 136, 255, 0.0)')

    ctx.beginPath()
    const firstPoint = points[0]
    if (firstPoint !== undefined) {
      ctx.moveTo(firstPoint.x, h)
      ctx.lineTo(firstPoint.x, firstPoint.y)

      for (let i = 1; i < points.length; i++) {
        const p0 = points[i - 1]
        const p1 = points[i]
        if (p0 === undefined || p1 === undefined) continue
        const midX = (p0.x + p1.x) / 2
        ctx.quadraticCurveTo(p0.x, p0.y, midX, (p0.y + p1.y) / 2)
      }
      const last = points[points.length - 1]
      if (last !== undefined) {
        ctx.lineTo(last.x, last.y)
        ctx.lineTo(width, h)
      }
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()
    }

    // Draw glowing line
    ctx.strokeStyle = '#00e5ff'
    ctx.lineWidth = 2.2
    ctx.shadowColor = '#00e5ff'
    ctx.shadowBlur = 6

    ctx.beginPath()
    if (firstPoint !== undefined) {
      ctx.moveTo(firstPoint.x, firstPoint.y)
      for (let i = 1; i < points.length; i++) {
        const p0 = points[i - 1]
        const p1 = points[i]
        if (p0 === undefined || p1 === undefined) continue
        const midX = (p0.x + p1.x) / 2
        ctx.quadraticCurveTo(p0.x, p0.y, midX, (p0.y + p1.y) / 2)
      }
      const last = points[points.length - 1]
      if (last !== undefined) {
        ctx.lineTo(last.x, last.y)
      }
      ctx.stroke()
    }

    // Reset shadow
    ctx.shadowBlur = 0

    // Draw active tip dot
    const lastPoint = points[points.length - 1]
    if (lastPoint !== undefined && estimatedSpeed > 0) {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = '#00e5ff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(lastPoint.x, lastPoint.y, 7, 0, Math.PI * 2)
      ctx.stroke()
    }
  }, [samples, estimatedSpeed, peakSpeed, height])

  return (
    <div className={`${css.root} ${className ?? ''}`}>
      <div className={css.header}>
        <div className={css.liveSpeed}>
          <span className={css.liveDot} data-active={estimatedSpeed > 0 || undefined} />
          <span className={css.speedValue}>{estimatedSpeed}</span>
          <span className={css.speedUnit}>{t('telemetry.speedUnit')}</span>
        </div>
        <div className={css.metrics}>
          <span className={css.metricItem} title={t('telemetry.peakTooltip')}>
            <span className={css.metricLabel}>{t('telemetry.peakLabel')}</span>
            <span className={css.metricVal}>{peakSpeed}</span>
          </span>
          <span className={css.metricItem} title={t('telemetry.avgTooltip')}>
            <span className={css.metricLabel}>{t('telemetry.avgLabel')}</span>
            <span className={css.metricVal}>{avgSpeed}</span>
          </span>
        </div>
      </div>
      <canvas ref={canvasRef} className={css.canvas} style={{ height }} />
    </div>
  )
}
