/**
 * Sticky session skill modes: a user-invoked `mode: true` skill whose body
 * stays present in every model request until turned off.
 *
 * The active mode is logged per-session as `skill/mode` (`{ name }`, last one
 * wins; `name: null` means off), so resume, fork, and compaction recover it
 * directly from the session log. While a mode is active, its rendered skill
 * body is included in every request through a `skill-mode` system prompt
 * section rendered from a per-session body cache — the sticky equivalent of
 * the one-shot `/name` invocation, without transcript growth.
 *
 * Mode activation is a user gesture: the `/mode <name>` command validates that
 * the skill exists, declares `mode: true`, and is user-invocable, then selects
 * it; `/mode off` leaves; bare `/mode` lists available mode skills and the
 * current state. A model never activates a mode; it only follows the injected
 * body.
 *
 * Agent Note:
 * - .agents/notes/implemented/feature/2026-08-22-skill-mode.md
 *
 * @module @deepseek-ai/dsh-skill-mode
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { isUserInvocable, renderSkillContent, type SkillDefinition } from '@deepseek-ai/dsh-skill'
// Type-only edges: resolves `ctx.commands` and the `command/run`/`command/done`
// session events for the optional command child and projection unit.
import type { CommandId } from '@deepseek-ai/dsh-commands'
// Type-only: resolves ctx.sessionProjections for the optional unit child.
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SkillModeProjection } from './types.ts'

/** Mode state logged per session: the active mode skill name, or null when off. */
export interface SkillModeState {
  /** Active mode skill name, or null when no sticky skill mode is active. */
  readonly name: string | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Which skill mode is in force from this point on: log-only, non-surface,
     * whole-value replace. The last `skill/mode` wins; a log with none folds
     * to off through {@link foldSkillMode}.
     */
    'skill/mode': SkillModeState
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillMode: SkillModeController
  }
}

/** Prompt order of the skill-mode section; after the persona and plan policy. */
const SKILL_MODE_SECTION_ORDER = 60

/**
 * Whether skill mode is active after the first `end` events. The last
 * `skill/mode` wins; a prefix with none is off.
 *
 * @param events The session log or any prefix of it.
 * @param end Fold `events[0, end)`; defaults to the whole log.
 * @returns The active mode skill name, or null when no mode is active.
 */
export function foldSkillMode(events: readonly SessionEvent[], end = events.length): string | null {
  let name: string | null = null
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'skill/mode') name = event.data.name
  }
  return name
}

/** Whether the log holds an opened turn without its closing `turn/end`. */
function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

/** Skill mode at the last logged request header, or undefined before the first header. */
function skillModeAtLastHeader(events: readonly SessionEvent[]): string | null | undefined {
  let lastHeader = -1
  let index = 0
  for (const event of events) {
    if (event.type === 'request/header') lastHeader = index
    index++
  }
  if (lastHeader < 0) return undefined
  return foldSkillMode(events, lastHeader + 1)
}

/**
 * `ctx.skillMode`: owns logged mode state, applies and narrates selected state
 * at step start, keeps the active mode's body present in every request through
 * a warmed system prompt section, the `/mode` command, and the projection
 * unit. UIs observe committed flips through `session/event`; there is no live
 * mirror.
 */
export class SkillModeController extends Service {
  static inject = ['skills', 'systemPrompt']

  /**
   * Latest selection per session awaiting the next accepted in-turn pre-step.
   * `narrate` is true for user selections and false for automatic drops, whose
   * notice is appended by the boundary listener instead.
   */
  private readonly pendingIntents = new WeakMap<Session, { name: string | null; narrate: boolean }>()

  /**
   * Rendered mode bodies per session, warmed at selection time, at session
   * creation (resume), and on `skills/change`. The section text is synchronous,
   * so it renders from this cache; a cold cache renders nothing for one request
   * while the boundary listener re-warms it. `bodies` holds the mode skill's own
   * body first, then one entry per resolved member of its `skills:` list.
   */
  private readonly bodyCache = new WeakMap<Session, { name: string; bodies: readonly string[] }>()

