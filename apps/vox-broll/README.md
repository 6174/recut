# vox-broll/

> L2 | 父级: /apps/README.md

成员清单
manifest.json: 唯一运行时配置，声明 B-roll 的 JS 入口、权限、统一 operations 的调用说明、输入 schema 与暴露面，以及可缓存 UI 版本。
AGENTS.md: 纯领域创作契约，定义 B-roll 的七阶段、声音先于场景视频的关系、审美标准与审批门；不包含平台工具或运行时实现。
background.js: 自行创建 briefs/resources SQLite 表并发布 Artifact；定义并校验七种资源的输入/输出契约，计算权威 workflow context，将同步生成的风格图以 `assetId + prompt` 保存为 Look，首次读取时清理历史旧格式 Look，并支持受依赖保护的手动删除。
ui/index.html: React/Vite 开发入口。
ui/src/: B-roll 的 React UI 源码、宿主事件订阅与样式；以多面板工作台同时预览所有创作阶段。
ui/package.json: UI 独立构建依赖与 Vite 命令。
ui/dist/: Vite 构建产物，manifest 的项目 UI 入口。

服务边界
此 App 只覆盖 B-roll：主题到 Vox 风格纸质拼贴解说片。平台不理解 Brief/Look 数据结构；`background.js` 通过 SQLite/Artifact capability 自行实现。Agent 通过 MCP 的 `tools/list` 获得 operation 的名称、说明和 input schema；`workflow.context` 再返回当前有效资源、阶段准入、下一步动作、逐类资源契约和媒体快照结构，是创作时的唯一真相。媒体资产始终由全局素材库 `assetId` 标识；图片生产输入为 `text + imageAssetIds`，视频生产输入为 `text + imageAssetIds + audioAssetIds`，`sourceResourceIds` 只记录当时引用的创作决策。领域 AGENTS.md 不重复接口字段。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
