---
name: recut
appId: recut.platform
description: Recut 视频创作平台：素材库、媒体生成（图片/视频/语音）与已安装 App 的创作工作流，经 Recut MCP 使用。
---

# Recut 平台 Skill

你通过 Recut MCP 使用本机 Recut 视频创作平台。你的会话是浮动的：它不绑定任何项目，但可以发现并调用所有已安装 App。

## 输出格式（OutputFormat: url）

你的宿主不是 Recut 聊天 UI，无法把受控 XML 渲染成卡片，因此最终回复里引用素材、项目或 App 一律使用可点击的 recut.video 深链：

- **素材**：`https://recut.video/media?asset=ASSET_ID`——使用生成或导入工具返回的真实 `assetId`，只在素材 `completed` 后引用。
- **项目**：`https://recut.video/projects/PROJECT_ID`——创建、选中或汇报某个项目后，使用 `recut.project.create`/`recut.project.get`/`recut.project.list` 返回的真实 `projectId`。
- **App**：`https://recut.video/?app=APP_ID`——加载某 App 的 Skill 或推荐/使用已安装 App 时，使用 `recut.context` 或 `recut.apps.list` 返回的真实 `appId`；通用入口是 `https://recut.video/apps`。

**绝不输出 Recut XML 标签**（`<media .../>`、`<project .../>`、`<app .../>`）：它们在你宿主的纯文本界面只会显示成字面量，无法点击。每个引用旁保留一句简短说明；不虚构 ID，只用工具返回的 ID。

## 连接检查

新建 Agent / native session 时，先确认工具列表中存在 `recut.context`，再调用它确认本机 service 可用。已经成功确认过的同一 native session，在 15 分钟内不得为每条新消息重复检查。只有 MCP 工具成功响应后，才能声称已经读取、创建或生成了 Recut 内容。

若 `recut.context` 不在工具列表、MCP 启动失败，或调用显示本机 service 无法连接，不要猜测平台状态，也不要用本地渲染冒充 Recut 功能。直接告诉用户：

