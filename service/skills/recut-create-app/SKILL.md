---
name: recut-create-app
appId: recut.platform
description: Recut 全局「创建 App」工作流：从零打造一个标准 Recut App（manifest + background 业务 + 可选 iframe UI + 平台通讯契约），可安装、可测试、可随 Git 分发。结合平台通讯契约（统一 Op 总线 + 异步 Handle + App→UI RPC）与 docs/platform-comms-contract.md、rfc/ 里的权威定义。
---

# Recut App 创作指南（recut-create-app）

本 Skill 是 Recut 平台的**全局 App 创作参考**：指导 Agent 从零创建一个标准 Recut App，并把它接入平台通讯契约（统一 Op 总线、统一异步 Handle、App→UI RPC）。它不绑定任何具体 App，也不做业务领域适配——它就是「App 长什么样、怎么建、怎么连平台」这件事本身。

## App 是什么

Recut 是类似 Chrome 的本地 App Host。**App 用 JavaScript 定义 UI 与业务**，平台提供隔离存储、文件、任务、素材、Artifact 和 MCP capability。一个 App 是：

```text
<appRoot>/
├── manifest.json        # 唯一契约：身份、入口、permissions、operations、background
├── background.js        # App 业务入口（goja 沙箱，每次调用全新 VM）
├── background/*.js      # 可选 backgroundModules（按 manifest.backgroundModules 顺序加载）
├── skills/<skillId>/    # 可选：App 自己的 Agent Skill（SKILL.md + references/）
└── ui/                  # 可选：iframe UI（manifest.ui.projectView 指向 dist 入口）
```

**App 数据模型属于 App 的 JavaScript**。平台不解析业务数据、不规定表结构或工作流步骤。App 只通过 manifest 明示的 capability API 与平台交互，平台表一律不进 `ctx.sqlite` / `ctx.appState`。

## 何时用本 Skill

- 用户要求「新建一个 Recut App」「做一个 App 处理 X」。
- 已有 App 需要新增 operation、接入 App→UI RPC 或统一异步 Handle。
- 需要验证一个 App 能被 `recut.apps.install` 从 Git 安装、`recut.apps.list` 正常识别。

若任务是**修改或调试某 App 的既有工作流**，读该 App 自己的 Skill（`recut.skills.read`）而非本 Skill；本 Skill 只提供跨 App 的平台骨架与通讯契约。

## 硬性约束（违反会被平台拒绝）

1. **manifest 是唯一契约**：`id` 全局唯一、`type` 是 `project`（绑用户项目）或 `standalone`（绑 App 专属工作区）。`type: project` 显示在项目桌面；`standalone` 不要求项目命名。
2. **App 之间绝不读取彼此数据库/文件目录**：协作只走公开 API 与不可变 Artifact 引用。
3. **JS 无宿主权限**：只能调用 manifest 声明的 `recut` API；平台表绝不进入 `ctx.sqlite`。
4. **异步是默认形态**：可能不立即完成的 op 必须返回统一 Handle（jobId），由 `recut.job.*` 观察；禁止在 MCP 调用内阻塞长等，禁止自造 requestId 表 + 专用轮询 op。
5. **App→UI 回包走 `rpc.reply`**：不要在 UI 侧发明第二套回传机制。

## 平台通讯契约（所有 App 必须遵守）

跨端一切交互都是「带身份、可关联、可完成、可观察的消息」，收敛为一套原语。权威定义见 `docs/platform-comms-contract.md`；设计背景见 `rfc/2026-08-19-platform-communication-op-bus.md`。

### 统一消息信封

```ts
{ id, op, kind: "call"|"reply"|"publish"|"stream",
  correlationId, from, to, payload,
  error?: { code, message, hint? }, version?, ts }
```

- `reply` 必须带发起 `call` 的 `correlationId`。
- 错误一律走 `error` 信封（`code` 机器可读，`hint` 面向 Agent/用户），不当作传输错误抛出。

### 对称 op 原语

| 原语 | App background | iframe UI | Agent |
|---|---|---|---|
| `on(op, handler)` | `recut.operation.register` | `recut.on(op, handler)` | — |
| `call(op, payload)` | `ctx.project.callUI(method, payload, opts)` | `recut.background.call(op, payload)` | MCP 工具调用 |
| `publish(event, payload)` | `ctx.project.emit(event, payload)` | `recut.events.subscribe` | 经 job/账本事件 |
| `handle` | `ctx.job.*` | 回包即完成 | `recut.job.status/wait/cancel` |

### 统一异步 Handle（async_ops）

`ctx.project.callUI` / `ctx.job.create` 注册一个 deferred Handle，返回 `{ id }`（= jobId）。平台表 `async_ops` 承接三类完成来源（`shell` / `media` / `deferred`），`recut.job.*` 统一观察。状态机：`pending → running → completed | failed | cancelled | timed_out`。

```js
// App 发起一次 App→UI 请求并等 UI 回包
const job = ctx.project.callUI("frame.render", { timeSec }, {
  completeOp: "frame.finalize",   // UI 回包后平台按此 op 收尾（写文件/导入/整形结果）
  timeoutMs: 15000,
});
return { ok: true, jobId: job.id };  // Agent 用 recut.job.wait(jobId) 观察终态
```

UI 侧用 `recut.on(method, handler)` 处理并自动 `rpc.reply` 回包（成功带 `result`，抛错带统一错误信封）；平台按 `completeOp` 调 App op 收尾，其返回值即最终 result。

## manifest.json 字段速查

