// @vitest-environment jsdom
/**
 * ui-panels plugin registration spec: the workspace occupies the frame's
 * 'panels' slot whichever order the two plugins apply in, and disposal
 * withdraws it.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'

/**
 * Stand up the registry and the services ui-panels binds, WITHOUT declaring
 * the frame's slots: apply order follows service readiness, so the plugin has
 * to tolerate applying before ui-layout declares 'panels'.
 * @returns the context and the applied ui-panels fiber.
 */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()

  ctx.provide('sessions', {})
  ctx.provide('workspaces', {})
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {}, sessionHandoff: { relay: async () => {} } } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)

  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-panels browser plugin', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'locale', 'remote'])
  })

  it('registers the workspace when the frame declares panels after it applies', async () => {
    const { ctx, fiber } = await bench()

    // The declaration arrives only now — the plugin already applied against a
    // registry that had no 'panels' slot, and must not have thrown.
    const disposeFrame = ctx.slots.register({
      name: 'root',
      children: { 'panels': { kind: 'single', scope: 'root' } },
    } as never, () => null)

    expect(ctx.slots.entries('panels')).toHaveLength(1)

    await fiber.dispose()
    expect(ctx.slots.entries('panels')).toHaveLength(0)

    disposeFrame()
  })
})
