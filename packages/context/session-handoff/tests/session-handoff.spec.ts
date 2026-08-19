import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { deriveEventMessage, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import {
  extractHandoffContent,
  renderHandoffPrompt,
  retainHandoffPayload,
  SessionHandoffService,
  stringifyTagSafeJson,
  type Config,
  type SessionHandoffDelivery,
  type SessionHandoffErrorCode,
  type SessionHandoffRequest,
} from '../src/index.ts'

function expectCode(code: SessionHandoffErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

function createFakeAgent(session: Session): Agent {
  const injected: unknown[] = []
  const followups: unknown[] = []

  const agent: Agent = {
    id: session.id,
    session,
    inject: vi.fn((msg) => {
      injected.push(msg)
    }),
    followup: vi.fn((msg) => {
      followups.push(msg)
    }),
  } as unknown as Agent

  return agent
}

function appendAssistant(session: Session, text: string): MessageId {
  const msg = createAssistantMessage({
    content: [{ type: 'text', text }],
    source: { provider: 'test', model: 'test' },
  })
  const ev = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: msg,
  }, { surfaceOp: 'append' })
  return deriveEventMessage(ev)!.id as MessageId
}

function appendUser(session: Session, text: string): void {
  const msg = createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
  session.append('user/message', msg, { surfaceOp: 'append' })
}

class TestSessionQueryEngine extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    ..._args: Parameters<SessionQueryEngine['searchEvents']>
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return Promise.resolve({ items: [] } as never)
  }
}

async function harness(config: Config = {}): Promise<{
  ctx: Context
  service: SessionHandoffService
  agentsMap: Map<SessionId, Agent>
  createAgent: (id: string, cwd?: string) => { agent: Agent; session: Session }
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSessionQueryEngine)

  const agentsMap = new Map<SessionId, Agent>()
  ctx.provide('agents', {
    get: (sessionId: SessionId) => agentsMap.get(sessionId),
  } as never)

  await ctx.plugin(SessionHandoffService, config)

  const service = ctx.sessionHandoff

  const createAgent = (id: string, cwd?: string) => {
    const session = ctx.sessions.create(id as SessionId, {
      meta: {
        cwd: cwd ?? '/workspace/repo',
      },
    })
    const agent = createFakeAgent(session)
    agentsMap.set(session.id, agent)
    return { agent, session }
  }

  return { ctx, service, agentsMap, createAgent }
}

describe('stringifyTagSafeJson & renderHandoffPrompt', () => {
  it('serializes objects and escapes opening brackets', () => {
    const data = { prompt: '<script>alert("xss")</script>', count: 42 }
    const serialized = stringifyTagSafeJson(data)
    expect(serialized).not.toContain('<')
    expect(serialized).toContain('\\u003c')
    expect(JSON.parse(serialized)).toEqual(data)
  })

  it('throws on non-serializable input', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => stringifyTagSafeJson(circular)).toThrow(TypeError)
  })

  it('renders prompt with untrusted wrapper', () => {
    const prompt = renderHandoffPrompt({
      sessionId: 's1',
      label: 'Panel A',
      messageId: 'm1',
      answer: '42',
    })
    expect(prompt).toContain('## Relayed session handoff')
    expect(prompt).toContain('<relayed-handoff>')
    expect(prompt).toContain('</relayed-handoff>')
    expect(prompt).toContain('42')
  })
})

describe('extractHandoffContent', () => {
  it('extracts assistant answer and nearest preceding user question', async () => {
    const { ctx } = await harness()
    const session = ctx.sessions.create('s-extract' as SessionId)

    appendUser(session, 'What is 2+2?')
    const msgId = appendAssistant(session, 'The answer is 4.')

    const extracted = extractHandoffContent(session.events, msgId)

    expect(extracted).toEqual({
      answer: 'The answer is 4.',
      question: 'What is 2+2?',
    })
  })

  it('extracts answer without question if no preceding user message exists', async () => {
    const { ctx } = await harness()
    const session = ctx.sessions.create('s-no-q' as SessionId)

    const msgId = appendAssistant(session, 'System greeting')
    const extracted = extractHandoffContent(session.events, msgId)

    expect(extracted).toEqual({
      answer: 'System greeting',
    })
  })

  it('returns undefined if target messageId is not found', async () => {
    const { ctx } = await harness()
    const session = ctx.sessions.create('s-missing' as SessionId)
    expect(extractHandoffContent(session.events, 'm-404' as MessageId)).toBeUndefined()
  })
})

