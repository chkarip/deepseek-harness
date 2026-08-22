# Agent Note: 粘性 skill 模式——`mode: true` skill 跨轮次保持激活

Status: implemented

[English](2026-08-22-skill-mode.md) | 中文

## 问题

一次调用的 skill 是一次性注入：其正文随该步骤的请求携带，模型按任务自行决定是否再次加载。有些 skill 意在充当常驻姿态而非单条指令——写作风格、评审纪律、持久化工作流。Cursor 插件以 `mode: true` frontmatter 标志加粘性调用表达这一点：用户一旦调用 `/poteto-mode`，该 skill 便跨轮次保持激活，在 playbook 匹配或任务需要严谨时自行应用，直到用户退出。DeepSeek Harness 没有这种机制：每个 skill 要么列入目录（由模型按判断调用），要么由用户调用一次，没有任何东西跨轮次持久化「该 skill 已开启」这一状态。

## 决策

`@deepseek-ai/dsh-skill-mode` 增加粘性会话 skill 模式。模式的激活 skill 名称按会话记录为 `skill/mode`（`{ name: string | null }`）这一 `SessionEventMap` 成员——仅记录、非 surface、整值替换、后者胜出——因此 resume、fork 与 compaction 直接从会话日志中恢复它。`foldSkillMode(events)` 返回最后记录的名称或 `null`，镜像 `foldPlanMode`。

`/mode` 命令进入与退出模式：`/mode <name>` 校验该 skill 存在、声明 `mode: true` 且可被用户调用，然后选中它；`/mode off` 退出；裸 `/mode` 列出可用的模式 skill 与当前状态。选择语义镜像 `ctx.planMode`：轮次之间，变更立即追加 `skill/mode`；进行中的轮次内，它把待定选择排入下一次被接受的轮内 pre-step；重复选择当前或已待定的状态为空操作；反向选择则取消。`ctx.skillMode.get(agent)` 返回 `{ name, pending? }`，把用于组装当前步骤的记录状态与用户轮中的选择区分开。

模式激活期间，`skill-mode` 系统提示词段落（order 60，位于 plan policy 之后）渲染该 skill 的 `<skill_content>` 正文，在选择时从注册表预热，并在 `session/created`（resume）与 `skills/change`（skill 编辑）时重新解析。所引 skill 消失、失去 `mode: true` 或变为仅模型可调用的模式会被自动丢弃，记录状态重置为 `null`。模式激活是用户手势：只有 `mode: true` 且可被用户调用的 skill 才能进入，模型从不激活模式——它只遵循注入的正文。这是一次性 `/name` 调用的粘性等价物，且不增长 transcript：正文挂在系统提示词上，而非每轮复制一条持久化用户消息。

`mode` 是 skill frontmatter 中新增的可选布尔值，由 `dsh-skill-filesystem` 解析进 skill 摘要与定义，并由注册表校验（存在时 `skill.mode` 必须是布尔值）。不含它的 skill 是普通 skill。

`skill-mode` projection 单元把 `{ name, pending }` 从 `/mode` 命令生命周期与 `skill/mode` 事件折叠为纯重放量，因此宿主重启、其他标签页与冷读取仅凭日志即可恢复它。名为 `mode` 的 `command/run` 记录会以记录的参数启动一个候选目标（`off` → `null`，名称 → 该名称）；配对的 `command/done` 保留成功的选择并丢弃错误；`skill/mode` 提交记录状态并清空保留的选择。

组合镜像 plan mode：base bundle 在宿主平面挂载 `dsh-skill-mode`，web-app bundle 禁用该行（按 agent 的状态归 preset 管理），standard、code 与 cordis preset 在 `skillMode: true` 的 isolate realm 内挂载它。

## 曾考虑的替代方案

**复用用户调用路径实现粘性 skill。** 否决：`/name` 按设计是一次性注入，使其粘性会混淆两种不同的姿态——「应用一次」与「保持开启」。

**每轮把模式正文作为持久化用户消息注入。** 否决：它用重复正文撑大 transcript。系统提示词段落每请求渲染同一正文而不增长 transcript，resume 也不需要消息重放。

**要求模型按任务重新调用模式 skill。** 否决：那正是模式要消除的姿态；模型应遵循注入的常驻指令，而非重新发现它们。

## Consequences

`SkillEntry` 与 skill 摘要携带必填的 `mode` 布尔字段，因此每一处技能列表的生产者都要设置它——`skills.list` RPC schema、客户端 connection fixture 与 apiproxy carrier 测试都显式写出该字段，而非依赖默认值。

`SessionEventMap` 新增 `skill/mode`，因此不认识该成员的构建会拒绝该日志，除非信封标记为可忽略；与其他已记录状态一样，这一项是读取时必填的。

挂载了 `dsh-skill-mode` 但没有 `ctx.commands` 的组合会得到服务与提示词分节、却没有 `/mode`；没有 `ctx.sessionProjections` 的组合则得不到投影单元——两者都按设计保持静默，因为本包把每项贡献都注册在它所需的服务之后。base bundle 在宿主平面挂载该插件，web-app bundle 停用该行，standard、code 与 cordis 预设则在 `skillMode: true` 的隔离 realm 内挂载它，因此按 Agent 的模式状态与 plan mode 一样留在预设背后。

`ctx.skillMode` 映射到 skills 子系统页面，并在文档图谱中与 `planMode` 一同归类为 core 服务。
