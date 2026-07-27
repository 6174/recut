# apps/

> L2 | 父级: /README.md

成员清单
starter/: 最小项目型 JS App；展示 manifest、background 与 UI 固定包结构。
vox-broll/: B-roll 项目型案例；其 JS 自行定义 brief 数据、资源契约与统一 operation handler，领域 AGENTS.md 只描述创作方法。
media-library/: 内部系统 App；为工作区素材库复用标准 Agent/MCP 会话，不能被用户作为项目创建。

App 包不包含平台配置碎片。`manifest.json` 是唯一运行时配置，`background.js` 与 `ui/` 是 App 自己的实现。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