describe('retainHandoffPayload', () => {
  it('retains within budget when content is short', () => {
    const retained = retainHandoffPayload({
      sessionId: 's1',
      label: 'Panel A',
      messageId: 'm1',
      cwd: '/workspace',
      extracted: { answer: 'Hello', question: 'Hi' },
      include: { answer: true, question: true, summary: true },
      summaryText: 'Summary',
    }, 1024)

    expect(retained).toEqual({
      sessionId: 's1',
      label: 'Panel A',
      messageId: 'm1',
      cwd: '/workspace',
      summary: 'Summary',
      question: 'Hi',
      answer: 'Hello',
    })
  })

  it('truncates answer and question when exceeding budget', () => {
    const longAnswer = 'A'.repeat(5000)
    const retained = retainHandoffPayload({
      sessionId: 's1',
      label: 'Panel A',
      messageId: 'm1',
      extracted: { answer: longAnswer, question: 'Short question' },
      include: { answer: true, question: true, summary: false },
    }, 1000)

    expect(retained).toBeDefined()
    expect(retained?.answer).toContain('omitted')
    expect(retained?.question).toBe('Short question')
  })

  it('returns undefined when budget is too tiny to fit minimal structure', () => {
    const retained = retainHandoffPayload({
      sessionId: 's1',
      label: 'Panel A',
      messageId: 'm1',
      extracted: { answer: 'A', question: 'Q' },
      include: { answer: true, question: true, summary: false },
    }, 10)

    expect(retained).toBeUndefined()
  })
})

