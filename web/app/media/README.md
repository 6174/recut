# media/

> L2 | 父级: /web/app/README.md

成员清单
page.tsx: 工作区级素材库系统应用；左侧按类型浏览、预览媒体资产，并通过“创建”菜单选择图片、视频或音频；音频创建按当前凭据动态读取 MiniMax/ElevenLabs 音色并提交 voiceId；重复导入命中已有 assetId 时保持本地列表唯一；提交后立即显示并轮询生成中任务卡片，完成时刷新真实资产；弹框以紧凑下拉框选择已连接模型，并严格按模型 `inputModes` 选择、上传和展示兼容参考素材（Seedance 可用多图、视频和音频，Gemini Omni 仅参考图）；详情可将已保存的提示词、模型和引用回填以再次生成，右侧承载标准 Agent 会话。
reference-assets-field.tsx: 创建弹框的模型约束参考素材字段；负责图片/视频/音频的选择、上传、缩略预览和局部选择弹框，不持有 Provider 或任务状态。
asset-preview.tsx: 素材详情弹框的兼容入口；实际视图复用 components/asset-preview-dialog.tsx，展示生成提示词、参考素材缩略图和再次生成入口。
media-types.ts: 素材、任务和 Provider HTTP 数据的共享 TypeScript 契约。

依赖边界

本页面只调用 Daemon 的 `/v1/media/*` API 与内部素材库系统项目的 Agent Session；兼容的图片、视频或音频上传与图片粘贴先导入平台 Asset Registry，再发送已选择的模型 ID、同 Provider 的凭据 ID 和资源引用 ID，密钥始终不离开 Daemon，前后端均按模型能力限制引用类型，服务端是最终校验边界。Provider、BYOK Credential 和用途模型 Route 仍在全局 SettingsPanel 管理。资产文件由平台 Asset Registry 管理，业务 App 不可直接读取其存储路径。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
