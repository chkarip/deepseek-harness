/** Collapsed work-group activity lines for this package's own Node kinds. */
import type { WorkSummaryViewProps } from '../contract/slots.ts'

/**
 * Name a reasoning step by its latest thought.
 * @param props.node - the group's last member, an Assistant step carrying only reasoning.
 * @returns the one-line activity text, or nothing when the step has no reasoning yet.
 */
export function ReasoningWorkSummary({ node }: WorkSummaryViewProps<'assistant-step'>) {
  const reasoning = node.data.blocks.findLast(block => block.kind === 'reasoning')
  const text = reasoning === undefined ? '' : reasoning.text.trim()
  if (text === '') return null
  const newline = text.indexOf('\n')
  return <>{newline === -1 ? text : text.slice(0, newline)}</>
}
