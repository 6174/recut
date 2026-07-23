# Recut - Local-first AI video studio

`recut.video` 是面向视频创作工作流的本地优先平台：Web 负责把复杂生成流程变成傻瓜式应用，本地 CLI 负责数据、素材和 Agent 执行。它不再运营一个昂贵且落后的云端 Agent，而是让用户已有的 Codex、Claude Code、Kimi CLI 等本地 Agent 完成创作。

技术栈：Next.js + React 工作台，Go 本地守护进程，文件系统项目库 + append-only 事件日志，MCP/HTTP Agent 接口。SQLite 可在需要高性能索引时作为可重建索引层接入，不作为项目唯一真相。第一阶段没有云端服务、账号或认证依赖；工作台作为静态资源随 Daemon 分发并由本机提供。

## 当前骨架

```text
service/                   完整本地 shell service：Go module、Daemon、项目存储、App 注册表与 loopback API
apps/starter/              无业务语义的声明式 App 格式样例
web/                       独立 Next.js 本地工作台，仅经 HTTP 调用 Daemon
.gitignore                 排除本地构建产物与操作系统元数据
Makefile                   根级开发、构建与验证命令入口
```

运行 `cd service && go run .` 启动本机服务。当前 API 包括 `GET /health`、`GET /v1/apps`、项目 CRUD、`GET /v1/agents`（探测 Codex / Claude Code），以及通用终端会话的创建、输入、输出流、尺寸调整和终止；例如以 `recut.starter` 创建项目：`curl -X POST http://127.0.0.1:17373/v1/projects -H 'Content-Type: application/json' -d '{"name":"My project","appId":"recut.starter"}'`。

开发时使用 `make help` 查看命令；`make dev` 同时启动本地 service 和 Web 工作台，`make service-dev` 会自动停止占用 17373 的旧 Recut Daemon（拒绝停止其他程序），`make check` 执行完整验证。

## 产品原则

1. **Agent 可替换，项目不可丢失。** Recut 只定义任务、工具和产物契约；具体由哪个本地 Agent 执行是用户选择。
2. **本地是唯一事实来源。** 项目、素材、时间线、提示词、会话记录和中间产物默认存于用户机器；云端不保存创作内容。
3. **App 是工作流产品，不是 Prompt 模板。** 每个 App 把高频创作路径压缩为表单、预览、可编辑时间线和明确的交付物。
4. **一切可恢复。** 每次 Agent 写入都经过事务、快照和可重放事件；损坏时从最近一致状态恢复，而不是猜测文件内容。
5. **UI 与对话并存，但职责不同。** UI 收集确定输入、展示状态与提供可逆编辑；终端式对话处理开放创意、例外和迭代。

## 用户与产品模型

用户进入 `recut.video`，选择一个 App，创建本地项目，然后沿着该 App 的工作流完成生产。每个 App 共享平台能力，却拥有自己的输入 schema、生成步骤、编辑器与导出规则。

首批 App 应聚焦三条需求最确定的路径：

- **Vox Explainer**：主题或文稿 -> 论点结构 -> 旁白 -> 分镜 -> 图表/B-roll -> 成片。
- **漫剧**：剧本 -> 人物与画风设定 -> 分镜 -> 镜头生成 -> 配音/字幕/BGM -> 连续剧集。
- **口播精剪**：导入素材 -> 转写 -> 去停顿/口癖/废句 -> 自动粗剪 -> 字幕与包装 -> 成片。

不要先做“万能视频 App”。三个 App 的共同点应下沉为平台能力；特有的创作判断留在各自工作流中。

## 系统地图

```text
Browser: local Recut workspace
  │ loopback HTTP / local session token
  ▼
Web Workspace (Next.js)
  ├─ Left workspace: project list and project detail
  ├─ Right workspace: Daemon guidance, CLI detection and terminal sessions
  ├─ Workflow UI / timeline / asset browser
  └─ Local connection status and task progress
  │ localhost HTTP or WebSocket, capability-scoped token
  ▼
Recut Daemon (single local binary)
  ├─ Project service: manifests, assets, snapshots, repair
  ├─ Job service: durable task queue and event stream
  ├─ Terminal gateway: 通用 PTY 包装层，承载 Codex / Claude Code / Kimi CLI
  ├─ Tool host: media, timeline, render, ASR, filesystem
  ├─ Local API: browser-facing HTTP/WebSocket server
  └─ Runtime manager: model binaries and optional workers
  │
  ├─ ~/.recutvideo/projects/<project-id>/      immutable project data
  ├─ ~/.recutvideo/cache/                      regenerable derivatives
  ├─ ~/.recutvideo/runtimes/                   ASR/renderer runtimes
  └─ ~/.recutvideo/config/                     credentials and settings
  │
  ▼
Local agent CLIs and media engines
Codex / Claude Code / Kimi · ffmpeg · ASR · optional image/video providers
```

