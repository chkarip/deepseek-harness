/**
 * Browser-local prompt history and the prefix match behind the composer's
 * inline ghost completion.
 *
 * Suggestions are only ever the user's OWN earlier prompts: nothing here
 * ships authored copy, so the ghost carries no untranslated text and offers
 * nothing the user has not already written. The store is plugin-owned (see
 * apply.ts) rather than a module singleton, so its listeners and its storage
 * writes ride the plugin fiber.
 */

/** localStorage key holding the prompt ring. */
const STORAGE_KEY = 'dsh:prompt-history'

/** Prompts retained; older entries fall off the tail. */
const MAX_HISTORY = 100

/**
 * The subset of `Storage` this store uses. Accepting the face (rather than
 * reaching for `window.localStorage`) is what lets the plugin construct one
 * store per browser context and lets tests run without a DOM.
 */
export interface PromptHistoryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * The ambient browser storage, or undefined where there is none.
 * @returns `window.localStorage`, or undefined outside a browser or where
 * site data is blocked (reading the property itself can throw).
 */
export function browserPromptStorage(): PromptHistoryStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    // Blocked site data throws on property access, not on the call.
    return undefined
  }
}

/**
 * A most-recent-first ring of submitted prompts, mirrored to storage.
 * Construct one per plugin instance; without storage it stays in memory.
 */
export class PromptHistory {
  private entries: string[]

  /**
   * @param storage - persistence face; omit for an in-memory ring.
   */
  constructor(private readonly storage?: PromptHistoryStorage) {
    this.entries = this.load()
  }

  /**
   * Read the retained ring.
   * @returns the prompts, most recent first.
   */
  list(): readonly string[] {
    return this.entries
  }

  /**
   * Record one submitted prompt at the head, de-duplicating an earlier
   * identical entry. Blank prompts are ignored.
   * @param prompt - the text the user submitted.
   */
  record(prompt: string): void {
    const trimmed = prompt.trim()
    if (trimmed === '') return
    this.entries = [trimmed, ...this.entries.filter(item => item !== trimmed)].slice(0, MAX_HISTORY)
    this.persist()
  }

  /** Drop every retained prompt, in memory and in storage. */
  clear(): void {
    this.entries = []
    this.persist()
  }

  /**
   * The completion the composer would show ahead of the caret.
   * @param draft - the current draft text.
   * @returns the suffix completing `draft` from the most recent matching
   * prompt, or null when the draft is empty or nothing extends it.
   */
  ghost(draft: string): string | null {
    if (draft === '') return null
    const lower = draft.toLowerCase()
    for (const item of this.entries) {
      if (item.length > draft.length && item.toLowerCase().startsWith(lower)) {
        return item.slice(draft.length)
      }
    }
    return null
  }

  /** @returns the persisted ring, or an empty one when storage holds nothing usable. */
  private load(): string[] {
    if (this.storage === undefined) return []
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (raw === null) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    } catch {
      // A corrupt record is replaced by the next write.
      return []
    }
  }

  /** Mirror the ring to storage, tolerating a full or unavailable quota. */
  private persist(): void {
    if (this.storage === undefined) return
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.entries))
    } catch {
      // Quota exhausted or writes blocked; the in-memory ring stays authoritative.
    }
  }
}
