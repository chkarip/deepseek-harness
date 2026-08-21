/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-activity-monitor`.
 * @module @deepseek-ai/dsh-client-ui-activity-monitor/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-activity-monitor'

/** Cordis companion plugin name. */
export const name = 'client-ui-activity-monitor-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every contribution is a slot registration disposed by
 * its own `ctx.effect`, covered by the package's disposal spec; the plugin
 * emits no cordis events and owns no host state.
 *
 * The mascot store is deliberately outside that lifecycle: it is per-browser
 * user preference backed by `localStorage`, so it outlives plugin disposal by
 * design and there is no owned relationship for an invariant to assert.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
