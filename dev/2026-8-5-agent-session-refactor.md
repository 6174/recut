<!--
[INPUT]: 依赖现有 service、web、App Catalog、Agent Bridge 与媒体平台注册表的实际边界。
[OUTPUT]: 定义 Agent 会话、单 App Project Doc、App 全局状态、Doc/Asset 流通、Skills/MCP 与外部 Agent 的重构契约。
[POS]: dev 的架构级设计记录；实施前的唯一状态归属与跨 App 协作依据。
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->
# Recut Agent 会话解耦与 Skills/MCP 重构方案（2026-08-05）

> 范围：完整重构设计。会话可调用任意已安装 App，但一个 Project 通常且默认只归属一个 App。跨 App 协作只通过 Doc 与媒体 Asset 引用完成，不共享私有数据库。

## 1. 结论

当前系统把 Agent 会话、Project 和 App 绑定在同一个 projectId 上：首页会话只能建项目；一个会话也不能自然组合多个 App 的技能。

目标不是把多个 App 的私有状态塞进同一个 Project。目标是拆开三个概念：

- 会话是浮动对话，能发现并调用任意已安装 App。
- Project 是用户明确创建的一份 Doc，由一个 owner App 类型化。
- App 有自己的全局状态；没有 Project 时照常工作。

跨 App 数据流只传递 Doc ID 与全局媒体 Asset ID。App A 不读取 App B 的数据库；Agent 也不直接查询任意 SQLite 表。

## 2. 设计原则

1. 一个 Project 只有一个 owner App。owner App 决定该项目的工作流、私有表和动态文件结构。
2. 会话能力组合不等于项目状态组合。会话可调用多个 App；一个 App 不能借此写入另一个 App 的项目。
3. App 私有状态与 Project 状态分别落盘。没有 Project 不是错误，也不自动创建隐藏项目。
4. Doc 的内部状态只由 owner App 读取和修改；跨 Doc 读取调用 owner App 声明的 MCP operation。
5. Agent 消费稳定 MCP 读模型，不消费 App 内部 SQL schema。
6. UI 当前页面只是 workspace hint；它不能在执行中的 Turn 改变写入目标。

### 2.1 Project 即类型化 Doc

Project 可以理解成一份持久化 Doc，而不是“某个 App 的目录”或“一个 SQLite 文件”。owner App 赋予这份 Doc 类型和编辑语义：Vox Project 是视频叙事 Doc，Remotion Project 是可渲染 composition Doc，未来的 Cover Project 则是封面设计 Doc。

一份 Doc 内部可以包含任意数量的结构化记录、关系、版本、动态源文件和交付物。App 的单一 storage.sqlite 与项目 files 只是其机器相；Project name、owner App、Doc/Asset 引用和工作流阶段共同构成其语义相。不同 Doc 类型不共享私有表，但可以通过 owner App operation 和媒体 Asset 相互引用。

### 2.2 Agent 是 Doc 组合任务的执行者

Agent 不拥有 Doc，也不等同于 Session。它执行一个明确的 Task：组合一个或多个输入 Doc 与媒体 Asset，调用对应 App 的 skill 和 operation，最终交付一个或多个输出 Doc。

    Agent Session
      持久对话与历史；可包含多个 Task。

    Agent Task
      一件用户目标明确的工作；记录 inputDocIds、outputDocIds、
      Doc/Asset references、默认 Doc 与执行状态。

    Doc
      Task 的持久输入或输出；由 owner App 类型化。

Session 只负责继续对话。Task 负责可审计的输入、输出和执行边界。一个 Task 可以以当前 Doc 为默认输入，并通过该 Doc owner App 的 operation 读取其他 Doc；若要写入另一份已有 Doc，必须在对应 operation 中显式声明 target。每次显式访问都记入 Task 审计记录。

面向用户的创作 Task 完成时必须返回 outputDocIds。一次单纯生成素材的操作可以先只产生 Asset，但它不是完整创作交付；后续 Task 应将该 Asset attach 到某个输出 Doc，或明确标记为无 Doc 的工具性结果。

