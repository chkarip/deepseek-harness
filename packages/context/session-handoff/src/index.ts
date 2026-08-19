/**
 * Cross-panel and cross-session answer handoff service.
 * Enables relaying a finalized assistant answer (with question, summary, and provenance)
 * from one session into another as a sourced context message (`form: 'relay'`).
 *
 * @module @deepseek-ai/dsh-session-handoff
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import {
  DEFAULT_ALLOW_CROSS_WORKSPACE,
  DEFAULT_MAX_RELAY_BYTES,
  SessionHandoffError,
  type Config,
} from './config.ts'
import {
  extractHandoffContent,
  renderHandoffPrompt,
  retainHandoffPayload,
} from './projection.ts'
import type {
  SessionHandoffRequest,
  SessionHandoffRelayResult,
  SessionHandoffSource,
} from './types.ts'

export type * from './types.ts'
export type { Config, SessionHandoffErrorCode } from './config.ts'
export {
  DEFAULT_ALLOW_CROSS_WORKSPACE,
  DEFAULT_MAX_RELAY_BYTES,
  SessionHandoffError,
}
export {
  PROMPT_PREFIX,
  PROMPT_SUFFIX,
  extractHandoffContent,
  renderHandoffPrompt,
  retainHandoffPayload,
  stringifyTagSafeJson,
} from './projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionHandoff: SessionHandoffService
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteServiceMap {
    sessionHandoff: SessionHandoffService
  }
}

/**
 * Service that relays finalized answers and context across agent sessions.
 */
export class SessionHandoffService extends TypertRemoteService {
  static inject = ['agents', 'sessions']
  static Config: z<Config> = z.object({
    maxRelayBytes: z.number().step(1).min(1).default(DEFAULT_MAX_RELAY_BYTES),
    allowCrossWorkspace: z.boolean().default(DEFAULT_ALLOW_CROSS_WORKSPACE),
  })