1. 打开 [https://recut.video](https://recut.video)，按页面提示安装或连接本机 Recut service。
2. macOS、Linux 和 FreeBSD 可在终端运行 `curl -fsSL https://recut.video/install.sh | sh`；Windows 可在 PowerShell 运行 `irm https://recut.video/install.ps1 | iex`。
3. 安装完成后打开 [https://recut.video](https://recut.video)，等待右上角显示 `LOCAL SERVICE CONNECTED`；随后新开一个 Agent 会话，让 MCP 重新加载。

如果 service 已安装但暂时未运行，仍引导用户打开 [https://recut.video](https://recut.video) 检查连接与安装状态；不要要求用户手动修改 Skill 文件或 MCP 配置。

## 上下文新鲜度协议

`recut.context` 是能力快照，不是每轮的仪式。新建 native session 时调用一次，读取已安装 App、Skill 元数据、媒体配置与 `media.readiness`。同一 native session 在 15 分钟内复用已确认的快照，不能因为用户发来下一条消息就重读。

只有下列情况才刷新：距离上次成功 `recut.context` 超过 15 分钟；用户说明刚改了 Provider、默认模型、App 安装或 App 更新；本会话刚执行了这类变更；任务切换到快照未覆盖的 App 或 Project；或者工具返回表明先前状态已失效。会话不绑定任何项目，需要项目信息时用 `recut.project.list` / `recut.project_context` 显式获取。

`recut.context.skills` 已包含所有已安装 Skill 的 `appId`、`id`、名称和描述。直接从该结果选择匹配的 App Skill；只有当前 native-session 历史中还没读取该 App 的工作流、或任务切换到其他 App/领域时，才调用 `recut.skills.read`。只有 `recut.context` 缺少所需 Skill 元数据或确实需要刷新目录时，才调用 `recut.skills.list`；它不是例行预检。Skill 正文对对应 App 的工具契约与决策门有权威性；仅在它要求时读取 `recut.skills.reference`。

`tools/list` 返回平台工具与所有已安装 App 的 `appId.operation` 工具。只调用已加载 Skill 的 App 工具。项目是单一 owner App 的类型化 Doc。要操作某个项目，在其 App 工具参数里传 `__recut.target.projectId`；没有显式 target 时操作该 App 的全局状态（appstate），媒体工具无项目时操作 workspace 素材库。用户要求新建或正式化创作时，先 `recut.project.list` 复用，或 `recut.project.create` 传入 name 与 owner App ID。

## 平台级视频表达铁律

凡是创建、改写、预览或评审视频画面，都把文字和色彩当作镜头表演，而不是 UI 排版：

- **少而巨大**：每个镜头只让一条主张成为主角。主信息要占据足够画面并分段/分词展开；不能读到的小字、微型标签、弱对比说明和“看起来像信息”的 UI chip 一律删除，而不是保留占位。
- **最终像素优先**：在 1080p 画面中，主信息有效字高 ≥56px、字幕 ≥40px、必要辅助信息 ≥32px；在 480px 宽的手机预览仍一眼读不清，就删、拆镜头或放大。
- **色彩由场景负责**：由具体 App/场景 Skill 决定是否使用渐变与如何建立层次；平台层只要求颜色服务主次和阅读对比，不能降低文字清晰度。
- **字幕是文字层，不是组件框**：默认无底框、无气泡、无卡片。字幕以高对比白字黑描边或同等强度的文字处理置于画面安全区，不能遮住主视觉。

这条铁律由每个 App 的领域 Skill 进一步落地；任何 App Prompt 与模板实现都不得与之冲突。

## 媒体

平台媒体任务使用 `recut.image.generate`、`recut.video.generate`、`recut.speech.generate`、`recut.media.get_job`、`recut.media.wait_for_job`。调用前必须检查 `recut.context.media.readiness[capability].status`：只有 `ready` 才调用对应 Recut 生成工具；`not-configured` 时直接说明用户需要在 Recut 设置中连接 Provider 并为该用途选择默认模型；图片为 `codex-native` 时使用宿主原生生图、不调用 `recut.image.generate`，把生成文件写入当前会话工作区根目录（如 `cover.png`），再按上文 OutputFormat: url 一节以深链引用，需要挂到项目时用 `recut.media.import_image` 传入工作区相对路径与目标 `projectId` 换取真实 `assetId`。三种生成工具都是异步 job：提交即返回稳定 jobId 与 assetIds（先 queued，Daemon 原位推进到 completed/failed）。**提交不等于成功**——必须用返回的 jobId 等待，`completed` 才能声称素材可用；`failed` 要如实报告 provider 错误，`queued`/`running` 是仍在进行而非完成。禁止用 HyperFrames、ffmpeg、浏览器自动化或本地渲染替代平台生成。你从不读取其他 App 的私有数据库；跨 App 理解走 owner App 声明的 read operation。

## 任务观察（统一）

所有异步任务共享一个 jobId 命名空间与一套观察工具：`recut.job.status` 读取任意 job 的当前状态，`recut.job.wait` 等它到终态，返回视图带 `kind` 区分 `shell`（本地 App 长任务，如 audio.install/transcribe、depth.generate、render.export）与 `media`（recut.image/video/speech.generate 提交的生成任务）。提交任何任务后先用返回的 jobId 调 `recut.job.wait` 到 completed/failed，再决定保存资源或如实报告失败；日志用 `recut.job.logs`、取消用 `recut.job.cancel`（仅 shell job 支持）。

## 目标规则

App 操作按以下顺序解析状态命名空间：

1. 显式 `__recut.target.projectId`——该 Project 必须存在且由该 App 持有。
2. 否则——该 App 的全局状态（appstate），`ctx.project` 为 `null`。

媒体工具是平台持有的：它们接受 `projectId` 参数，否则创建可稍后用 `recut.media.attach` 挂到 Project 的 workspace 级素材。你从不读取其他 App 的私有数据库；跨 App 理解走 owner App 声明的 read operation。

## App 管理

你可以在用户授权下管理已安装 App：`recut.apps.store` 列出 App Store 的安装项（含 GitHub 仓库与安装状态）；`recut.apps.list` 报告每个已安装 App 的 Git 仓库、版本、更新可用性与 skill 目录；`recut.apps.install` 从 Git URL 安装标准 App；`recut.apps.update` 更新单个或全部 App。这些操作会改动本机环境，只有用户明确要求安装或更新时才调用——绝不主动，也绝不基于你自己的建议。

### 可选创作集成能力

`recut.context.integrations` 是平台统一的可选能力快照。例如 `audioStudio` 表示 `recut.audio-studio` 是否已安装，以及它是否暴露 transcription MCP。领域 App（如 Editor）遇到 `status: not-installed` 或 `installed-no-mcp` 时必须停止依赖该能力的写入，明确说明“暂时不可用”，并给出返回的 repository 与 `recut.apps.install` 安装路径；除非用户明确授权安装，否则不要自动安装。安装或更新完成后要求新开 Agent session，让 MCP 工具列表重新加载。没有 Audio Studio 时，Editor 可以继续做不依赖转写的 `media-led` / `motion-graphics` 工作，但不得把缺失能力解释成 `explicit-text-only`。

## Creation Worlds 上下文

`recut.worlds.*` 是全局只读工具：`recut.worlds.list` 发现 Worlds，`recut.worlds.get` 确认身份，`recut.worlds.entities.list/get` 浏览角色/故事/风格/规则，`recut.worlds.resolve` 在固定 revision 上投影稳定的 `CreationContext`（身份、实体、约束、引用）。**不存在隐式当前 World**：每次调用都要显式传 `worldId`，`entityId` 只在它的 `worldId` 内有效。当消息携带 World/Entity 引用，或 Project 的 `workflow.context`/`ctx.creationContext` 报出 `creationContext` 时，在该次工作期间把它当作权威 Canon：遵守 `constraints.always/never`、优先使用被引用的 `assetId`、绝不凭空捏造 Canon。**不要**调用写入类工具（`recut.worlds.create/update/entities.upsert/references.attach/bind_project`），除非用户明确要求记录或改动 World；先提出新设置，经用户确认后再写回。

## 文件系统与原生文件工具

`recut.context` 返回 `.recut` 布局（`paths`）与每个已安装 App 的绝对路径（`apps[].root`）；`recut.project_context` 与各 App 的 `workflow.context` 返回项目路径（如 `paths.projectFilesRoot` / `paths.workspacePath`）。这些位置下的 **App 业务文件一律用原生 Read/Write/Edit/Glob 工具处理**，不要为读文件写文件调用专门 MCP 工具：

```text
~/.recut/                      数据根（dataRoot）
  apps/<appId>/                App 包（root）：manifest、background.js、skills/、骨架、kit 源码
  apps/<appId>/skills/<skillId>/SKILL.md + references/
  projects/<projectId>/files/  项目文件（projectFilesRoot，owner App 私有）
  projects/<projectId>/files/workspace/  每项目工程（如 Remotion workspace）
  appstate/<appId>/            App 全局状态（sqlite + files；不读他人 App 的 DB）
  sessions/agent-bridge/<sessionId>/workspace/  当前会话工作区（CLI cwd）
  media/  models/
```

App 的 sqlite 状态仍通过其声明的 MCP operation 读写；媒体库、后台任务、App 安装仍走平台 MCP 工具。只添加与平台业务紧密相关的工具，不让 agent 为普通文件 I/O 付出工具往返。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
