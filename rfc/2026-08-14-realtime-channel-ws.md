<!--
 * [INPUT]: 依赖现有 service Store 的三个 changeHub（projectEvents/agentEvents/mediaEvents）、Catalog.installationEvents、media_asset_events/events 持久化账本、stream 端口 :17374，以及 web 端 6 处 EventSource/WebSocket 与 iframe App 的直连
 * [OUTPUT]: 定义平台实时通道的单 WS 收敛设计：一条长连接 + channels 订阅 + 心跳保活 + REST 首屏取数 + 单后台账本转发，以及 iframe App 的宿主桥/直连 WS 双链路传输抽象
 * [POS]: rfc 的实施蓝图；获批后作为 Go service、web 宿主页、iframe App、测试的共同落地契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# Technical RFC: Single Global WebSocket Realtime Channel

- 状态：实施中（Phase 1-2 已完成：media/project/app/agent/cli/terminal 全部收敛到单 WS，宿主 web 零 EventSource；Phase 3 iframe 传输抽象待办）
- 依赖：现有 `notifier.go` changeHub、`/v1/events`（ws.go）、`media_asset_events` / `events` 账本、`stream-address :17374`、iframe `recut-sdk` 桥
- 日期：2026-08-14
- 目标版本：Phase 1（media+project+app）→ Phase 2（agent/cli/terminal）→ Phase 3（iframe App 双链路）

## 1. 范围与不变量

1. 浏览器侧每个页面/tab **一条** WS 长连接；页面内所有组件经一个共享单例订阅。跨 tab 仍各一条（浏览器无法跨 tab 共享连接）。
2. **首屏/全量数据走 REST**，长连接只承载增量事件；不再有 snapshot-over-SSE。
3. 事件写入链路不变：`AppendEvent` / `recordAssetEvent` / agent 事件 / catalog 变更仍落 durable 账本；服务端把变更转成 channel 事件推送。
4. 断线重连后：重连 WS → 重订阅 → 对需要快照的 channel 用 REST 补一次快照。不使用事件游标续传。
5. iframe App 通过传输层抽象接入：嵌入宿主运行时走宿主桥；无宿主独立运行时走直连 WS（`/v1/events`）。
6. 旧 SSE 端点（`/v1/media/events`、`/v1/apps/events`、`/v1/agent-sessions/{id}/events`、`/v1/terminals/{id}/events`、`/v1/agent-sessions/{id}/cli-stream`）在迁移期保留、逐步废弃；`/v1/events` WS 协议向后兼容项目事件。

## 2. 现状与问题

- 服务端暴露 6 个长连接端点；其中 project(WS)/media(SSE)/agent(SSE) 3 条各自用 1s ticker 直接查 DB（`changeHubPollInterval`）。
- 宿主页常驻 3 条（app SSE + media SSE + agent SSE），项目页再加 1 条 project WS，共 4 条；iframe App（ai-short-film/cover-studio）各再开 1 条 media SSE。
- 同样数据被多处重复推送；每连接每秒轮询 DB，连接越多开销越大。
- 首屏数据绑在长连接 snapshot 里，出现"正在读取资源…"卡死（已加 REST 兜底缓解，但设计仍是混合）。

## 3. 目标架构

```text
浏览器(每页一条 WS)
   │  订阅 channels：project/media/agent/cli/terminal/app
   ▼
/v1/events (WS, :17374)   EventBus (进程内扇出)
   │       ▲                     │
   │       │  Publish(channel,msg)│
   ▼       │                     ▼
[background ledger forwarders]   [write 路径]
 media_asset_events ──────────── recordAssetEvent
 events(project) ─────────────── Store.AppendEvent
 agent_events ────────────────── agent 写入
 catalog.installationEvents ──── App 安装变更
 terminal/cli ────────────────── 终端/CLI channel
        └ 1s ticker 仅作跨进程(MCP)兜底，进程内写入由 changeHub 即时唤醒
```

关键决策：

- **EventBus hub**：持有已连接 WS 客户端（含订阅的 channel 集合），`Publish(channel, payload)` 扇出给匹配客户端。
- **后台 ledger forwarder（每账本一个 goroutine）**：`changeHub.wait()` 即时唤醒 + 1s ticker 兜底，读取 `id > last` 新行并 `Publish`。DB 轮询从"每连接每秒"降为"每账本每秒一次"，与客户端数量解耦。
- **REST 首屏**：`GET /v1/media/assets`（media）、`GET /v1/projects/{id}/events`（project）、既有 session 读取接口（agent）；订阅时不再带 snapshot。

