<!--
 * [INPUT]: 依赖现有通讯事实——ctx.project.emit 持久化事件账本 + project WS channel 游标投递（service/ws.go、
 *          eventbus.go）、iframe SDK 的 {id,type,input}→{id,result} 半 JSON-RPC 桥（ui/src/recut/sdk.ts）、
 *          api surface 操作经 POST /v1/projects/{id}/apps/{appID}/api/{name} 回流（service/server.go）、
 *          ctx.shell.start 异步进程 job + shell_jobs 平台表 + recut.job.status/wait/cancel 统一观察（service/shell_jobs.go、
 *          mcp.go unifiedJobStatus/Wait）、goja 每次调用全新 VM（F3，rfc/2026-08-14-editor-ai-agent-surface.md）、
 *          编辑器 iframe 常驻 renderer 任意时刻取帧能力 renderFrameDataUrl({time})（ui/src/core/managers/project-manager.ts）、
 *          recut.job.wait 同步长轮询曾触发 MCP EOF（rfc/2026-08-19-editor-component-create-resilience-and-compositing.md）、
 *          预览/导出一致性契约（rfc/2026-08-13-visual-runtime-component-system.md）。
 * [OUTPUT]: 平台通讯架构 RFC：把 WS/HTTP 桥/MCP/shell job/事件账本这五套方言收敛为一个统一 Op 总线契约——
 *           标准化信封（id/correlationId/from/to/version）、对称原语（on/call/publish/handle）、统一异步 Handle
 *           契约（async_ops，shell/media/deferred 三类统一由 recut.job.* 观察）、App→UI RPC（ctx.project.callUI +
 *           rpc.reply + iframe recut.on）。preview.frame 是首个验收消费者：Agent 调 preview.frame → jobId →
 *           recut.job.wait 直接拿 {imageUrl}。稳定契约单独落 docs/platform-comms-contract.md。
 * [POS]: rfc 的平台级通讯设计蓝图；获批后 service 与 web/iframe SDK 按契约实现，代码与文档反向更新保持一致。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

# RFC: 平台通讯架构——统一 Op 总线与异步 Handle 契约

- 状态：提议
- 作者：Recut
- 日期：2026-08-19
- 决策范围：平台通讯契约（消息信封、对称 op 原语、异步 Handle/async_ops、App→UI RPC、统一 job 观察）、preview.frame 作为首个消费场景、cover/export 的迁移路径；不含传输层重写与 goja 长驻 VM
- 关联：`rfc/2026-08-14-realtime-channel-ws.md`（单 WS 收敛与账本投递）、`rfc/2026-08-14-editor-ai-agent-surface.md`（F3 无状态 VM、preview.frame 原设计）、`rfc/2026-08-13-visual-runtime-component-system.md`（Preview==Export 确定性）、`rfc/2026-08-19-editor-component-create-resilience-and-compositing.md`（长轮询 EOF 教训、统一错误信封）、`docs/platform-comms-contract.md`（稳定契约，本 RFC 的实现蓝本）
- 实施进展：未实施

## 1. 摘要

Recut 同时存在五套"消息方言"，各自解决同一件事的片段：App→UI 单向 push（`ctx.project.emit` → 账本 → WS）、UI→App 单次调用（HTTP 桥 api op）、Agent→App 同步调用（MCP）、异步观察（shell/media job）、可审计（事件账本）。当一个 App 需要"发起一次 App→UI→App 的请求/响应"（典型如 AI 读取时间线某时刻的真实画面 preview.frame）时，没有任何一条通道提供**关联 + 完成 + 观察**的完整语义，于是每个 feature 都只能自造 requestId 表 + 轮询 op。这不是某个 feature 的问题，是平台通讯层缺了"一条持久 op 总线 + 统一异步 handle"这一段抽象。

本文档定义平台通讯契约：**一切跨端交互都是"带身份、可关联、可完成、可观察的消息"**，传输（WS / HTTP 桥 / MCP / 进程）只是这条总线的适配器。平台新增三层原语，不重写传输：

1. **统一消息信封** `BusMessage`：`{ id, op, kind, correlationId, from, to, payload, error?, version, ts }`，五套方言的负载统一走这一个信封。
2. **对称 op 原语**：`on(op, handler)` / `call(op, payload) → handle` / `publish(event, payload)` / `handle`（可等待、可观察、可取消）。App background、iframe UI、Agent 三者是同一模型的镜像。
3. **统一异步 Handle**：平台 `async_ops` 注册表承接三类完成来源——进程（shell job）、云（media job）、App/UI 回包（deferred）。`recut.job.status/wait/cancel` 统一观察三类，Agent 心智只有一套。

