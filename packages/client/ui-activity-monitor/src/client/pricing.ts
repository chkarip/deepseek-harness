/**
 * DeepSeek list pricing for the mascot's cost readouts.
 *
 * Rates are US dollars per ONE MILLION tokens and cover the two published
 * tiers: peak (standard) and off-peak (discount). They are DISPLAY constants
 * only — never a billing input — and are kept in one place so they stay easy
 * to update when DeepSeek changes its published prices.
 *
 * Off-peak window: 16:30–00:30 UTC (Beijing 00:30–08:30), matching DeepSeek's
 * documented "错峰优惠" discount.
 */

/** One tier's per-million-token USD rates. */
export interface PricingTier {
  /** Input tokens not served from cache (cache miss). */
  inputCacheMiss: number
  /** Input tokens served from cache (cache hit). */
  inputCacheHit: number
  /** Output tokens. */
  output: number
}

/** Peak + off-peak rates for one model family. */
export interface ModelPricing {
  peak: PricingTier
  offPeak: PricingTier
}

/** Published DeepSeek rates (per 1M tokens, USD). */
export const DEEPSEEK_PRICING: Readonly<{
  chat: ModelPricing
  reasoner: ModelPricing
}> = {
  chat: {
    peak: { inputCacheMiss: 0.27, inputCacheHit: 0.07, output: 1.10 },
    offPeak: { inputCacheMiss: 0.135, inputCacheHit: 0.035, output: 0.55 },
  },
  reasoner: {
    peak: { inputCacheMiss: 0.55, inputCacheHit: 0.14, output: 2.19 },
    offPeak: { inputCacheMiss: 0.1375, inputCacheHit: 0.035, output: 0.5475 },
  },
}

/** DeepSeek off-peak window start (UTC minutes since midnight). */
const OFF_PEAK_START_MIN = 16 * 60 + 30
/** DeepSeek off-peak window end (UTC minutes since midnight, just after 00:00). */
const OFF_PEAK_END_MIN = 30

/**
 * Whether the current UTC wall time is inside DeepSeek's off-peak window.
 * @param now - the time to test (defaults to now).
 */
export function offPeakNow(now: Date = new Date()): boolean {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  return minutes >= OFF_PEAK_START_MIN || minutes < OFF_PEAK_END_MIN
}

/** The chat-model output tier in effect right now. */
export function currentChatOutputPrice(): number {
  return offPeakNow() ? DEEPSEEK_PRICING.chat.offPeak.output : DEEPSEEK_PRICING.chat.peak.output
}

/** USD per single token for a per-million rate. */
export function usdPerToken(pricePerMillion: number): number {
  return pricePerMillion / 1_000_000
}

/**
 * Format a USD amount for the compact surfaces: two decimals once meaningful,
 * four decimals for sub-cent token costs.
 */
export function formatUsd(value: number): string {
  if (value === 0) return '$0'
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}