  constructor(ctx: Context) {
    super(ctx, 'skillMode')
    // Pre-step is outside Session.append publication, so it can append the
    // log-only mode event inside an open turn without re-entering the session.
    // A failed append remains pending for a later accepted in-turn pre-step,
    // and policy cannot block the step.
    ctx.on('agent/pre-step', async (
      { agent, signal },
      next,
    ): Promise<PreStepDecision> => {
      let decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      const pending = this.pendingIntents.get(agent.session)
      if (pending !== undefined) {
        const narration = this.narration(agent.session, pending.name)
        try {
          this.onBoundary(agent.session)
        } catch (error) {
          ctx.logger.warn('dsh-skill-mode: failed to append selected skill mode at step start: %o', error)
          return decision
        }
        if (pending.narrate && narration !== undefined) {
          decision = { ...decision, messages: [...decision.messages, narration] }
        }
      }
      // Reconcile the body cache against the folded mode: a direct `set()`, a
      // resume, or a skill edit can leave the cache cold or stale. Awaiting
      // here means the next request assembly renders the correct body.
      await this.reconcileCache(agent)
      return decision
    })
    ctx.effect(() => () => { }, 'dsh-skill-mode: close service lifetime')

    ctx.systemPrompt.section({
      name: 'skill-mode',
      order: SKILL_MODE_SECTION_ORDER,
      text: (context) => {
        if (context.agent === undefined) return ''
        const session = context.agent.session
        const cached = this.bodyCache.get(session)
        const active = foldSkillMode(session.events)
        if (cached === undefined || cached.name !== active) return ''
        return [
          '<system-reminder>',
          `Skill mode "${active}" is active in this session. Follow its instructions.`,
          '',
          cached.bodies.join('\n\n'),
          '</system-reminder>',
        ].join('\n')
      },
    })

    // The skill-mode projection unit (session-projection RFC): a pure event
    // fold serving clients the whole {name, pending} value. `command/run`
    // records the user's logged /mode selection, its paired `command/done`
    // keeps only successful selections, and `skill/mode` records that
    // selection and clears it. Pending is thereby a pure replay quantity: host
    // restarts, other tabs, and cold reads all recover it from the log alone.
    // The unit child activates only when a projection registry is composed
    // (headless assemblies stay unaffected).
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'skill-mode', SkillModeUnitState>({
        key: 'skill-mode',
        stateSchema: skillModeUnitStateSchema,
        init: () => ({ name: null, wanted: null, running: null }),
        apply: (state, event) => {
          if (event.type === 'command/run' && event.data.name === 'mode') {
            if (event.data.args === undefined) return state
            const wanted = parseModeTarget(event.data.args)
            if (wanted === undefined) return state
            return { ...state, running: { commandId: event.data.commandId, wanted } }
          }
          if (event.type === 'command/done' && event.data.commandId === state.running?.commandId) {
            const wanted = event.data.kind === 'success' && state.running.wanted.name !== state.name
              ? state.running.wanted
              : null
            return { ...state, wanted, running: null }
          }
          if (event.type === 'skill/mode') {
            return { ...state, name: event.data.name, wanted: null }
          }
          return state
        },
        wire: {
          viewSchema: skillModeProjectionSchema,
          view: (state) => {
            const wanted = state.running?.wanted ?? state.wanted
            return { name: state.name, pending: wanted !== null && wanted.name !== state.name }
          },
        },
        stateVersion: 1,
      })
    })

    // The command child activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'mode',
        description: 'Enter or leave a sticky skill mode',
        input: { hint: '[name|off]' },
        handler: async ({ agent, rawInput }) => {
          const message = rawInput.trim()
          if (message === 'off') {
            switch (this.set(agent, null)) {
              case 'committed':
                return { kind: 'success', text: 'Skill mode off.' }
              case 'queued':
                return { kind: 'success', text: 'Leaving skill mode (applies from the next step).' }
              case 'cancelled':
                return { kind: 'success', text: 'Skill mode entry cancelled.' }
              case 'noop':
                return foldSkillMode(agent.session.events) !== null
                  ? { kind: 'success', text: 'Leaving skill mode (applies from the next step).' }
                  : { kind: 'success', text: 'Skill mode is already off.' }
            }
          }
          if (message !== '') {
            const outcome = await this.enter(agent, message)
            return outcome
          }
          return this.describe(agent)
        },
      })
    })

    // Resume and fork restore the mode name from the log but not the cached
    // body, so re-warm on session creation. A cold cache renders nothing for
    // the first request; the pre-step reconciler warms it before the next.
    ctx.on('session/created', (session) => {
      const name = foldSkillMode(session.events)
      if (name === null) return
      const agent = this.liveAgent(ctx, session)
      if (agent !== undefined) void this.resolveActiveMode(agent, name)
    }, { global: true })

    // A skill edit can change the body while its mode is active; a deletion or
    // a lost `mode: true` drops the mode. Re-resolve every session whose active
    // mode names a skill, and drop modes whose skill no longer qualifies.
    ctx.on('skills/change', () => {
      for (const session of this.sessionsWithActiveMode(ctx)) {
        const name = foldSkillMode(session.events)
        if (name === null) continue
        const agent = this.liveAgent(ctx, session)
        if (agent === undefined) continue
        void this.resolveActiveMode(agent, name)
      }
    }, { global: true })
  }

  /**
   * Enter a named mode skill: validate it exists, declares `mode: true`, and is
   * user-invocable, then select it.
   *
   * @param agent The agent to switch.
   * @param name The mode skill name.
   * @returns a command result for the user.
   */
  private async enter(agent: Agent, name: string): Promise<ModeCommandResult> {
    const lookup = { cwd: agent.session.header.cwd, scope: agent }
    const skill = await this.ctx.skills.get(name, lookup)
    if (skill === undefined) {
      return { kind: 'error', text: `Unknown skill "${name}". Use /mode to list available mode skills.` }
    }
    if (skill.mode !== true) {
      return { kind: 'error', text: `Skill "${name}" is not a mode skill. Use /mode to list available mode skills.` }
    }
    if (!isUserInvocable(skill)) {
      return { kind: 'error', text: `Skill "${name}" is not user-invocable and cannot become a mode.` }
    }
    this.bodyCache.set(agent.session, { name, bodies: await this.renderModeBodies(agent, skill) })
    switch (this.set(agent, name)) {
      case 'committed':
        return { kind: 'success', text: `Skill mode ${name} on. Use /mode off to leave.` }
      case 'queued':
        return { kind: 'success', text: `Entering skill mode ${name} (applies from the next step). Use /mode off to leave.` }
      case 'cancelled':
        return { kind: 'success', text: 'Skill mode entry cancelled.' }
      case 'noop':
        return { kind: 'success', text: `Skill mode ${name} is already active.` }
    }
  }

  /**
   * List the available mode skills and the current state.
   *
   * @param agent The agent to describe.
   * @returns a command result for the user.
   */
  private async describe(agent: Agent): Promise<ModeCommandResult> {
    const lookup = { cwd: agent.session.header.cwd, scope: agent }
    const summaries = (await this.ctx.skills.list(lookup))
      .filter(skill => skill.mode === true && isUserInvocable(skill))
    const active = foldSkillMode(agent.session.events)
    const header = active === null
      ? 'No skill mode is active. Use /mode <name> to enter one.'
      : `Skill mode ${active} is active. Use /mode off to leave.`
    if (summaries.length === 0) {
      return { kind: 'success', text: `${header}\nNo mode skills are available in this session.` }
    }
    const rows = summaries.map((skill) => {
      const members = skill.modeSkills ?? []
      const carries = members.length === 0 ? '' : ` (carries: ${members.join(', ')})`
      return `- ${skill.name}: ${skill.description}${carries}`
    }).join('\n')
    return { kind: 'success', text: `${header}\nAvailable mode skills:\n${rows}` }
  }

  /**
   * Read the logged mode state and any selected state awaiting the next
   * accepted in-turn pre-step.
   *
   * @param agent The agent to read.
   * @returns Current logged state plus a pending selection, when present.
   */
  get(agent: Agent): { name: string | null; pending?: string | null } {
    const name = foldSkillMode(agent.session.events)
    const pending = this.pendingIntents.get(agent.session)
    return pending === undefined ? { name } : { name, pending: pending.name }
  }

  /**
   * Select whether a skill mode should be active. Between turns the method
   * appends the change immediately because no in-turn pre-step will run until
   * another prompt starts a turn. The open-turn fold is the idle signal: agent
   * status stays `running` through post-turn checkpointing, when no further
   * in-turn pre-step runs. During an open turn the selection remains pending
   * until the next accepted in-turn pre-step. Repeated selection of the current
   * or already-pending state is a no-op.
   *
   * @param agent The agent to switch.
   * @param name The mode skill name to select, or null to leave the mode.
   * @returns what happened: `committed` (logged now), `queued` (awaiting the
   * next accepted in-turn pre-step), `cancelled` (an opposite pending selection
   * was cleared; the logged state already matches), or `noop` (already in that
   * state).
   */
  set(agent: Agent, name: string | null): 'committed' | 'queued' | 'cancelled' | 'noop' {
    const session = agent.session
    const pending = this.pendingIntents.get(session)
    const target = pending?.name ?? foldSkillMode(session.events)
    if (name === target) return 'noop'
    if (hasOpenTurn(session.events)) {
      this.pendingIntents.set(session, { name, narrate: true })
      return foldSkillMode(session.events) === name ? 'cancelled' : 'queued'
    }
    // No open turn: commit now. Delete only after append succeeds so a
    // failed durable write leaves the selection retryable, not dropped.
    if (name === foldSkillMode(session.events)) {
      this.pendingIntents.delete(session)
      return 'cancelled'
    }
    session.append('skill/mode', { name })
    this.pendingIntents.delete(session)
    const narration = this.narration(session, name)
    if (narration !== undefined) agent.inject(narration)
    return 'committed'
  }

  /** Append one pending selection before the next request assembly. */
  private onBoundary(session: Session): void {
    const pending = this.pendingIntents.get(session)
    if (pending === undefined) return
    const target = pending.name
    if (target === foldSkillMode(session.events)) {
      this.pendingIntents.delete(session)
      return
    }
    session.append('skill/mode', { name: target })
    // Delete only after append succeeds so a later accepted in-turn pre-step
    // can retry a failed durable write.
    this.pendingIntents.delete(session)
  }

  /**
   * Reconcile the body cache against the folded mode. A cold or stale cache is
   * resolved (and validated) asynchronously; a dead mode — skill gone, lost
   * `mode: true`, or no longer user-invocable — is dropped so the fold stops
   * re-resolving the name and the section stops rendering.
   */
  private async reconcileCache(agent: Agent): Promise<void> {
    const session = agent.session
    const name = foldSkillMode(session.events)
    if (name === null) {
      this.bodyCache.delete(session)
      return
    }
    const cached = this.bodyCache.get(session)
    if (cached !== undefined && cached.name === name) return
    await this.resolveActiveMode(agent, name)
  }

  /** Resolve one active mode's body, dropping the mode when the skill no longer qualifies. */
  private async resolveActiveMode(agent: Agent, name: string): Promise<void> {
    const session = agent.session
    const lookup = { cwd: session.header.cwd, scope: agent }
    let skill
    try {
      skill = await this.ctx.skills.get(name, lookup)
    } catch (error) {
      this.ctx.logger.warn('dsh-skill-mode: failed to load mode skill "%s": %o', name, error)
      return
    }
    if (skill !== undefined && skill.mode === true && isUserInvocable(skill)) {
      this.bodyCache.set(session, { name, bodies: await this.renderModeBodies(agent, skill) })
      return
    }
    // The mode is dead: clear the cache and drop the logged state so the
    // section stops rendering and the fold stops re-resolving the name.
    this.bodyCache.delete(session)
    if (foldSkillMode(session.events) === name) {
      try {
        session.append('skill/mode', { name: null })
      } catch (error) {
        this.ctx.logger.warn('dsh-skill-mode: failed to drop unavailable mode skill "%s": %o', name, error)
      }
    }
  }

  /**
   * Render one mode's bodies: the mode skill's own, then each member its
   * `skills:` list declares, in declaration order.
   *
   * A member is resolved one level only — a member's own `modeSkills` is
   * ignored, so expansion terminates by construction. Duplicates and a
   * self-reference are dropped. A member that no longer loads, or that the user
   * cannot invoke, is dropped with a warning while the mode itself stays
   * active: one deleted member must not take the whole posture down.
   *
   * @param agent The agent whose workspace and scope resolve the members.
   * @param skill The already-qualified mode skill.
   * @returns The mode body followed by each resolved member body.
   */
  private async renderModeBodies(agent: Agent, skill: SkillDefinition): Promise<readonly string[]> {
    const bodies = [renderSkillContent(skill)]
    const lookup = { cwd: agent.session.header.cwd, scope: agent }
    const seen = new Set([skill.name])
    for (const member of skill.modeSkills ?? []) {
      if (seen.has(member)) continue
      seen.add(member)
      let loaded
      try {
        loaded = await this.ctx.skills.get(member, lookup)
      } catch (error) {
        this.ctx.logger.warn('dsh-skill-mode: failed to load member skill "%s" of mode "%s": %o', member, skill.name, error)
        continue
      }
      if (loaded === undefined || !isUserInvocable(loaded)) {
        this.ctx.logger.warn('dsh-skill-mode: member skill "%s" of mode "%s" is unavailable and was skipped', member, skill.name)
        continue
      }
      bodies.push(renderSkillContent(loaded))
    }
    return bodies
  }

  /** The live agent for a session, when this service's registry can resolve one. */
  private liveAgent(ctx: Context, session: Session): Agent | undefined {
    const agents = ctx.get('agents')
    if (agents === undefined) return undefined
    for (const agent of agents.list()) {
      if (agent.session === session) return agent
    }
    return undefined
  }

  /** Every session this service can see whose logged mode is active. */
  private sessionsWithActiveMode(ctx: Context): Session[] {
    const sessions = ctx.get('sessions')
    if (sessions === undefined) return []
    return sessions.list().filter(session => foldSkillMode(session.events) !== null)
  }

  /** Build a user-switch notice when the last logged header described another mode. */
  private narration(session: Session, target: string | null): UserMessage | undefined {
    const told = skillModeAtLastHeader(session.events)
    if (told === undefined || told === target) return
    const text = target === null
      ? 'The user switched this session back to the default mode.'
      : `The user switched this session to skill mode ${target}.`
    return createUserMessage({
      content: [{ type: 'text', text }],
      // The narration is already one sentence, so it is its own summary.
      source: { kind: 'plugin', plugin: 'skill-mode', form: 'notice', summary: text },
    })
  }
}