`preview.frame` 作为首个消费者验证整条链路：Agent 一次 `preview.frame` 调用返回 `jobId`，`recut.job.wait(jobId)` 直接拿到 `{ imageUrl, width, height }`——与媒体生成、shell job 的体验完全一致，无专用轮询 op、无专用请求表。

## 2. 现状：五套方言与真实缺口

| 通道 | 方向 | 承载 | 缺什么 |
|---|---|---|---|
| `ctx.project.emit` + 账本 + WS | App→UI | 事件（publish） | 无 id、无关联、单向 |
| HTTP 桥 `background.call`（api op） | UI→App | 单次调用 | 无 deferred、无关联 |
| MCP 工具调用 | Agent→App | 同步请求/响应 | 无法挂起等异步回包 |
| `ctx.shell.*` + `shell_jobs` | App→进程 | 异步 job | 只有进程类完成源 |
| 媒体平台 job | App→云 | 异步 job | 只有云类完成源 |

关键观察：**UI→App 的桥（`sdk.ts` 的 `{id, type, input} → {id, result}`）已经是半 JSON-RPC**；**账本 + 游标重放（`ws.go`）已经是一条 durable bus**。缺的不是传输，是"把消息当作一等公民"的抽象层：关联、对称、完成、超时、取消、统一观察。

当前 feature 被迫自造的形态（以 preview.frame 会怎样落地为例，若走"零平台改动"）：

```
editor_frame_requests 表 + preview.frame.result 轮询 op + presence 心跳表
```

这正是本 RFC 要消灭的：每次新 feature 发明一个新机制。设计原则是**通讯契约一次定义，feature 只消费**。

## 3. 设计原则

1. **不重写传输**：WS 单通道、HTTP 桥、MCP、shell 进程都是已建成且正确的适配器；契约在其上分层，不动传输协议。
2. **不引入长驻 VM**：goja 无状态（F3）是这个系统可重启、可审计的根基。关联与状态一律落 `async_ops`/账本，不靠进程内记忆。
3. **对称**：App 与 UI 是同一 op 模型的镜像；任何一端都能 on/call/publish。
4. **异步是默认形态**：任何可能不立即完成的 op 都返回 handle；完成/超时/取消内建于 handle，不做阻塞长等（吸取 MCP EOF 教训）。
5. **统一观察**：所有异步事情（进程、云、UI 回包）由同一套 `recut.job.*` 观察。
6. **可审计**：所有消息进持久账本；Handle 生命周期是账本的投影，无第二份状态。
7. **乐观并发内建**：信封携带 `version`，跨端因果不靠每表手缝 baseVersion。

## 4. 目标模型：统一 Op 总线

```text
任何一端（daemon / app background / iframe UI / agent）：
  on(op, handler)     注册处理       → 收到对该 op 的 call/publish
  call(op, payload)   请求-响应       → 返回 handle（future），带 correlationId
  publish(event, ..)  事件（持久化）  → 现有 ctx.project.emit / WS 事件语义
  handle.stream()     进度/日志       → 完成前可看中间态（可选阶段）
  handle.ready        完成/失败/超时/取消

信封统一：
  { id, op, kind: "call"|"reply"|"publish"|"stream",
    correlationId, from, to,
    payload, error?: {code,message,hint}, version, ts }

路由表 = 已注册的 op；寻址 = app://recut.editor/background 、app://recut.editor/ui 、agent://session-x …（对称）
```

- **App background**：`recut.operation.register` 已是 on；`ctx.project.emit` 已是 publish；新增 `ctx.project.callUI`（App→UI call）。
- **iframe UI**：`recut.on(op, handler)` 与 `recut.operation.register` 镜像；收到 call 后执行并回包（`rpc.reply`）。
- **Agent**：MCP 工具调用即 call；异步结果经 `recut.job.*` 观察 handle。

一次 preview.frame 在目标模型里：`agent call preview.frame → background callUI("frame.render") → UI 计算 → rpc.reply → handle.completed {imageUrl}`。没有专用请求表、没有专用轮询 op、没有 shell 协调器。

## 5. 平台新增层（三件套）

### 5.1 统一异步 Handle：`async_ops`

新增平台表（`workspace.sqlite`）：

