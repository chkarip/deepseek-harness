# Agent 笔记：跨面板会话接力与上下文转发

状态：提议中

[English](2026-08-17-cross-panel-session-handoff.md) | 中文

## 问题

在多面板工作区（`ui-panels`）中跨会话协作时，用户经常希望将一个面板中已完成的 Assistant 回答、代码片段或结论，作为参考上下文或提示词发送给另一面板中的 Agent。

在该特性之前，面板间传递信息必须通过手动复制粘贴到输入框，这会导致丢失溯源信息（哪个会话、面板名称及消息产生该回答），并绕过了长度预算控制与非可信内容的安全隔离。

## 方案

实现 Host 侧 `session-handoff` 服务（`@deepseek-ai/dsh-session-handoff`）以及注册在 `conversation.chat.assistant-actions` 插槽中的客户端操作入口（`PanelHandoffAction`）：

1. **Host 侧服务 (`packages/context/session-handoff`)**：
   - 在 Typert 命名空间 `sessionHandoff` 下注册为 `@Remote('relay')`。
   - 通过 `createApiRemoteAgentResolver` 解析活跃/冷启动 Agent。
   - 直接从源持久化日志中提取已完成的 Assistant 回答及前置直接用户提问。
   - 在配置的 UTF-8 字节上限（`maxRelayBytes`，默认 32 KB）内截断并保留负载，附带精确的省略提示。
   - 除非显式启用 `allowCrossWorkspace`，否则强制校验工作区边界。
   - 使用标签安全的 JSON（`<` 转换为 `\u003c`）并包装在非可信提示词边界（`<relayed-handoff>`）中。
   - 向目标会话注入带有溯源的 UserMessage（`source: { kind: 'session-handoff', form: 'relay', senderSessionId, senderLabel, messageId, includes }`）。
   - 在带有人工备注的 `'attach-and-ask'` 模式下，自动向目标会话发起以该备注为提示词的后续轮次。

2. **客户端溯源展示 (`packages/client/runtime`)**：
   - 在 `context-provenance.ts` 中识别 `case 'session-handoff'`，映射为 `{ role: 'recall', label: senderLabel ?? 'session-handoff' }`。

3. **客户端操作组件 (`packages/client/ui-panels`)**：
   - `PanelHandoffAction` 挂载在 `conversation.chat.assistant-actions`（order 20）。
   - 仅当工作区存在 2 个及以上活跃面板时渲染。
   - 提供气泡弹窗选择目标面板、勾选包含内容（回答、提问、摘要）、按需触发 AI 摘要提取并选择投递方式（`attach` 或 `attach-and-ask`）。

## 曾考虑的替代方案

- **仅客户端输入框粘贴**：向未发送草稿注入文本。已被否决，因为其破坏未发送草稿、无法自动触发轮次且丢失持久化溯源。
- **复制完整会话历史**：分支或复制整个日志。已被否决，因为仅需某条特定回答时会向目标会话上下文窗口引入大量无关轮次。

## 风险与缓解

- **跨会话提示词注入风险**：来自相邻会话的内容可能携带恶意指令；通过 `<relayed-handoff>` 标签安全隔离并明确声明非可信背景来进行缓解。
- **上下文窗口膨胀**：转发超大内容可能消耗过多上下文；通过可配置的字节预算限制（`maxRelayBytes`）以及明确的省略提示进行缓解。

## 验收标准

- `session-handoff` 单元测试覆盖所有校验、内容提取、字节预算截断和中继投递路径。
- 客户端单元测试验证 `contextProvenance` 及 `PanelHandoffAction` 的渲染与交互。
- 保证多面板工作区的端到端完整性。