## 3. 四层模型

    Capability
      App package: manifest, background.js, skills/<skillId>/SKILL.md

    State
      App state: appstate/<appId>/storage.sqlite plus files/ (唯一 sqlite)
      Project state: projects/<projectId>/files/ (状态在 App 单一 storage.sqlite 内按 project_id 分区)

    Session
      Floating conversation and Tasks; workspace hint plus immutable default Doc per Turn

    Platform
      Catalog, Media, project discovery, identity, permissions,
      namespace resolution, AppHost, Agent Bridge

### 3.1 状态归属

    ~/.recut/
      workspace.sqlite
        platform-only: agent sessions/turns/events,
        projects, artifacts, events,
        media_credentials/routes/assets/asset_projects/jobs/preferences

      appstate/
        <appId>/
          storage.sqlite          # App 唯一的 sqlite 接口（全局 + 它拥有的所有 Project）
          files/                  # App 全局文件

      projects/
        <projectId>/
          files/                  # Project 动态工作目录（无项目级 sqlite）

      sessions/
        agent-bridge/<bridgeSessionId>/workspace/
        terminals/

workspace.sqlite 是平台唯一库。projects 表保存项目元数据（id、name、app_id、app_version、format_version、kind、created_at、updated_at），项目列表一条 SELECT 即可返回，不再逐项目读文件。artifacts 与 events 以 project_id 键归属项目，属于平台，不进入任何 App 库。agent、媒体与凭据同库。

每个 App 只有一个 sqlite 接口：appstate/<appId>/storage.sqlite。它同时承载该 App 的全局状态与它拥有的所有 Project；App 以 ctx.project.id 分区自己的行，无项目时 ctx.project 为 null。项目没有自己的 sqlite 文件，因此 App 对接 sqlite 只需要 ctx.sqlite 一个句柄。

appstate/<appId> 的 files/ 是 App 的全局文件（预设、模板、未命名草稿）。它不以 sessionId 或 projectId 分目录；同一 App 内并行草稿由 App 的 documentId 区分。

Project 是 owner App 的类型化 Doc。项目目录只有 files/（Doc 的动态工作目录，适合 Remotion composition、源码、渲染中间文件和交付物），没有项目级 sqlite、recut.json、logs、sessions、snapshots；Project 元数据在 workspace.sqlite 的 projects 表。

general-chat 与 media-library 不再是隐藏系统项目。首页 = 无 target 的浮动会话；素材库 = appView: media 的无 target 会话，媒体工具天然 workspace 级。

sessions/ 全部位于全局：agent-bridge/<bridgeSessionId>/workspace/ 是每轮 CLI 的独立工作区，terminals/ 是终端会话。

### 3.2 Project 与 App 的边界

Project 只有 Project.AppID，不增加 Project.Apps，也不提供挂载第二个 App 的接口。

    project.appId == invoked appId  -> 该 App 可使用项目状态与 files
    project.appId != invoked appId  -> 该 App 只能使用自己的 appstate

如果两个领域需要长期共享私有状态，它们不是两个松散 App，应成为一个新的组合 App，并由该组合 App 拥有 Project。

### 3.3 App runtime 状态目标

Host 向 background.js 注入统一 target，但不改变 App operation 的业务 input schema：

    Project target
      ctx.sqlite -> appstate/<appId>/storage.sqlite   （与 App-state target 同一库）
      ctx.files  -> projects/<projectId>/files
      ctx.project -> { id, name, appId }

    App-state target
      ctx.sqlite -> appstate/<appId>/storage.sqlite
      ctx.files  -> appstate/<appId>/files
      ctx.project -> null

    ctx.appFiles（常驻，两种 target 下都可用）
      ctx.appFiles -> appstate/<appId>/files

