# @deepseek-ai/dsh-client-ui-panels

[English](README.md) | 中文

多面板对话工作区客户端插件。渲染并列或分栏对话面板（`PanelWorkspace`）、面板创建控件、会话选择器、角色定制模态框（`ForkRoleModal`）以及跨面板上下文传递操作（`PanelHandoffAction`）。

## Model Experience

无，此包完全运行于浏览器客户端并负责渲染 UI 布局，不直接构建模型请求。

#### KV Cache effect

无；此包既不组装也不发送提供者请求。

## Known Limitations and Deferred Work

- **面板网格灵活性**：分栏布局目前支持 2 个活跃面板并列展示。
- **刷新持久化布局**：面板组合与活跃会话挂载状态保存在前端内存中，按会话意图初始化。
