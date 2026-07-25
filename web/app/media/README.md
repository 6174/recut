# media/

> L2 | 父级: /web/app/README.md

成员清单
page.tsx: 工作区级素材库系统应用；左侧按类型浏览、预览媒体资产，并通过“创建”菜单选择图片、视频或音频，再在弹框中以已连接 Provider 的模型直接提交生成任务；图片可引用、上传或从创作输入框粘贴参考图，视频可引用已有图片和音频，未连接模型会引导至 Provider 设置，右侧承载标准 Agent 会话。

依赖边界

本页面只调用 Daemon 的 `/v1/media/*` API 与内部素材库系统项目的 Agent Session；参考图上传和粘贴先导入平台 Asset Registry，再发送已选择的模型 ID、同 Provider 的凭据 ID 和资源引用 ID，密钥始终不离开 Daemon，服务端再次校验归属、能力和引用类型。Provider、BYOK Credential 和用途模型 Route 仍在全局 SettingsPanel 管理。资产文件由平台 Asset Registry 管理，业务 App 不可直接读取其存储路径。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