App 只有一个 sqlite 句柄 ctx.sqlite，永远指向 appstate/<appId>/storage.sqlite：它同时保存全局状态与该 App 拥有的所有 Project。App 必须用 ctx.project.id 分区自己的行（表里加 project_id 列，查询/写入时按 ctx.project.id 过滤）；无项目时 ctx.project 为 null，写入全局分区。平台不替 App 做行级隔离，跨 Project 的干净边界是 App 作者契约。不同 App 仍由物理数据库隔离。平台表一律不进入 ctx.sqlite。

## 4. Doc 与 Asset 流通

### 4.1 Doc 引用

Doc ID 是跨 App 的稳定引用。平台的 recut.project.list 和 recut.project.get 只返回 Doc metadata：id、name、owner App、版本和状态，不泄漏私有表。

Agent 需要理解一份 Doc 时，先读取其 owner App skill，再调用该 App 声明的 document.summary、workflow.context 或其他领域 read operation，并把目标 Doc 写入 __recut.target。只有 owner App 的 handler 读取自己的 storage.sqlite；调用者得到的是该 App 明确返回的领域语义。

一期没有通用跨 Doc 批量状态查询。某类 App 如需批量检索自己的 Doc，只能由该 App 显式声明、实现和版本化 list 或 summary operation；它不能查询其他 App 的内部状态。这样批量能力仍由数据 owner 决定，而不把数据库 schema 变成平台 API。

### 4.2 Asset 引用

媒体 Asset 是平台级资源，可没有 projectId。无项目生图、上传或生成的结果直接留在素材库；用户或 App 在需要时调用 attach，将 assetId 关联到目标 Project。媒体 attach 不等同于复制 App 私有状态。

## 5. 能力层：App Skill 树

App 包提供：

    manifest.json
    background.js
    skills/
      <skillId>/
        SKILL.md
        references/
        resources/
        scripts/

SKILL.md 的 frontmatter 至少声明 name、appId、description、references 和 resources。正文只保留主流程与决策门；大块提示词、参考规范和只读资源按需读取。

Host 扫描 App 的 skills 目录，返回 id、appId、name、description 和声明的逻辑资源路径。没有 skills 目录的既有 App 可暂时以根 AGENTS.md 作为一个回退 skill；skills 优先于 AGENTS.md，二者不能同时作为独立权威正文。

技能发现不承担权限控制。所有已安装 App 的 MCP operation 都可以被发现；skill 负责告诉模型何时、为何调用工具。调用 App operation 时仍由目标解析和 manifest 权限决定结果。

子文档读取只能接受 skill 根目录下、前置声明的相对路径。拒绝绝对路径、符号链接和越界路径；二进制 resources 只返回逻辑清单，文本内容按需读取。

## 6. MCP 契约

### 6.1 工具面

所有会话可见的平台工具：

    recut.context
    recut.apps.list / store / install / update
    recut.skills.list / read / reference
    recut.project.list / get / create
    recut.media.configuration
    recut.media.*

所有已安装 App 的 mcp surface operations 同时出现在 tools/list，以 appId.operation 命名。工具说明和 schema 来自 manifest；平台工具与 App 工具不可同名。

App 管理开放给 Agent：`recut.apps.store` 列出 App Store 可安装的 App（GitHub repository 与是否已安装），让 Agent 知道从哪里下载；`recut.apps.list` 返回已安装 App 的 Git 仓库、revision、可更新状态与 skill 目录；`recut.apps.install` 从 Git 仓库安装标准 App；`recut.apps.update` 更新单个或全部已安装 App。这些会改动本地环境，guide 约束 Agent 仅在用户明确要求时调用、绝不主动。媒体凭据与路由的写操作仍只允许 HTTP/UI 的明确用户操作，不向 MCP 开放。

### 6.2 显式 target envelope

宿主保留 operation arguments 的 __recut 字段：

    {
      "__recut": { "target": { "projectId": "..." } },
      "...App business arguments": "..."
    }

