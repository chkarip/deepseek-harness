/**
 * DeepSeek pricing panel: the peak vs off-peak rates shown inside the mascot
 * window, with the currently-active tier highlighted. Purely informational —
 * the rates are display constants from {@link ./pricing.ts}.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { DEEPSEEK_PRICING, formatUsd, offPeakNow } from './pricing.ts'
import css from './PricingPanel.module.css'

export interface PricingPanelProps {
  t: TranslateNS<typeof NS>
}

export function PricingPanel({ t }: PricingPanelProps) {
  const offPeak = offPeakNow()

  const models = [
    { key: 'chat', label: t('pricing.model.chat'), tiers: DEEPSEEK_PRICING.chat },
    { key: 'reasoner', label: t('pricing.model.reasoner'), tiers: DEEPSEEK_PRICING.reasoner },
  ] as const

  return (
    <div className={css.root}>
      <div className={css.header}>
        <span className={css.title}>{t('pricing.title')}</span>
        <span className={offPeak ? css.badgeOff : css.badgePeak}>
          {offPeak ? t('pricing.offPeakNow') : t('pricing.peakNow')}
        </span>
      </div>

      <div className={css.rows}>
        {models.map(model => (
          <div key={model.key} className={css.modelRow}>
            <div className={css.modelName}>{model.label}</div>
            <div className={css.tierRow}>
              <span className={css.tierLabel}>{t('pricing.peak')}</span>
              <span className={css.tierValues}>
                {t('pricing.inOut', {
                  input: formatUsd(model.tiers.peak.inputCacheMiss),
                  output: formatUsd(model.tiers.peak.output),
                })}
              </span>
            </div>
            <div className={css.tierRow}>
              <span className={css.tierLabel}>{t('pricing.offPeak')}</span>
              <span className={css.tierValues}>
                {t('pricing.inOut', {
                  input: formatUsd(model.tiers.offPeak.inputCacheMiss),
                  output: formatUsd(model.tiers.offPeak.output),
                })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
