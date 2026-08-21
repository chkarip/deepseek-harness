# Agent Note: 活动监控与伴侣插件

Status: implemented

[English](2026-08-21-web-activity-monitor-mascot.md) | 中文

## Problem

运行中的轮次只表现为一个转圈动画和一行统计。没有任何东西告诉旁观的用户 Agent 处于哪个阶段、解码速度如何，或者这段对话已经吃掉了多少上下文窗口——也没有任何东西让等待一个长轮次变得愉快。这两种诉求都真实存在，也都是可选的：它们都不属于每个组装都会引入的 `ui-conversation`。

## Decision

**一个可选插件、三处槽位条目，不改动任何所有者。** `ui-activity-monitor` 注册到 `conversation.session.header.utilities`、`conversation.input.dock` 与 `conversation.view`。每处注册都是随 fiber 释放的 `ctx.effect`；`ui-conversation` 对此一无所知。

**组件通过标准套件读取会话。** 这三个槽位都是 session 作用域，因此每个条目都会收到 `useSession`、`sessionId` 与 `useProjection`。改为读取列表 store 再去取会话对象，会绕开框架的按会话绑定——而且按原先的写法，它读取的是列表行并不携带的字段，导致整个功能在类型检查通过的假象下完全失效。

**估算值与服务端上报值绝不混用。** 曲线、头部徽标与"投喂词元数"由浏览器按流式文本的字符数近似得出，文案已如实标注。流转视图的耗时行与仪表盘则来自 `sessionStats`、`tokenUsage` 与 `contextPressure`。若某投影尚未提供值，对应仪表盘直接省略：用假定的 128k 窗口算出的占用率看起来像测量结果，实际却是猜测；而把恒为 `null` 的 TTFT 渲染成一个字段，则是数据永远兑现不了的承诺。

**伴侣状态存储刻意是模块级单例，其不变量伴生插件也如实说明。** 其中的一切都是由 `localStorage` 支撑的、按浏览器保存的用户偏好，因此必须像那条存储记录一样在插件卸载后继续存在。这里没有可供不变量断言的所有权关系；宣称一份它并不具备的释放安全性，比一个有解释的空伴生插件更糟。存储写入被合并为最多每两秒一次，外加 `pagehide` 时的刷写，因为流式生成会以帧率记入词元增量。

**只有伴侣区域播放完成提示音。** 三个界面都用同一个 Hook 渲染同一只伴侣，若把提示音放进共享 Hook，每个已挂载的界面都会各响一次。`useCompletionCue` 是一个独立导出，仅由伴侣区域调用，并受默认关闭的音效偏好控制。

## Alternatives considered

**把遥测放进 `ui-conversation` 的统计行。** 已否决：统计行是基于已定型节点的摘要，刻意不随流式增量重新渲染。实时曲线的诉求恰好相反，把两者塞进同一行会让每个组装都付出重渲染的代价。

**让伴侣状态存储采用插件生命周期，并通过槽位 `inject` 传递。** 暂时否决：该存储只保存偏好，把偏好绑定到 fiber 会在每次 HMR 重载时重置用户选择的外观。不变量伴生插件如实记录这一例外，而不是假装它不存在。

**让伴侣在轮次结束后保持 `success` 精灵以示庆祝。** 已推迟：只要会话保持空闲，settled 阶段就会一直持续，因此永久显示"任务完成！"是错的。带时限的瞬时状态需要该 Hook 目前并不拥有的定时器。

## Consequences

`ui-activity-monitor` 依赖 `dsh-session-stats` 与 `dsh-token-meter`，仅用于其投影键的类型合并（type-only 导入）。web-app bundle 默认挂载它，因此其文案完全双语；不需要它的组装去掉一行 patch 即可。伴侣统计只存在于单个浏览器中，永远不属于会话日志。
