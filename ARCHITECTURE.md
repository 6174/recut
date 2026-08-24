# Recut Extension Architecture

> L1 | 父级: /README.md

```text
App package (`~/.recut/apps` Git clone / 本地源码或固定 Git submodule 链接)
├── manifest.json       唯一运行时配置
├── background.js       App 业务、API 与 MCP handler
└── ui/                 App 自己定义的界面
        │
        ▼
Recut Daemon / Capability Host
├── SQLite namespace    ctx.sqlite
├── file sandbox        ctx.files
├── Artifact registry   ctx.artifacts.publish
├── App API broker      recut.apps（下一步）
├── Media Platform      asset registry / encrypted BYOK / routes / jobs
├── Project cover       owner App selects image/video Asset via ctx.project.setCover
└── MCP Host            recut.media.* + manifest.mcp → background.js
        │
        ▼
Agent Session Host
├── workspace.sqlite    本机用户的会话、消息、事件与 native session 指针
├── Codex JSONL adapter  将 runtime 事件归一为 Chat UI 协议
└── TerminalManager     PTY 兼容与诊断，不作为对话状态真相
```

`manifest.json` 只声明身份、`type`、`background`、UI 入口、权限和 `operations`。一个 operation 定义名称、描述、输入 schema 与 `surfaces: ["api", "mcp"]`；它不声明数据表、项目文件、迁移或业务 workflow；这些都是 App JavaScript 的内部实现。

每个 App 只有一个 sqlite 接口：`appstate/<appId>/storage.sqlite`，同时承载该 App 的全局状态与它拥有的所有 Project——App 以 `ctx.project.id` 分区自己的行，无项目时 `ctx.project` 为 `null`。平台表（Project 元数据、Artifact、事件、Agent、媒体、凭据）全部位于唯一 `workspace.sqlite`。Project 的 `cover` 是平台元数据，但封面选择仍是 App 业务：owner App 可以把已完成 image/video Asset 交给 `ctx.project.setCover({ assetId })`，平台自动关联、保存并在项目桌面按类型展示；也可用 `ctx.project.setCoverImage({ path, mimeType })` 把项目文件根内 App 写入的文件登记为封面（`project_covers.source='file'`），平台经 `GET /v1/projects/{id}/cover` 直接服务该文件，`ctx.files.writeBase64` 提供二进制写入。文件封面不产生 media Asset，适合首帧封面这类频繁刷新、不想污染素材库的用途。大媒体写入 content-addressed `files/`，SQLite 永远先保存资源记录、哈希和 `fileId`，而不是让业务状态散落成 JSON 文件。路径只是平台实现细节，JS 不获得裸路径或 SQLite 连接串。

MCP 由平台而非 App 监听。Agent session 只看到当前 App manifest 声明且包含 `mcp` surface 的 `app-id.operation`；调用经 Host 权限校验后进入 `background.js` 注册的 `recut.operation.register(name, handler)`。同一 operation 以 `api` surface 给 UI 调用，以 `mcp` surface 给 Agent 调用，只有一份名称、schema 与实现。

## Agent App Assets

App 还可以拥有三类 Agent 资产，但平台不把它们混为自由文件系统权限：

```text
App package
├── AGENTS.md       App 的领域工作流、审批门与 MCP 使用规则；每个 turn 注入 Codex guide
├── references/     可版本化的参考资料；未来以声明式索引、只读引用按需提供给 Agent
└── scripts/        可复现的转换/生成脚本；未来必须由 manifest 声明显式输入输出，并暴露为受控 MCP tool
```

`AGENTS.md` 是当前已实现的自动注入层。`references/` 与 `scripts/` 的目标是支持类似 vox-director 的复杂制作 App：参考材料有可追溯 ID，脚本有参数 schema、产物和执行记录；Agent 不获得“随便运行包内脚本”的模糊权限。

运行时始终从 `~/.recut/apps` 加载 App。开发仓库执行 `make app-link` 后，目录中的包会链接至源码，因此服务、项目和 Agent 使用同一份 App 文件。项目会创建 `.recut/app -> ~/.recut/apps/<package>`；平台生成的 Agent guide 明确该路径是 App 的 manifest、领域 guide、参考资料与实现源码位置。App 工作副本可被 Agent 按用户任务修改并以 Git 回退，项目 SQLite、媒体和用户文件不受 App 代码回退影响。

