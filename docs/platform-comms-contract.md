# Platform Communication Contract

> 平台通讯契约（稳定文档）。本文件是 App↔UI↔Agent 通讯的**权威规范**，实现与文档必须与其保持一致。
> 设计背景与决策记录见 `rfc/2026-08-19-platform-communication-op-bus.md`。
>
> 状态：Approved（已批准为契约，实现随 P1 推进）
> 版本：1.0

## 1. 目标与范围

Recut 的所有跨端交互统一为"**带身份、可关联、可完成、可观察的消息**"。本契约定义消息信封、对称 op 原语、统一异步 Handle（`async_ops`）与 App→UI RPC；传输层（WS / HTTP 桥 / MCP / 进程）是总线适配器，不属于本契约范围。

**必须遵守（契约评审门）**：任何新通信 feature 必须建在本契约原语之上，禁止自造 requestId 表、专用轮询 op、shell 协调器等旁路机制。

**不改变**：WS 单通道协议、HTTP 桥协议、MCP 协议、事件账本结构、goja 无状态 VM（F3）、shell/media job 表。

## 2. 参与方与寻址

| Address | 说明 |
|---|---|
| `daemon://media` | 平台媒体生成 job |
| `app://<appId>/background` | App 后台（goja VM，每次调用全新） |
| `app://<appId>/ui` | App 浏览器 UI（iframe） |
| `agent://<sessionId>` | Agent 会话（MCP） |

路由：按 `op` 名分发到已注册 handler；`to` 缺省时按 op 的注册方路由。

## 3. 消息信封

```ts
type BusMessage = {
  id: string;               // 唯一消息 id
  op: string;               // 路由名 / 语义名，如 "frame.render"
  kind: "call" | "reply" | "publish" | "stream";
  correlationId: string;    // 请求↔响应关联；publish 可为 ""
  from: string;             // Address，见 §2
  to?: string;              // 目标 Address；缺省按 op 路由表
  payload: unknown;
  error?: { code: string; message: string; hint?: string };  // 统一错误信封
  version?: number;         // 乐观并发 / 因果
  ts: string;               // ISO-8601
};
```

- `reply` 必须携带发起 `call` 的 `correlationId`。
- 错误一律走 `error` 信封（`code` 机器可读，`hint` 面向 Agent/用户），不作为传输错误抛出。

## 4. 对称 op 原语

| 原语 | App background | iframe UI | Agent |
|---|---|---|---|
| `on(op, handler)` | `recut.operation.register`（既有） | `recut.on(op, handler)` | — |
| `call(op, payload)` | `ctx.project.callUI(method, payload, opts)` | `recut.background.call(op, payload)`（既有） | MCP 工具调用 |
| `publish(event, payload)` | `ctx.project.emit(event, payload)`（既有） | `recut.events.subscribe`（既有，接收） | 经 job/账本事件 |
| `handle` | `ctx.job.*`（create/complete/fail/status） | 回包即完成 | `recut.job.status/wait/cancel` |

- `call` 返回 **handle**（见 §5），不阻塞。
- UI 侧 `recut.on` 与 App 侧 `recut.operation.register` 是同一模型的镜像：注册 handler → 收到 call → 执行 → 回包（`rpc.reply`）或抛错。

## 5. 统一异步 Handle：async_ops

平台表 `async_ops`（`workspace.sqlite`）是异步结果的统一注册表，三类完成来源共用同一观察契约：

| kind | 完成来源 | 记录位置 | 日志 |
|---|---|---|---|
| `shell` | 进程退出 | `shell_jobs`（async_ops 存观察视图） | JSONL 日志 |
| `media` | 云终态 | 媒体 job 表（async_ops 存观察视图） | 无 |
| `deferred` | `rpc.reply` / `ctx.job.complete` | `async_ops` 本体 | 无（生命周期事件在账本） |

### 状态机

```
pending → running → completed | failed | cancelled | timed_out
pending → timed_out（timeout_at 到期，sweeper 终态化）
pending/running → cancelled（recut.job.cancel）
```

终态一律带结构化 `result_json` 或 `error_json`（统一错误信封）。

### ctx 原语（App 侧）

```ts
ctx.job.create({ method, payload, completeOp?, timeoutMs? })        // → { id }（deferred, pending）
ctx.job.complete(id, result)                                        // 标记 completed
ctx.job.fail(id, error)                                             // 标记 failed
ctx.job.status(id)                                                  // → handle 视图
ctx.project.callUI(method, payload, { timeoutMs?, completeOp? })    // → { id }
```

`ctx.project.callUI` 等价于 `ctx.job.create(...)` + `ctx.project.emit("app.rpc.request", { id, method, payload })`。

### 回包处理

