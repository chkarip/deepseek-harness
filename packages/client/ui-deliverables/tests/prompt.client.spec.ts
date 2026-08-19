/** Node-half coverage for the model guidance paired with Web file references. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply, inject } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('ui-deliverables node plugin', () => {
  it('registers final-response file-reference guidance only while mounted', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()

    const sections = (await ctx.systemPrompt.assemble()).sections
    const fileRefSection = sections.find(entry => entry.name === 'ui:deliverable-file-references')
    expect(fileRefSection?.text).toContain('When you successfully create or modify files')

    const formattingSection = sections.find(entry => entry.name === 'ui:rich-formatting-guidance')
    expect(formattingSection?.text).toContain('Structure answers for visual clarity and rich Web rendering')

    await mounted.dispose()
    const afterSections = (await ctx.systemPrompt.assemble()).sections
    expect(afterSections.some(entry => entry.name === 'ui:deliverable-file-references')).toBe(false)
    expect(afterSections.some(entry => entry.name === 'ui:rich-formatting-guidance')).toBe(false)
  })
})
