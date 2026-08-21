/**
 * Client-side derivation of mascot state and a decode-rate sparkline from the
 * conversation snapshot.
 *
 * Every token figure here is an ESTIMATE: the browser sees streamed text, not
 * the provider's token accounting, so tokens are approximated from character
 * length. Provider-reported totals live in the `sessionStats` projection and
 * are rendered separately; the two must never be presented as the same number.
 */

import { useEffect, useRef, useState } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { MascotState } from '../mascot/pixel-models.ts'
import { playRetroSound } from '../audio/retro-synth.ts'
import { tamagotchiStore } from '../mascot/tamagotchi-store.ts'

/** Average characters per token used to approximate decode counts from streamed text. */
const CHARS_PER_TOKEN = 3.8

/** Sparkline window: samples retained for the live throughput graph. */
const HISTORY_SAMPLES = 30

/** One sparkline sample: the estimated decode rate over one snapshot interval. */
export interface SpeedSample {
  /** Wall time the sample was taken. */
  timestamp: number
  /** Estimated tokens per second over the interval since the previous sample. */
  speed: number
  /** Estimated tokens decoded during the interval. */
  tokens: number
}

/** Where the current turn stands, as the browser can observe it. */
export type TurnStage = 'idle' | 'thinking' | 'streaming' | 'tool' | 'settled'

/** Mascot state and estimated decode telemetry for one session. */
export interface LiveTelemetry {
  /** Sprite state the mascot renders. */
  mascotState: MascotState
  /** Estimated tokens per second over the latest interval; 0 while not streaming. */
  estimatedSpeed: number
  /** Highest {@link estimatedSpeed} observed since this hook mounted. */
  peakSpeed: number
  /** Mean {@link estimatedSpeed} across the non-zero samples still in the window. */
  avgSpeed: number
  /** Stage the pipeline view highlights. */
  currentStage: TurnStage
  /** Name of the first running tool call, or null when none runs. */
  runningToolName: string | null
  /** The retained sparkline window, oldest first. */
  speedHistory: readonly SpeedSample[]
}

const IDLE: LiveTelemetry = {
  mascotState: 'idle',
  estimatedSpeed: 0,
  peakSpeed: 0,
  avgSpeed: 0,
  currentStage: 'idle',
  runningToolName: null,
  speedHistory: [],
}

/** @returns estimated tokens across the streamed text of a partial assistant message. */
function estimateTokens(snapshot: ConversationSnapshot): number {
  const partial = snapshot.partial
  if (partial === null) return 0
  let tokens = 0
  for (const block of partial.blocks) {
    if (block.kind === 'text' || block.kind === 'reasoning') {
      tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN)
    }
  }
  return tokens
}

/** @returns the mascot state and pipeline stage the snapshot implies. */
function readStage(snapshot: ConversationSnapshot): Pick<LiveTelemetry, 'mascotState' | 'currentStage' | 'runningToolName'> {
  if (snapshot.promptError !== null) {
    return { mascotState: 'error', currentStage: 'idle', runningToolName: null }
  }
  if (snapshot.pending.length > 0) {
    return { mascotState: 'approval', currentStage: 'idle', runningToolName: null }
  }
  const running = snapshot.runningCalls[0]
  if (running !== undefined) {
    return { mascotState: 'tool', currentStage: 'tool', runningToolName: running.name }
  }
  if (snapshot.running) {
    const streaming = snapshot.partial !== null && snapshot.partial.blocks.length > 0
    return streaming
      ? { mascotState: 'streaming', currentStage: 'streaming', runningToolName: null }
      : { mascotState: 'thinking', currentStage: 'thinking', runningToolName: null }
  }
  const settled = snapshot.nodes[snapshot.nodes.length - 1]?.kind === 'assistant'
  return { mascotState: 'idle', currentStage: settled ? 'settled' : 'idle', runningToolName: null }
}

/**
 * Derive mascot state and the estimated decode-rate sparkline from a session.
 * @param snapshot - the session's conversation snapshot, or undefined with no session.
 * @returns live telemetry; the idle value while no session is selected.
 */
export function useLiveTelemetry(snapshot: ConversationSnapshot | undefined): LiveTelemetry {
  const [telemetry, setTelemetry] = useState<LiveTelemetry>(IDLE)

  const historyRef = useRef<readonly SpeedSample[]>([])
  const peakRef = useRef(0)
  const lastTokensRef = useRef(0)
  const lastSampleAtRef = useRef(Date.now())

  useEffect(() => {
    if (snapshot === undefined) {
      historyRef.current = []
      peakRef.current = 0
      lastTokensRef.current = 0
      setTelemetry(IDLE)
      return
    }

    const stage = readStage(snapshot)
    const now = Date.now()
    // A floor on the interval keeps two snapshots in the same millisecond from
    // reporting an unbounded rate.
    const seconds = Math.max(0.1, (now - lastSampleAtRef.current) / 1000)
    lastSampleAtRef.current = now

    const tokens = estimateTokens(snapshot)
    const deltaTokens = Math.max(0, tokens - lastTokensRef.current)
    // A finished turn clears the baseline so the next message counts from zero.
    lastTokensRef.current = snapshot.running ? tokens : 0

    let speed = 0
    if (snapshot.running && stage.currentStage === 'streaming' && deltaTokens > 0) {
      speed = Math.round(deltaTokens / seconds)
      peakRef.current = Math.max(peakRef.current, speed)
      tamagotchiStore.addTokensFed(deltaTokens)
    }

    const history = [...historyRef.current, { timestamp: now, speed, tokens: deltaTokens }]
      .slice(-HISTORY_SAMPLES)
    historyRef.current = history

    const active = history.filter(sample => sample.speed > 0)
    const avgSpeed = active.length === 0
      ? 0
      : Math.round(active.reduce((sum, sample) => sum + sample.speed, 0) / active.length)

    setTelemetry({
      ...stage,
      estimatedSpeed: speed,
      peakSpeed: peakRef.current,
      avgSpeed,
      speedHistory: history,
    })
  }, [snapshot])

  return telemetry
}

/**
 * Sound one victory cue each time a turn settles, when the user has enabled
 * sound. Mount this from exactly ONE component per session — every mount that
 * calls it sounds its own cue.
 * @param stage - the current pipeline stage from {@link useLiveTelemetry}.
 */
export function useCompletionCue(stage: TurnStage): void {
  const previous = useRef<TurnStage>(stage)

  useEffect(() => {
    const settledNow = stage === 'settled' && previous.current !== 'settled' && previous.current !== 'idle'
    previous.current = stage
    if (settledNow) playRetroSound('victory', tamagotchiStore.getSnapshot().soundEnabled)
  }, [stage])
}