```text
rpc.reply { id, result }           // 平台 op，daemon 直接处理
  → 校验 id 属于当前 project/app（防跨项目伪造）
  → completeOp 非空：以 { id, result } 调 app op 收尾（有 ctx：写文件 / 导入素材 / 整形结果），
    其返回值 = 最终 result
  → async_ops → completed（result_json）或 failed（error_json）
  → 账本事件记录 handle 生命周期
```

### 统一观察（Agent 侧）

`recut.job.status` / `recut.job.wait` / `recut.job.cancel` 统一读 `shell` / `media` / `deferred` 三类。`recut.job.wait` 对 deferred 同样按 timeout 返回当前视图，Agent 可继续轮询。

## 6. App→UI RPC 时序（规范）

```text
[App background]  ctx.project.callUI("frame.render", payload, { completeOp: "frame.finalize" })
                  → async_ops 行(pending) + emit "app.rpc.request" { id, method, payload }
[daemon]          事件入账本 → project WS channel 投递 iframe
[iframe]          recut.on("frame.render", handler) 命中
                  → handler 执行（可返回 Promise）
                  → recut.background.call("rpc.reply", { id, result })   // 成功
                  或 recut.background.call("rpc.reply", { id, error })   // 失败
[daemon]          rpc.reply 校验 → 调 completeOp 收尾 → async_ops completed/failed
[Agent]           recut.job.wait(id) → { status, result? | error? }
```

超时：`timeoutMs` 内无回包 → `timed_out`（终态）。取消：`recut.job.cancel` → `cancelled` 并 emit `app.rpc.cancel {id}` 通知 UI（可选中止）。

## 7. iframe SDK 对称侧

```ts
// 注册 UI 侧 handler（与 recut.operation.register 镜像）
recut.on(method: string, handler: (payload) => unknown | Promise<unknown>): () => void;

// 内部行为
// 1. 订阅 recut.events 收到 { type: "app.rpc.request", id, method, payload }
// 2. 按 method 派发 handler
// 3. 结果 → recut.background.call("rpc.reply", { id, result })
//    handler 抛错 → recut.background.call("rpc.reply", { id, error: { code, message, hint } })
// 4. 收到 { type: "app.rpc.cancel", id } → 若 handler 返回了取消信号则中止（可选）
```

## 8. 存活性（Presence）

- iframe 挂载后每 10s 心跳写入 `editor_frame_sessions(project_id, last_seen_at)`（App 表，`recut.editor` 持有）。
- 任何需要"前端是否在线"决策的 feature 读取该表：`last_seen_at` 距今 < 30s 视为在线。
- 契约只规定语义，不规定表归属；各 App 可在自己的 scope 实现等价心跳。

## 9. 示例：preview.frame（首个消费者）

```text
preview.frame({ timeSec: 1.5 })                 // mcp op
  → presence 在线 → callUI("frame.render", { timeSec })
  → { jobId, requestId }

recut.job.wait(jobId)
  → { status: "completed",
      result: { imageUrl, width, height, version, assetId? } }
```

- `imageUrl`：app 文件 CDN 地址（`/v1/projects/{id}/apps/{appID}/files/frames/<id>.png`），**基于地址交付，不用 base64 内联**。
- 默认帧只写项目文件，不污染素材库；`saveToLibrary: true` 时另导入为 image Asset 返回 `assetId`。
- 确定性：同 doc + 同 t 渲染像素一致（Preview==Export）。

## 10. 平台依赖与边界

| 项 | 现状/要求 |
|---|---|
| `async_ops` 表 | 平台新增（workspace.sqlite） |
| `ctx.job.*` / `ctx.project.callUI` | runtime 注入 |
| `rpc.reply` / `rpc.cancel` | 平台 op（daemon 直处理） |
| `recut.job.*` deferred 分支 | mcp.go unifiedJob* 扩展 |
| 传输层 | 不改（WS / HTTP 桥 / MCP 复用） |
| VM 模型 | 保持无状态（F3） |
| 范围 | 本地单机；不做跨机、不做 CRDT、不做 WebRTC 级低延迟 |

## 11. 迁移指引

已有自造 requestId 表 / 专用轮询 op 的 feature（未来需要回包时）迁入本契约：

1. 请求发起改为 `ctx.project.callUI(method, payload, { completeOp })`，删除专用请求表。
2. UI 侧改 `recut.on(method, handler)`，删除专用回传 op 的自造关联。
3. Agent 侧改用 `recut.job.wait(jobId)`，删除专用轮询 op。
4. 收尾逻辑放 `completeOp` app op（保留 ctx 能力：写文件 / 导入 / 整形结果）。

## 12. 契约变更流程

本文件是权威规范。任何契约变更必须先出 RFC 并获批，然后更新本文件版本号，再反向更新 `service` / `web` / `apps` 实现与该处引用。

[PROTOCOL]: 变更时更新本头部版本，然后检查 rfc/ 与各实现引用。