# service/

> L2 | 父级: /README.md

成员清单
main.go: 组合 Daemon、AppHost、MCP Host 与 loopback HTTP 服务，并在启动时协调可恢复的远端媒体任务。
catalog.go: 从运行时 `~/.recut/apps` 读取和校验 manifest.json，跟随开发 App 的符号链接，不理解 App 数据布局。
project.go: 创建平台项目并按 App scope 提供 SQLite、文件与 Artifact 存储。
runtime.go: 在 Goja sandbox 中执行 App background.js，并注入统一 operation 注册器；同一 handler 可按 manifest surface 暴露给 UI API 与 MCP。
mcp.go: 将带 App workflow context、默认媒体契约和凭据可用音色的 recut.project_context、同步 recut.image.generate、异步 recut.video.generate_async/recut.speech.generate_async、recut.media.list_voices 与当前 App 的 manifest operations 路由给 JavaScript handler。
mcp_test.go: 锁定按图片、视频和语音拆分的 MCP 生成工具及其互不混淆的输入 schema。
server.go: 提供项目、App UI、App API、Artifact 与终端 HTTP 边界；启动 Recut 项目 Codex 时保留用户扩展配置，并注入 Recut MCP 媒体 API。
bridge.go: 管理 Agent session 与本地 CLI 连接，为项目挂载 `.recut/app`，再用内嵌 prompts/ 核心模板和当前 App 的 AGENTS.md 渲染 Codex 项目 guide。
bridge_prompt_test.go: 锁定渲染后的 Vox Agent guide 必须使用 Recut 视频生成 API，且禁止把场景生成委托给 HyperFrames 或本地渲染。
prompts/: Go 后端私有的嵌入式平台 Agent 模板；不会作为 App 包内容或运行时外部依赖暴露。
agent.go: 保存本机用户的一对一 Agent 会话、消息、图片资产引用、Codex 模型/推理强度与事件；同一会话把生成期间的新消息持久化为 FIFO 待发送队列，停止操作先即时持久化 cancelled/idle 终态再终止运行时，附件以 assetId、来源和只读路径同时交给 Agent，Codex 以原生图片参数和会话固定模型配置读取受控资产，并将 JSONL 规范化为保留工具输入、输出、失败态和耗时的 UI 时间线协议。
agent_server.go: 提供 Agent Session 的创建、Codex 会话模型/推理强度更新、带项目图片资产引用的待发送消息入队、停止、查询与 SSE 事件 API。
media_adapter.go: 根服务与 media 子包的窄 Store 适配器和兼容类型别名；不承载任何媒体业务。
media/: 独立媒体领域包；按类型、模型目录、配置凭据、资产和任务拆分，Provider 协议位于 `providers/` 子目录。
media_server.go: 素材库、图片/视频/音频导入、模型、凭据、路由、任务和资产内容的 HTTP API。
media_test.go: 验证媒体凭据不泄漏、Provider 模型归属、隐藏素材库系统项目、默认路由、模型/凭据直连校验和生成任务幂等性。
terminal.go, ws.go: PTY 和事件传输基础设施。
*_test.go: manifest、存储与 JS runtime 的回归验证；其中 runtime_test.go 断言 Vox Keyframes 不能退化为纯文本且接受带图片快照的结构化产出。

依赖关系

`Catalog -> Store -> AppHost -> Server/MCP Host`；`media_adapter -> media.Service -> providers/* -> WorkspaceDatabase/media files` 是平台级资源路径；`AgentManager -> Store.WorkspaceDatabase -> Codex JSONL` 是平行的对话协议路径。PTY 保留在 `TerminalManager`，仅作兼容与诊断，不能成为对话 UI 的真相源。App 代码只能经 `ctx.sqlite`、`ctx.files`、`ctx.artifacts` 或 `recut.media.*` 使用平台资源；Host 决定权限和实际路径。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