```sql
create table if not exists async_ops (
  id            text not null primary key,
  scope_type    text not null,                 -- 'project' | 'appstate'
  project_id    text not null default '',
  app_id        text not null,
  kind          text not null,                 -- 'deferred' | 'shell' | 'media'（后两类为观察视图引用）
  op            text not null default '',      -- 语义名，如 frame.render
  method        text not null default '',      -- UI 方法名（deferred + callUI 用）
  complete_op   text not null default '',      -- 回包后由哪个 app op 收尾（如 frame.finalize）
  status        text not null default 'pending', -- pending|running|completed|failed|cancelled|timed_out
  payload_json  text not null default '{}',
  result_json   text not null default '',
  error_json    text not null default '',
  timeout_at    text not null default '',
  created_at    text not null,
  updated_at    text not null
);
create index if not exists idx_async_ops_scope on async_ops(project_id, app_id);
```

- **完成来源**三类：`shell`（复用 `shell_jobs` 记录，async_ops 只存观察视图）、`media`（复用媒体 job）、`deferred`（App 代码或 UI 回包完成，无进程）。
- **ctx 原语**（runtime 注入）：
  - `ctx.job.create({ method, payload, completeOp, timeoutMs })` → `{ id }`（deferred，pending）。
  - `ctx.job.complete(id, result)` / `ctx.job.fail(id, error)` / `ctx.job.status(id)`。
  - `ctx.project.callUI(method, payload, { timeoutMs?, completeOp? })` → `{ id }`：`job.create` + `ctx.project.emit("app.rpc.request", { id, method, payload })` 一步完成。
- **完成/超时/取消**：
  - 回包到达 → 平台按 `completeOp` 调 app op 收尾（有 ctx，可写文件/导入素材/整形结果），返回值为最终 result；无 completeOp 则原样存 raw result。
  - 超时：`timeout_at` 到未完成 → `timed_out`（终态），sweeper 清理过期行。
  - 取消：`recut.job.cancel` 对 deferred 标记 `cancelled` 并 emit `app.rpc.cancel {id}` 通知 UI 中止（可选）。
- **统一观察**：`recut.job.status/wait/cancel`（`mcp.go` `unifiedJobStatus/Wait`）在 shell/media 之外增加 async_ops 分支；`recut.job.logs` 对 deferred 返回空。

### 5.2 App→UI RPC：`callUI` + `rpc.reply`

**下行复用现有 emit 管线，零新传输**：`callUI` 只是 `job.create` + `ctx.project.emit("app.rpc.request", { id, method, payload })`。该事件经账本 + project WS channel 投递给 iframe（进程内写账本由 changeHub 即时唤醒，无 1s 额外延迟）。

**`rpc.reply` 是平台 op**（daemon 直接处理，不另起 app VM）：

```text
iframe recut.background.call("rpc.reply", { id, result })
  → 校验 async_ops 行属于该项目/App
  → 若 completeOp 非空：以 { id, result } 调 app op（InvokeAPI 机制，app 收尾写文件/导入/整形）
  → 标记 completed + result_json；或 failed + error_json
  → 广播 shell.job.completed 语义的账本事件（handle 生命周期可观察）
```

**iframe SDK 对称侧**（web/ui 新增，非 service）：

```ts
recut.on("frame.render", async (payload) => string | { ... }); // 返回结果或 Promise
// 内部：收到 app.rpc.request 事件 → 派发 handler → 结果经 rpc.reply 回包；handler 抛错 → rpc.reply error
```

### 5.3 统一 job 观察

`recut.job.status/wait/cancel` 统一三类：

| kind | 记录位置 | 完成信号 | 日志 |
|---|---|---|---|
| shell | `shell_jobs` | 进程退出 | JSONL 日志 |
| media | 媒体 job 表 | 云终态 | 无 |
| deferred | `async_ops` | `rpc.reply` / `ctx.job.complete` | 空（生命周期事件在账本） |

`recut.job.wait` 对 deferred 同样按 timeout 返回当前视图，Agent 可继续轮询——与现有 shell/media 契约完全一致。

## 6. 消费者 #1：preview.frame

### 6.1 操作契约

```ts
// mcp + api
recut.editor.preview.frame({
  timeSec: number,            // 必填，秒
  mode?: "auto" | "ui" | "headless",   // 缺省 auto
  width?: number,             // 可选；缺省项目画布宽
  height?: number,            // 可选
  pixelRatio?: number,        // 可选；缺省 1
  saveToLibrary?: boolean,    // 可选；默认 false（帧只写项目文件，不污染素材库）
})
→ { ok: true, jobId, requestId, mode }
```

Agent 流程：`preview.frame` → `recut.job.wait(jobId)` → 结果 `{ imageUrl, width, height, version, assetId? }`。

### 6.2 时序（UI 快路径，P1）

