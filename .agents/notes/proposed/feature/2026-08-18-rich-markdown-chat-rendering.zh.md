# Agent Note: Web UI 富文本 Markdown 渲染与交互增强

状态: proposed

[English](2026-08-18-rich-markdown-chat-rendering.md) | 中文

## 背景与问题

Web UI 中助手的回答此前仅呈现基础 Markdown 纯文本块，缺乏现代视觉排版与交互语义能力，用户无法体验：
- GitHub Flavored Markdown (GFM) 提示块（`> [!NOTE]`、`> [!TIP]`、`> [!IMPORTANT]`、`> [!WARNING]`、`> [!CAUTION]`）。
- 用于折叠冗长日志或深入探讨的 `<details>` 与 `<summary>` 折叠块。
- 交互式脚注页内跳转锚点（`#user-content-fn-*`）及返回引用（`↩`）。
- 从 ````mermaid` 代码块直接呈现的可视化流程图与架构图。
- 沙箱隔离的 HTML 代码段运行预览。
- 引导大模型输出结构化丰富排版的系统提示词指导。

## 方案设计

在 `packages/client/ui-primitives` 与 `packages/client/ui-deliverables` 中实现全面的富文本 Markdown 支持：

1. **视觉排版与 CSS 设计令牌**：
   - 优化标题垂直排版、行高及细微分割线。
   - 结构化表格样式，具备交替斑马纹与浮动表头。
   - 主色调边框与背景浅色的引用块。
   - 令牌化行内代码徽章与带语言标识/复制操作的代码块标头。
   - 流式生成时的呼吸光标脉冲动画。

2. **富语义组件解析 (`packages/client/ui-primitives/src/markdown/render.tsx`)**：
   - 将 GFM 提示块解析为带 SVG 图标和主题色边框的专属容器。
   - 支持原生 `<details>` 与 `<summary>` 折叠展开容器。
   - 将脚注引用与定义转换为交互式锚点链接与回跳引用。

3. **Mermaid 图表栅格组件 (`MermaidBlock.tsx`)**：
   - 动态按需加载 `mermaid`，自适应亮色/暗色主题（`data-ds-dark-theme`）。
   - 图表与源码之间的平滑切换。
   - 解析失败时优雅降级为语法高亮 `CodeBlock`。
   - 流式传输期间保持纯代码展示，避免不完整 AST 解析异常。

4. **沙箱隔离 HTML 预览组件 (`HtmlPreviewBlock.tsx`)**：
   - 在 `<iframe sandbox="allow-scripts" srcdoc=... referrerPolicy="no-referrer" />` 中渲染并注入严格 CSP。
   - 默认展示源码，提供显式“运行预览”按钮。

5. **提示词指导 (`packages/client/ui-deliverables/src/index.ts`)**：
   - 在 `systemPrompt` 中注册 `ui:rich-formatting-guidance`，引导模型使用表格、GFM 提示块、Mermaid 图表与折叠块组织回答。

## 曾考虑的替代方案

- **不使用 iframe 直接内联渲染 HTML**：已被否决，因存在严重的跨站脚本攻击（XSS）风险以及主应用样式污染问题。
- **将 Mermaid 静态打包进主 Shell**：已被否决，避免图表库体积过大拖慢页面首屏加载性能。

## 风险与缓解

- **Iframe 沙箱逃逸风险**：通过禁用 `allow-same-origin`、启用 `allow-scripts`、设置 `referrerpolicy="no-referrer"` 并注入严格的 CSP 策略进行缓解。
- **流式解析不稳定**：在流式生成未结算前保持纯代码块展示，避免不完整 token 导致解析异常。

## 验收标准

- `packages/client/ui-primitives` 单元测试验证提示块解析、折叠容器、脚注锚点、HTML 沙箱隔离与 Mermaid 切换。
- `packages/client/ui-deliverables` 单元测试验证系统提示词段落注册与释放。
- DOM 对齐与增量渲染快照测试保持全部通过。
- 客户端模块与 Web 产物构建无报错且支持分块按需加载。
