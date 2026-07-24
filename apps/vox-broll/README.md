# vox-broll/

> L2 | 父级: /apps/README.md

成员清单
manifest.json: 唯一运行时配置，声明 B-roll 的 JS 入口、权限、App API 和 MCP 工具。
background.js: 自行创建 briefs SQLite 表、写入 App 文件并发布 `recut.vox.brief@1` Artifact。
ui/index.html: React/Vite 开发入口。
ui/src/: B-roll 的 React UI 源码与样式。
ui/package.json: UI 独立构建依赖与 Vite 命令。
ui/dist/: Vite 构建产物，manifest 的项目 UI 入口。

服务边界
此 App 只覆盖 B-roll：主题到 Vox 风格纸质拼贴解说片。平台不理解 Brief 数据结构；`background.js` 通过 SQLite/files/Artifact capability 自行实现。Agent 的 `generate_brief` MCP 工具和其他 App 的 `brief.create` API 共用同一业务函数。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