## 两端边界

### Web：本地工作台

第一阶段的 Web 是随 Daemon 打包的本地工作台，不是需要登录的 SaaS 页面。Daemon 在 `127.0.0.1` 启动后打开浏览器，工作台提供 App 发现、工作流 UI、项目目录、编辑器、终端式对话和本地任务状态。项目打开后，UI 只通过本地 Daemon 读写数据。

浏览器失联不应中断正在运行的本地任务；重新连接后只需从任务事件日志恢复界面。首期无需设备配对：Daemon 为启动的浏览器生成一次性本地 session token，并拒绝没有该 token 的写请求。这是防止本机其他网页跨站调用的边界，不是账号体系。

### CLI/Daemon：可信执行层

CLI 使用 **Go**。原因不是语言偏好，而是单文件分发、跨平台后台进程、低运维成本和对本地文件/子进程管理的适配性。它负责：安装与升级、启动本地工作台、项目库、任务持久化、调用 Agent CLI、托管工具、媒体管线和恢复。

命令行只暴露少量稳定命令：`recut install`、`recut start`、`recut project open`、`recut doctor`、`recut repair`。所有复杂能力通过 Daemon API 和 Agent 工具协议提供，避免把业务逻辑复制进 CLI 子命令。

## 本地项目与一致性

每个项目拥有独立目录，目录是可移植的创作包，而不是数据库黑盒：

```text
~/.recutvideo/projects/<project-id>/
├── recut.json                project identity, active App and format versions
├── core/                     platform-owned, App-independent canonical data
│   ├── assets.json           asset metadata; binaries live in assets/
│   ├── timeline.json         optional shared editable timeline
│   └── exports.json          exported deliverables and provenance
├── assets/                   imported and generated source assets, content-addressed
├── apps/<app-id>/            App-owned namespace, declared by its manifest
│   ├── app.json              App state version and public project summary
│   ├── data/                 validated App-specific source of truth
│   ├── derived/              regenerable previews, indexes and intermediate media
│   └── exports/              App-specific deliverables before promotion to core/
├── sessions/                 项目内 agent conversations、terminal sessions 和 tool-call traces
├── state/events.jsonl        append-only task and mutation event log
├── snapshots/                point-in-time manifests and state snapshots
└── logs/                     diagnostic logs, safe to delete after support export
```

`recut.json` 与 `core/` 是项目的稳定公共契约，所有 App 必须理解或至少安全保留；`apps/<app-id>/` 是唯一允许 App 定义专有文件结构的区域。`state/events.jsonl` 是当前事件日志骨架；未来 SQLite 只缓存其可重建索引，不成为唯一真相。一次写操作遵循：校验输入 -> 写入临时文件 -> 原子替换 -> 追加事件 -> 生成快照。启动时 Daemon 校验 manifest、哈希和 schema；发现中断写入则回放事件或回退最近快照。`recut doctor` 只报告，`recut repair` 才执行可审计的修复。

## 项目扩展机制

项目格式分成三个层次，禁止把它们混在一起：

| 层次 | 所有者 | 内容 | 规则 |
| --- | --- | --- | --- |
| `recut.json`、`core/` | 平台 | 项目身份、素材注册表、通用时间线、最终交付物 | 版本化、跨 App 稳定，Daemon 独占写入 |
| `apps/<app-id>/data/` | App | 该 App 的业务状态与可编辑创作决策 | 必须在 manifest 中声明 schema、版本与迁移 |
| `apps/<app-id>/derived/` | App | 波形、缩略图、临时渲染、向量索引 | 必须可从前两层重建，可随时清理 |

