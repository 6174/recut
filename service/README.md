# service/

> L2 | 父级: /README.md

成员清单
main.go: 组合 Daemon、AppHost、MCP Host、内嵌工作台与默认监听全部网卡的 LAN HTTP 服务；启动时创建隐藏 media scope、先将重启遗留的 Agent 运行态收敛为可解释终态，再恢复媒体任务；初始化 UTC 微秒服务日志并将其落盘到 `<data-dir>/logs/`；将平台 MediaService 注入 AppHost，供已获授权的 App 发起本地两轨导出；仅常驻 Daemon 在启动恢复后以 SQLite lease 定期提交/回收媒体任务，短生命周期 MCP 只持久化 queued 任务。
logging.go: service 可观测性边界；将标准库日志以 UTC 微秒时间戳同时输出到 stderr 与 `<data-dir>/logs/service-YYYY-MM-DD.log`，并按 HTTP 最终状态码记录 INFO/WARN/ERROR 请求审计，保留 SSE、WebSocket 等 ResponseWriter 能力。
logging_test.go: 锁定请求审计的状态码分级与耗时字段，不创建真实日志文件。
catalog.go: 从运行时 `~/.recut/apps` 读取和校验 manifest.json，按目录与 manifest 指纹在本地 link/修改后原子刷新注册表，强制每个 App 声明作者和简短描述，跟随开发 App 的符号链接且不清空缓存化 Git 远端检查状态；素材库只以无磁盘包的隐藏 scope 供平台 Agent/MCP 使用，旧失效链接不会阻止 daemon 启动。
onboarding.go: 新对话引导真相源；合并当前 App manifest、用户级全局设置，并仅在两者都为空时返回平台内置兜底，严格只使用显式 prompt。
app_install.go: App 分发边界；仅接受 HTTPS GitHub 地址，在临时 clone 通过 manifest 校验后激活，立即返回缓存化安装状态并在后台单飞抓取远端，任何 clone/fetch/pull 均不持有 Catalog 锁；以 Git status/fast-forward 管理单个或批量升级，原生素材库不进入 App 分发链。
app_install_test.go: 锁定 GitHub 地址规范化、dirty Git 工作树识别、本地目录刷新不清空远端检查缓存、后台远端检查不阻塞 Catalog 读取与临时本地 remote 的更新检测/批量升级，不访问网络。
updater.go: macOS service 自更新器；下载并校验 Cloudflare 发布 manifest/归档，原子替换当前 binary 后交给 launchd 重启，并只对已安装的 `recut-service` 暴露重启能力。
updater_test.go, server_update_test.go: 锁定自更新归档提取和 HTTP 可用性边界；不下载、替换或重启真实 daemon。
project.go: 创建平台项目并按 App scope 提供 SQLite、文件与 Artifact 存储；独立型 App 使用稳定但不出现在项目列表中的工作区 scope，原生素材库与首页 general chat 各使用同样隐藏的系统 scope；每个 SQLite 文件在 service 内由共享的有限连接池管理，连接统一启用 WAL、NORMAL 同步与 15 秒 busy timeout，既允许嵌套读取又让并发写入等待而非随机失败；缓存句柄以 100ms 上限探测，连接池繁忙时继续复用、调用方已关闭时才重开。
runtime.go: 在 Goja sandbox 中执行 App background.js，并注入统一 operation 注册器；同一 handler 可按 manifest surface 暴露给 UI API 与 MCP；获授权的 App 可将已完成 Asset materialize 到私有文件、在用户确认后 import 私有输出，并使用通用 `ctx.shell` Job 或 manifest 声明的 `ctx.python` venv，模型根固定注入为 `~/.recut/models`。
shell_jobs.go: 可恢复的非交互本地进程任务；持久化 queued/running/terminal 状态和顺序 stdout/stderr JSONL 日志，投递项目事件，并在 service 日志记录不含命令参数的排队/终态审计，支持取消，并在 daemon 重启时将未完成任务收敛为 interrupted。
terminal.go: 通用 PTY 会话管理器；持久化 transcript 与摘要、支持输入/尺寸/订阅和终止，并在 service 日志记录不含参数的会话启动与退出。
python_runtime.go: manifest 驱动的 Python 环境生命周期；以 App id、逻辑 venv 名和 requirements 指纹派生 `~/.recut/python/envs/` 路径，平台创建 venv/安装依赖，App bootstrap 仅作为自由兜底。
mcp.go: 将真实项目创建 `recut.project.create`、带 App workflow context、默认媒体契约和凭据可用音色的 recut.project_context、同步 recut.image.generate、受限的 Codex 原生图归档 recut.media.import_image、异步 recut.video.generate_async/recut.speech.generate_async、语音终态等待 recut.media.wait_for_job、recut.media.list_voices 与当前 App 的 manifest operations 路由给 JavaScript handler；每个 stdio 请求独立并发执行并以 JSON-RPC id 回应，故本地素材查询不会被同步图片生成阻塞；数组结果仅在 structuredContent 中包装为 `{items: [...]}` 以满足 OpenCode record 契约，文本内容仍是原始 JSON；项目内 Brief、Artifact 和资源绝不冒充项目；原生图只接受当前项目内相对路径，并验证真实路径、类型和大小后关联为 Asset。
mcp_test.go: 锁定按图片、视频和语音拆分的 MCP 工具、原生图片归档输入 schema，以及项目边界不可逃逸。
server.go: 提供带进程启动时间的 health、项目、独立 App 工作区 scope、App UI、App API、受 App scope 校验的私有预览文件、App 安装/单个或批量升级、service self-update/restart、Artifact、终端、使用共享 CLI 定位缓存的 Agent 可用性、OpenCode TUI 模型目录与内嵌本地工作台 HTTP 边界；本机或私有网络可在新标签页读取 service `PATH`、login shell CLI 解析结果和受限近期日志，公网请求拒绝访问该诊断页；App `index.html` 直接返回且每次重新验证，不产生可缓存的 301；动态 `/v1` API 禁止缓存，精确 API 路由优先于同源 UI 兜底，并允许 `recut.video`、loopback 与私有/链路本地 IP 的浏览器跨域访问 LAN API。
workspace_embed.go: 将 `ui/assets/` 的 local mode 工作台静态导出嵌入 service binary；绝不嵌入 Cloudflare 发布用的 service 安装包。
workspace_server.go: 将内嵌工作台映射到根路径，并把顶层 Tab、项目/App 语义深链收敛到带尾部斜杠的静态目录壳，杜绝静态目录相对重定向造成路径重复；Next hash 资源以 immutable 缓存交付。
workspace_server_test.go: 锁定本地首页、顶层 Tab 与项目/App 深链无重定向、Next 静态缓存及 HTTP 方法边界；不需要真实前端构建。
ui/: 内嵌本地工作台的生成资源边界；`assets/` 仅由 Makefile 暂存，目录 README 记录它与 Cloudflare 发布物的单向关系。
bridge.go: 管理 Agent session 与本地 CLI 连接，为普通 App 项目挂载 `.recut/app`，再用内嵌 prompts/ 核心模板和当前 App 的 AGENTS.md 渲染 Codex 项目 guide；OpenCode 的 MCP 初始化与工具调用统一配置为 5 分钟；原生素材库只使用平台模板，不读取任意工作目录的 AGENTS.md。
bridge_prompt_test.go: 锁定渲染后的 Vox Agent guide 必须使用 Recut 视频生成 API、包含中文 Vox 提示词/导演语言，且禁止把场景生成委托给 HyperFrames 或本地渲染。
prompts/: Go 后端私有的嵌入式平台 Agent 模板；不会作为 App 包内容或运行时外部依赖暴露。
agent.go: 保存本机用户的一对一 Agent 会话、消息、项目媒体引用、Codex 模型/推理强度与事件；Codex、Claude 与 OpenCode 的可执行位置共享 Store 的持久化定位缓存，缓存失效或启动失败才刷新；OpenCode 配置和每次执行仍读取本机 `opencode models`，只接受 TUI 当前真实可选的全部 provider/model，默认 Go DeepSeek V4 Flash，新会话显式标题以避免额外标题模型请求，并以 `--auto` 自动批准未被 OpenCode 明确拒绝的工具调用，使其与 Codex 的无人值守执行模式一致，并将模型连接重试映射为 UI 状态；OpenCode 单次执行最多等待 6 分钟，超时失败后清除原生会话，避免坏的 provider stream 被下一条消息复用；会话详情先完整读取并关闭 Turn 结果集，再查询附件，因此单连接池也不会自锁；同一会话把生成期间的新消息持久化为 FIFO 待发送队列，消息、附件和会话运行态以单一短事务原子提交，停止操作原子取消 active 与 queued Turn、结束关联 Task、将会话收敛到 idle 并清除 OpenCode 原生会话后才终止运行时；服务日志审计会话和 Turn 的排队、开始、完成、取消及失败，但绝不写入用户消息或 CLI 输出；服务重启时取消无法跨进程恢复的 active Turn、把会话收敛为空闲并恢复安全的 queued Turn，附件以 assetId、类型、来源和只读路径同时交给 Agent，Codex 仅对图片注入原生图片参数，所有媒体均以稳定引用和路径进入上下文，并将 JSONL 规范化为分离的工具输入、输出、OpenCode `state.error` 与成本信息，供 UI 时间线完整查看；general chat 复用隐藏系统 scope，绝不混入用户项目会话。
agent_process_unix.go, agent_process_windows.go: Agent CLI 的平台进程生命周期边界；Unix 将每次 CLI 置于独立进程组并在取消时共同终止 OpenCode 与 MCP 子进程，Windows 保持同一调用契约并使用 Go 的直接子进程取消。
agent_test.go: 锁定 Agent 附件上下文、Codex/OpenCode 工具事件、CLI 定位缓存的私有落盘/命中/失效刷新/启动重试、共享 SQLite 并发与单连接池详情读取、停止时 active/queued Turn 共同收敛、OpenCode 原生会话重置和重启后的 Turn 收敛。
agent_process_unix_test.go: 锁定 Unix 下取消 Agent CLI 会终止整个进程组，不残留 OpenCode 的 MCP 子进程。
agent_cli.go: Agent CLI 可执行文件解析器；先使用常规 PATH，再通过当前用户的 login shell 动态执行 `command -v` 并验证绝对可执行路径，消除 launchd/systemd 常驻环境与交互 shell 的 PATH 差异，不编码 NVM 等版本管理器的目录结构；缓存未命中时以单飞 shell 探测、且不持有解析器锁，解析结果连同动态 PATH 原子持久化到 `<data-dir>/config/agent-commands.json`（目录 `0700`、文件 `0600`）；正常刷新只校验缓存路径可执行，缓存缺失、路径失效或 CLI 启动失败才重新解析；启动 CLI 时以动态 PATH 替换 daemon PATH，保证 `#!/usr/bin/env node` 等依赖能正确解析；完整多 shell 扫描只由诊断页触发，shell 初始化最多等待 8 秒并留下明确超时原因。
agent_server.go: 提供项目或 general scope Agent Session 的创建、Codex 会话模型/推理强度更新、OpenCode 的实时 TUI 模型目录、带项目媒体资产引用的待发送消息入队、停止、查询与 SSE 事件 API，以及全局与按项目解析的新对话引导 API；`scope=general` 只列出隐藏 general scope 的会话，省略创建请求的 projectId 会在服务端绑定该 scope；仅对当前进程真实运行的回复接受停止，并准确区分会话不存在与存储暂时读取失败。
agent_server_test.go: 锁定全局 onboarding 的保存、通用/项目/独立 App scope 的会话隔离与最新优先，以及 App/全局按项目解析 HTTP 契约；不启动真实 Agent CLI。
media_adapter.go: 根服务与 media 子包的窄 Store 适配器和兼容类型别名；不承载任何媒体业务。
media/: 独立媒体领域包；按类型、模型目录、配置凭据、资产和任务拆分，Provider 协议位于 `providers/` 子目录。
media_server.go: 素材库、图片/视频/音频导入、模型、凭据、路由、任务、资产内容及基于 SQLite 事件账本的 Asset SSE HTTP API；已完成 Asset 内容标记为不可变缓存，避免重复媒体读取。
media_test.go: 验证媒体凭据不泄漏、Provider 模型归属、Atlas 异步 prediction 原位回收、生成耗时和模型/凭据直连校验。
media_compose_test.go: 以本机 FFmpeg 生成极小测试素材，验证视频轨与音频轨被合成为一个新的、已关联项目的 video Asset；未安装 FFmpeg 时跳过并由产品 UI 给出安装路径。
media_lifecycle_test.go: 验证 queued 本地 Asset 由常驻 Daemon 原子认领并原位完成、重启恢复与基础媒体生命周期。
media_scheduler_test.go: 验证 Atlas 与 one-request Provider 在 daemon 崩溃后的提交 checkpoint 都不重放、Atlas 单边远端关联会自愈、两个 Daemon 共享 SQLite 时仅一个可提交任务。
media_events_test.go: 验证 Asset SQLite 事件账本的 SSE snapshot、生成耗时元数据更新、游标回放与 Last-Event-ID 重连契约。
terminal.go, ws.go: PTY 和事件传输基础设施；订阅先快照会话再读取 transcript，慢文件 I/O 不阻塞终端状态锁。
*_test.go: manifest、存储与 JS runtime 的回归验证；其中 runtime_test.go 断言 Vox Keyframes 不能退化为纯文本且接受带图片快照的结构化产出。