Host 在校验后剥离 __recut，background.js 永远看不到它。因此不抢占 App 可能已有的 projectId 业务字段，也不改 App input schema。

tools/list 暴露的是宿主包装后的 schema：复制 App 的 properties 与 required，增加 __recut，并在宿主边界放宽 original additionalProperties 的限制；剥离 __recut 后再按原始 App schema 校验。这样 manifest 使用 additionalProperties: false 时也不会拒绝合法 target。

### 6.3 target 解析

    resolveTarget(task, turn, appId, explicitTarget):
      1. explicitTarget.projectId:
           project 必须存在，且 project.appId == appId
           将 projectId 追加到 task.accessedDocIds 审计记录
      2. turn.defaultDocSnapshot.projectId:
           仅当该 project.appId == appId 时使用
      3. 否则：
           使用 appstate/<appId>

平台 media 工具没有 appId，不解析为某个 App 的 appstate。它只接受显式 Project target 或 Turn snapshot 中的 Project target；两者都不存在时生成 workspace 级 Asset。

### 6.4 recut.context

recut.context 返回：

    session identity
    current workspace hint
    active Task inputDocIds, outputDocIds and accessedDocIds
    current Turn default Doc snapshot
    current Project metadata when target is Project
    installed App and skill directory
    configured media routes

它不返回 Doc 私有状态，不调用某个 App 的 workflow.context，也不因页面切换改变当前 Turn 的 target。模型选择 skill 后，再调用对应 App 的 workflow.context、document.summary 或其他领域 read operation。

## 7. 会话层与 Agent Bridge

### 7.1 会话和 Turn

agent_sessions 保存 workspace_context_json。它只是 UI 页面语义：

    projectId?
    appId?
    appView?

agent_tasks 新增 input_doc_ids_json、output_doc_ids_json、accessed_doc_ids_json、status、created_at 与 completed_at；agent_turns 增加 task_id 和 default_doc_json。

StartTurn 会创建或继续一个 Agent Task，并从 workspace hint 复制、校验默认 Doc，形成不可变 default Doc snapshot。一个正在执行的 Turn 无论用户怎样切换页面，都继续使用该默认 Doc；Task 若要组合或写入其他 Doc，必须逐次以显式 target 调用并留下 accessedDocIds 审计。

agent_sessions.project_id 不再是默认写入目标；会话可空。project_id 仅作向后兼容的遗留 hint，默认写入目标来自 workspace_context_json 与 Turn default Doc 快照。

PUT agent-sessions/:id/context 只更新下一次 Turn 的 hint，并校验 projectId 和 appId 的存在性与匹配关系。它广播 session.updated，但不会修改已持久化 Turn 或正在进行的 Task。

GET agent-sessions 默认按 updated_at 返回全局历史；projectId 是筛选参数，不再是会话归属。

### 7.2 会话工作区

每次本地 CLI 使用独立会话工作区：

    sessions/agent-bridge/<bridgeSessionId>/workspace/
      AGENTS.md
      .codex/config.toml
      opencode.json
      project -> projects/<projectId>   only for Project target

所有 runtime 的 cwd 都是该 workspace。Codex、Claude 和 OpenCode 的 guide 与 MCP 配置因此不会写入用户项目根，也不会被并发会话覆盖。

Project target 时，workspace/project 是指向 Project 动态目录的受控链接。原生生成图片必须写入 workspace 内的相对路径，例如 project/files/cover.png；import_image 在 session workspace 内校验真实路径，再依据 frozen target 关联 Asset。App 包不再通过单数 .recut/app 暴露；领域规则由 skills.read 提供。

bridge session 的 token 携带 frozen default Doc、Task ID 与最小调用权限。MCP 子进程可以操作该默认 Doc，或以显式、通过校验的 target envelope 访问另一份 Doc；两种情况都写入 Task 审计。

## 8. 存储定稿（无历史迁移）

### 8.1 目标布局