  private readonly config: Required<Config>

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sessionHandoff')
    this.config = {
      maxRelayBytes: config.maxRelayBytes ?? DEFAULT_MAX_RELAY_BYTES,
      allowCrossWorkspace: config.allowCrossWorkspace ?? DEFAULT_ALLOW_CROSS_WORKSPACE,
    }
    if (!Number.isSafeInteger(this.config.maxRelayBytes) || this.config.maxRelayBytes <= 0) {
      throw new SessionHandoffError(
        'session-handoff: maxRelayBytes must be a positive safe integer',
        'SESSION_HANDOFF_INVALID_CONFIG',
      )
    }
  }

  /**
   * Relay an assistant answer from a source session into a target session.
   * @param request - Handoff request specifications.
   * @returns acknowledgement of successful injection.
   */
  @Remote('relay')
  async relay(request: SessionHandoffRequest): Promise<SessionHandoffRelayResult> {
    this.validateRequest(request)

    if (request.sourceSessionId === request.targetSessionId) {
      throw new SessionHandoffError(
        `session "${request.sourceSessionId}" cannot relay to itself`,
        'SESSION_HANDOFF_SELF_RELAY',
      )
    }

    const sourceAgent = await this.resolveSourceAgent(request.sourceSessionId)
    const targetAgent = await this.resolveTargetAgent(request.targetSessionId)

    if (!this.config.allowCrossWorkspace) {
      const sourceCwd = sourceAgent.session.header.cwd
      const targetCwd = targetAgent.session.header.cwd
      if (sourceCwd !== undefined && targetCwd !== undefined && sourceCwd !== targetCwd) {
        throw new SessionHandoffError(
          `cross-workspace handoff is disallowed (source: "${sourceCwd}", target: "${targetCwd}")`,
          'SESSION_HANDOFF_CROSS_WORKSPACE_DISALLOWED',
        )
      }
    }

    const extracted = extractHandoffContent(sourceAgent.session.events, request.messageId)
    if (extracted === undefined) {
      throw new SessionHandoffError(
        `finalized assistant message "${request.messageId}" not found in session "${request.sourceSessionId}"`,
        'SESSION_HANDOFF_MESSAGE_NOT_FOUND',
      )
    }

    let summaryText = request.summaryText?.trim()
    if ((summaryText === undefined || summaryText.length === 0) && request.include.summary) {
      const title = await this.ctx.get('sessionQuery')?.readTitle?.(request.sourceSessionId)
      if (title?.title) {
        summaryText = title.title
      }
    }

    const retained = retainHandoffPayload(
      {
        sessionId: sourceAgent.id,
        label: request.senderLabel,
        messageId: request.messageId,
        cwd: sourceAgent.session.header.cwd ?? null,
        extracted,
        include: request.include,
        ...(summaryText !== undefined && summaryText.length > 0 ? { summaryText } : {}),
      },
      this.config.maxRelayBytes,
    )

    if (retained === undefined) {
      throw new SessionHandoffError(
        'handoff payload exceeds configured byte budget after retention',
        'SESSION_HANDOFF_BUDGET_EXCEEDED',
      )
    }

    const prompt = renderHandoffPrompt(retained)
    const source: SessionHandoffSource = {
      kind: 'session-handoff',
      form: 'relay',
      senderSessionId: sourceAgent.id,
      senderLabel: request.senderLabel,
      messageId: request.messageId,
      includes: { ...request.include },
    }

    const injectedMsg: UserMessage = createUserMessage({
      source,
      content: [{ type: 'text', text: prompt }],
    })
    targetAgent.inject(injectedMsg)

    if (request.delivery === 'attach-and-ask') {
      const note = request.note?.trim()
      if (note !== undefined && note.length > 0) {
        const followupMsg: UserMessage = createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: note }],
        })
        targetAgent.followup(followupMsg)
      }
    }

    return {
      ok: true,
      injectedMessageId: injectedMsg.id,
    }
  }

  private validateRequest(request: SessionHandoffRequest): void {
    if (typeof request !== 'object' || request === null) {
      throw new SessionHandoffError('request must be an object', 'SESSION_HANDOFF_INVALID_REQUEST')
    }
    if (typeof request.sourceSessionId !== 'string' || request.sourceSessionId.length === 0) {
      throw new SessionHandoffError('sourceSessionId must be a non-empty string', 'SESSION_HANDOFF_INVALID_REQUEST')
    }
    if (typeof request.targetSessionId !== 'string' || request.targetSessionId.length === 0) {
      throw new SessionHandoffError('targetSessionId must be a non-empty string', 'SESSION_HANDOFF_INVALID_REQUEST')
    }
    if (typeof request.messageId !== 'string' || request.messageId.length === 0) {
      throw new SessionHandoffError('messageId must be a non-empty string', 'SESSION_HANDOFF_INVALID_REQUEST')
    }
    if (typeof request.senderLabel !== 'string' || request.senderLabel.length === 0) {
      throw new SessionHandoffError('senderLabel must be a non-empty string', 'SESSION_HANDOFF_INVALID_REQUEST')
    }
    if (typeof request.include !== 'object' || request.include === null) {
      throw new SessionHandoffError('include must be an object', 'SESSION_HANDOFF_INVALID_REQUEST')
    }
    if (request.delivery !== 'attach' && request.delivery !== 'attach-and-ask') {
      throw new SessionHandoffError('delivery must be "attach" or "attach-and-ask"', 'SESSION_HANDOFF_INVALID_REQUEST')
    }
  }

  private async resolveSourceAgent(sessionId: SessionId): Promise<Agent> {
    const live = this.ctx.agents?.get(sessionId)
    if (live !== undefined) return live
    try {
      return (await this.ctx.agents.resume({ resumeSessionId: sessionId })).agent
    } catch (err) {
      throw new SessionHandoffError(
        `source session "${sessionId}" not found: ${err instanceof Error ? err.message : String(err)}`,
        'SESSION_HANDOFF_SOURCE_NOT_FOUND',
      )
    }
  }

  private async resolveTargetAgent(sessionId: SessionId): Promise<Agent> {
    const live = this.ctx.agents?.get(sessionId)
    if (live !== undefined) return live
    try {
      return (await this.ctx.agents.resume({ resumeSessionId: sessionId })).agent
    } catch (err) {
      throw new SessionHandoffError(
        `target session "${sessionId}" not found: ${err instanceof Error ? err.message : String(err)}`,
        'SESSION_HANDOFF_TARGET_NOT_FOUND',
      )
    }
  }
}

export default SessionHandoffService
