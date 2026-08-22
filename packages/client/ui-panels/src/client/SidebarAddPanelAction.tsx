/**
 * Sidebar session-row action: "Add in panel". Rendered inside the session
 * row's ⋯ menu through the `sidebar.workspaces.session-actions` slot; clicking
 * creates a new panel hosting that session and dismisses the menu.
 */
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarAddPanelActionProps } from './contract.ts'
import css from './SidebarAddPanelAction.module.css'

export function SidebarAddPanelAction({
  sessionId,
  onClose,
  addToPanel,
  t,
}: SidebarAddPanelActionProps) {
  const label = t('sidebar.addToPanel')
  return (
    <button
      type="button"
      role="menuitem"
      className={css.row}
      onClick={() => {
        addToPanel(sessionId)
        onClose()
      }}
    >
      <span className={css.icon}><IconPanelLeftOutline16 /></span>
      <span className={css.label}>{label}</span>
    </button>
  )
}