依赖关系

`web/out (local) -> ui/assets -> workspace_embed -> workspace_server -> LAN /` 是本地工作台的单向资源路径，`releases/` 在进入 `ui/assets` 前被移除；相反 `web/out (cloud)` 保留 release binary 供 Cloudflare 安装器下载。普通扩展走 `Catalog -> Store -> AppHost -> Server/MCP Host`；素材库走 `web/app/media -> media_server -> media_adapter -> media.Service -> providers/* -> WorkspaceDatabase/media files`，其隐藏 media scope 只保存资产归属和 Agent session，不进入 Catalog、App 分发或 iframe 宿主。获 `media.read` 的 App 只能复制已完成 Asset 到自己的 files，获 `media.write` 的 App 仅能从自己的 files 创建新 Asset；`shell.exec` 保留短命令兼容，`shell.start/status/cancel` 提供持久任务和实时项目事件。Python App 另以 `manifest.runtime.python` 声明逻辑 venv、requirements 和 optional bootstrap：平台拥有 `~/.recut/python/envs/<app>/<venv>/<fingerprint>/` 的创建、依赖和路径注入，模型仍位于 `~/.recut/models/`；bootstrap 可以自由准备代码或系统资源。异步媒体由 MCP 先原子持久化 `job -> queued asset`，再由常驻 Daemon 的周期调度器用 SQLite lease 认领、写入外部调用 checkpoint、提交远端 prediction、原位回收；只有已持久化 remote prediction 可安全重试轮询，未绑定 prediction 的过期调用明确失败而不重复收费。每次 Asset 变化与 SQLite `media_asset_events` 同事务提交，前端通过 `/v1/media/events` 的 snapshot/replay SSE 读取本地状态，绝不直接轮询 Provider。SSE 读者由进程内 changeHub 在写事务提交后立即唤醒，仅以 1 秒慢轮询兜底捕捉短命 MCP 进程的跨进程写入；SQLite DSN 以 `_txlock=immediate` 起始写事务并配合 WAL，消除 deferred 读后升级的 SQLITE_BUSY 死锁。Agent 事件与项目事件的 SSE 订阅共享同一唤醒机制。`AgentManager -> Store.WorkspaceDatabase -> Codex JSONL` 是平行的对话协议路径。PTY 保留在 `TerminalManager`，仅作兼容与诊断，不能成为对话 UI 的真相源；相反，运行中的 Agent CLI 将 stdout/stderr 镜像到 AgentManager 的有界内存流，再由 `/v1/agent-sessions/{id}/cli-stream` 仅向当前本机调试弹框 SSE 输出，绝不写入 service log 或 SQLite。App 代码只能经 manifest 授权的 `ctx.sqlite`、`ctx.files`、`ctx.media`、`ctx.artifacts`、`ctx.shell` 或 `ctx.python` 使用平台资源；Host 决定权限和实际路径。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
