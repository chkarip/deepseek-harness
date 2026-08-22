import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId, SessionStore, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillModeController, { foldSkillMode } from '../src/index.ts'

const TEST_BODY = '# Mode skill body\n\nFollow these instructions.'

async function tempDir(name: string): Promise<string> {
  return await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), `dsh-${name}-`)))
}

async function writeSkill(
  root: string,
  name: string,
  description: string,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  const frontmatter = [
    `name: ${name}`,
    `description: ${description}`,
    ...Object.entries(extra).map(([key, value]) => `${key}: ${String(value)}`),
  ].join('\n')
  await writeFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`)
}

async function setup(home: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillModeController)
  // The `ctx.inject` child mounts asynchronously once `commands` resolves.
  await new Promise(resolve => setImmediate(resolve))
  setupCtx = ctx
  return ctx
}

let setupCtx: Context | undefined

async function agentForCwd(cwd: string, id = 'skill-mode-agent'): Promise<Agent & { session: Session }> {
  const sessionId = SessionId(id)
  const store = setupCtx!.get('sessions')
  const session = store === undefined
    ? Session.create(sessionId, [], { version: 0, id: sessionId, createdAt: 0, cwd })
    : store.create(sessionId, { meta: { cwd } })
  const agent = {
    id: sessionId,
    options: {},
    session,
    inject(message: UserMessage) {
      session.append('user/message', message, { surfaceOp: 'append' })
    },
  } as unknown as Agent & { session: Session }
  let scoped!: Context
  await setupCtx!.plugin(Object.assign((inner: Context) => { scoped = createScope(inner, agent).ctx }, {
    inject: ['tools'],
  }))
  ;(agent as { ctx?: Context }).ctx = scoped
  const agents = setupCtx!.get('agents')
  if (agents === undefined) {
    setupCtx!.emit('agent/created', { agent })
  } else {
    agents.enter(agent, undefined)
    agents.announce(agent)
  }
  return agent
}

/** Assemble exactly as the loop does: the agent is both subject and scope. */
function assembleFor(ctx: Context, agent: Agent) {
  return ctx.systemPrompt.assemble({ agent, scope: agent })
}

async function fireStep(ctx: Context, agent: Agent, turn = 1, step = 1): Promise<void> {
  const signal = new AbortController().signal
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn, step, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  if (decision.kind === 'enter') {
    for (const message of decision.messages) {
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
}

/** Open a turn so a selection queues for the boundary flush (the mid-turn shape). */
function openTurn(session: Session, turn = 0): void {
  session.append('turn/start', { turn })
}

/** Close the open turn (the between-turns shape: selections commit immediately). */
function closeTurn(session: Session, turn = 0): void {
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** Append a minimal `request/header` snapshot so the log has a "what the model was told" anchor. */
function header(session: Session): void {
  session.append('request/header', { header: { config: { provider: 'test', model: 'test-model' } }, reason: 'initial' })
}

function noticeTexts(session: Session): string[] {
  return session.events
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
    .map(event => (event.data as { content: { type: string; text?: string }[] }).content.map(block => block.text ?? '').join(''))
}

describe('foldSkillMode', () => {
  it('folds an empty log to off and takes the last skill/mode otherwise', () => {
    const session = Session.create(SessionId('fold'))
    expect(foldSkillMode(session.events)).toBeNull()
    session.append('skill/mode', { name: 'unslop' })
    session.append('skill/mode', { name: null })
    session.append('skill/mode', { name: 'unslop' })
    expect(foldSkillMode(session.events)).toBe('unslop')
  })

  it('folds a prefix when `end` is given', () => {
    const session = Session.create(SessionId('fold-prefix'))
    session.append('skill/mode', { name: 'unslop' })
    session.append('skill/mode', { name: null })
    expect(foldSkillMode(session.events, 1)).toBe('unslop')
    expect(foldSkillMode(session.events, 0)).toBeNull()
  })
})

describe('ctx.skillMode: get/set', () => {
  it('reads the folded state', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    expect(ctx.skillMode.get(agent)).toEqual({ name: null })
    agent.session.append('skill/mode', { name: 'unslop' })
    expect(ctx.skillMode.get(agent)).toEqual({ name: 'unslop' })
  })

  it('queues an exit selection during an open turn', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    agent.session.append('skill/mode', { name: 'unslop' })
    openTurn(agent.session)
    expect(ctx.skillMode.set(agent, null)).toBe('queued')
    expect(ctx.skillMode.get(agent)).toEqual({ name: 'unslop', pending: null })
  })

  it('drops a no-op set (target equals pending, else the current fold)', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    openTurn(agent.session)
    expect(ctx.skillMode.set(agent, null)).toBe('noop')
    expect(ctx.skillMode.get(agent)).toEqual({ name: null })
    expect(ctx.skillMode.set(agent, 'unslop')).toBe('queued')
    expect(ctx.skillMode.set(agent, 'unslop')).toBe('noop')
    expect(ctx.skillMode.get(agent)).toEqual({ name: null, pending: 'unslop' })
  })

  it('a between-turns selection commits skill/mode immediately (no boundary would come)', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    expect(ctx.skillMode.set(agent, 'unslop')).toBe('committed')
    expect(foldSkillMode(agent.session.events)).toBe('unslop')
    expect(ctx.skillMode.get(agent)).toEqual({ name: 'unslop' })
    // Immediately reversible, still without a boundary.
    expect(ctx.skillMode.set(agent, null)).toBe('committed')
    expect(foldSkillMode(agent.session.events)).toBeNull()
    // A later boundary finds nothing pending — no double append.
    await fireStep(ctx, agent)
    expect(agent.session.events.filter(event => event.type === 'skill/mode')).toHaveLength(2)
  })

  it('a between-turns reversal of a mid-turn pending intent cancels without logging', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    openTurn(agent.session)
    expect(ctx.skillMode.set(agent, 'unslop')).toBe('queued')
    closeTurn(agent.session)
    // Back to the logged state: the pending intent clears, nothing lands.
    expect(ctx.skillMode.set(agent, null)).toBe('cancelled')
    expect(agent.session.events.some(event => event.type === 'skill/mode')).toBe(false)
    expect(ctx.skillMode.get(agent)).toEqual({ name: null })
  })

  it('a between-turns commit narrates when the last header told the model otherwise', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    header(agent.session)
    ctx.skillMode.set(agent, 'unslop')
    expect(noticeTexts(agent.session)).toEqual(['The user switched this session to skill mode unslop.'])
  })
})

describe('the boundary flush', () => {
  it('is inert when no selection is pending', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    await fireStep(ctx, agent)
    expect(agent.session.events.filter(event => event.type === 'skill/mode')).toHaveLength(0)
  })

  it('flushes from pre-step before the following step/start', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    openTurn(agent.session)
    expect(ctx.skillMode.set(agent, 'unslop')).toBe('queued')
    await fireStep(ctx, agent)
    expect(foldSkillMode(agent.session.events)).toBe('unslop')
  })

  it('narrates once when the flushed mode differs from what the last header told the model', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    header(agent.session)
    openTurn(agent.session)
    ctx.skillMode.set(agent, 'unslop')
    await fireStep(ctx, agent)
    expect(noticeTexts(agent.session)).toEqual(['The user switched this session to skill mode unslop.'])
    await fireStep(ctx, agent)
    expect(noticeTexts(agent.session)).toEqual(['The user switched this session to skill mode unslop.'])
  })

  it('narrates a switch back to the default mode with the default wording', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    agent.session.append('skill/mode', { name: 'unslop' })
    header(agent.session)
    ctx.skillMode.set(agent, null)
    await fireStep(ctx, agent)
    expect(noticeTexts(agent.session)).toEqual(['The user switched this session back to the default mode.'])
  })

  it('stays silent when the header already reflects the flushed mode', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    agent.session.append('skill/mode', { name: 'unslop' })
    header(agent.session)
    agent.session.append('skill/mode', { name: null })
    ctx.skillMode.set(agent, 'unslop')
    await fireStep(ctx, agent)
    expect(foldSkillMode(agent.session.events)).toBe('unslop')
    expect(noticeTexts(agent.session)).toEqual([])
  })
})

describe('the mode section', () => {
  it('renders nothing before any mode is active or when the body is not yet warmed', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    const assembly = await assembleFor(ctx, agent)
    expect(assembly.sections.find(section => section.name === 'skill-mode')?.text).toBe('')
  })

  it('renders the mode body in the system prompt once the mode is active and warmed', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    ctx.skillMode.set(agent, 'unslop')
    await fireStep(ctx, agent)
    const assembly = await assembleFor(ctx, agent)
    const section = assembly.sections.find(section => section.name === 'skill-mode')
    expect(section?.text).toContain('Skill mode "unslop" is active in this session.')
    expect(section?.text).toContain('# Mode skill body')
    expect(section?.text).toContain('Follow these instructions.')
  })

  it('stops rendering after /mode off', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    ctx.skillMode.set(agent, 'unslop')
    await fireStep(ctx, agent)
    ctx.skillMode.set(agent, null)
    await fireStep(ctx, agent)
    const assembly = await assembleFor(ctx, agent)
    expect(assembly.sections.find(section => section.name === 'skill-mode')?.text).toBe('')
  })

  it('leaves an agent-less assembly untouched', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'skill-mode')?.text).toBe('')
  })

  it('drops the mode when the skill disappears', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    ctx.skillMode.set(agent, 'unslop')
    await fireStep(ctx, agent)
    await import('node:fs/promises').then(fs => fs.rm(join(home, '.agents', 'skills', 'unslop'), { recursive: true, force: true }))
    ctx.emit('skills/change')
    // The skills/change handler re-resolves asynchronously; two turns let the
    // registry read settle before the section is assembled.
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    const assembly = await assembleFor(ctx, agent)
    expect(assembly.sections.find(section => section.name === 'skill-mode')?.text).toBe('')
    expect(foldSkillMode(agent.session.events)).toBeNull()
  })
})

describe('/mode command', () => {
  async function runCommand(
    ctx: Context,
    agent: Agent & { session: Session },
    line: string,
  ): Promise<{ kind: 'success'; text?: string } | { kind: 'error'; text: string }> {
    const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
    if (execution === undefined || execution.result === undefined) {
      throw new Error(`no command result for "${line}"`)
    }
    return execution.result
  }

  it('enters a valid mode skill', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    const result = await runCommand(ctx, agent, '/mode unslop')
    expect(result.kind).toBe('success')
    expect(foldSkillMode(agent.session.events)).toBe('unslop')
  })

  it('rejects an unknown skill', async () => {
    const home = await tempDir('skill-mode')
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    const result = await runCommand(ctx, agent, '/mode nope')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.text).toContain('Unknown skill "nope"')
  })

  it('rejects a skill that is not a mode', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'plain', 'An ordinary skill.', TEST_BODY)
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    const result = await runCommand(ctx, agent, '/mode plain')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.text).toContain('is not a mode skill')
  })

  it('rejects a model-only skill', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'hidden', 'A user-hidden mode skill.', TEST_BODY, {
      mode: true,
      'user-invocable': false,
    })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    const result = await runCommand(ctx, agent, '/mode hidden')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.text).toContain('not user-invocable')
  })

  it('leaves the mode on /mode off', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    await runCommand(ctx, agent, '/mode unslop')
    const result = await runCommand(ctx, agent, '/mode off')
    expect(result.kind).toBe('success')
    expect(foldSkillMode(agent.session.events)).toBeNull()
  })

  it('lists available mode skills and the current state on bare /mode', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    await writeSkill(join(home, '.agents', 'skills'), 'plain', 'An ordinary skill.', TEST_BODY)
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    const result = await runCommand(ctx, agent, '/mode')
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.text).toContain('No skill mode is active')
      expect(result.text).toContain('- unslop: Cut AI tells from any writing.')
      expect(result.text).not.toContain('plain')
    }
  })

  it('bare /mode reports an active mode', async () => {
    const home = await tempDir('skill-mode')
    await writeSkill(join(home, '.agents', 'skills'), 'unslop', 'Cut AI tells from any writing.', TEST_BODY, { mode: true })
    const ctx = await setup(home)
    const agent = await agentForCwd(home)
    await runCommand(ctx, agent, '/mode unslop')
    const result = await runCommand(ctx, agent, '/mode')
    expect(result.kind).toBe('success')
    if (result.kind === 'success') expect(result.text).toContain('Skill mode unslop is active')
  })
})
