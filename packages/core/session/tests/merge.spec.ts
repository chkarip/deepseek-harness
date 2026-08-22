import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  Session, SessionId, forkOwnStart, lastTurnOf, planForkMerge,
} from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'test/log-only': { value: string }
  }
}

/**
 * A copy of one header with `seedLength` absent, exercising the defensive path
 * that locates the fork boundary without a recorded seed length.
 * @param header - the header to copy.
 * @returns the same header with no `seedLength` key.
 */
function withoutSeedLength(header: SessionHeader): SessionHeader {
  const { seedLength: _seedLength, ...rest } = header
  return rest
}

async function setup(): Promise<{ ctx: Context; sessions: SessionStore }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return { ctx, sessions: ctx.sessions }
}

function appendClosedTurn(session: Session, turn: number, text: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `answer ${text}` }],
      source: { provider: 'test', model: 'probe' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('fork merge planning', () => {
  it('locates the own-work boundary from the header seedLength', async () => {
    const { ctx, sessions } = await setup()
    const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: '/w' } })
    appendClosedTurn(parent, 1, 'hello')
    const child = sessions.fork(parent, undefined, SessionId('child'))
    appendClosedTurn(child, 2, 'forked')

    const ownStart = forkOwnStart(child.events, child.header)
    // child log: seed (4 events) + end-seed marker + own turn events
    expect(ownStart).toBe(child.header.seedLength as number + 1)
    expect(child.events[ownStart]?.type).toBe('turn/start')
  })

  it('falls back to scanning for the last end-seed marker without a header boundary', async () => {
    const { ctx } = await setup()
    const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: '/w' } })
    appendClosedTurn(parent, 1, 'hello')
    // A child whose header carries no seedLength (defensive path): locate the
    // boundary from the last session/end-seed marker.
    const events = [...parent.events, {
      type: 'session/end-seed', seq: parent.events.length, time: Date.now(), data: {},
    }] as SessionEvent[]
    expect(forkOwnStart(events, withoutSeedLength(parent.header)))
      .toBe(parent.events.length + 1)
    // No marker at all: the whole log counts as own work (start = 0).
    expect(forkOwnStart([...parent.events], withoutSeedLength(parent.header))).toBe(0)
  })

  it('keeps seed-cited sourceEventSeqs as-is and remaps only own-work citations', async () => {
    const { ctx, sessions } = await setup()
    const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: '/w' } })
    appendClosedTurn(parent, 1, 'hello')
    const child = sessions.fork(parent, undefined, SessionId('child'))
    child.append('turn/start', { turn: 2 })
    child.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'fork q' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    child.append('step/start', { turn: 2, step: 1 })
    // Cites BOTH a seed event (seq 1) and its own step (the next seq).
    child.append('assistant/message', {
      turn: 2,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'answer' }],
        source: { provider: 'test', model: 'probe' },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [1, child.seq - 1] })
    child.append('step/end', { turn: 2, step: 1 })
    child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    const planned = planForkMerge(
      { length: parent.events.length, lastTurn: lastTurnOf(parent.events) },
      child.events,
      child.header,
    )
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const answer = planned.plan.events.find(event => event.type === 'assistant/message')
    // Seed citation (1) unchanged; own citation (the step/start seq) becomes
    // relative: (child.seq - 1) - ownStart.
    // (child.seq - 1 at append time) minus ownStart = 9 - 7 = 2.
    expect(answer?.sourceEventSeqs).toEqual([1, 2])
  })

  it('plans no events for a blank fork (seed only)', async () => {
    const { ctx, sessions } = await setup()
    const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: '/w' } })
    appendClosedTurn(parent, 1, 'hello')
    const child = sessions.fork(parent, undefined, SessionId('child'))

    const planned = planForkMerge(
      { length: parent.events.length, lastTurn: lastTurnOf(parent.events) },
      child.events,
      child.header,
    )
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.appendedCount).toBe(0)
  })

  it('replays own-work turns continuing the parent numbering, preserving times', async () => {
    const { ctx, sessions } = await setup()
    const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: '/w' } })
    appendClosedTurn(parent, 1, 'hello')
    const child = sessions.fork(parent, undefined, SessionId('child'))
    appendClosedTurn(child, 2, 'forked')
    // The parent advanced after the fork (a second parent turn), so the child's
    // turn 2 must shift to continue the parent's current numbering.
    appendClosedTurn(parent, 2, 'parent again')

    const planned = planForkMerge(
      { length: parent.events.length, lastTurn: lastTurnOf(parent.events) },
      child.events,
      child.header,
    )
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const { events } = planned.plan
    expect(events.length).toBeGreaterThan(0)
    const firstTurn = events.find(event => event.type === 'turn/start')
    expect(firstTurn).toBeDefined()
    expect((firstTurn?.data as { turn: number }).turn).toBe(3)
    // Original times preserved.
    expect(events[0]?.time).toBe(child.events[child.header.seedLength as number + 1]?.time)
  })

  it('remaps own-work sourceEventSeqs relative to the boundary and keeps seed citations', async () => {
    const { ctx, sessions } = await setup()
    const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: '/w' } })
    appendClosedTurn(parent, 1, 'hello')
    const child = sessions.fork(parent, undefined, SessionId('child'))
    // The child's own assistant/message cites its own chunk seq (a seed seq
    // citation would be the chunk of the LAST seed turn — not produced here).
    child.append('turn/start', { turn: 2 })
    child.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'fork q' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    child.append('step/start', { turn: 2, step: 1 })
    child.append('assistant/chunk', {
      turn: 2,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'fork ' },
    })
    child.append('assistant/message', {
      turn: 2,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'fork answer' }],
        source: { provider: 'test', model: 'probe' },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [child.seq - 1] })
    child.append('step/end', { turn: 2, step: 1 })
    child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    const ownStart = forkOwnStart(child.events, child.header)
    const chunkSeq = child.events.findIndex(event => event.type === 'assistant/chunk')
    const planned = planForkMerge(
      { length: parent.events.length, lastTurn: lastTurnOf(parent.events) },
      child.events,
      child.header,
    )
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const answer = planned.plan.events.find(event => event.type === 'assistant/message')
    expect(answer?.sourceEventSeqs).toEqual([chunkSeq - ownStart])
  })

  it('tolerates defensive branch inputs: no turn shift, marker-less boundary, non-numeric turn', async () => {
    const { ctx, sessions } = await setup()
    const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: '/w' } })
    appendClosedTurn(parent, 1, 'hello')
    const child = sessions.fork(parent, undefined, SessionId('child'))
    appendClosedTurn(child, 2, 'forked')
    // Parent did NOT advance after the fork: the child's turn 2 continues the
    // parent's numbering already, so no shift is applied (turnDelta 0 branch).
    const planned = planForkMerge(
      { length: parent.events.length, lastTurn: lastTurnOf(parent.events) },
      child.events,
      child.header,
    )
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const firstTurn = planned.plan.events.find(event => event.type === 'turn/start')
    expect((firstTurn?.data as { turn: number }).turn).toBe(2)

    // Boundary without an end-seed marker at seedLength (seed ended with one).
    const events = [...child.events]
    const seedLength = child.header.seedLength as number
    events.splice(seedLength, 1) // remove the boundary marker
    expect(forkOwnStart(events, child.header)).toBe(seedLength)

    // Fallback scan skips a non-marker trailing event before finding one.
    const markerAt = child.events.findLastIndex(e => e.type === 'session/end-seed')
    const trailing = [...child.events]
    trailing.push({ type: 'todo/write', seq: trailing.length, time: 1, data: { todos: [] } })
    expect(forkOwnStart(trailing, withoutSeedLength(child.header))).toBe(markerAt + 1)

    // A turn-bearing event with a non-numeric turn counts as turn-less.
    const forged: SessionEvent<'turn/start'> = {
      type: 'turn/start', seq: 0, time: 1, data: { turn: 'x' as never },
    }
    expect(lastTurnOf([forged])).toBe(-1)
  })

  it('merges log-only own work (no turns) without a turn shift', async () => {
    const { ctx, sessions } = await setup()
    const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: '/w' } })
    appendClosedTurn(parent, 1, 'hello')
    const child = sessions.fork(parent, undefined, SessionId('child'))
    // Log-only own work: a plugin event with no turn-bearing events.
    child.append('test/log-only', { value: 'note' })

    const planned = planForkMerge(
      { length: parent.events.length, lastTurn: lastTurnOf(parent.events) },
      child.events,
      child.header,
    )
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.events.map(event => event.type)).toEqual(['test/log-only'])
  })

  it('rejects a fork whose own work contains a surface-replacing event', async () => {
    const { ctx, sessions } = await setup()
    const parent = ctx.sessions.create(SessionId('parent'), { meta: { cwd: '/w' } })
    appendClosedTurn(parent, 1, 'hello')
    const child = sessions.fork(parent, undefined, SessionId('child'))
    appendClosedTurn(child, 2, 'forked')
    // Forge a compaction-style replacement in the own-work segment.
    const events = [...child.events]
    const last = events.at(-1)
    if (last === undefined) throw new Error('no events')
    const replacement: SessionEvent<'assistant/message'> = {
      type: 'assistant/message',
      seq: last.seq,
      time: last.time,
      data: last.data as never,
      surfaceOp: { op: 'replace', start: 0, end: 1 },
      sourceEventSeqs: [0, 1],
    }
    events[events.length - 1] = replacement

    const planned = planForkMerge(
      { length: parent.events.length, lastTurn: lastTurnOf(parent.events) },
      events,
      child.header,
    )
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.rejection.reason).toContain('surface-replacing')
  })
})
