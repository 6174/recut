# media-library/

> L2 | 父级: /apps/README.md

成员清单
manifest.json: 内部素材库系统应用身份；仅用于承载标准 Agent/MCP 会话，不能由用户创建项目。
background.js: 空运行时入口；所有媒体业务由 service 的 Media Platform 提供。
ui/index.html: 最小占位 UI；真实系统界面由 web/app/media 承载。

依赖边界

此 App 不保存业务数据，也不声明业务 MCP 工具。Agent 只使用平台级 `recut.media.*`，资产、Provider、凭据和 Route 均属于 MediaService。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
