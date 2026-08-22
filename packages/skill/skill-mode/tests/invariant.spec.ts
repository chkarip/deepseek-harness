import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as SkillModeInvariant from '@deepseek-ai/dsh-skill-mode/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SkillModeInvariant)
  return ctx
}

function event(name: unknown): SessionEvent {
  return { type: 'skill/mode', seq: 0, time: 0, data: { name } } as SessionEvent
}

function emitTurnStart(ctx: Context, session: Session): void {
  ctx.emit('session/event', session, {
    type: 'turn/start', seq: 0, time: 0,
    data: { turn: 1 },
  })
}

describe('skill-mode stream invariants', () => {
  it('accepts a string name or null', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('skill-mode-state'))
    emitTurnStart(ctx, session)
    expect(() => { ctx.emit('session/event', session, event('unslop')) }).not.toThrow()
    expect(() => { ctx.emit('session/event', session, event(null)) }).not.toThrow()
    ctx.emit('session/event', session, {
      type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } },
    })
  })

  it.each([42, false, undefined])('rejects invalid durable mode state %j', async (name) => {
    const ctx = await setup()
    const session = Session.create(SessionId(`invalid-${String(name)}`))
    emitTurnStart(ctx, session)
    expect(() => { ctx.emit('session/event', session, event(name)) })
      .toThrow(/expected a string or null/)
  })

  it('accepts standalone mode state between turns (the idle immediate commit)', async () => {
    const ctx = await setup()
    expect(() => ctx.sessions.create().append('skill/mode', { name: 'unslop' }))
      .not.toThrow()
  })

  it('ignores unrelated dispatches and session events', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('unrelated'))
    expect(() => {
      ctx.emit('tools/change')
      ctx.emit('session/event', session, {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })

  it('rejects invalid existing state on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('skill/mode', { name: 42 as unknown as string })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SkillModeInvariant).then(() => undefined)).rejects.toThrow(/expected a string or null/)
  })

  it('replays enclosed existing mode state through its closing boundary', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('skill/mode', { name: 'unslop' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SkillModeInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('accepts standalone existing mode state on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('skill/mode', { name: 'unslop' })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SkillModeInvariant).then(() => undefined)).resolves.toBeUndefined()
  })
})
