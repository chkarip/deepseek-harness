/**
 * Deliverables plugin, node half. Registers the response-format guidance that
 * lets the browser half recognize final-response file references. The browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Services required for the model guidance paired with the browser renderer. */
export const inject = ['systemPrompt']

/** Stable final-response guidance owned by the matching renderer. */
const FILE_REFERENCE_PROMPT = 'When you successfully create or modify files, mention the primary outputs in your final response. '
  + 'To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn.'

/** Prompt guidance for rich Markdown rendering in the Web UI. */
const RICH_FORMATTING_PROMPT = 'Structure answers for visual clarity and rich Web rendering: '
  + 'use Markdown tables for structured comparisons and matrices; '
  + 'use GFM alert callouts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]) for notes and caveats; '
  + 'use ```mermaid fences for flowcharts, sequence diagrams, and architecture maps instead of ASCII art; '
  + 'use <details><summary>Title</summary>...</details> collapsible sections for long logs, supplementary code, or deep dives; '
  + 'and use footnotes ([^1]) for reference citations.'

/**
 * Register model guidance for the file-reference renderer shipped by this package.
 * @param ctx - host context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'ui:deliverable-file-references',
    order: 190,
    text: FILE_REFERENCE_PROMPT,
  })
  ctx.systemPrompt.section({
    name: 'ui:rich-formatting-guidance',
    order: 191,
    text: RICH_FORMATTING_PROMPT,
  })
}