## 4. WS 协议契约（`/v1/events`）

**升级后首帧**（客户端→服务端）：
```json
{ "type": "subscribe",
  "channels": [
    { "channel": "project", "projectId": "p1" },
    { "channel": "media" },
    { "channel": "agent", "sessionId": "s1" },
    { "channel": "cli", "sessionId": "s1" },
    { "channel": "terminal", "sessionId": "t1" },
    { "channel": "app" }
  ] }
```

**服务端确认**：
```json
{ "type": "subscribed", "channels": ["project", "media", "app"] }
```

**推送帧**（统一信封，channel 分流）：
```json
{ "type": "event", "channel": "media",
  "data": { "event": "asset.updated", "asset": { "id": "…", "kind": "image", "status": "completed", … } } }
```
project 帧沿用现有 `{ "type": "project.event", "projectId": "…", "event": … }` 以兼容 iframe 宿主桥；agent/terminal/cli 帧保留各自现有负载结构，仅套上 `channel` 信封。

**心跳**：
- 服务端每 30s `{"type":"ping","t":<unix>}`；客户端回 `{"type":"pong","t":…}`。
- 客户端侧 watchdog：30s 内未收到服务端 ping/pong 则视为死链，主动 close → 指数退避重连（1s→2s→4s…上限 30s）→ 重订阅 → 按 channel 补 REST 快照。
- 服务端 `SetPingHandler/SetPongHandler` + 读超时，N 次无 pong 则关闭该连接并清理 hub。

**订阅变更**（客户端可增量更新）：
```json
{ "type": "subscribe", "channels": [{ "channel": "cli", "sessionId": "s2" }] }
{ "type": "unsubscribe", "channels": [{ "channel": "cli", "sessionId": "s2" }] }
```

## 5. 服务端实现（Go）

- 新增 `eventbus.go`：`EventBus`（`Subscribe/Unsubscribe/Publish`，按 channel→client 集合索引），线程安全。
- 重构 `ws.go`：`projectEventsWS` 泛化为 `realtimeWS`——读取 subscribe 帧、维护 channel 订阅、收心跳、经 EventBus 收推送、写帧。旧 `project.event` 语义保留。
- 新增 `forwarders.go`：media/agent/project 三个后台转发器，读取各自账本新行并 `bus.Publish`；用 `changeHub.wait()` + 1s ticker 兜底。
- 接线写路径：`publishAssetChange()`、`AppendEvent`、agent notify、catalog 变更 追加 `bus.Publish`（进程内即时，无需等 ticker）。
- terminal/cli：由 `Subscribe(id)` 的 channel 直接桥到 EventBus（`terminal`/`cli` channel），保留各自 Subscribe/历史回放语义。
- 路由：`/v1/events` 仍指向泛化后的 WS；旧 SSE 端点保留（转发到同一 EventBus 或维持原实现直到废弃）。

## 6. 前端实现（web）

- 新增 `lib/realtime-channel.ts`（模块级单例）：
  - 模块级单例 WS（`/v1/events`，经 `streamServiceEndpoint`），自动重连+退避+心跳。
  - `useRealtimeChannel()` hook：返回 `subscribe(channel, handler)/unsubscribe`，页面卸载时自动退订。
  - `ready` 状态 + 断线重连后的 REST 快照补拉回调（由消费方注册）。
- 消费方迁移：
  - `use-media-asset-events.tsx`：删除 `EventSource`，改订阅 `media` channel；初始 `ready` 由 `GET /v1/media/assets` 置位；`asset.updated` 增量经 channel。原 REST 兜底随之取消（初始即 REST）。
  - `use-app-installation-events.tsx`：订阅 `app` channel。
  - `project-detail-client.tsx` / `standalone-app-client.tsx`：`/v1/events` WS 改为接入共享单例（订阅 `project` channel，把事件转发给 iframe 桥不变）。
  - `project-agent-panel.tsx`：agent session events 与 cli-stream 改订阅 `agent`/`cli` channel。
  - `terminal-panel.tsx`：订阅 `terminal` channel。

