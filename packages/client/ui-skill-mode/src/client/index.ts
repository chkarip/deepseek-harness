/**
 * Skill-mode plugin, browser half: decorates the HOST `/mode` command with a
 * popupSelect shell over the session's mode skills. Bare `/mode` (or picking
 * it from the '/' menu) opens the shell; its search input filters the loaded
 * mode-skill rows locally, ↑↓ move the highlight, Tab autocompletes the
 * highlighted row into the search, and Enter settles the selection — which
 * executes `/mode <name>` through the ordinary command channel. The active
 * mode therefore reads exactly like any other command submission: the host
 * executor logs the lifecycle and the result renders as a flow node.
 *
 * Options come from the `skills.list` RPC (the same catalog the '/' skill
 * source and the model catalog read), filtered to `mode === true`. Rows carry
 * the skill description as detail so filtering matches both name and text.
 * A session with no mode skills opens a shell that reports the empty state
 * instead of a bare claim line.
 *
 * The decoration never manufactures a row: if the host composition does not
 * mount the `/mode` command (dsh-skill-mode absent), the directory has no
 * row and the decoration is simply unreachable.
 */
// Type-only: the carrier types, the forwarded Host-event face and the ctx.remote merge.
import type { ConnectionHandle, SessionId, SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, NS, zh, type SkillModeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The skill-mode popup's copy. */
    'skill-mode': SkillModeKey
  }
}

/** One session's mode-skill fetch: the shared promise plus its own abort handle. */
interface ModeFetch {
  readonly promise: Promise<readonly SkillEntry[]>
  readonly abort: AbortController
}

/** Required services: the command decoration registry, the skills RPC, and the command channel. */
export const inject = ['commandUi', 'connection', 'locale', 'remote', 'remote.commands']

/**
 * Client plugin body: register the /mode popupSelect decoration and its dictionaries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skill-mode: dictionaries')

  const command = ctx.get('commandUi') as CommandUiContract
  const skills = (ctx.get('connection') as ConnectionHandle).api.skills

  // Session-keyed mode fetch; single-flight per key. Plugin-closure state:
  // the fiber effect below is its teardown boundary.
  const fetches = new Map<SessionId, ModeFetch>()

  const fetchModes = (sessionId: SessionId, signal: AbortSignal): Promise<readonly SkillEntry[]> => {
    const existing = fetches.get(sessionId)
    if (existing !== undefined) return existing.promise
    const abort = new AbortController()
    const promise = (async () => {
      const { result } = await skills.list({ sessionId }, abort.signal)
      if (!result.ok) throw new Error(`skill.list failed: ${result.error.code}: ${result.error.message}`)
      return result.value.skills.filter(skill => skill.mode)
    })()
    const entry: ModeFetch = { promise, abort }
    fetches.set(sessionId, entry)
    promise.then(
      () => { if (fetches.get(sessionId) === entry) fetches.delete(sessionId) },
      () => { if (fetches.get(sessionId) === entry) fetches.delete(sessionId) },
    )
    // The shell's options() call owns selection; its signal only cancels the
    // shell, so the shared fetch deliberately outlives it.
    void signal
    return promise
  }

  ctx.effect(() => command.decorate({
    name: 'mode',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const modes = await fetchModes(session.sessionId, signal)
        const options: SelectOption[] = modes.map(skill => ({
          id: skill.name,
          label: skill.name,
          detail: skill.description,
        }))
        return options
      },
      onSelect: async (option, session) => {
        const result = await ctx.remote.commands.execute(session.sessionId, `/mode ${option.label}`, [])
        if (!result.ok) throw new Error(`command.execute failed: ${result.error.code}: ${result.error.message}`)
        if (result.value === undefined) throw new Error(`unknown or malformed command: /mode ${option.label}`)
        if (result.value.result.kind === 'error') {
          throw new Error(result.value.result.text)
        }
      },
    },
  }), 'ui-skill-mode: /mode decoration')
}