- Project 保留单一 AppID，不增加 Apps 数组。
- workspace.sqlite 新增 projects 表（元数据）、artifacts（project_id 键）、events（project_id 键）；agent、媒体、凭据同库。
- AppStateDatabase 指向 appstate/<appId>/storage.sqlite：每个 App 唯一的 sqlite 接口（全局 + 所有 Project，按 project_id 分区）。
- ProjectFilesRoot 指向 projects/<projectId>/files（项目目录无 sqlite 文件）。
- AppStateFilesRoot 指向 appstate/<appId>/files。
- sessions/ 全局：agent-bridge 工作区与 terminals。
- 删除 general-chat / media-library 隐藏系统项目；standalone App 的 workspace-app-<appId> 由 appstate/<appId> 取代。

### 8.2 版本门禁（无数据迁移）

当前没有历史用户数据，不设计迁移路径。workspace.sqlite 记录布局版本（layout version）；启动时若版本高于实现支持版本则拒绝启动；低于支持版本且不兼容时，把旧数据目录整体改名留档，并初始化全新数据目录，不做猜测性搬表。App 升级导致的 schema 演进由 App 自己在 storage.sqlite 内做 additive 迁移。

## 9. HTTP 与 Web

### 9.1 HTTP API

修改：

    POST /v1/agent-sessions
      projectId 可空；接收 workspace context

    GET /v1/agent-sessions
      默认全量；projectId 仅筛选

新增：

    PUT /v1/agent-sessions/:id/context
    GET /v1/apps/:appId/skills
    GET /v1/apps/:appId/skills/:skillId
    POST /v1/mcp

删除规划：

    Project.Apps
    POST /v1/projects/:id/apps/:appId
    project-wide import_scratch
    GET /v1/apps/:appId/workspace（standalone）——改读 appstate/<appId>
    workspace-app-<appId> 隐藏项目与 general-chat / media-library 假项目

### 9.2 Web UI

Agent store 改为全量会话缓存和客户端筛选。页面只在用户切换视图后上报 workspace hint；侧栏会话项显示上一次上下文徽标，但不把它显示为永久归属。

首页允许直接选择已安装 App 的 skill 并开始创作。没有 Project 时 App 写入自身 appstate，生成媒体留在素材库。需要正式工作流或持久化交付时，Agent 提议创建 owner App 对应的 Project Doc。

项目页默认把新 Turn 的 workspace hint 设为该 Project。只有 owner App 的 operation 自动路由到该项目；其他 App 的调用在 UI 中明确显示为使用其全局状态。

App 商店展示 skill 目录和 App 明确声明的 Doc read/write operation，不展示任意内部表。

## 10. 外部 Agent 封装

Recut 对 Codex CLI、Claude Code 和 OpenCode 暴露一个平台 skill 与 MCP server。

recut mcp 是薄 stdio JSON-RPC 转发器，调用带 Bearer token 的 POST /v1/mcp。Daemon 处理同一 MCP 契约；外部 Agent 没有 Recut 内部会话历史，也没有隐式网页上下文。

设备 token 必须：

- 仅允许 loopback MCP HTTP 入口。
- 以哈希形式持久化，带 id、scope、创建时间、过期时间与吊销状态。
- 按 Project、App state 与 media read/write 分 scope。
- 审计每个调用者与最终 target。

外部调用必须使用显式 __recut.target，或默认落到目标 App 的 appstate。可选 default project 只能是 token scope 内、不可被其他客户端静默修改的固定配置。

recut agent install 注册 MCP server 并安装平台 skill；App skill 默认经 recut.skills.read 实时读取，不镜像本地。agent sync 可以显式镜像只读技能正文。

## 11. 分阶段实施

### Phase 1：存储与运行时边界

