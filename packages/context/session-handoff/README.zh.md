# `@deepseek-ai/dsh-session-handoff`

[English](README.md) | 中文

`ctx.sessionHandoff` 跨会话中继已完成的 assistant 回复、前置 user 问题以及源对话摘要，作为有溯源的模型上下文（`ContextForm = 'relay'`）。它通过 Typert Remote 发布为 `sessionHandoff.relay`。

## 公共 API

- `relay(request)` 校验请求，通过 `createApiRemoteAgentResolver` 解析源与目标 agent，直接从持久化源日志中提取 assistant 回复和前置问题，格式化并约束负载字节数，向目标会话注入带有溯源的上下文消息。
- 交付模式：
  - `'attach'`：静默注入中继上下文，不唤醒目标 agent。
  - `'attach-and-ask'`：注入中继上下文并立即在同一轮次中使用人类提示词附带 followup。

## 安全与框架

中继负载封装在 `<relayed-handoff>` 标签内的标签安全 JSON 结构中，带有不可信背景警告，确保模型不会直接执行中继内容中的指令，除非当前用户明确重复。

## 配置项

| 配置键 | 默认值 | 约束 |
|---|---:|---|
| `maxRelayBytes` | `65536` | handoff JSON 负载的最大 UTF-8 序列化字节数。 |
| `allowCrossWorkspace` | `false` | 是否允许跨不同工作区工作目录进行 handoff。 |

## Model Experience

### Relayed session handoff

#### What the model sees

目标 agent 会收到一条包含 `<relayed-handoff>` 包装的标签安全 JSON 溯源上下文消息，其中包含源会话中提取的 assistant 回复、前置问题以及可选摘要。

#### Token effect

增加固定的警告标头以及受 `maxRelayBytes` 约束的序列化 JSON 对象。

#### KV Cache effect

中继 handoff 消息作为常规对话轮次追加到目标会话日志中，其 KV 缓存前缀行为与普通 user 输入一致。

## Known Limitations and Deferred Work

- **静态 JSON 截断**：超出预算时会带省略提示截断前置问题或过长的回复末尾；中继前的语义结构化摘要需要客户端显式发起。
- **跨主机中继**：中继目前在同一主机实例的本地 agent 会话之间执行。