## Media Platform

媒体资源是工作区级 Asset，不属于任一 App 的私有文件夹。`MediaService` 的 Provider Registry 声明每个平台的协议、默认 API Base 和模型目录；BYOK 凭据属于 Provider，Route 必须选择同一 Provider 下的具体模型。全局 SettingsPanel 负责“连接 Provider → 选择用途模型”，素材库不重复配置。`workspace.sqlite` 保存 Asset 元数据、项目引用、生成任务、能力 Route 和加密后的 BYOK 凭据；内容文件以哈希落入受控媒体根。`recut.project_context` 直接携带当前默认 route 的模型契约；Agent 按意图调用 `recut.image.generate`、`recut.video.generate` 或 `recut.speech.generate`，不再传递可错配的 capability 枚举。三种生成都是异步 Job：提交即返回稳定 jobId 与 assetIds（先 queued，Daemon 原位推进到 completed/failed），Agent 用 `recut.media.get_job` / `recut.media.wait_for_job` 观察终态。`recut.media.list_voices` 按配置的 MiniMax/ElevenLabs 凭据返回实时可用音色，`voiceId` 是语音生成的必填输入。`recut.media.*` 仅保留配置、Job、音色与素材管理。App 仅消费稳定的 `assetId`，可在自身 Artifact 中保存该引用。Atlas Cloud 作为原生 prediction 聚合 Provider，图片模型经 `/api/v1/model/generateImage` 提交并轮询 `outputs[0]`（模型 ID 形如 `openai/gpt-image-2/text-to-image`，带参考图时自动切到 `…/edit` 编辑变体），模型目录含 GPT Image、Seedream、Seedance、Grok 和 xAI TTS；`model_providers` 策略层按 Provider ID 分派图片执行，`openai` / `openai-compatible` 走 OpenAI 兼容 `/images/generations`（有引用时 multipart `/images/edits`），MiniMax 与 ElevenLabs 覆盖动态音色和语音适配器，视频会复用相同任务与 Asset 契约。

### Font Service

编辑器文字渲染在浏览器内 canvas 完成，字体可用性 = 渲染时 `document.fonts` 已注册。字体由 Recut 自有 CDN 自托管（`cdn/buckets/fonts/google`，`cdn/scripts/fetch-fonts.mjs` 一次编制并 `make upload PREFIX=fonts` 上传到 `https://cdn.recut.video/fonts/google/`），运行期零 `fonts.googleapis.com` 依赖。service 提供 `/v1/fonts`：目录（内嵌 curated Google 目录含 CJK 家族 + 用户上传 local 字体）、`/v1/fonts/google/{id}/css`（自托管 @font-face + unicode-range，url 重写指向本服务）、`/v1/fonts/google/{id}/{file}.woff2`（首次从 Recut CDN 抓取，`store.root/fonts/cache` 内容寻址落盘，此后离线可用）、`/v1/fonts/local`（上传/列表/交付/删除）。编辑器在 `google-fonts.ts` 经 `fontsAPIBase()`（宿主同源，测试 seam 可注入）加载；`project-manager` 按来源回灌（system 跳过 / upload 从 service 读字节注册 / google 走自托管 css）。详见 `rfc/2026-08-16-editor-font-system.md`。

### Realtime Channel

平台实时事件收敛为单条 WebSocket（`/v1/events`，stream 端口 17374），浏览器每页一条连接，按 `channel` 订阅分流（media/project/app/agent/cli/terminal）。首屏/全量数据走 REST（如 `GET /v1/media/assets`），长连接只承载增量事件；服务端 `EventBus` 扇出 + 后台账本 forwarder（每账本每秒至多一次 DB 轮询，与客户端数量解耦）。连接内置心跳保活与指数退避重连，重连后重订阅并补 REST 快照。iframe App 通过传输层抽象接入：嵌入宿主运行走宿主桥，无宿主独立运行回退直连 WS。实现详见 `rfc/2026-08-14-realtime-channel-ws.md`。

## B-roll 案例

`apps/ai-short-film/manifest.json` 申请 `sqlite`、`files`、`artifacts.publish`，声明 `brief.create` API 和 `generate_brief` MCP 工具。`background.js` 自行创建 `briefs` 表、保存 brief 文件并发布 `recut.vox.brief@1` Artifact；平台没有任何 B-roll 专用数据结构或 workflow 代码。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
