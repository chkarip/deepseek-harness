/**
 * PromptHistory: the ring behind the composer's inline ghost completion.
 * No DOM here — the store takes its storage face as a constructor argument.
 */
import { describe, expect, it } from 'vitest'
import { PromptHistory, type PromptHistoryStorage } from '../src/client/input/prompt-history.ts'

/** In-memory stand-in for `localStorage`, with a switch for a full quota. */
function memoryStorage(seed?: string): PromptHistoryStorage & { readonly items: Map<string, string>; full: boolean } {
  const items = new Map<string, string>()
  if (seed !== undefined) items.set('dsh:prompt-history', seed)
  return {
    items,
    full: false,
    getItem: key => items.get(key) ?? null,
    setItem(key, value) {
      if (this.full) throw new Error('quota exceeded')
      items.set(key, value)
    },
  }
}

describe('PromptHistory', () => {
  it('starts empty and offers nothing before the first prompt', () => {
    const history = new PromptHistory()
    expect(history.list()).toEqual([])
    expect(history.ghost('Exp')).toBeNull()
  })

  it('records prompts most recent first and ignores blank ones', () => {
    const history = new PromptHistory()
    history.record('')
    history.record('   ')
    expect(history.list()).toEqual([])

    history.record('First prompt')
    history.record('Second prompt')
    expect(history.list()).toEqual(['Second prompt', 'First prompt'])
  })

  it('trims the recorded prompt', () => {
    const history = new PromptHistory()
    history.record('  padded  ')
    expect(history.list()).toEqual(['padded'])
  })

  it('moves a repeated prompt to the front instead of duplicating it', () => {
    const history = new PromptHistory()
    history.record('Prompt A')
    history.record('Prompt B')
    history.record('Prompt A')
    expect(history.list()).toEqual(['Prompt A', 'Prompt B'])
  })

  it('caps the ring at 100 prompts, dropping the oldest', () => {
    const history = new PromptHistory()
    for (let i = 0; i < 110; i++) history.record(`Prompt #${i}`)
    const entries = history.list()
    expect(entries.length).toBe(100)
    expect(entries[0]).toBe('Prompt #109')
    expect(entries[99]).toBe('Prompt #10')
  })

  it('completes a draft case-insensitively from the most recent match', () => {
    const history = new PromptHistory()
    history.record('Write unit tests')
    history.record('Explain the architecture of this project')

    expect(history.ghost('')).toBeNull()
    expect(history.ghost('exp')).toBe('lain the architecture of this project')
    expect(history.ghost('Explain')).toBe(' the architecture of this project')
    expect(history.ghost('Explain the architecture of this project')).toBeNull()
    expect(history.ghost('unknown prefix')).toBeNull()
  })

  it('mirrors the ring to storage and reloads it in a new instance', () => {
    const storage = memoryStorage()
    new PromptHistory(storage).record('Persisted prompt')
    expect(new PromptHistory(storage).list()).toEqual(['Persisted prompt'])
  })

  it('clears memory and storage together', () => {
    const storage = memoryStorage()
    const history = new PromptHistory(storage)
    history.record('Something')
    history.clear()
    expect(history.list()).toEqual([])
    expect(new PromptHistory(storage).list()).toEqual([])
  })

  it('ignores a stored value that is not an array of prompts', () => {
    expect(new PromptHistory(memoryStorage('not json')).list()).toEqual([])
    expect(new PromptHistory(memoryStorage('{"nope":1}')).list()).toEqual([])
    expect(new PromptHistory(memoryStorage('[1,"keep","","  "]')).list()).toEqual(['keep'])
  })

  it('keeps serving completions after a storage write fails', () => {
    const storage = memoryStorage()
    storage.full = true
    const history = new PromptHistory(storage)
    expect(() => { history.record('Explain everything') }).not.toThrow()
    expect(history.ghost('Explain')).toBe(' everything')
  })
})