```text
[VM#1] preview.frame (mcp op)
  1. presence 判定：editor_frame_sessions 心跳新鲜(<30s) → mode=ui；否则 mode=auto → 返回 ok:false,
     reason:"editor-not-open"（P1）；mode=headless → P2 shell job
  2. callUI("frame.render", { timeSec, width, height, pixelRatio },
            { completeOp: "frame.finalize", timeoutMs: 15000 })
  3. 返回 { jobId, requestId }

[daemon] emit app.rpc.request { id, method:"frame.render", payload } → 账本 → WS

[iframe] recut.on("frame.render", ...)
  4. editor.project.renderFrameDataUrl({ time: timeSec })  → PNG data URL（复用常驻 renderer 隔离 pass）
  5. recut.background.call("rpc.reply", { id, result: { fileBase64, width, height } })

[VM#2] frame.finalize (app op, 平台按 completeOp 调用)
  6. ctx.files.writeBase64("frames/<id>.png", fileBase64)
  7. imageUrl = app 文件 CDN 地址（/v1/projects/{id}/apps/recut.editor/files/frames/<id>.png）
  8. saveToLibrary → ctx.media.importFile → assetId
  9. 返回 { imageUrl, width, height, version } → async_ops completed

[Agent] recut.job.wait(jobId) → { status:"completed", result:{ imageUrl, ... } }
```

### 6.3 presence（`mode:auto` 的决策依据）

iframe 挂载 hook 每 10s 心跳写 `editor_frame_sessions(project_id, last_seen_at)`。`preview.frame` 读最新心跳：<30s → UI 快路径；否则 P1 明确报错、P2 自动切 headless。心跳表同时是"编辑器是否在线"的平台级存活性事实，未来任何 feature 可直接复用。

### 6.4 结果交付

- 默认帧 PNG 写项目文件根 `frames/<id>.png`，返回 app 文件 CDN URL（`/v1/projects/{id}/apps/{appID}/files/...` 语义，`appFile` 路由已存在）。**基于地址对话，不用 base64 内联**（base64 进工具结果会击穿 token/上下文）。
- `saveToLibrary: true` 时同时 `ctx.media.importFile` 为 image Asset 返回 `assetId`（工作台素材卡片直接渲染）；默认不污染素材库。
- 确定性：同 doc + 同 t 两次渲染像素一致（Preview==Export），AI 多帧对比时以 settled 帧判定。

### 6.5 并发与一致性

- preview.frame 只读 committed doc（携带 version 渲染对应快照），多请求互不干扰，无需 aiLock。
- 帧请求是独立的 async_ops 行，天然并发安全；`rpc.reply` 校验 id 属于当前 project/app，防跨项目伪造。

### 6.6 P2：headless

无前端场景用 shell job 类：`preview.frame(mode:"headless")` 返回的 jobId 是真实 shell job——Playwright 无头 Chromium 加载 `frame-harness.html`，独立 bootstrap（project.load + media + fonts + components）后渲染，写 PNG，完成时走同一 `frame.finalize` 收尾。同一 `recut.job.*` 契约，Agent 无感。需 `preview.prepare` 安装渲染器依赖（对齐 audio-studio 模式），另立 RFC。

## 7. 迁移与一致性

- **cover/export 暂不迁移**：cover.update / export.complete 是 fire-and-forget（无需回包），保持现状。本契约只为"需要回包"的场景提供统一通道。
- **未来可迁**：UI 发起需后台回执的操作（如导出确认）、App→App 调用（`to` 寻址跨 App）、长任务进度流（`stream` kind）。迁移即把自造 requestId 表替换为 async_ops，观察层自动接入 `recut.job.*`。
- **一致性红线**：不改 WS 传输协议、不改账本结构、不引入长驻 VM、不新增专用轮询 op。所有新通信 feature 必须建在 §5 三层原语之上，否则拒绝合入（契约评审门）。

## 8. 平台依赖与边界

| 项 | 说明 |
|---|---|
| 新增表 | `async_ops`（workspace.sqlite）+ 迁移 |
| 新增 ctx | `ctx.job.*`、`ctx.project.callUI` |
| 新增平台 op | `rpc.reply`（daemon 直处理）、`rpc.cancel`（可选） |
| 修改 | `mcp.go` 统一 job 观察加 deferred 分支；`runtime.go` 注入 ctx.job/callUI |
| web/iframe | `sdk.ts` 增 `recut.on` + 自动 rpc.reply 管道；presence 心跳 hook |
| 不改 | WS 协议、HTTP 桥协议、MCP 协议、账本结构、shell/media job 表 |
| 不做 | 跨机分布式、CRDT 协作、长驻 VM、WebRTC 级低延迟（本地单机 ≤1s 账本投递足够） |