App 不声明固定的“统一业务文件名”。它声明自己的 **Project Layout Descriptor**，由 Daemon 解析和执行：

```json
{
  "projectLayout": {
    "version": 3,
    "files": [
      { "path": "data/script.json", "schema": "schemas/script.v2.json", "kind": "source" },
      { "path": "data/characters.json", "schema": "schemas/characters.v1.json", "kind": "source" },
      { "path": "data/shots.json", "schema": "schemas/shots.v3.json", "kind": "source" },
      { "path": "derived/storyboard.webp", "kind": "derived" }
    ],
    "migrations": ["migrations/2-to-3.json"]
  }
}
```

`path` 必须相对 `apps/<app-id>/`，不能越过命名空间；`source` 文件必须有 JSON Schema 和原子写入策略；`derived` 文件不得被其他 App 当作输入真相。Daemon 根据 Descriptor 创建项目、验证 Agent 写入、把受影响文件加入快照，并在 App 升级时顺序运行声明式迁移。迁移失败时保留旧目录和快照，项目进入只读修复状态，而不是半升级。

例如 `漫剧` 可以定义 `data/script.json`、`data/characters.json`、`data/episodes/<id>/shots.json` 与 `derived/boards/`；`口播精剪` 可以定义 `data/transcript.json`、`data/edit-rules.json`、`data/decisions.json` 与 `derived/waveforms/`。它们共享 `assets/`、最终 `core/exports.json`、会话、任务和恢复机制，但不被迫伪装成同一种工作流。

App 只能通过以下边界与项目交互：读取 `core` 公开对象、注册/引用 `assetId`、在自己的 namespace 内读写声明文件、提交可验证的最终 Export。App 间复用不直接读取彼此目录，而是由前一个 App 将可交付对象发布到 `core/`，下一个 App 从公开对象导入。这避免 App 私有格式演变时形成隐式耦合。

## Agent 协议

不要让 Agent 直接任意读写项目目录。Daemon 向 Agent 提供版本化的 MCP 工具集，所有变更经过同一个任务与校验通道：

- `project.read` / `asset.search`：读取受限项目上下文。
- `workflow.propose` / `workflow.apply`：提出并应用结构化工作流变更。
- `timeline.patch`：按 JSON Patch 修改时间线，先校验再生成可撤销事件。
- `app.state.patch`：依据当前 App 的 Layout Descriptor 和 JSON Schema 修改其声明状态。
- `media.transcribe` / `media.render` / `media.generate`：启动可追踪媒体任务。
- `task.status` / `task.cancel`：查询与取消持久化任务。

适配器将 Codex、Claude Code 与 Kimi 的启动方式和权限模型归一化为 `AgentSession`。上层只关心能力声明，例如是否支持 MCP、流式输出、图像生成或长任务恢复；不依赖厂商特有消息格式。每次任务记录输入版本、调用的工具、模型标识和输出版本，从而支持重放、审计和“从这里再试一次”。

## App 架构

App 是声明式包，而非独立微服务。其最小构成是：

```text
apps/<app-id>/
├── manifest.json             name, version, permissions, entry workflow
├── workflow.schema.json      typed inputs, steps, outputs and validations
├── project-layout.json       App project files, schemas and migrations
├── schemas/                  App-owned source-state schemas
├── migrations/               versioned, reversible state migrations
├── ui/                       workflow-specific React surfaces
├── prompts/                  agent roles and structured task instructions
├── tools/                    optional App-specific tool declarations
└── templates/                reusable timeline, caption and render templates
```

平台提供 `Project`、`Asset`、`Task`、`Conversation`、`Timeline`、`Export` 六个稳定领域对象，以及 `Project Layout Descriptor` 这一存储扩展点。App 只能通过公开 schema、Layout Descriptor 和工具扩展它们，不能自建第二套项目存储、任务队列或会话系统。这样新增 App 是新增工作流和受控项目格式，不是复制一套产品。

## 任务执行模型

所有耗时操作都建模为可恢复 Job，状态统一为 `queued -> running -> waiting_for_input -> succeeded | failed | canceled`。Job 拆为可缓存的 Step；每个 Step 有明确输入哈希和产物哈希。相同输入命中缓存，失败只重试失败步骤，用户修改某个镜头只使下游依赖失效。