/** The `/mode` command's success/error result shape. */
type ModeCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/**
 * Unit state of the `skill-mode` projection: the logged mode, the latest
 * successful `/mode` selection not yet resolved by a `skill/mode` commit, and
 * an execution whose paired `command/done` has not settled. Plain JSON
 * (persisted-cache precondition).
 */
interface SkillModeUnitState {
  name: string | null
  /** The selection's target; null when no selection is outstanding. */
  wanted: { name: string | null } | null
  /** The latest mode command awaiting its paired settlement. */
  running: { commandId: CommandId; wanted: { name: string | null } } | null
}

const skillModeUnitStateSchema: ZodType<SkillModeUnitState> = zod.object({
  name: zod.string().nullable(),
  wanted: zod.object({ name: zod.string().nullable() }).strict().nullable(),
  running: zod.object({
    commandId: zod.string() as unknown as ZodType<CommandId>,
    wanted: zod.object({ name: zod.string().nullable() }).strict(),
  }).strict().nullable(),
}).strict()

const skillModeProjectionSchema: ZodType<SkillModeProjection> = zod.object({
  name: zod.string().nullable(),
  pending: zod.boolean(),
})

/** Parse a `/mode` raw input into a target: undefined for bare (list only). */
function parseModeTarget(args: string): { name: string | null } | undefined {
  const message = args.trim()
  if (message === '') return undefined
  return { name: message === 'off' ? null : message }
}

export default SkillModeController
