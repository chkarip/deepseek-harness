/**
 * Pure types of the skill-mode domain: the ONE home of the `skill-mode`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis service, dsh-tools, dsh-agent). Two namespace projections serve it —
 * `./types` for host consumers, `./client` for client aggregates — with zero
 * content duplication.
 *
 * @module @deepseek-ai/dsh-skill-mode/types
 */

/**
 * The skill-mode projection's wire value. `name` is the logged mode skill in
 * force (the last `skill/mode`, `null` before the first); `pending` is true
 * while a logged `/mode` selection targets a state other than `name`, has not
 * failed through its paired `command/done`, and no later `skill/mode` event has
 * recorded that state. Capability absence (skill-mode not composed) is the
 * key's absence, never a value.
 */
export interface SkillModeProjection {
  /** Active mode skill name, or null when no sticky skill mode is active. */
  name: string | null
  /** Whether a logged user selection has not yet reached the logged state. */
  pending: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Sticky skill-mode state folded from the `/mode` command lifecycle and `skill/mode` events. */
    'skill-mode': SkillModeProjection
  }
}
