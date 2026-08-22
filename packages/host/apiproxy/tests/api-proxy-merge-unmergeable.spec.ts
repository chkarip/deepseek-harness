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
import type { ApiProxy, RpcRequest } from '../src/api/index.ts'
import { RpcId } from '../src/api/index.ts'

// Every fork is unmergeable: planForkMerge refuses all of them, so the RPC
// must fail with fork-unmergeable and leave the forks untouched.
vi.mock('@deepseek-ai/dsh-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-session')>()
  return {
    ...actual,
    planForkMerge: vi.fn(() => ({
      ok: false as const,
      rejection: {
        forkSessionId: SessionId('fork'),
        reason: 'contains a surface-replacing compaction event (seq 0)',
      },
    })),
  }
})

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId('rpc-merge'), payload }
}

function sid(value: string): SessionId {
  return value as SessionId
}

async function composed(): Promise<{ ctx: Context; api: ApiProxy }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('workspaceRegistry', { list: () => [] } as never)
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, { id: session.id, session, status: 'idle', ctx: agentCtx })
      await options.setup?.(agentCtx)
      ctx.agents.register(agent)
      return { agent, dispose: async () => { /* test teardown only */ } }
    },
    resume: () => Promise.reject(new Error('merge test sources are live')),
  })
  return { ctx, api: createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
    cwd: '/tmp',
  }) }
}

function liveAgent(ctx: Context, id: string): SessionId {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'prompt 1' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session.id
}

afterEach(() => { vi.restoreAllMocks() })

describe('sessions.mergeForks (unmergeable forks)', () => {
  it('fails with fork-unmergeable when every fork is rejected, leaving them in place', async () => {
    const { ctx, api } = await composed()
    const parentId = liveAgent(ctx, 'session-parent')
    const forked = await api.sessions.fork(request({ sessionId: parentId }))
    if (!forked.result.ok) throw new Error('fork setup failed')
    const forkId = forked.result.value.sessionId

    const response = await api.sessions.mergeForks(request({ sessionId: parentId }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('fork-unmergeable')
    // The fork survives (not merged, not deleted).
    expect(ctx.sessions.get(forkId)).toBeDefined()
    await ctx.fiber.dispose()
  })
})
