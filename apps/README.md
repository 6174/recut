# apps/

> L2 | 父级: /README.md

成员清单
vox-broll/: B-roll 项目型案例；其 JS 自行定义 brief 数据、资源契约与统一 operation handler，领域 AGENTS.md 只描述创作方法。
media-library/: 内部系统 App；为工作区素材库复用标准 Agent/MCP 会话，不能被用户作为项目创建。

此目录只保存开发源码，运行时只从 `~/.recut/apps` 发现 App。执行 `make app-link` 会按包创建链接，开发源码与运行中 App 因而是同一份文件；项目内 `.recut/app` 再链接到该包供 Agent 读取和迭代。

App 包不包含平台配置碎片。`manifest.json` 是唯一运行时配置，`background.js` 与 `ui/` 是 App 自己的实现。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
