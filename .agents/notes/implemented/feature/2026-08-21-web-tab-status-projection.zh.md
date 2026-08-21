# Agent Note: 浏览器标签页状态投影

Status: implemented

[English](2026-08-21-web-tab-status-projection.md) | 中文

## Problem

外壳原本已经把所选会话的持久标题投影到浏览器标题上。用户启动一个长轮次后切走标签页，就无法从标签栏判断 Agent 仍在工作还是几分钟前就已完成——而那恰恰是标签栏成为他们唯一可见界面的时刻。

## Decision

**状态搭乘既有的标题投影，而不是引入第二个所有者。** `DocumentTitle` 在 `title` 之外接收 `status`，并在同一个 effect 里同时绘制标题前缀（`●` 运行中、`✓` 已完成）与网站图标上的指示点，因此二者不可能不一致。

**"运行中"取会话自身的运行位或任一存活 job。** 外壳选择器读取 `summary.running`，或该会话处于 `running` / `stopping` 的任一 job。其返回值每次读取都是新对象，因此传入 `shallowEqual`；否则任何无关的会话列表变化都会重新渲染该投影。

**"已完成"是运行到空闲跃迁上的锁存，由注意力或切换会话清除。** 窗口获得焦点即为确认——用户已经看到了——而切换会话会重置而非携带锁存，因为关于你已离开的会话的 `✓` 只是噪声。

**空闲时恢复文档原本携带的图标。** 原始 href 在首次绘制时记录在 link 元素上，并从那里还原。看似直觉的 `link.href = '/favicon.svg'` 是对部署基路径的猜测：在任何非根基路径下，它都会把一个可用图标换成 404，同时还会悄悄覆盖宿主页面自己的品牌标识。

**外壳不发出声音。** 完成提示音是用户偏好，而外壳没有可用于开关它的配置接缝：它是由启动内核挂载的伪条目，而非由 cordis.yml 组装的一行，因此其上的 `Config` 字段无法从 bundle 修改。可选的 `ui-activity-monitor` 已经拥有持久化的音效偏好（默认关闭）、8-bit 合成器，以及每个会话恰好一处可以发声的挂载点——所以提示音归它，外壳只保留静默且始终安全的信号。

## Alternatives considered

**给 app-shell 增加一个用于提示音的 `Config` 字段。** 已否决：app-shell 条目由启动内核在无配置的情况下创建，该字段将是一个披着 schema 外衣的常量——正是规则所禁止的硬编码可调项。

**在外壳中保留 `ambient-sound` 模块，并用 `localStorage` 标志控制。** 已否决：它重复了活动监控插件的合成器与偏好，而一个没有任何界面能切换的标志算不上开关。其 `getAudioContext` 还会异步 resume 上下文，随后同步检查 `state !== 'running'`，因此每个页面的第一次提示音必然被丢弃。

## Consequences

`packages/client/web` 不再提供 `ambient-sound.ts`，也不再导出 `playAmbientSound`。未装配 `ui-activity-monitor` 的部署将只有视觉状态而没有声音。`updateFavicon` 现在会在首次绘制时给图标 link 打上 `data-dsh-original-href`。
