# @deepseek-ai/dsh-client-web

[English](README.md) | 中文

Web 外壳内核：`new AppWebEntry(el, seams?).run()` 通过两阶段启动（web2）挂载整个客户端。第一阶段（模块侧）：构建客户端模块系统（`@deepseek-ai/dsh-client-modules`），以主机推送的配置项图（`window.__DSH_BOOT__`）为基础，并行预取 `immediately` 层级；执行组合包只会注册 factory。第二阶段（插件侧）：挂载仓库内置的 Cordis Loader，并通过其 `internal` 约定注入模块系统；为每一行图数据创建一个 loader 配置项，另创建外壳自身的 app-shell 组装配置项（tree.import 会物化各模块）；以 settle 作为 AppRoot 的门禁（loader 完全停稳 + 每个配置项 fiber 都为 ACTIVE → 一次切换显示完整 UI）。组合完全由主机图决定：花名册和 immediately 层级都位于负责组合的应用中；外壳不作任何组合决策。

外壳自给自足（web2 硬性规则）：内核不对任何插件包执行值导入；启动状态 store 与信号在这里手写（`loader-status.ts`），因此即使插件失败，加载页面仍能工作，而此时这一点尤其重要。app-shell 组装（`@deepseek-ai/dsh-client-app-shell`，由外壳拥有、背后没有 npm 包的伪配置项）是唯一通过 `registerStatic` 注册的模块；它与任何插件一样，通过 inject 等待 slots/sessions/layout。

`PLATFORM_MODULES`（src/platform.ts）是共享模块接口的唯一真源：种子表 key、tsdown 客户端 external 和 vite alias 集都是它的投影。

可选的覆盖参数 `seams` 会为外部 `<script>` 执行无法到达页面上下文的环境转发模块系统的 `loadBundle` 传输覆盖（`BootSeams`）；普通浏览器调用方省略此参数。

外壳拥有浏览器标题投影。选中带有持久标题的会话时，它会渲染 `<session title> — <existing HTML title>` 并响应后续标题修订；未选择会话或选中无标题会话时，会保留现有标题；外壳卸载时恢复标题。现有 HTML 标题仍是可配置的产品后缀。

同一投影还会把所选会话的执行状态带到标签页上，因此切到后台的标签页也能看出其 Agent 是否仍在工作。`running`（会话自身的运行位，或其任一 job 处于 running/stopping）会给标题加上 `●` 前缀，并在网站图标上画一个蓝点；从运行到空闲的跃迁会锁存 `completed`，显示 `✓` 与绿点，直到窗口重新获得焦点。切换会话会清除该锁存，而不是把它带过去。空闲时使用的图标是文档原本携带的 href，在首次绘制时记录在 link 元素上——若还原为猜测的 `/favicon.svg`，在任何非根基路径下都会 404。外壳不播放任何声音；可选的 [`ui-activity-monitor`](../ui-activity-monitor/README.md) 拥有完成提示音及其偏好开关。

## 模型体验

无。入口外壳负责启动浏览器插件树；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **有意采用一次性渲染**：UI 等待启动 settle；只要一个配置项失败，加载页面就会保留并逐项显示醒目的报告，不提供部分可用性（渐进式渲染将作为独立项目恢复）。
- **窄窗口外壳行为缺少组装后演练**：ui-layout 已实现让步链，但该包没有外壳级窄视口验收用例。
