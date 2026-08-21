/** Collapsed work-group activity line for a Tool call: the row's own title and summary. */
import type { ToolWorkSummaryProps } from '../contract/slots.ts'
import { toolRowModel } from './models/tool-call-model.ts'
import css from './ToolWorkSummary.module.css'

/** Resolve a Tool call's wire name from either lifecycle form. */
function callName(block: ToolWorkSummaryProps['node']['data']['root']): string {
  return 'kind' in block ? block.call?.name ?? '' : block.name
}

/**
 * Name one Tool call the way its collapsed row does.
 * @param props.node - the group's last member, a root Tool call.
 * @param props.cwd - session workspace root for relative path display.
 * @returns the tool title and its one-line summary.
 */
export function ToolWorkSummary({ node, cwd }: ToolWorkSummaryProps) {
  const root = node.data.root
  const model = toolRowModel(callName(root), root, cwd)
  return (
    <>
      <span className={css.title}>{model.title}</span>
      <span className={css.summary}>{model.summary}</span>
    </>
  )
}
