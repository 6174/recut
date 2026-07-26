# vox-broll/

> L2 | 父级: /apps/README.md

成员清单
manifest.json: 唯一运行时配置，声明 B-roll 的 JS 入口、权限、App API、MCP 工具与可缓存 UI 版本。
AGENTS.md: Agent 创作契约，定义七阶段资源图、两个人工决策门、持久化边界和跨 App 协作规则；吸收 vox-director 的创意工作流而不绑定其渲染栈。
background.js: 自行创建 briefs/resources SQLite 表并发布 Artifact；为视觉风格注入“生成风格图 → assetId + prompt → Look 资源”的强制创作链，首次读取时清理历史旧格式 Look，并支持受依赖保护的手动删除。
ui/index.html: React/Vite 开发入口。
ui/src/: B-roll 的 React UI 源码、宿主事件订阅与样式；以多面板工作台同时预览所有创作阶段。
ui/package.json: UI 独立构建依赖与 Vite 命令。
ui/dist/: Vite 构建产物，manifest 的项目 UI 入口。

服务边界
此 App 只覆盖 B-roll：主题到 Vox 风格纸质拼贴解说片。平台不理解 Brief/Look 数据结构；`background.js` 通过 SQLite/Artifact capability 自行实现。Look 是项目级媒体资产 `assetId` 与原始图片 prompt 的组合，文字字段只补充视觉约束。Agent 的 `generate_brief` MCP 工具和其他 App 的 `brief.create` API 共用同一业务函数。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
