/**
 * Tamagotchi store: mascot stats and browser-local user preferences (skin,
 * sound, dock collapse), persisted to `localStorage`.
 *
 * Deliberately a module-level singleton, not a plugin-owned service: every
 * value here is per-browser user preference that must survive plugin
 * disposal, HMR, and remounting, exactly like the `localStorage` record
 * backing it. Nothing in it is host state, and it emits no cordis events.
 */

export type MascotSkin = 'byte' | 'kraken' | 'neko'

/** The mascot's stats and the user's display and sound preferences. */
export interface TamagotchiState {
  skin: MascotSkin
  happiness: number
  coffees: number
  pets: number
  tokensFed: number
  soundEnabled: boolean
  dockCollapsed: boolean
}

const STORAGE_KEY = 'dsh:activity-monitor:tamagotchi'

/**
 * Shortest gap between `localStorage` writes. Streaming feeds token deltas at
 * frame rate; persisting each one puts a synchronous main-thread serialize +
 * write on every frame. Coalescing to a trailing write costs at most this
 * much staleness on an abrupt tab close.
 */
const PERSIST_INTERVAL_MS = 2000

const DEFAULT_STATE: TamagotchiState = {
  skin: 'byte',
  happiness: 80,
  coffees: 0,
  pets: 0,
  tokensFed: 0,
  soundEnabled: false,
  dockCollapsed: false,
}

/** @returns the storage face, or undefined where the environment has none. */
function storage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    // Reading the property itself throws where site data is blocked.
    return undefined
  }
}

/** @returns persisted state merged over the defaults, or the defaults alone. */
function loadSavedState(): TamagotchiState {
  const store = storage()
  if (store === undefined) return { ...DEFAULT_STATE }
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<TamagotchiState>
      return {
        ...DEFAULT_STATE,
        ...parsed,
        happiness: Math.min(100, Math.max(0, parsed.happiness ?? DEFAULT_STATE.happiness)),
      }
    }
  } catch {
    // A corrupt or unreadable record is replaced by the defaults on the next write.
  }
  return { ...DEFAULT_STATE }
}

/**
 * Mascot stats and preferences with throttled persistence. Reads are
 * synchronous and always current; only the `localStorage` write lags.
 */
export class TamagotchiStore {
  private state: TamagotchiState
  private readonly listeners = new Set<() => void>()
  private persistTimer: ReturnType<typeof setTimeout> | undefined
  private lastPersistedAt = 0

  constructor() {
    this.state = loadSavedState()
    if (typeof window !== 'undefined') {
      // A tab closing mid-throttle would otherwise drop the pending write.
      window.addEventListener('pagehide', this.flush)
    }
  }

  /**
   * Read the current state.
   * @returns the state (stable reference until the next mutation).
   */
  public getSnapshot = (): TamagotchiState => this.state

  /**
   * Observe state replacements.
   * @param listener - invoked after each mutation.
   * @returns the disposer removing this listener.
   */
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Write any pending state to storage immediately. */
  public flush = (): void => {
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }
    this.lastPersistedAt = Date.now()
    const store = storage()
    if (store === undefined) return
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      // Quota exhausted or writes blocked; in-memory state stays authoritative.
    }
  }

  /**
   * Discard all stats and preferences, in memory and in storage. Exists for
   * tests, which share this singleton across cases.
   */
  public reset = (): void => {
    this.state = { ...DEFAULT_STATE }
    this.flush()
    for (const listener of this.listeners) listener()
  }

  /**
   * Pet the mascot.
   * @returns the resulting happiness percentage.
   */
  public pet = (): number => {
    const nextHappiness = Math.min(100, this.state.happiness + 8)
    this.state = {
      ...this.state,
      happiness: nextHappiness,
      pets: this.state.pets + 1,
    }
    this.notify()
    return nextHappiness
  }

  /** Feed the mascot one coffee. */
  public feedCoffee = (): void => {
    this.state = {
      ...this.state,
      happiness: Math.min(100, this.state.happiness + 15),
      coffees: this.state.coffees + 1,
    }
    this.notify()
  }

  /**
   * Credit decoded tokens to the mascot's lifetime total.
   * @param tokens - estimated tokens decoded since the last credit; non-positive values are ignored.
   */
  public addTokensFed = (tokens: number): void => {
    if (tokens <= 0) return
    const happinessBoost = Math.min(5, Math.floor(tokens / 200))
    this.state = {
      ...this.state,
      tokensFed: this.state.tokensFed + tokens,
      happiness: Math.min(100, this.state.happiness + happinessBoost),
    }
    this.notify()
  }

  /**
   * Select the mascot sprite set.
   * @param skin - the skin to display.
   */
  public setSkin = (skin: MascotSkin): void => {
    if (this.state.skin === skin) return
    this.state = { ...this.state, skin }
    this.notify()
  }

  /**
   * Flip the sound preference.
   * @returns whether sound is enabled after the toggle.
   */
  public toggleSound = (): boolean => {
    const next = !this.state.soundEnabled
    this.state = { ...this.state, soundEnabled: next }
    this.notify()
    return next
  }

  /**
   * Collapse or expand the composer dock.
   * @param dockCollapsed - whether the dock shows its compact bar.
   */
  public setDockCollapsed = (dockCollapsed: boolean): void => {
    if (this.state.dockCollapsed === dockCollapsed) return
    this.state = { ...this.state, dockCollapsed }
    this.notify()
  }

  /** Publish the new state to listeners and schedule a throttled write. */
  private notify(): void {
    this.schedulePersist()
    for (const listener of this.listeners) listener()
  }

  /** Write now when the throttle window has elapsed, otherwise arm the trailing write. */
  private schedulePersist(): void {
    if (this.persistTimer !== undefined) return
    const elapsed = Date.now() - this.lastPersistedAt
    if (elapsed >= PERSIST_INTERVAL_MS) {
      this.flush()
      return
    }
    this.persistTimer = setTimeout(this.flush, PERSIST_INTERVAL_MS - elapsed)
  }
}

/** Browser-local mascot stats and preferences, shared by every mount. */
export const tamagotchiStore = new TamagotchiStore()
