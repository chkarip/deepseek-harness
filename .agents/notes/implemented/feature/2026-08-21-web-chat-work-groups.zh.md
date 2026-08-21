# Agent Note: Web 对话过程分组

Status: implemented

[English](2026-08-21-web-chat-work-groups.md) | 中文

## Problem

聊天流把每一条中间行都渲染在与答案同一层级：一个轮次的 Think 行和它的 Bash/Read 工具行排成一列位于正文之上，每一行虽然各自可折叠，却无法一起折叠。带有若干工具调用的轮次会把答案挤出屏幕，使记录读起来像机器日志而不是回复；而想查看推理过程的读者，也没有一个统一的入口可以展开。

## Decision

**分组由 Chat 快照构建器决定，视图只负责渲染。** `ChatSnapshotBuilder` 在 `order` 之外发布 `ChatSnapshot.rows`：同一轮次中相邻且可见、其材料仅为推理或 tool-call 头部的 Node，合并为一条携带成员 key 的 `work-group` 行，其余 Node 保持为 `node` 行。`order` 不变，因此滚动锚定、分页、`data-chat-anchor-key` 账本以及按 key 的席位订阅仍作用于扁平列表。行具备引用稳定性：布局未变时返回上一次的数组，未移动的分组保留原对象，因此折叠不会导致成员重新挂载。

**成员身份取决于 Node 携带的内容，而不仅是它的 kind。** 工具调用始终属于过程。Assistant 步骤只有在其全部 block 都是推理或 tool-call 头部时才属于过程，且被中断时绝不属于——因此真正开始说话的那个步骤，或半句冻结的步骤，会自行离开分组。由于该判定读取内容，`apply()` 携带一个独立于结构变化的重新分组信号：某个步骤获得第一个文本 block 时会重建布局，而不触动 `order` 或 Location 索引。

**分组的展开状态跟随其轮次，直至读者接管。** `WorkGroup` 从所属轮次的 `status` 推导展开状态，因此轮次运行期间过程可见地流式输出，轮次一结束即折叠为一行。手动切换会写入显式覆盖，此后由该覆盖决定。成员仅在展开时挂载，因此长历史只为摘要行付出代价。

**折叠后的活动行是一个按 key 分发的席位，而非 switch。** `conversation.chat.workSummary` 按最后一个成员的 renderer kind 分发。`ui-conversation` 用最新的想法命名推理步骤；`ui-tool` 注册 `ToolWorkSummary`，从展开行所用的同一个纯 `toolRowModel` 导出工具标题与单行摘要。没有注册条目的 kind 只保留步骤数，因此该席位是降级而非失败。

## Alternatives considered

**在视图里基于 `chat.order` 分组。** 否决：`ChatNodeStore` 是稳定的活对象，且某个步骤开始说话时 `order` 并不变化，视图因此没有可用于重新分组的信号；而构建器本来就能看到每一次 upsert。

**把分组本身做成一种 Chat Node kind。** 否决：一个 Context 对应一个 Node 是引擎规则，而合成的父 Node 将不得不重新拥有其成员的 key、锚点与生命周期——这正是 `order` 已经提供的机制。

**为摘要行把工具行 model 引入聊天视图。** 否决：依赖方向是 `ui-tool` 依赖 `ui-conversation`，而非相反。按 key 分发的席位把工具展示留在拥有它的包内，并且在该包被组合排除时分组仍可渲染。

**把推理拆成独立的 Chat Node kind，使每个 Think 行都能分组。** 推迟，而非否决。与答案文本在同一步骤中到达的推理仍渲染在答案之上，而不在分组内。拆分需要一个针对推理 chunk 的独立 `ConversationNodeDefinition`，以及 `assistant.ts` 中的可见性变更，会牵动 turn-tail 的收尾判定、分支操作的启用条件和 StatsLine 的步骤计数；这件事值得单独做，并配套自己的覆盖。

## Consequences

现在一个轮次读起来是一份附带过程的答案，而不是一串步骤日志。Chat target 多拥有一个已发布的投影，且 `ChatSnapshot` 增加了必填字段，因此所有手工构建该切片的 fixture 都需提供 `rows`——ui-conversation 的 fixture 通过导出的 `chatRowLayout` 构建，这也顺带修正了该 fixture 中工具调用落定时丢失 Location 的问题。折叠会卸载成员行，因此工具卡片的局部展开状态不会跨折叠保留；分组行上的锚点 key 让分页仍能落在被折叠的一段上。
