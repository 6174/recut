---
name: recut
appId: recut.platform
mcp: platform
description: Recut 视频创作平台：素材库、媒体生成（图片/视频/语音）与已安装 App 的创作工作流，经 Recut MCP 使用。
references: world-onboarding.md
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

新建 Agent / native session 时，先确认工具列表中存在 `recut.context`，再调用它确认本机 service 可用。已经成功确认过的同一 native session（包括 resume 续跑）不得为每条新消息重复检查。只有 MCP 工具成功响应后，才能声称已经读取、创建或生成了 Recut 内容。

若 `recut.context` 不在工具列表、MCP 启动失败，或调用显示本机 service 无法连接，不要猜测平台状态，也不要用本地渲染冒充 Recut 功能。直接告诉用户：

1. 打开 [https://recut.video](https://recut.video)，按页面提示安装或连接本机 Recut service。
2. macOS、Linux 和 FreeBSD 可在终端运行 `curl -fsSL https://recut.video/install.sh | sh`；Windows 可在 PowerShell 运行 `irm https://recut.video/install.ps1 | iex`。
3. 安装完成后打开 [https://recut.video](https://recut.video)，等待右上角显示 `LOCAL SERVICE CONNECTED`；随后新开一个 Agent 会话，让 MCP 重新加载。

如果 service 已安装但暂时未运行，仍引导用户打开 [https://recut.video](https://recut.video) 检查连接与安装状态；不要要求用户手动修改 Skill 文件或 MCP 配置。

## 上下文新鲜度协议

`recut.context` 是能力快照，不是每轮的仪式。新建 native session 时调用一次，读取已安装 App、Skill 元数据、媒体配置与 `media.readiness`。同一 native session（包括 resume 续跑）内，整段会话生命周期都复用已确认的快照，不能因为用户发来下一条消息、暂停后恢复或跨天再打开就重读。

只有下列情况才刷新：用户说明刚改了 Provider、默认模型、App 安装或 App 更新；本会话刚执行了这类变更；任务切换到快照未覆盖的 App 或 Project；或者工具返回表明先前状态已失效。会话不绑定任何项目，需要项目信息时用 `recut.project.list` / `recut.project_context` 显式获取。

`recut.context.skills` 已包含所有已安装 Skill 的 `appId`、`id`、名称和描述。直接从该结果选择匹配的 App Skill；只有当前 native-session 历史中还没读取该 App 的工作流、或任务切换到其他 App/领域时，才调用 `recut.skills.read`。只有 `recut.context` 缺少所需 Skill 元数据或确实需要刷新目录时，才调用 `recut.skills.list`；它不是例行预检。Skill 正文对对应 App 的工具契约与决策门有权威性；仅在它要求时读取 `recut.skills.reference`。

同样的「整段会话复用」规则适用于其余相对稳定的上下文类调用，按变更来源分两档：

**会话冻结档**（同一 native session 含 resume 续跑只读一次，不因跨天或新消息重读）：

- `recut.apps.list` / `recut.apps.store`：App 目录随安装/更新走，且 `recut.context.apps` 已内嵌已安装清单，禁止例行调用；只在用户明确要求安装、更新或浏览商店时使用。
- `recut.skills.read`：每个 App 的 Skill 正文每个会话只读一次，任务切到其他 App/领域才读新的。
- `recut.skills.reference`（`skillId: recut-design-system`）：全局设计系统随 service 版本走，会话内不可变；风格清单在 `design-systems/catalog.json`。
- `recut.media.list_voices`：音色随 Provider 凭据走，只在用户说明改了 Provider/凭据、或本会话执行了此类变更后刷新。
- `audio.status` / `depth.status` / `subtitle.capabilities`：环境与模型就绪状态，会话内不变；个别字段如 `activeJob` 是动态的，按对应 jobId 用 job 观察工具轮询，不靠重读 status。

**事件失效档**（基线在会话内冻结，但自己动手变更或用户说明变更后做增量维护，而不是整表重读）：

- `recut.project.list` / `recut.project.get`：基线冻结；自己 `recut.project.create` 后把新项目并入已知列表。
- `recut.media.list_assets`：基线冻结；自己 import/attach 后追加已知条目，用户说「刚传了素材」才重读。
- `audio.characters` / `audio.syntheses`：同上，自己 create/remove/synthesize 后增量维护。
- `recut.worlds.list` / `recut.worlds.get` / `recut.worlds.entities.list` / `recut.worlds.evidence.list`：Canon 相对稳定；自己 upsert/attach 后增量，且这些写入本就要求用户明确授权，天然带失效信号。

**不适用冻结**（随工作进展变化，按各 App Skill 的现有节奏读）：各 App 的 `workflow.context`（stage 门禁，节拍推进就变；Editor 已规定连续编辑会话读一次、外部变化/冲突/失效才回读）、`recut.project_context`（含已产出 Artifact，随产出增长）、`project.get` / `timeline.read`（Editor 走 `baseVersion` 增量同步，缓存 version 而非快照）、`recut.context.integrations`（App 安装/更新动作前后会变）、`cover.context`。

「不适用冻结」不等于每轮重读。这一档同样遵守 resume 续跑不重读，且状态变化从**写操作的返回值**观察：每次写入返回的 version、stage、产物 ID 就是权威增量，用它滚动更新已知状态，绝不为了「确认」或「安心」而重读。回读只由事件触发——写入报阶段/版本冲突、用户说明在 UI 或其他会话里改过、切换目标 Project/App。时间间隔（包括跨天空闲）本身不是失效信号；跨天新开 native session 才从头读。若状态真过期，workflow 的阶段门禁与 `baseVersion` 冲突会给出真实状态，按返回值修正即可，不要预防性重读。

`tools/list` 返回平台工具与所有已安装 App 的 `appId.operation` 工具。只调用已加载 Skill 的 App 工具。项目是单一 owner App 的类型化 Doc。要操作某个项目，在其 App 工具参数里传 `__recut.target.projectId`；没有显式 target 时操作该 App 的全局状态（appstate），媒体工具无项目时操作 workspace 素材库。用户要求新建或正式化创作时，先 `recut.project.list` 复用，或 `recut.project.create` 传入 name 与 owner App ID。

## 平台级视频表达铁律

凡是创建、改写、预览或评审视频画面，都把文字和色彩当作镜头表演，而不是 UI 排版：

- **少而巨大**：每个镜头只让一条主张成为主角。主信息要占据足够画面并分段/分词展开；不能读到的小字、微型标签、弱对比说明和“看起来像信息”的 UI chip 一律删除，而不是保留占位。
- **最终像素优先**：在 1080p 画面中，主信息有效字高 ≥56px、字幕 ≥40px、必要辅助信息 ≥32px；在 480px 宽的手机预览仍一眼读不清，就删、拆镜头或放大。
- **色彩由场景负责**：由具体 App/场景 Skill 决定是否使用渐变与如何建立层次；平台层只要求颜色服务主次和阅读对比，不能降低文字清晰度。
- **字幕是文字层，不是组件框**：默认无底框、无气泡、无卡片。字幕以高对比白字黑描边或同等强度的文字处理置于画面安全区，不能遮住主视觉。

这条铁律由每个 App 的领域 Skill 进一步落地；任何 App Prompt 与模板实现都不得与之冲突。

## 媒体

平台媒体任务使用 `recut.image.generate`、`recut.video.generate`、`recut.speech.generate`、`recut.media.get_job`、`recut.media.wait_for_job`。调用前必须检查 `recut.context.media.readiness[capability].status`：只有 `ready` 才调用对应 Recut 生成工具；`not-configured` 时直接说明用户需要在 Recut 设置中连接 Provider 并为该用途选择默认模型；当语音 route 报告 `provider:"local-audio"` 时本机 TTS 已配置，先看音频/转写是否由 Audio Studio 承载（`audio.transcribe`/`audio.synthesize`/`audio.characters`/`audio.save`），`recut.speech.generate` 的本地路由仅在 daemon 已接 Audio Studio 桥时可用；图片为 `codex-native` 时使用宿主原生生图、不调用 `recut.image.generate`，把生成文件写入当前会话工作区根目录（如 `cover.png`），再按上文 OutputFormat: url 一节以深链引用，需要挂到项目时用 `recut.media.import_image` 传入工作区相对路径与目标 `projectId` 换取真实 `assetId`。三种生成工具都是异步 job：提交即返回稳定 jobId 与 assetIds（先 queued，Daemon 原位推进到 completed/failed）。**提交不等于成功**——必须用返回的 jobId 等待，`completed` 才能声称素材可用；`failed` 要如实报告 provider 错误，`queued`/`running` 是仍在进行而非完成。禁止用 HyperFrames、ffmpeg、浏览器自动化或本地渲染替代平台生成。你从不读取其他 App 的私有数据库；跨 App 理解走 owner App 声明的 read operation。

素材发现用 `recut.media.list_assets`，永远不要全量拉取：已知 ID 用 `ids` 精确取回，否则用 `kind` / `query` / `limit` / `offset` 过滤分页，按返回的 `total` 判断是否翻页。平台对任何工具输出执行 48KB 预算：超限结果会被截断为 `{truncated, totalBytes, preview, fullOutputPath}` 信封——把它当作数据来决策（缩小查询参数或读文件），不要重复提交同样的全量调用。

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

`recut.worlds.*` 是全局工具：**`recut.worlds.brief` 是读取 World 的默认单次入口**——一次获得身份、世界技能（`skill`/world.md 全文）、角色/故事/场景/风格事实（含 `body` 长文）、规则约束与证据（`assetId` 或 `url` 双源）。`recut.worlds.list` 发现 Worlds，`recut.worlds.get` 确认身份，`recut.worlds.entities.list/get` 浏览实体，`recut.worlds.resolve` 保留给 App/运行时（固定 revision 的 `CreationContext`）。**不存在隐式当前 World**：每次调用都要显式传 `worldId`，`entityId` 只在它的 `worldId` 内有效。

World 分三类来源（`origin`）：`local`（用户自建，可编辑）、`platform`（平台内置，daemon 自动同步）、`published`（发布安装，P4）。**非 local 世界只读**：任何写工具（update/entities.upsert/evidence.*/skill_md）会返回 `WORLD_READ_ONLY`——这是边界不是失败，按错误 details 向用户说明并**提议 `recut.worlds.fork`**，经用户确认在本地副本上继续。平台世界的 world.md 是该垂直能力的**生产工作流**（如小黑配图：先出 shot list → 逐张生成 → 按质检口径复核 → 交付），必须按其执行；技能中的「资源口径」章节约束证据的使用方式（如“风格示例仅作低频视觉校准，不进入默认生成路径”）。

证据双源：`source: "asset"` 走素材库 assetId；`source: "url"` 是绝对 http(s) 远程资源——provider 接受 URL 时直接引用，需要本地文件或入库时调用 `recut.media.import_url`（≤25MB，内容寻址去重）。当消息携带 World/Entity 引用，或 Project 的 `workflow.context`/`ctx.creationContext` 报出 `creationContext` 时，在该次工作期间把它当作权威 Canon：遵守 `constraints.always/never`、优先使用被引用的证据、绝不凭空捏造 Canon。**不要**调用写入类工具（`recut.worlds.create/update/fork/entities.upsert/references.attach/evidence.*/bind_project`），除非用户明确要求；非 local 世界的修改诉求走 Fork。

**新世界从空开始（无模板空壳实体）**：`recut.worlds.readiness({ worldId })` 返回就绪度（skeleton/draft/ready）、分数与按优先级排序的缺失清单（含原因与建议动作），并按世界类型推荐起点场景蓝图（小说改编 / IP 账号 / 风格体系 / 品牌指南 / 从零开始）。用户要求完善或搭建一个 World 时，按 onboarding 标准工作流执行：readiness 取工作清单 → 消化用户素材（链接用 `recut.media.create_reference` 登记）→ research 补全（只依据素材，未覆盖项标注"需要你补充"）→ 生成候选图交用户挑选 → 结构化提案 → 用户确认后逐条写回（携带 `expectedRevisionId`，冲突即停）。完整工作流经 `recut.skills.reference({ appId: "recut.platform", skillId: "recut", path: "references/world-onboarding.md" })` 读取。

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