```jsonc
{
  "manifestVersion": 1,
  "id": "my.app.id",            // 全局唯一，反向域名风格
  "name": "App 显示名",
  "author": "你",
  "description": "一句话说明",
  "version": "0.1.0",
  "type": "project",            // 或 "standalone"
  "background": "background.js",
  "backgroundModules": ["background/module-a.js"],  // 可选，顺序加载
  "permissions": ["sqlite", "files", "media.read", "http"],  // 只声明需要的
  "operations": [ { "name": "...", "surfaces": ["mcp","api"], "description": "...", "inputSchema": {...} } ],
  "ui": { "projectView": "ui/dist/index.html" },     // 可选 iframe UI
  "distribution": { "builtin": { "include": ["."], "exclude": [".git","node_modules"] } },
  "onboarding": [ { "id":"...", "title":"...", "description":"...", "prompt":"..." } ]
}
```

- **permissions**：`sqlite`（`ctx.sqlite` + `ctx.appState`）、`files`（`ctx.files` + `ctx.appFiles` + `ctx.app.readText`）、`media.read/write`、`shell`（`ctx.shell.run/start/status/logs/cancel`）、`http`（`ctx.http.get`）、`artifacts.publish`、`python`。**只声明真正需要的**；`ctx.job.*` / `ctx.project.callUI` / `rpc.reply` 是平台原语，不占 permission。
- **operations 的 `surfaces`**：`mcp` 供 Agent 调用、`api` 供 UI 经 `recut.background.call` 调用、两者兼有则同一契约。业务 op 一律在 manifest 声明；平台 op（`rpc.reply` / `rpc.cancel`）不需声明。
- **onboarding** 的每张卡必须显式 `id`/`title`/`prompt`。

## background.js 骨架

```js
/* 每个 op 经 recut.operation.register(name, (input, ctx) => ...) 注册 */
recut.operation.register("hello", (input, ctx) => {
  const who = (input && input.name) || "world";
  return { ok: true, greeting: "hello " + who, projectId: scope(ctx) };
});

// 需要用户项目上下文的 op 用 ctx.project.*：
recut.operation.register("timeline.assets", (input, ctx) => {
  const scopeId = scope(ctx);
  ctx.project.emit("my.event", { at: nowIso() });  // 落事件账本，iframe 经 recut.events.subscribe 接收
  return { ok: true };
});

// 统一异步 Handle + App→UI RPC（见上）：
recut.operation.register("preview.frame", (input, ctx) => {
  // ...presence 门 + callUI + 返回 jobId
});
```

**ctx 能力（注入的沙箱对象）**：`ctx.project.emit/callUI`、`ctx.sqlite.execute/query`、`ctx.files.readText/writeText/writeBase64/list/url`、`ctx.appFiles.*`、`ctx.app.readText`、`ctx.job.create/complete/fail/status`、`ctx.media.*`、`ctx.shell.*`、`ctx.http.get`、`ctx.locale`。`ctx.project` 在非 Project target 下为 `null`。

## iframe UI 接线

- UI 与宿主握手经 `recut.ui.ready` / `recut.ui.connect`（MessageChannel）；调用 App op 用 `recut.background.call(name, input)`。
- 接收 App 广播事件：`recut.events.subscribe(listener)`。
- 响应 App→UI RPC：`recut.on(method, handler)` —— 收到 `app.rpc.request { id, method, payload }` 时按 method 派发，自动 `rpc.reply` 回包。
- 业务文件用原生 Read/Edit/Glob 处理，不为普通文件 I/O 造专用 MCP 工具。

## 自带 Skill（可选但推荐）

```text
skills/<skillId>/SKILL.md     # 你 App 的 Agent 工作流
skills/<skillId>/references/  # 子文档（操作契约、决策门）
```

平台 Skill 有权威性：Agent 会读它来决定怎么用你的 App。把它写清楚：op 契约、输入输出、验证纪律（mutation 成功 ≠ 视觉证明）、异步 job 的观察方式。

## 验证清单

1. `manifest.json` 合法（JSON 可解析、`id` 唯一、字段齐全）。
2. `background.js` 及 backgroundModules 能无报错加载（`go build` / 测试路径）。
3. 每个声明为 `mcp` 的 op 有 `recut.operation.register` 处理器；`api` op 可供 `recut.background.call` 调通。
4. 需要异步的 op 返回统一 Handle，Agent 用 `recut.job.wait` 观察，无自造轮询。
5. App 数据只进自己的 `ctx.sqlite` / 文件根，不碰平台表与他人 App 数据。
6. 有 `skills/` 时，SKILL.md 描述与 manifest operations 一致。

## 放置与分发

- 本地开发：放在仓库 `apps/<app-name>/`，用 `make app-link APP=apps/<app-name>` 链接到运行时 `~/.recut/apps/`。
- 安装分发：把 App 做成标准 Git 仓库（根含 `manifest.json`），用户经 `recut.apps.install` 从 GitHub 安装；service 只在 clone 后验证标准 `manifest.json` 才激活。
- 升级：App 目录 `git pull --ff-only`，拒绝覆盖本地修改。

## 参考

- `docs/platform-comms-contract.md` — 平台通讯契约（权威，本 Skill 的契约依据）
- `rfc/2026-08-19-platform-communication-op-bus.md` — 统一 Op 总线设计背景与 preview.frame 首个消费者
- `rfc/2026-08-19-platform-communication-op-bus.md` §8–§10 — 落地文件与验证
- 官方 App 范例：`apps/editor/`（剪辑器，含 backgroundModules + iframe + skills）、`apps/remotion-studio/`

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
