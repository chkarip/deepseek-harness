import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  AgentRegistry, type Agent, type AgentHandle, type CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createApiProxy } from '../src/api-proxy.ts'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { ApiProxy, RpcRequest } from '../src/api/index.ts'
import { RpcId } from '../src/api/index.ts'

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId('rpc-merge'), payload }
}

function sid(value: string): SessionId {
  return value as SessionId
}

/** Composed host with a lightweight agent factory (fork + disposeAgent). */
async function composed(
  workspaces: readonly Workspace[] = [],
): Promise<{ ctx: Context; api: ApiProxy }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
  const unregisterBySession = new Map<SessionId, { unregister: () => void; detachSession: () => void }>()
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.prepare(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const detachSession = ctx.sessions.enter(session)
      ctx.sessions.announce(session)
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, { id: session.id, session, status: 'idle', ctx: agentCtx })
      await options.setup?.(agentCtx)
      const unregister = ctx.agents.register(agent)
      unregisterBySession.set(session.id, { unregister, detachSession })
      return {
        agent,
        dispose: async () => {
          unregister()
          detachSession()
          unregisterBySession.delete(session.id)
        },
      }
    },
    resume: () => Promise.reject(new Error('merge test sources are live')),
    disposeAgent: async (id) => {
      const entry = unregisterBySession.get(id)
      if (entry === undefined) return false
      entry.unregister()
      entry.detachSession()
      unregisterBySession.delete(id)
      return true
    },
  })
  return { ctx, api: createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
    cwd: '/tmp',
  }) }
}

function liveAgent(ctx: Context, id: string, turns: number): SessionId {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${String(turn)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session.id
}

/** Append one own-work turn to a fork (turn numbers continue the seed). */
function appendForkTurn(ctx: Context, forkId: SessionId, turn: number, text: string): void {
  const session = ctx.sessions.get(forkId)
  if (session === undefined) throw new Error(`missing fork ${forkId}`)
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

afterEach(() => { vi.restoreAllMocks() })

describe('sessions.mergeForks', () => {
  it('merges every direct fork into the parent and reports them deleted', async () => {
    const { ctx, api } = await composed()
    const parentId = liveAgent(ctx, 'session-parent', 1)
    // Two forks via the host fork RPC.
    const first = await api.sessions.fork(request({ sessionId: parentId }))
    const second = await api.sessions.fork(request({ sessionId: parentId }))
    if (!first.result.ok || !second.result.ok) throw new Error('fork setup failed')
    const firstId = first.result.value.sessionId
    const secondId = second.result.value.sessionId
    appendForkTurn(ctx, firstId, 2, 'first fork work')
    appendForkTurn(ctx, secondId, 2, 'second fork work')

    const response = await api.sessions.mergeForks(request({ sessionId: parentId }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value.merged).toHaveLength(2)
    expect(response.result.value.failed).toEqual([])
    // The parent's log now carries both forks' own-work messages.
    const parent = ctx.sessions.get(parentId)
    const texts = parent?.events
      .filter(event => event.type === 'user/message')
      .map(event => (event.data as { content: { type: 'text'; text: string }[] }).content[0]?.text)
    expect(texts).toEqual(expect.arrayContaining(['first fork work', 'second fork work']))
    // The merged forks are gone from the live store.
    expect(ctx.sessions.get(firstId)).toBeUndefined()
    expect(ctx.sessions.get(secondId)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('does not merge subagent-origin children', async () => {
    const { ctx, api } = await composed()
    const parentId = liveAgent(ctx, 'session-parent', 1)
    // A subagent-origin child of the parent: same lineage axis, different origin.
    const subagentSession = ctx.sessions.create(sid('session-subagent'), {
      meta: { cwd: '/proj', parentSession: parentId, origin: 'subagent' },
    })
    ctx.agents.register({
      id: subagentSession.id,
      session: subagentSession,
      status: 'idle',
      ctx,
    } as Agent)

    const response = await api.sessions.mergeForks(request({ sessionId: parentId }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('no-forks')
    await ctx.fiber.dispose()
  })

  it('deletes the merged forks through session persistence when one is mounted', async () => {
    const { ctx, api } = await composed()
    const deleted: string[] = []
    ctx.provide('sessionPersistence', {
      list: async () => [],
      delete: async (id: SessionId) => { deleted.push(id) },
    } as never)
    const parentId = liveAgent(ctx, 'session-parent', 1)
    const forked = await api.sessions.fork(request({ sessionId: parentId }))
    if (!forked.result.ok) throw new Error('fork setup failed')
    const forkId = forked.result.value.sessionId
    appendForkTurn(ctx, forkId, 2, 'fork work')

    const response = await api.sessions.mergeForks(request({ sessionId: parentId }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(deleted).toEqual([forkId])
    await ctx.fiber.dispose()
  })

  it('rejects a running parent', async () => {
    const { ctx, api } = await composed()
    const session = ctx.sessions.create(sid('session-parent'), { meta: { cwd: '/proj' } })
    ctx.agents.register({ id: session.id, session, status: 'running', ctx } as Agent)

    const response = await api.sessions.mergeForks(request({ sessionId: session.id }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('session-busy')
    await ctx.fiber.dispose()
  })

  it('detaches merged forks from their workspace accounting', async () => {
    const accounted: SessionId[] = []
    const detachSession = vi.fn<(sessionId: SessionId) => Promise<void>>()
      .mockImplementation(async (sessionId) => {
        const at = accounted.indexOf(sessionId)
        if (at !== -1) accounted.splice(at, 1)
      })
    const workspace = {
      sessionIds: accounted,
      detachSession,
      attachSession: async (sessionId: SessionId) => {
        if (!accounted.includes(sessionId)) accounted.push(sessionId)
      },
    } as unknown as Workspace
    const { ctx, api } = await composed([workspace])
    const parentId = liveAgent(ctx, 'session-parent', 1)
    accounted.push(parentId)
    const forked = await api.sessions.fork(request({ sessionId: parentId }))
    if (!forked.result.ok) throw new Error('fork setup failed')
    const forkId = forked.result.value.sessionId
    appendForkTurn(ctx, forkId, 2, 'fork work')

    const response = await api.sessions.mergeForks(request({ sessionId: parentId }))

    expect(response.result.ok).toBe(true)
    expect(detachSession).toHaveBeenCalledWith(forkId)
    expect(accounted).toEqual([parentId])
    await ctx.fiber.dispose()
  })
})
