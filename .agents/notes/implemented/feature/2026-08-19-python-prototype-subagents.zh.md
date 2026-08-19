# Agent Note: Python 原型子 agent

Status: implemented

[English](2026-08-19-python-prototype-subagents.md) | 中文

## 问题

独立的 DeepSeek Python 原型只有技能专用循环，没有用于研究、审查或测试任务的隔离委派路径。

## 决策

原型在父循环中提供 `spawn_subagent`，并通过 `agent_core.py` 中的共享循环运行每个子 agent；每个子 agent 只获得新的系统消息和用户任务消息。`SUBAGENT_TYPES` 管理专用提示词和每类限制。工具 schema 与分发器都依据实时注册表过滤；子 agent 的文件读取限制在示例根目录，测试使用固定且有超时的 pytest 命令，搜索工具明确是离线 stub。子 agent 不能继续创建子 agent。同一批次的委派在有界线程池中并行运行，工具结果按请求顺序返回父级。父级只接收提炼后的文本，完整的子 agent 统计信息保留在父级 trace 中。

委派参数由模型控制，因此在进入 runner 之前会被规范化为固定的关键字集合：未知键被丢弃，非法参数变成工具结果，而不是终止父级本轮的异常。限制分三层——每类角色自身的迭代与 token 限制、整轮共享的子 agent token 预算，以及单轮可启动的子 agent 数量上限——从而约束并发失控，而不只是约束单个子 agent。

结构化输出会在子 agent 剩余预算内获得一次修复机会，`output_schema` 既可以是 JSON Schema，也可以是扁平的键映射。父级和子 agent 的用量分开记录，父级 trace 还提供子 agent 用量汇总。

## 备选方案

**将整个原型改为 asyncio。** 当前传输使用阻塞式 `urllib`，因此线程可以提供等效的 I/O 并发，同时不改变同步 CLI 和现有测试。

**复用父级系统提示词和 transcript。** 这会把无关上下文泄露给子 agent，并使委派结果依赖父级历史，因此每个子 agent 保持隔离。

**只在提示词中限制工具。** 仅靠提示词不是强制机制；必须同时省略 schema 中的工具并在分发器中拒绝调用。

## 影响

原型现在具备有界并发委派，并会对被拒绝、格式错误、截断或结构化输出无效的子 agent 结果返回明确文本。离线搜索工具是 fixture stub，不能被当作网络能力。实现只位于 `examples/deepseek-skills`；生产 TypeScript 子 agent 能力保持独立。
