# Agent Note: 模式成员——模式 skill 携带其他 skill

Status: implemented

[English](2026-08-22-skill-mode-membership.md) | 中文

## 问题

[粘性 skill 模式](2026-08-22-skill-mode.zh.md)只让恰好一个 skill 常驻：`/mode <name>` 记录 `skill/mode`，`skill-mode` 系统提示词段落在每个请求中渲染该 skill 的正文。而姿态很少只由一个 skill 构成。`unslop` 声明自己必须始终生效，但作为模式它只能独自常驻；一个既想要常驻写作风格、又有自身 playbook 文本的路由模式无法表达这一组合。同时进入两个模式也不可行——记录状态是单个名称。

## 决策

模式 skill 在 `skills:` frontmatter 中声明它携带的 skill，模式激活期间，每个声明成员的正文与模式自身的正文一同渲染。

```markdown
---
name: poteto
description: Router for rigorous engineering work.
mode: true
skills: [unslop]
---
```

`dsh-skill-filesystem` 把 `skills:` 解析进 `SkillSummary.modeSkills`，与它已解析的 `mode` 标志并列。两个模式字段现在一起解析、一起拒绝：非数组的 `skills`、非字符串或非 kebab-case 的成员、缺少 `mode: true` 的 `skills`，以及非布尔的 `mode`，都会带着具名警告忽略该文件，与无效的调用策略 frontmatter 完全一致。

`SkillModeController.renderModeBodies()` 在预热正文缓存时解析成员——`/mode` 进入时、`session/created`（resume）时以及 `skills/change` 时。缓存持有有序的正文列表而非单条正文，段落先渲染模式正文，再渲染各成员正文，每条都是独立的 `renderSkillContent` 块。解析规则：

- **只展开一层。** 成员自身的 `modeSkills` 被忽略，因此展开由构造本身终止，无需环路守卫。
- **重复项与自引用被丢弃**，因此列出自己的模式其正文只渲染一次。
- **无法再加载的成员被丢弃并告警，模式保持激活。** 成员只需存在且可被用户调用，不需要 `mode: true`。

成员关系只在模式渲染处解析。`dsh-tool-skill` 的用户调用边界只读取调用策略，因此无论携带它的模式是否激活，成员始终是一次性的 `/name` 注入，模型也仍通过 `skill` 工具抵达它。wire 上的 `SkillEntry` 新增必填的 `modeSkills` 数组，`/mode` popupSelect 将其渲染为行详情，使按成员搜索能找到携带它的模式；会话当前模式所在行按 `skill-mode` projection 标记为激活。

## 曾考虑的替代方案

**集合值的 `skill/mode` 事件。** 否决：叠加两个模式需要定义正文顺序并变更会话格式，而具名容器用格式已承诺的单个记录名称表达了同一姿态。

**每个模式一个 preset。** 否决：preset 替换工具 schema 与提示词段落，且在 agent 产出任何内容后即锁定，而姿态必须能在会话中途切换。

**成员缺失即终止模式。** 否决：一个被删除的成员文件会拖垮整个姿态，而其余成员完好无损。模式自身消失时仍照旧丢弃模式。

**递归展开成员。** 否决：它带来无人要求的嵌套，代价是环路守卫外加为传递闭包定义顺序。

## Consequences

成员关系在渲染时从 skill 文件解析，而非来自日志，因此 `SESSION_FORMAT_VERSION` 不变——`skill/mode` 仍只记录一个名称。因此编辑模式的 `skills:` 列表会改变已记录会话的重放结果：日志记名模式，文件决定该模式当前携带什么。

激活模式的请求开销按每个成员的完整正文增长，每请求一次。携带多个大 skill 的模式是常驻前缀开销，这正是与每轮分别调用它们之间的取舍。

`SkillEntry.modeSkills` 是必填 wire 数据，因此每一处技能列表的生产者都要设置它——`skills.list` RPC schema、客户端 connection fixture 与 apiproxy carrier 测试都显式写出该字段，而非依赖默认值。

模式的成员正文与会话前缀目录仍会同时抵达请求，与单 skill 情形相同：模式不会把成员与 `tool-skill` 已列出的内容做差集。