## 9. 分阶段实施

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P1** | `async_ops` 表 + `ctx.job.*` + `ctx.project.callUI` + `rpc.reply` 平台 op + `recut.job.*` deferred 观察；iframe `recut.on` + 自动回包；presence 心跳；`preview.frame`（UI 快路径）+ `frame.finalize`；manifest + SKILL/references 更新 | §10 L0–L3 |
| **P2** | headless shell 渲染器（`preview.prepare` + frame-harness）+ `preview.frame(mode:headless)`；`saveToLibrary` 全量 | E1 双路径一致性 |
| **P3** | 批量多帧 `preview.frames`（一次 callUI 多 t）；cover/export 可选迁入；app→app 寻址；stream 进度 | 一致性回归 |

## 10. 验证方案

### L0 · ctx.job 纯逻辑（node，`apps/editor/scripts/test-op-bus.js` 或 service 侧）
- create/complete/fail/timeout 状态机；timeoutAt 到期转 timed_out；取消转 cancelled。
- callUI 信封：id 唯一、payload 透传、completeOp 存储。

### L1 · service Go 集成（`service/` 新增 `op_bus_test.go`，复用 editor_agent_test 基建）
- `rpc round-trip`：真实 Host 上 preview.frame → WS 收到 `app.rpc.request` → 模拟 iframe 调 `rpc.reply` → async_ops completed → `recut.job.wait` 返回 result。
- `unified observation`：shell / deferred 两类 job 经 `recut.job.status/wait/cancel` 一致返回；deferred 无日志不报错。
- `scope validation`：跨项目/跨 App 的 rpc.reply 被拒。
- `timeout & cancel`：无回包 → timed_out；cancel → cancelled 且 emit app.rpc.cancel。

### L2 · Playwright（`apps/editor/ui/tests/e2e/preview-frame.spec.ts`）
- iframe 挂载后心跳写入；收到 `frame.render` → 渲染 → `rpc.reply` → job completed → imageUrl 可 GET 到 PNG。
- 确定性：同 t 两次渲染 PNG 字节 hash 一致。
- 渲染期间播放头/预览不被打断（复用隔离 pass 断言）。

### L3 · MCP 全流程用户旅程
```
preview.frame({timeSec:1.5}) → {jobId} → recut.job.wait(jobId) → {imageUrl,width,height}
→ GET imageUrl → PNG 有效；timeline.validate 零违反；AI 读图自检构图/文字/关键帧插值
```

### L4 · 回归
- `make check`（service-test + service-vet + web-build + editor-model-test）全绿；editor e2e 现有 suite 不回归（sdk.ts 变更兼容）。

## 11. 备选方案对比（为何不用更重/更绕的做法）

| 方案 | 结论 | 理由 |
|---|---|---|
| shell 协调器 job 等 iframe 回包 | **否决** | 为"等待"起一个无计算进程，且需 RECUT_API_BASE 注入；统一 handle 已覆盖其全部价值（jobId + 观察 + 取消） |
| MCP 调用内同步阻塞等回包 | **否决** | 违反异步默认原则，阻塞长轮询是 resilience RFC 点名的 MCP EOF 反模式 |
| 每 feature 自造 requestId 表 + 专用轮询 op | **否决** | 正是本 RFC 消灭的对象；通讯契约必须平台化 |
| 长驻 goja VM 支持事件 handler | **否决** | 破坏 F3 可重启/可审计根基；关联靠持久化层同样可达 |
| 为 reply 新增 WS 上行协议 | **暂缓** | 现有 HTTP 桥 `rpc.reply` 已够；若未来需要 UI 流式/低延迟再评估 |

## 12. 落地文件

- `service/`：`async_ops.go`（表 + 生命周期 + sweeper）、`runtime.go`（ctx.job / ctx.project.callUI / rpc.reply 注册）、`mcp.go`（unifiedJob* 加 deferred）、`op_bus_test.go`
- `web/`：iframe SDK `recut.on` + rpc.reply 自动管道（sdk.ts 同级）
- `apps/editor/manifest.json`：`preview.frame`(mcp+api)、`frame.finalize`(api，completeOp)
- `apps/editor/background/frame-render.js`：preview.frame / frame.finalize / presence 心跳读取
- `apps/editor/ui/src/recut/use-frame-render.ts`：心跳 + `recut.on("frame.render")` 实现
- `apps/editor/skills/recut-editor/references/preview-export.md` + `SKILL.md`：更新 preview.frame 契约
- `docs/platform-comms-contract.md`：稳定契约（§4–§5 的权威版本）
- `rfc/README.md`、`README.md`：索引与目录结构更新