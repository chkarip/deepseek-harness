# @deepseek-ai/dsh-skill-mode

[English](README.md) | 中文

按会话分别记录到日志的粘性 skill（技能）mode：用户调用的 `mode: true` skill，其正文会保留在每个模型请求中，直到被关闭。`/mode <name>` 进入某个 mode，`/mode off` 退出该 mode，不带参数的 `/mode` 列出可用的 mode skill 和当前状态。

## 持久状态

`skill/mode`（`{ name: string | null }`）是一个仅存在于日志中、每次以完整值替换的 `SessionEventMap` 成员。`foldSkillMode(events)` 返回最后记录的 mode skill 名称，如果没有则返回 `null`，因此恢复、fork 和压缩（compaction）都能直接从会话日志恢复 mode 状态。UI 通过 `session/event` 观察已提交的切换。

`ctx.skillMode.set(agent, name)` 会在 agent（智能体）空闲时立即追加独立的 `skill/mode` 事件，因为下一个提示词之前不会运行轮内 pre-step。agent 运行时，该方法会为下一个被接受的轮内 pre-step 保留待生效选择。返回值区分 `committed`、`queued`、表示反转的 `cancelled` 和 `noop`。`get(agent)` 返回 `{ name, pending? }`，将用于组装当前步骤的日志状态与用户的轮中选择分开。初始与续步 pre-step 都会应用待生效选择；同一步骤的请求恢复重试会复用已冻结的 assembly，并将该选择保留到下一个 pre-step。当最后记录的请求头描述了另一状态时，用户选择的变更会贡献一条插件来源的 `user/message` 通知（两条提交路径皆然）。

## 模型交互

mode 激活时，`skill-mode` 系统提示词区段会渲染该 skill 的 `<skill_content>` 正文，在选中时从注册表预热，并在 `session/created`（恢复）和 `skills/change`（skill 编辑）时重新解析。若某个 mode 的 skill 消失、失去 `mode: true` 或变成仅限模型，该 mode 会被自动丢弃，已记录状态重置为 `null`。激活 mode 属于用户手势：只能进入 `mode: true` 且用户可调用的 skill，模型永远不会激活 mode，只遵循被注入的正文。

## `/mode` 命令

组合 `ctx.commands` 时，该包会注册 `/mode`：

- `/mode <name>` 验证命名 mode skill 存在、声明 `mode: true` 且可被用户调用后，进入该 mode。
- `/mode off` 退出 mode 并取消待生效的进入。
- 不带参数的 `/mode` 列出可用的 mode skill 和当前状态。

## 编写 mode skill

一个 skill 只需一个 frontmatter 标志即可成为 mode：

```markdown
---
name: unslop
description: Cut AI tells from any writing. Must always apply.
mode: true
---
```

`mode` 标志由 `dsh-skill-filesystem` 解析进 skill 概述与定义中；没有该标志的 skill 是普通 skill。把 skill 放在任意发现根（项目 `.agents/skills`、用户 `~/.agents/skills`、bundled）中，然后用 `/mode unslop` 进入。

## 会话投影

当组合挂载 `ctx.sessionProjections`（[`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.zh.md)）时，本包会在一个注入的子插件中注册 `skill-mode` 投影单元。名为 `mode` 且携带已记录 `args` 的 `command/run` 记录会开始一个候选目标（`off` → `null`，一个名称 → 该名称）；与它配对的 `command/done` 保留成功选择并丢弃错误；`skill/mode` 提交已记录状态并清除已保留的选择。其他任何事件都返回同一个状态引用。`view` 推导 `{ name, pending }`，其中 `pending` 仅在未结算或已成功的选择与已记录状态不同时为 true。该值仍完全由日志回放得出，因此 host 重启、其他标签页和冷读都能仅凭日志恢复它。key 由 `src/types.ts` 通过声明合并加入 `SessionProjectionMap`（host 消费方经 `./types` 获取，client 聚合经 `./client` 获取）；框架负责驱动该单元，载体通过历史尾页和 `session/projection` 推送帧提供其值。未挂载注册表的组合不受影响。

## 配置

该插件不接受任何配置。

```yaml
- id: skill-mode
  name: '@deepseek-ai/dsh-skill-mode'
```

将它挂载在 `tool-skill` 旁边，使其 pre-step 监听器在目录的监听器之后运行，mode 正文在请求中位于目录之后。

## 模型体验

### 模式技能系统提示词

#### 模型看到什么

模式活跃时，模型在提示词顺序 60（plan policy 之后）看到 `skill-mode` 分节：先是一段点名当前模式的 `<system-reminder>`，随后是由 `renderSkillContent` 渲染的所选技能，与 `tool-skill` 渲染已加载正文的方式完全一致。没有模式则不贡献任何文本。模型无法进入或离开模式——激活始终是用户通过 `/mode` 发出的手势；该分节只告诉它当前哪个模式生效、以及要遵循它。

##### 渲染出的分节

```markdown
<system-reminder>
Skill mode "unslop" is active in this session. Follow its instructions.

<skill_content name="unslop">
<skill_resources>
...
</skill_resources>

<skill_instructions>
...the skill body...
</skill_instructions>
</skill_content>
</system-reminder>
```

#### 词元影响

没有模式则不增加词元；模式活跃期间，其技能正文会加入每一次请求。模式正文按每次请求计一次长度，而非每轮一次，这正是它与「每轮把技能作为用户消息重新调用」之间的取舍。

#### KV Cache 影响

同一模式保持选中期间，该分节稳定，因此顺序 60 之前的前缀可跨轮复用。进入、离开或切换模式会改变从顺序 60 起的系统提示词；对活跃技能文件的编辑同样如此，`skills/change` 会重新解析它。

### 人类命令

#### 模型看到什么

`/mode`、`/mode <name>`、`/mode off` 及其终态结果都不进入模型历史。当最后一次已记录的请求头描述的是另一种状态时，选择变更会贡献一条插件来源的 `user/message` 通知，因此回读转录的模型能看出请求之间姿态发生了变化。取消待定选择不贡献通知，因为没有任何请求观察到它。

#### 词元影响

选择变更时通知是一条简短的用户消息；列出模式或重复选择当前模式不增加任何内容。

#### KV Cache 影响

通知追加在历史之后而非修改前缀，因此不会使任何已缓存内容失效。

## 已知限制与暂缓事项

- **一次只能有一个模式**——已记录状态是单个名称，因此进入某个模式会替换当前活跃的模式。叠加两个模式技能需要集合值事件与确定的正文顺序，而格式并未承诺其中任何一项。
- **正文不与目录去重**——即便 `tool-skill` 已在会话前缀目录中列出该技能，活跃模式仍会完整渲染其正文，因此一个模式技能的摘要与正文可能同时进入请求。
- **模型侧无法退出**——模型无法离开它认为不适用的模式，只能拒绝套用正文并说明原因。希望由模型驱动姿态变化的部署需要另设工具。
- **按会话而非按 Agent 树**——子 Agent 不继承父级的模式；每个会话的模式状态都是它自己的已记录量。
