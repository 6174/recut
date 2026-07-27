# vox-broll/

> L2 | 父级: /apps/README.md

成员清单
manifest.json: 唯一运行时配置，声明 B-roll 的 JS 入口、权限、统一 operations 的调用说明、输入 schema 与暴露面；含读取资源全文与按节拍原位更新的 MCP 契约。
AGENTS.md: B-roll 七阶段创作契约与媒体执行边界；规定声音先于场景视频、Keyframes 必须图文配对，并强制图片、旁白和 Scene 分别调用 Recut MCP 媒体 API；平台媒体调用不是本地视频创作，禁止用 HyperFrames、通用视频 Skill 或本地渲染替代。
background.js: 自行创建 briefs/resources SQLite 表并发布 Artifact；定义并校验七种资源的输入/输出契约，强制 Keyframes 保存图片、Audio 每段保存真实语音 `assetId`，将昂贵视频拆为每 Beat 一个 Scene resource，支持按 `beatId` 原位合并局部更新，首次读取清理历史空媒体资源，并支持受依赖保护的手动删除。
ui/index.html: React/Vite 开发入口。
ui/src/: B-roll 的 React UI 源码、宿主事件订阅与样式；以多面板工作台同时预览所有创作阶段。
ui/package.json: UI 独立构建依赖与 Vite 命令。
ui/dist/: Vite 构建产物，manifest 的项目 UI 入口。

服务边界
此 App 只覆盖 B-roll：主题到 Vox 风格纸质拼贴解说片。平台不理解 Brief/Look 数据结构；`background.js` 通过 SQLite/Artifact capability 自行实现。Agent 通过 MCP 的 `tools/list` 获得 operation 的名称、说明和 input schema；`workflow.context` 再返回当前有效资源、阶段准入、下一步动作、逐类资源契约、媒体快照结构和 `mediaExecution` 意图路由，是创作时的唯一真相。媒体资产始终由全局素材库 `assetId` 标识；图片生产输入为 `text + imageAssetIds`，异步语音和视频在提交时取得稳定的 queued `assetId`，常驻 Daemon 在同一 ID 上更新状态；视频生产输入为 `text + imageAssetIds + audioAssetIds`，其中音频必须已完成。视频每段独立保存为一个 Scene resource，默认只生成下一段；用户明确要求全部生成时才连续处理剩余段。HyperFrames 等扩展只在用户明确选择其合成能力时使用，不能替代平台媒体生成。局部修订通过 `resource.read → resource.update.itemPatch` 保持资源 ID 与依赖不变。领域 AGENTS.md 不重复接口字段。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