## 7. iframe App 传输抽象（Phase 3）

```text
RealtimeChannel（接口，iframe 内统一消费）
  subscribe(channel, handler)
  unsubscribe(...)
  requestSnapshot(channel)     // REST 或桥查询
  onTransportChange(cb)        // 断线/恢复信号（直连模式用）

实现一：HostBridgeChannel   —— 走已有 MessageChannel，宿主转发事件
实现二：DirectWSChannel     —— 直连 /v1/events，心跳+重连+退避

选择逻辑（运行时探测）：
  收到 recut-sdk-ready（宿主桥就绪）→ HostBridgeChannel
  超时未收到桥（独立 tab 直接打开 UI）→ DirectWSChannel
```

宿主桥路径：
- 宿主新增桥指令：`media.list` → 返回宿主缓存资产（快照）；`media.subscribe` → 注册 iframe，宿主收到 `media` channel 事件后 `postToFrame` 推 `recut.media.event`（复用 `recut.project.event` 推送先例）。
- App：`use-media-asset-events` 的 EventSource 换成"桥订阅 + `media.list` 快照"，无重连/心跳代码。

直连路径：
- App：inline ~120 行 WS 客户端（连 `/v1/events` → subscribe media → REST 首屏 → 心跳/重连）。宿主零改动。

选择原则：嵌入宿主运行 → 宿主桥（每页严格 1 条 WS）；无宿主独立运行 → 直连 WS（App 自治）。

## 8. 兼容与废弃

- 迁移期：新旧端点并存；宿主页优先用新 WS，若 `upgrade` 失败回退旧 SSE（兜底）。
- 废弃顺序：先关宿主页的旧 SSE 消费 → 再关 iframe App 的旧 SSE → 最后移除服务端旧端点与每连接 1s 轮询。
- `rfc/README.md` 与 `ARCHITECTURE.md`、各文件头部 [INPUT]/[OUTPUT] 需随实现反向更新。

## 9. 分阶段实施

- **Phase 1（media + project + app）**：服务端 EventBus + forwarders + `/v1/events` 泛化；web 端 media/app/project 三个消费方切到共享单例；`use-media-asset-events` 改 REST 首屏。可独立验收（素材库/选择器/项目事件不再多连接）。
- **Phase 2（agent/cli/terminal）**：agent、cli、terminal 收编进 channels；宿主 web 全部消费方切到单 WS，页面 EventSource 归零。旧 SSE 端点保留供 iframe App（ai-short-film/cover-studio 的 media）与 remotion-studio（terminal）使用，标记为 legacy。
- **Phase 3（iframe 传输抽象）**：`RealtimeChannel` 接口 + 宿主桥转发 + 直连 WS 客户端；ai-short-film/cover-studio 迁移；移除旧 SSE 路由与每连接 1s 轮询（若 forwarders 已覆盖）。

## 10. 测试与验证

- Go：`EventBus` 并发扇出、订阅/退订、心跳超时断开、重连重订阅、forwarder 账本增量、跨进程（MCP）写入经 1s ticker 兜底送达。
- web（Playwright）：素材库页/选择器/项目页各只开 1 条 WS（Network 断言无 EventSource 且 `ws` 连接数=1）；断线重连后 `ready` 恢复且数据不丢；心跳无死链。
- 回归：编辑器从 Recut assets 导入、Agent 对话事件、终端输出、App 安装刷新、ai-short-film/cover-studio 素材展示。

## 11. 风险与取舍

- **跨进程 MCP 写入**：仍依赖 1s ticker 兜底，无法做到真实时；可后续把 MCP 写入改为经 daemon 的带内通道。
- **每条 WS 一个后台 forwarder**：客户端数量不再是 DB 压力来源；但 forwarder 需处理账本行积压与节流。
- **tab 数**：每 tab 一条 WS，行为与现状一致；不引入 SharedWorker（可选优化，不入本期）。
- **心跳开销**：30s ping 极小；断链探测延迟可接受。
- **双链路**：宿主桥是主路径；直连 WS 仅兜底无宿主场景。两个实现共享 `RealtimeChannel` 接口，测试面翻倍但收敛在一个接口后可控。
