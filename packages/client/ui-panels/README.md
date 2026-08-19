# @deepseek-ai/dsh-client-ui-panels

English | [中文](README.zh.md)

Multi-panel conversation workspace client plugin. Renders side-by-side or split conversation panels (`PanelWorkspace`), panel creation controls, session pickers, role customization modals (`ForkRoleModal`), and cross-panel handoff actions (`PanelHandoffAction`).

## Model Experience

None, as this package runs entirely in the browser client and renders UI layouts; nothing here directly reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel Grid Flexibility**: Split-pane layout is currently limited to 2 active panels side-by-side.
- **Persistent Layouts Across Reloads**: Panel compositions and active session attachments are held in frontend memory and initialized per session intent.
