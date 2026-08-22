/**
 * Panels plugin, browser half: registers PanelWorkspace into the frame's
 * 'panels' slot — the named multi-panel chat workspace — and PanelHandoffAction
 * into 'conversation.chat.assistant-actions'. The store (panel roster, layout,
 * focus) is root-scoped and shared between both slots.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { PanelsInjected, PanelHandoffInjected, SidebarSessionActionInjected } from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { createPanelsStore } from './panels-store.ts'
import { PanelHandoffAction } from './PanelHandoffAction.tsx'
import { PanelWorkspace } from './PanelWorkspace.tsx'
import { SidebarAddPanelAction } from './SidebarAddPanelAction.tsx'
import { completedTurnCount, extractRecap, summarizeSession } from './summary.ts'

/** Services required by the panels plugin. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'remote']

/**
 * Client plugin body: register the workspace into 'panels' and handoff action
 * into 'conversation.chat.assistant-actions' with the shared store and inject faces.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-panels: dictionaries')

  const panelsStore = createPanelsStore()
  const storeInstance = panelsStore.create()

  // 'panels' is declared by ui-layout's root registration, and plugin apply
  // order follows service readiness, not bundle order: registering directly
  // throws whenever this plugin's services resolve first. inject() waits for
  // the declaration and re-registers across its lifetimes.
  ctx.slots.inject('panels', () => ctx.slots.register({
    name: 'panels',
    locale: NS,
    store: panelsStore,
    inject: (actions: BoundActions<ReturnType<typeof createPanelsStore>>): PanelsInjected => ({
      summarize: async (panelId, sessionId) => {
        actions.setSummaryState(panelId, 'generating')
        try {
          const text = await summarizeSession(ctx.sessions, t, sessionId)
          actions.setPanelSummary(panelId, text === '' ? t('panel.summary.empty') : text)
        } catch (error) {
          console.error('[ui-panels] summary generation failed:', error)
          actions.setSummaryState(panelId, 'error')
        }
      },
      createSession: async (workspaceId) => {
        // A genuinely FRESH conversation: host session.create directly — the
        // workspaces connect path would reuse the workspace's blank session
        // (the New Session flow), leaving two panels mirroring one chat.
        const workspacesState = ctx.workspaces.list.getSnapshot()
        const sessionsState = ctx.sessions.list.getSnapshot()
        const currentSessionId = sessionsState.current
        const currentWorkspace = currentSessionId === undefined
          ? undefined
          : workspacesState.items.find(item => item.sessionIds.includes(currentSessionId))
        const targetWorkspaceId = workspaceId
          ?? currentWorkspace?.workspaceId
          ?? workspacesState.recentWorkspaceId
          ?? workspacesState.items[0]?.workspaceId
        return ctx.sessions.create(targetWorkspaceId === undefined ? {} : { workspaceId: targetWorkspaceId })
      },
      forkSession: async (opts) => {
        const sourceSessionId = typeof opts === 'string' ? opts : opts.sourceSessionId
        const role = typeof opts === 'string' ? 'plain' : (opts.role ?? 'plain')
        const customGoal = typeof opts === 'string' ? undefined : opts.customGoal

        const childId = await ctx.sessions.fork({ sessionId: sourceSessionId, increaseTitle: true })

        let directive: string | undefined
        let panelName: string | undefined

        if (role === 'reviewer') {
          directive = t('fork.role.reviewer.directive')
          panelName = t('fork.role.reviewer.title')
        } else if (role === 'brainstorm') {
          directive = t('fork.role.brainstorm.directive')
          panelName = t('fork.role.brainstorm.title')
        } else if (role === 'docs') {
          directive = t('fork.role.docs.directive')
          panelName = t('fork.role.docs.title')
        } else if (role === 'custom' && customGoal !== undefined && customGoal.trim() !== '') {
          directive = t('fork.role.custom.directive', { goal: customGoal.trim() })
          panelName = customGoal.trim()
        }

        if (directive !== undefined) {
          try {
            ctx.sessions.openWindow(childId)
            const scope = ctx.sessions.scope(childId)
            const conversation = scope?.get('conversation') as { send: (text: string) => Promise<void> } | undefined
            if (conversation !== undefined) {
              void conversation.send(directive)
            }
          } catch (error) {
            console.error('[ui-panels] failed to send initial fork role directive:', error)
          }
        }

        return { sessionId: childId, panelName }
      },
      openSession: (sessionId) => { ctx.sessions.open(sessionId) },
      openWindow: (sessionId) => { ctx.sessions.openWindow(sessionId) },
      createWorkspace: input => ctx.workspaces.create(input),
      connectWorkspace: workspaceId => ctx.workspaces.connectWorkspace(workspaceId),
      pickDirectory: () => ctx.workspaces.pickDirectory(),
      extractRecap: sessionId => extractRecap(ctx.sessions, sessionId),
      getTurnCount: sessionId => completedTurnCount(ctx.sessions, sessionId),
    }),
  }, PanelWorkspace))

  ctx.slots.inject('conversation.chat.assistant-actions', () => {
    return ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'panel-handoff',
      order: 20,
      locale: NS,
      inject: (): PanelHandoffInjected => ({
        getPanels: () => storeInstance.getSnapshot().panels,
        subscribePanels: listener => storeInstance.subscribe(listener),
        relay: request => ctx.remote.sessionHandoff.relay(request),
        summarize: async (panelId, sessionId) => {
          storeInstance.actions.setSummaryState(panelId, 'generating')
          try {
            const text = await summarizeSession(ctx.sessions, t, sessionId)
            storeInstance.actions.setPanelSummary(panelId, text === '' ? t('panel.summary.empty') : text)
          } catch (error) {
            console.error('[ui-panels] summary generation failed:', error)
            storeInstance.actions.setSummaryState(panelId, 'error')
          }
        },
      }),
    }, PanelHandoffAction)
  })

  // The sidebar session-row ⋯ menu's "Add in panel" action: the same panels
  // store the workspace registers, so a panel created here appears in the
  // tiled/tabbed workspace immediately (and survives reloads).
  ctx.slots.inject('sidebar.workspaces.session-actions', () => {
    return ctx.slots.register({
      name: 'sidebar.workspaces.session-actions',
      id: 'add-to-panel',
      order: 10,
      locale: NS,
      inject: (): SidebarSessionActionInjected => ({
        addToPanel: (sessionId) => {
          const id = crypto.randomUUID()
          const panels = storeInstance.getSnapshot().panels
          storeInstance.actions.addPanel(id, `${t('panel.defaultName')} ${panels.length + 1}`, sessionId)
          storeInstance.actions.focusPanel(id)
          // Selecting the session lets PanelWorkspace's external-navigation
          // sync focus the new panel immediately.
          ctx.sessions.open(sessionId)
        },
      }),
    }, SidebarAddPanelAction)
  })
}
