# Agent Note: 输入区提示词幽灵补全

Status: implemented

[English](2026-08-21-composer-prompt-ghost-completion.md) | 中文

## Problem

重复发送一条提示词意味着重新键入。输入区本就拥有位于 textarea 字形之后的装饰背景层——绘制认领标记、chip 与认领提示的那一层——因此就地补全有地方渲染；但没有任何东西记录用户发送过什么，也没有任何规则决定补全该如何与已经住在那里的浮层共享光标位置。

## Decision

**建议只来自用户自己的提示词，别无其他。** `PromptHistory` 保存一个最近优先、上限 100 条、记录时去重的环。它不附带任何预置起始提示词：预置建议就是未翻译的产品文案，会出现在中文用户的输入区里；而一条谁也没写过的建议，比没有建议更糟。

**该存储由插件持有，其持久化面是构造参数。** `apply()` 基于 `browserPromptStorage()` 构造唯一的 `PromptHistory`，并交给 `InputHub` 与输入栏的注入面。若使用模块级单例直接取用 `window.localStorage`，就会把一次隐藏的存储写入放进 `InputHub.sink`——这正是让 hub 离开 DOM 便无法测试的原因——并使该环游离于任何释放流程之外。`InputHub` 只记录汇聚点接受的内容，因此被拒绝的空提交不留痕迹。

**输入栏读取的是一个函数，而不是一个模块。** `ComposerBarInjected.promptGhost` 的签名是 `(draft) => string | null`。输入栏依旧是其 props 的纯函数；不需要补全的组装可以传入恒返回 null 的实现；测试可以在不触碰存储的情况下预置环内容。

**幽灵文本位于输入区浮层栈的最底层。** 认领提示与已打开的命令菜单各自占据光标后方的空间，并各自接管 Escape。只要二者之一存在，幽灵文本就被抑制；只有在 `dismissPopup()` 与 `arbitrate('escape')` 都不处理之后，Escape 才会落到幽灵文本上——因此关闭幽灵文本绝不会吞掉浮层的 Escape。该关闭状态持续到下一次按键。

**ArrowRight 接受补全；Tab 不接受。** 几乎任何输入都会出现幽灵文本，为一条建议而绑定 Tab，会让整个输入区失去焦点切换键。ArrowRight 仅在草稿末尾接受补全，那里它本就没有光标可移动。

## Alternatives considered

**在历史为空时提供默认提示词模板。** 已否决：它们是双语界面上的预置英文文案，插件无法翻译一条用户可能接受并发送的建议。

**保留模块级函数，另加一个供测试使用的 reset 钩子。** 已否决：测试钩子不是注入接缝。导出的 `getPromptHistory` / `clearPromptHistory` 只被测试使用，knip 会将其标记出来，AGENTS.md 也明确禁止。

**按工作区隔离该环。** 已推迟。跟随用户跨会话的 shell 式历史是更常见的行为，而按工作区隔离需要输入区目前没有的键推导。输入区里键入的一切，本就是用户在自己机器上写下的自己的文本。

## Consequences

`ComposerBarInjected` 增加了一个必填成员，因此每个手工构造输入栏 props 的测试基座都要提供它。`InputHub` 的构造函数新增第三个可选参数；省略它只会关闭记录，不影响其他行为。提示词历史保存在单个浏览器的 `localStorage` 中，不属于会话日志。
