# @deepseek-ai/dsh-client-ui-skill-mode

[English](README.md) | 中文

Skill-mode 插件（浏览器侧）：用一个 popupSelect 外壳装饰宿主 `/mode` 命令（来自 `@deepseek-ai/dsh-skill-mode`），外壳悬浮于会话的 mode skill 列表之上。裸 `/mode`（在 composer 中输入或从 '/' 菜单选取）会打开该外壳；其搜索输入框在本地过滤已加载的 mode-skill 行（名称与描述），↑↓ 移动高亮，**Tab 将高亮行自动补全进搜索框**，Enter 则通过普通命令通道执行 `/mode <name>` 来敲定选择。宿主执行器记录生命周期，结果渲染为 flow 节点，与任何其他命令提交完全一致。

选项来自 `skills.list` RPC（'/' skill source 与模型目录读取的同一份目录），过滤条件为 `mode === true`，即 `dsh-skill-filesystem` 解析进 skill 摘要的 frontmatter 标志。行以 skill 描述作为 detail，因此过滤同时命中名称与正文。没有 mode skill 的会话打开外壳时，外壳报告空状态，而非裸 claim 行。

装饰从不凭空制造行：若宿主组合未挂载 `/mode` 命令（`dsh-skill-mode` 缺席），命令目录中便没有该行，装饰根本不可达。模式激活始终是用户手势：popup 只提交 `/mode <name>`，宿主在进入之前会验证该 skill 是 `mode: true`、用户可调用的条目。

`/client` 的导出即插件本体（`apply`/`inject`）。

## 交互

- 输入 `/mode ` 或从 '/' 菜单选取 `/mode`：popup 打开并显示 mode-skill 列表。
- 输入即过滤（对名称与描述做不区分大小写的子串匹配）。
- ↑↓ 移动高亮；Tab 用高亮行的名称填充搜索框；Enter 选中并提交 `/mode <name>`。
- `/mode off` 仍按普通参数行工作；没有可用装饰时，裸 `/mode` 回退到宿主 claim（`[name|off]` 提示）。

## 模型体验

间接地，通过 popup 提交的 `/mode <name>` 命令行：`@deepseek-ai/dsh-skill-mode` 拥有该命令行驱动的模型可见模式正文与已记录状态，本包只列出会话的 mode skill 并发送用户同样可以手敲的内容。

#### KV Cache 影响

进入或离开模式会改变活跃的 `skill-mode` 系统提示词段，因此改变请求前缀；popup 本身不添加任何提示词内容。

## 已知限制与暂缓事项

- **活跃模式指示器未渲染**——plan mode 有 composer chip（`ui-plan`）；skill-mode 目前仅通过 `/mode` 自身的响应文本呈现状态。在 `skill-mode` 投影上加一枚 chip 是自然的后续工作。
- **Tab 只补全、不选择**——Tab 填充搜索文本（可继续细化），Enter 提交；有意不提供「Tab 立即选中」模式，因此部分前缀绝不会提交错误的 skill。
