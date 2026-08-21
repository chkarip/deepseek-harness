/**
 * Web Audio API retro chiptune synthesizer for 8-bit sound effects.
 * Fails soft where AudioContext is unavailable or blocked (headless test
 * environments, autoplay policy) — every entry point returns without throwing.
 */

let audioCtx: AudioContext | null = null

/**
 * Get or construct the shared AudioContext without resuming it.
 * @returns the context, or null where the browser exposes no AudioContext.
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (audioCtx === null) {
    // Both names are read off an optional-typed view: lib.dom declares
    // AudioContext as always present, which is untrue in the environments
    // this must fail soft in (jsdom, older WebKit under the prefixed name).
    const audioApi = window as unknown as {
      AudioContext?: typeof AudioContext
      webkitAudioContext?: typeof AudioContext
    }
    const AudioContextClass = audioApi.AudioContext ?? audioApi.webkitAudioContext
    if (AudioContextClass === undefined) return null
    try {
      audioCtx = new AudioContextClass()
    } catch {
      // Construction throws where the API exists but audio is unavailable
      // (no output device, blocked by policy); there is no other signal.
      return null
    }
  }
  return audioCtx
}

/** The chiptune voices this synthesizer can play. */
export type SoundEffect = 'blip' | 'pet' | 'coffee' | 'victory' | 'token' | 'glitch'

/**
 * Play a synthesized retro 8-bit chiptune sound effect. A suspended context
 * is resumed first and the voice is scheduled only after that settles —
 * scheduling against a suspended context freezes `currentTime`, which drops
 * the very first sound of a page.
 * @param effect - Sound effect identifier.
 * @param enabled - Whether sounds are enabled by user preference.
 */
export function playRetroSound(effect: SoundEffect, enabled = true): void {
  if (!enabled) return
  const ctx = getAudioContext()
  if (ctx === null) return
  if (ctx.state === 'suspended') {
    void ctx.resume().then(() => { schedule(ctx, effect) }, () => {
      // Autoplay policy refuses a resume outside a user gesture; the next
      // gesture-driven call resumes and sounds.
    })
    return
  }
  schedule(ctx, effect)
}

/**
 * Schedule one effect's voice on a running context.
 * @param ctx - running AudioContext.
 * @param effect - Sound effect identifier.
 */
function schedule(ctx: AudioContext, effect: SoundEffect): void {
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.connect(gain)
  gain.connect(ctx.destination)

  switch (effect) {
    case 'blip': {
      osc.type = 'square'
      osc.frequency.setValueAtTime(440, now)
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08)
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
      osc.start(now)
      osc.stop(now + 0.08)
      break
    }
    case 'pet': {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(587.33, now) // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15) // A5
      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
      osc.start(now)
      osc.stop(now + 0.15)
      break
    }
    case 'coffee': {
      // 3-note ascending arpeggio (C5 -> E5 -> G5)
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(523.25, now)
      osc.frequency.setValueAtTime(659.25, now + 0.06)
      osc.frequency.setValueAtTime(783.99, now + 0.12)
      gain.gain.setValueAtTime(0.1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
      osc.start(now)
      osc.stop(now + 0.22)
      break
    }
    case 'victory': {
      // Classic victory chime (C5 -> G5 -> C6)
      osc.type = 'square'
      osc.frequency.setValueAtTime(523.25, now)
      osc.frequency.setValueAtTime(783.99, now + 0.1)
      osc.frequency.setValueAtTime(1046.50, now + 0.2)
      gain.gain.setValueAtTime(0.1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
      osc.start(now)
      osc.stop(now + 0.4)
      break
    }
    case 'token': {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1200, now)
      osc.frequency.exponentialRampToValueAtTime(1600, now + 0.03)
      gain.gain.setValueAtTime(0.03, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)
      osc.start(now)
      osc.stop(now + 0.03)
      break
    }
    case 'glitch': {
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(200, now)
      osc.frequency.linearRampToValueAtTime(80, now + 0.15)
      gain.gain.setValueAtTime(0.1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
      osc.start(now)
      osc.stop(now + 0.15)
      break
    }
  }
}
