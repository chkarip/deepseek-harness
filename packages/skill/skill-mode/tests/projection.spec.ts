import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionStore } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandId as CommandIdType } from '@deepseek-ai/dsh-commands'
import SkillModeController from '../src/index.ts'

interface Bench {
  ctx: Context
  session: Session
  values: () => { [key: string]: unknown }
}

async function harness(withSkillMode: boolean): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: '/nonexistent/.dsh',
    agentsHome: '/nonexistent/.agents',
    watch: false,
  })
  await ctx.plugin(CommandRuntime)
  if (withSkillMode) await ctx.plugin(SkillModeController)
  const session = ctx.sessions.create()
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return {
    ctx,
    session,
    values: () => ctx.sessionProjections.snapshot(session).values,
  }
}

/** Append one logged /mode selection record (the executor's command/run shape). */
function runModeCommand(session: Session, args: string, index: number): CommandIdType {
  const commandId = CommandId(`skill-mode-proj-${String(index)}`)
  session.append('command/run', {
    commandId,
    name: 'mode',
    args,
    source: { kind: 'user' },
  })
  return commandId
}

/** Append the paired settlement for one projected mode command. */
function settleModeCommand(session: Session, commandId: CommandIdType, kind: 'success' | 'error'): void {
  session.append('command/done', { commandId, kind })
}

/** Commit one skill/mode flip inside an open turn (the invariant's turn-enclosure rule). */
function commitSkillMode(session: Session, name: string | null, turn: number): void {
  session.append('turn/start', { turn })
  session.append('skill/mode', { name })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('skill-mode projection unit', () => {
  it('serves off/not-pending for the empty log', async () => {
    const bench = await harness(true)
    expect(bench.values()).toEqual({ 'skill-mode': { name: null, pending: false } })
  })

  it('a logged /mode selection reads pending until skill/mode records it', async () => {
    const bench = await harness(true)
    const commandId = runModeCommand(bench.session, 'unslop', 0)
    expect(bench.values()['skill-mode']).toEqual({ name: null, pending: true })
    settleModeCommand(bench.session, commandId, 'success')
    expect(bench.values()['skill-mode']).toEqual({ name: null, pending: true })
    commitSkillMode(bench.session, 'unslop', 0)
    expect(bench.values()['skill-mode']).toEqual({ name: 'unslop', pending: false })
  })

  it('drops a mode selection when its command settles with an error', async () => {
    const bench = await harness(true)
    commitSkillMode(bench.session, 'unslop', 0)
    const commandId = runModeCommand(bench.session, 'off', 0)
    expect(bench.values()['skill-mode']).toEqual({ name: 'unslop', pending: true })
    settleModeCommand(bench.session, commandId, 'error')
    expect(bench.values()['skill-mode']).toEqual({ name: 'unslop', pending: false })
  })

  it('folds `off` args and non-mode commands correctly, and a matching selection is not pending', async () => {
    const bench = await harness(true)
    commitSkillMode(bench.session, 'unslop', 0)
    // Another command's record never touches mode state.
    bench.session.append('command/run', {
      commandId: CommandId('other-1'), name: 'compact', args: '', source: { kind: 'user' },
    })
    expect(bench.values()['skill-mode']).toEqual({ name: 'unslop', pending: false })
    // A command lifecycle with omitted input carries no mode selection.
    bench.session.append('command/run', {
      commandId: CommandId('mode-no-input'), name: 'mode', source: { kind: 'user' },
    })
    expect(bench.values()['skill-mode']).toEqual({ name: 'unslop', pending: false })
    runModeCommand(bench.session, ' off', 1)
    expect(bench.values()['skill-mode']).toEqual({ name: 'unslop', pending: true })
    commitSkillMode(bench.session, null, 1)
    expect(bench.values()['skill-mode']).toEqual({ name: null, pending: false })
    // Selecting the already-committed state folds to not-pending (net zero).
    runModeCommand(bench.session, 'off', 2)
    expect(bench.values()['skill-mode']).toEqual({ name: null, pending: false })
  })

  it('a /mode name-argument selection targets that mode skill', async () => {
    const bench = await harness(true)
    runModeCommand(bench.session, ' unslop', 0)
    expect(bench.values()['skill-mode']).toEqual({ name: null, pending: true })
    commitSkillMode(bench.session, 'unslop', 0)
    expect(bench.values()['skill-mode']).toEqual({ name: 'unslop', pending: false })
  })

  it('has no skill-mode key when skill-mode is not composed', async () => {
    const bench = await harness(false)
    expect('skill-mode' in bench.values()).toBe(false)
  })

  it('drops the key when the skill-mode fiber unloads (HMR safety)', async () => {
    const bench = await harness(false)
    const fiber = await bench.ctx.plugin(SkillModeController)
    expect(bench.values()['skill-mode']).toEqual({ name: null, pending: false })
    await fiber.dispose()
    expect('skill-mode' in bench.values()).toBe(false)
  })

  it('cold replay recovers pending from the log alone (a fresh registry refolds it)', async () => {
    const bench = await harness(true)
    runModeCommand(bench.session, 'unslop', 0)
    // A second registry over the same log (the cold-read shape): no service
    // memory involved, the fold alone answers {name:null, pending:true}.
    const cold = await harness(true)
    for (const event of bench.session.events) {
      if (event.type === 'command/run' || event.type === 'command/done' || event.type === 'skill/mode') {
        cold.session.append(event.type, event.data)
      }
    }
    expect(cold.values()['skill-mode']).toEqual({ name: null, pending: true })
  })
})