describe('SessionHandoffService', () => {
  it('validates constructor config', async () => {
    const ctx1 = new Context()
    await ctx1.plugin(SessionStore)
    expect(() => new SessionHandoffService(ctx1, { maxRelayBytes: -1 })).toThrow(
      expectCode('SESSION_HANDOFF_INVALID_CONFIG'),
    )
    const ctx2 = new Context()
    await ctx2.plugin(SessionStore)
    expect(() => new SessionHandoffService(ctx2, { maxRelayBytes: 1.5 })).toThrow(
      expectCode('SESSION_HANDOFF_INVALID_CONFIG'),
    )
  })

  it('validates request payload structure', async () => {
    const { service } = await harness()

    await expect(service.relay(null as unknown as SessionHandoffRequest)).rejects.toThrow(expectCode('SESSION_HANDOFF_INVALID_REQUEST'))
    await expect(service.relay({} as unknown as SessionHandoffRequest)).rejects.toThrow(expectCode('SESSION_HANDOFF_INVALID_REQUEST'))
    await expect(service.relay({
      sourceSessionId: 's1' as SessionId,
      targetSessionId: 's2' as SessionId,
      messageId: 'm1' as MessageId,
      senderLabel: 'A',
      include: { answer: true, question: true, summary: true },
      delivery: 'invalid' as unknown as SessionHandoffDelivery,
    })).rejects.toThrow(expectCode('SESSION_HANDOFF_INVALID_REQUEST'))
  })

  it('rejects self-relay', async () => {
    const { service } = await harness()
    await expect(service.relay({
      sourceSessionId: 's1' as SessionId,
      targetSessionId: 's1' as SessionId,
      messageId: 'm1' as MessageId,
      senderLabel: 'Panel A',
      include: { answer: true, question: true, summary: false },
      delivery: 'attach',
    })).rejects.toThrow(expectCode('SESSION_HANDOFF_SELF_RELAY'))
  })

  it('rejects unknown source or target sessions', async () => {
    const { service, createAgent } = await harness()
    const { agent } = createAgent('s-live')

    await expect(service.relay({
      sourceSessionId: 's-missing' as SessionId,
      targetSessionId: agent.id,
      messageId: 'm1' as MessageId,
      senderLabel: 'Panel A',
      include: { answer: true, question: true, summary: false },
      delivery: 'attach',
    })).rejects.toThrow(expectCode('SESSION_HANDOFF_SOURCE_NOT_FOUND'))

    await expect(service.relay({
      sourceSessionId: agent.id,
      targetSessionId: 's-missing' as SessionId,
      messageId: 'm1' as MessageId,
      senderLabel: 'Panel A',
      include: { answer: true, question: true, summary: false },
      delivery: 'attach',
    })).rejects.toThrow(expectCode('SESSION_HANDOFF_TARGET_NOT_FOUND'))
  })

  it('rejects cross-workspace handoffs when disallowed', async () => {
    const { service, createAgent } = await harness({ allowCrossWorkspace: false })
    const { agent: source, session: srcSession } = createAgent('s-src', '/workspace/app-a')
    const { agent: target } = createAgent('s-tgt', '/workspace/app-b')

    const msgId = appendAssistant(srcSession, 'Some answer')

    await expect(service.relay({
      sourceSessionId: source.id,
      targetSessionId: target.id,
      messageId: msgId,
      senderLabel: 'Panel A',
      include: { answer: true, question: true, summary: false },
      delivery: 'attach',
    })).rejects.toThrow(expectCode('SESSION_HANDOFF_CROSS_WORKSPACE_DISALLOWED'))
  })

  it('allows cross-workspace handoffs when configured', async () => {
    const { service, createAgent } = await harness({ allowCrossWorkspace: true })
    const { agent: source, session: srcSession } = createAgent('s-src-allowed', '/workspace/app-a')
    const { agent: target } = createAgent('s-tgt-allowed', '/workspace/app-b')

    const msgId = appendAssistant(srcSession, 'Cross-workspace reply')

    const result = await service.relay({
      sourceSessionId: source.id,
      targetSessionId: target.id,
      messageId: msgId,
      senderLabel: 'Panel A',
      include: { answer: true, question: false, summary: false },
      delivery: 'attach',
    })

    expect(result.ok).toBe(true)
    expect(target.inject).toHaveBeenCalledTimes(1)
  })

  it('rejects when messageId is not a finalized assistant message', async () => {
    const { service, createAgent } = await harness()
    const { agent: source } = createAgent('s-src')
    const { agent: target } = createAgent('s-tgt')

    await expect(service.relay({
      sourceSessionId: source.id,
      targetSessionId: target.id,
      messageId: 'non-existent-msg' as MessageId,
      senderLabel: 'Panel A',
      include: { answer: true, question: true, summary: false },
      delivery: 'attach',
    })).rejects.toThrow(expectCode('SESSION_HANDOFF_MESSAGE_NOT_FOUND'))
  })

  it('relays successfully in attach mode', async () => {
    const { service, createAgent } = await harness()
    const { agent: source, session: srcSession } = createAgent('s-src')
    const { agent: target } = createAgent('s-tgt')

    appendUser(srcSession, 'How to build an app?')
    const msgId = appendAssistant(srcSession, 'Step 1: Plan. Step 2: Build.')

    const res = await service.relay({
      sourceSessionId: source.id,
      targetSessionId: target.id,
      messageId: msgId,
      senderLabel: 'Architecture Panel',
      include: { answer: true, question: true, summary: true },
      summaryText: 'Architecture overview',
      delivery: 'attach',
    })

    expect(res.ok).toBe(true)
    expect(target.inject).toHaveBeenCalledTimes(1)
    expect(target.followup).not.toHaveBeenCalled()

    const injectedMsg = (target.inject as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UserMessage
    expect(injectedMsg.source).toEqual({
      kind: 'session-handoff',
      form: 'relay',
      senderSessionId: source.id,
      senderLabel: 'Architecture Panel',
      messageId: msgId,
      includes: { answer: true, question: true, summary: true },
    })
    expect(injectedMsg.content[0]?.type === 'text' ? injectedMsg.content[0].text : '').toContain('Step 1: Plan. Step 2: Build.')
    expect(injectedMsg.content[0]?.type === 'text' ? injectedMsg.content[0].text : '').toContain('How to build an app?')
    expect(injectedMsg.content[0]?.type === 'text' ? injectedMsg.content[0].text : '').toContain('Architecture overview')
  })

  it('relays successfully in attach-and-ask mode with note', async () => {
    const { service, createAgent } = await harness()
    const { agent: source, session: srcSession } = createAgent('s-src')
    const { agent: target } = createAgent('s-tgt')

    const msgId = appendAssistant(srcSession, 'Implemented module X')

    const res = await service.relay({
      sourceSessionId: source.id,
      targetSessionId: target.id,
      messageId: msgId,
      senderLabel: 'Panel A',
      include: { answer: true, question: false, summary: false },
      note: 'Please review the module implementation.',
      delivery: 'attach-and-ask',
    })

    expect(res.ok).toBe(true)
    expect(target.inject).toHaveBeenCalledTimes(1)
    expect(target.followup).toHaveBeenCalledTimes(1)

    const followupMsg = (target.followup as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UserMessage
    expect(followupMsg.source).toEqual({ kind: 'user' })
    expect(followupMsg.content[0]?.type === 'text' ? followupMsg.content[0].text : '').toBe('Please review the module implementation.')
  })

  it('falls back to sessionQuery title when summaryText is omitted', async () => {
    const { service, createAgent } = await harness()
    const { agent: source, session: srcSession } = createAgent('s-src')
    const { agent: target } = createAgent('s-tgt')

    srcSession.append('session/title', {
      title: 'Auto Generated Session Title',
      messageSeqs: [],
      source: { kind: 'user' },
    })
    const msgId = appendAssistant(srcSession, 'Answer with title fallback')

    const res = await service.relay({
      sourceSessionId: source.id,
      targetSessionId: target.id,
      messageId: msgId,
      senderLabel: 'Panel A',
      include: { answer: true, question: false, summary: true },
      delivery: 'attach',
    })

    expect(res.ok).toBe(true)
    const injectedMsg = (target.inject as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UserMessage
    expect(injectedMsg.content[0]?.type === 'text' ? injectedMsg.content[0].text : '').toContain('Auto Generated Session Title')
  })

  it('rejects when payload exceeds configured byte budget', async () => {
    const { service, createAgent } = await harness({ maxRelayBytes: 50 })
    const { agent: source, session: srcSession } = createAgent('s-src')
    const { agent: target } = createAgent('s-tgt')

    const msgId = appendAssistant(srcSession, 'A'.repeat(500))

    await expect(service.relay({
      sourceSessionId: source.id,
      targetSessionId: target.id,
      messageId: msgId,
      senderLabel: 'Panel A with very very long name to definitely exceed 50 bytes',
      include: { answer: true, question: false, summary: false },
      delivery: 'attach',
    })).rejects.toThrow(expectCode('SESSION_HANDOFF_BUDGET_EXCEEDED'))
  })
})