Agent 的文本流、工具调用、进度、预览和错误都写入 append-only event log。UI 是事件日志的投影，而非任务状态的第二来源。这消除刷新页面、浏览器关闭和 Agent 输出延迟造成的状态分叉。

## 媒体与 ASR 决策

媒体基础设施应以 `ffmpeg` 为唯一转码/合成底座，Daemon 只编排，不重复实现编解码。ASR 采用两级策略：

- 默认：`faster-whisper` 或同类本地 runtime，以独立 worker 进程运行；离线、私密、成本可控。
- 可选：云端 ASR provider，针对低配机器、极速转写或更多语言，必须由用户明确授权并标记数据外发。

不要把 Python 嵌入 Go 二进制。Daemon 管理可版本化 ASR worker 和模型包，按需下载、健康检查、隔离崩溃；Go 保持为稳定控制平面。第一阶段可优先接入远程或本地已安装的 `whisper.cpp`，确认性能需求后再投资 GPU runtime 分发。

## 云端演进与商业化

第一阶段不部署业务云端，不提供账号、登录、订阅、多人协作或跨设备同步。App manifest 与内置模板同二进制发布；更新通过 CLI 自更新完成。这样 MVP 只有一个可信边界：用户自己的机器。

第二阶段需要账户时，以 Supabase Auth 提供认证，并新增独立的云端控制面保存账号、订阅 entitlement、App 目录、设备公钥和匿名产品指标。它不保存原始媒体、项目文件或 Agent 对话；跨设备同步必须显式启用端到端加密。认证身份只能控制云端权益，不能成为本地项目可读写的前提。

收费应围绕产品价值而非 Agent token：Pro 解锁高级 App、模板、批处理、团队交付和云端渲染；按量收费只覆盖真实外部成本，如视频生成、云端 ASR、GPU 渲染和存储。用户的 Agent 订阅仍是用户自己的执行能力。

## 安全与权限

- Daemon 默认只监听 `127.0.0.1`，启动本地工作台时签发短期、能力受限的 session token。
- App manifest 显式声明项目读写、网络、外部模型和 shell 权限；首次使用时由用户授权。
- Agent 不获得裸文件系统权限，只能调用受审计工具；需要原始 shell 时显示命令与工作目录并确认。
- API key 进入系统凭据库，绝不写入项目目录、会话日志或 Prompt。

## 交付路线

### Phase 1：可靠的本地骨架

发布 Go Daemon、本地工作台、项目目录、Job/event log、Codex 适配器、基础资产库与 `口播精剪` App。没有账号、云端数据库或在线服务。先证明“UI 驱动本地 Agent，任务可恢复，项目不丢失”。

### Phase 2：可扩展的创作平台

引入 App manifest、Claude Code/Kimi 适配器、时间线 patch、快照修复、`Vox Explainer` 与本地 ASR。此阶段验证新 App 不需要重做基础设施；仅在验证订阅、同步或协作需求后，再接入 Supabase Auth 与云端控制面。

### Phase 3：高价值生产能力

加入 `漫剧`、批量生产、团队交付、可选云 GPU、加密同步与 App 分发。只在本地工作流稳定后扩展云端服务。

## 关键决策

| 决策 | 选择 | 原因 |
| --- | --- | --- |
| 数据主权 | 本地默认、云端可选同步 | 信任、成本和 Agent 本地执行模型一致 |
| 控制平面 | Go Daemon | 单二进制分发与可靠子进程管理 |
| 产品前端 | Next.js + React | 适合复杂工作流、可独立访问和快速迭代 |
| Agent 集成 | MCP 工具 + Adapter | 避免绑定某一个 Agent 供应商 |
| 状态模型 | 规范化文件 + SQLite event log | 可移植、可审计、可修复 |
| 扩展模型 | 声明式 App 包 | 复用平台，而不复制系统 |

## 成功标准

一个新用户应能在十分钟内安装 Daemon、配对浏览器、导入一段口播视频并得到可编辑粗剪；浏览器关闭或 Agent 中断后，重新打开仍能准确看到任务与产物；新增一个 App 时，主要工作是定义工作流、UI 和提示词，而不是重写项目、会话、任务或媒体系统。

> 架构的核心不是让 Agent 更自由，而是让创作状态更确定。Agent 可以更换，项目必须永远可读、可改、可恢复。