1. 固化 Project 单 App 契约，删除多 App Project 规划。
2. workspace.sqlite 新增 projects / artifacts / events 表；Store 提供 AppStateDatabase（唯一 sqlite）、ProjectFilesRoot、AppStateFilesRoot；项目元数据改读 projects 表。
3. runtime target：Project / App-state 双 target；ctx.sqlite 始终指向 appstate/<appId>/storage.sqlite，App 以 ctx.project.id 分区；ctx.appFiles 常驻；删除 per-project 的 recut.json、logs、sessions、snapshots 目录。
4. standalone 改读 appstate（server.go 的 workspace 端点）；删除 general-chat / media-library 假项目。

验证：同一 App 可在无项目状态保存预设到 appstate；创建 Project 后经同一 ctx.sqlite 以 ctx.project.id 分区写入，项目 files 可写；另一个 App 无法读取该 App 的 storage.sqlite，只能经 owner App 声明的 read operation 理解该 Doc。

### Phase 2：会话与本地 Bridge

4. 增加 agent_tasks、workspace_context_json、turn task_id 与 default_doc_json。
5. 让 StartTurn 冻结默认 Doc，context 更新只影响下一 Turn；显式 target 访问追加 Task 审计。
6. 实现 session workspace，三个 CLI 都从该目录加载 guide 与 MCP 配置。
7. 调整 native image import 的 session base 与 target attach。

验证：执行中切换网页不会改变默认 Doc；一个 Task 可组合多个输入 Doc 与 Asset 并交付多个 outputDocIds；两个并发会话不会覆盖 guide/config；项目动态文件可由 session workspace 受控访问。

### Phase 3：Skills 与 MCP

8. 实现 skill 树、frontmatter、引用路径校验和 AGENTS.md 回退。
9. tools/list 遍历 Catalog；实现 __recut target envelope、recut.context、Doc read operation 路由和 App-state fallback。
10. 重写平台 guide，移除强制 project_context、.recut/app 和当前 App 全文注入。

验证：首页会话读取 Vox skill 后写 App state；Agent 可通过 owner App 的 read operation 组合多个 Doc；越界 skill 路径、错误 owner App target 和跨 App 私有状态读取全部被拒。

### Phase 4：Web 与外部 Agent

11. 完成全局历史、上下文徽标、首页直接创作和 App state 状态提示。
12. 实现 loopback MCP HTTP、设备 token、recut mcp 与 agent install/status/uninstall。

验证：裸目录中的外部 Codex 或 Claude 能读取 skill、读取 Doc metadata、生成未关联素材或写指定 Project；越权 token 与未显式目标均失败或明确回退到 App state。

## 12. 风险与验收

主要风险不是 SQLite 文件数量，而是数据边界被隐式 target 或跨库私有查询打破。实现必须以以下标准验收：

- 一个 Project 只声明一个 owner App，且只有它能获得该 Project 的 ctx.sqlite 和 ctx.files。
- 每个 App 只有一个 sqlite 接口 appstate/<appId>/storage.sqlite，以 ctx.project.id 分区全局与所有 Project；平台表（projects/artifacts/events/agent/media）全部位于 workspace.sqlite。
- 任意 App 在无 Project 时可使用自己的 appstate（ctx.project 为 null）；项目模式下 ctx.sqlite 仍是同一句柄。
- 任意会话能发现和调用全部已安装 App，但不会因 UI 导航改变已开始 Turn 的目标。
- 一个 Agent Task 可组合多个输入 Doc，所有显式访问均可审计，并以一个或多个 outputDocIds 交付用户可见结果。
- 跨 Doc 读取只经 owner App 明确声明的 operation；平台不提供跨 App 私有状态查询。
- Media Asset 可以先全局存在，再显式 attach 到 Project。
- 无 general-chat / media-library 假项目；sessions/terminals 全部位于全局目录。
- 任意路径越界、错误 owner App、未授权 token 和私有数据库跨 App 读取均被拒绝。
- Project 创建、删除、导出和备份都由平台按 projectId 协调项目目录、Doc 引用与媒体关联，不能只操作一个目录。

[PROTOCOL]: 变更时更新此头部，然后检查 dev/README.md
