# media/

> L2 | 父级: /web/app/README.md

成员清单
page.tsx: 工作区级素材库系统应用；左侧按类型浏览媒体资产并点击弹框预览内容与生成信息，右侧承载标准 Agent 会话；生成完成后自动刷新资源。

依赖边界

本页面只调用 Daemon 的 `/v1/media/*` API 与内部素材库系统项目的 Agent Session；Provider、BYOK Credential 和用途模型 Route 只能在全局 SettingsPanel 配置。资产文件由平台 Asset Registry 管理，业务 App 不可直接读取其存储路径。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
