/**
 * ui-skill-mode browser half on a real cordis Context with fake command /
 * connection / locale faces: the plugin mounts a `/mode` decoration whose
 * popupSelect options come from the skills.list RPC filtered to `mode ===
 * true`, and whose onSelect executes `/mode <name>` through the command
 * channel. Scope disposal drops the decoration (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandDecoration, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import { apply, inject } from '../src/client/index.ts'

const sid = (k: string): SessionId => k as SessionId

const SKILLS: SkillEntry[] = [
  { name: 'unslop', description: 'Cut AI tells from any writing.', modelInvocable: true, mode: true },
  { name: 'plain', description: 'An ordinary skill.', modelInvocable: true, mode: false },
  { name: 'tdd', description: 'Test-driven development.', modelInvocable: true, mode: true },
]

/** Boot the plugin over fake faces + a stateful fake host (mode list + execute log). */
async function mount() {
  const ctx = new Context()
  const calls = { list: 0, execute: 0 }
  const executed: string[] = []
  ctx.provide('connection', { api: { skills: {
    list: () => {
      calls.list += 1
      return Promise.resolve({ result: { ok: true as const, value: { skills: SKILLS } } })
    },
  } } })
  let decoration: CommandDecoration | undefined
  ctx.provide('commandUi', {
    register: () => () => {},
    decorate(d: CommandDecoration) {
      decoration = d
      return () => { decoration = undefined }
    },
  })
  const execute = vi.fn((sessionId: SessionId, line: string) => {
    calls.execute += 1
    executed.push(`${String(sessionId)} ${line}`)
    return Promise.resolve({ ok: true as const, value: { commandId: 'c1', result: { kind: 'success' as const } } })
  })
  const commandsRemote = { execute }
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  const localeRuntime = new LocaleRuntime(ctx)
  localeRuntime.setLocale('en')
  ctx.provide('locale', localeRuntime)
  const scopes = new Map<SessionId, Context>()
  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id),
    subagentAddress: () => undefined,
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await ctx.plugin(function probe() {}).await()
  const mint = (key: string) => {
    const handle = createScope(ctx, sid(key))
    scopes.set(sid(key), handle.ctx)
    return handle
  }
  return {
    ctx, fiber, mint, calls, executed,
    decoration: () => decoration!,
  }
}

describe('ui-skill-mode browser half', () => {
  it('decorates the host /mode command', async () => {
    const bench = await mount()
    expect(bench.decoration().name).toBe('mode')
    expect(bench.decoration().available(undefined as never)).toBe(true)
  })

  it('lists only mode skills as popup options', async () => {
    const bench = await mount()
    const options = await bench.decoration().ui.options(
      { sessionId: sid('s1') },
      new AbortController().signal,
    )
    expect(bench.calls.list).toBe(1)
    expect(options.map((option: SelectOption) => option.id)).toEqual(['unslop', 'tdd'])
    expect(options.map((option: SelectOption) => option.detail)).toEqual([
      'Cut AI tells from any writing.',
      'Test-driven development.',
    ])
  })

  it('executes /mode <name> on select through the command channel', async () => {
    const bench = await mount()
    const option = (await bench.decoration().ui.options(
      { sessionId: sid('s1') },
      new AbortController().signal,
    ))[0]!
    await bench.decoration().ui.onSelect(option, { sessionId: sid('s1') })
    expect(bench.calls.execute).toBe(1)
    expect(bench.executed).toEqual(['s1 /mode unslop'])
  })

  it('reports a failed command result as a selection error', async () => {
    const ctx = new Context()
    ctx.provide('connection', { api: { skills: {
      list: () => Promise.resolve({ result: { ok: true as const, value: { skills: SKILLS } } }),
    } } })
    let decoration: CommandDecoration | undefined
    ctx.provide('commandUi', {
      register: () => () => {},
      decorate(d: CommandDecoration) {
        decoration = d
        return () => { decoration = undefined }
      },
    })
    const execute = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { commandId: 'c2', result: { kind: 'error' as const, text: 'not user-invocable' } },
    }))
    const commandsRemote = { execute }
    ctx.provide('remote', { commands: commandsRemote })
    ctx.provide('remote.commands', commandsRemote)
    const localeRuntime = new LocaleRuntime(ctx)
    localeRuntime.setLocale('en')
    ctx.provide('locale', localeRuntime)
    ctx.provide('sessions', {
      scope: () => undefined,
      subagentAddress: () => undefined,
    })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await ctx.plugin(function probe() {}).await()
    const handle = createScope(ctx, sid('s2'))
    const options = await decoration!.ui.options({ sessionId: sid('s2') }, new AbortController().signal)
    await expect(decoration!.ui.onSelect(options[0]!, { sessionId: sid('s2') }))
      .rejects.toThrow('not user-invocable')
    void handle
  })

  it('drops the decoration on fiber disposal (HMR safety)', async () => {
    const bench = await mount()
    expect(bench.decoration()).toBeDefined()
    await bench.fiber.dispose()
    expect(bench.decoration()).toBeUndefined()
  })
})
