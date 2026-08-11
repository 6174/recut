# media/

> L2 | 父级: /web/app/README.md

成员清单
page.tsx: `/media` 素材库深链壳；复用主工作台以保持 Header、Agent 面板和激活 Tab 一致。
media-library-panel.tsx: 工作区级原生 React 素材库内容；供 `/media` 与主工作台复用，首屏只渲染 12 张素材并由用户继续加载，左侧按类型浏览（图片 / 视频 / 音频 / 转写）、预览媒体资产，完成的视频卡片显示 iframe 子文档中的静音循环真实画面，顶部可主动批量上传图片、视频或音频，并通过“创建”菜单选择图片、视频或音频；创建弹框从 `media-configuration-store` 读取当前凭据，音频按当前凭据动态读取 MiniMax/ElevenLabs 音色并提交 voiceId；所有 Asset 从单条 Recut SSE 快照/增量流消费，提交后一次 hydrate 用于即时呈现，运行态实时显示用时、终态只显示持久化耗时，任务卡不自行猜测时钟；弹框以紧凑下拉框选择已连接模型，并严格按模型 `inputModes` 选择、上传和展示兼容参考素材（Seedance 可用多图、视频和音频，且按 `outputModes` 展示默认开启的同步音频开关；Gemini Omni 仅参考图且不展示无效开关）；详情可将已保存的提示词、模型和引用回填以再次生成，左侧 Agent 会话由主工作台承载。
asset-grid.tsx: 素材和尚未可见 Asset 的任务卡片；完成视频显示 iframe 子文档中的静音循环真实画面，图片惰性加载并异步解码，运行态显示实时用时，终态读取 Asset 已持久化的生成耗时；转写 bundle 卡片直接显示分段数与时长。
reference-assets-field.tsx: 创建弹框的模型约束参考素材字段；负责图片/视频/音频的选择、上传、缩略预览和局部选择弹框，完成视频统一以 `VideoFrame` iframe 子文档显示真实画面，不持有 Provider 或任务状态。
asset-preview.tsx: 素材详情弹框的兼容入口；实际视图复用 components/asset-preview-dialog.tsx，从共享 Asset 缓存原位更新运行/终态并显示用时，展示生成提示词、参考素材缩略图和再次生成入口；转写 bundle 详情包含源声音播放、分段列表与 SRT/JSON parts 预览下载。
media-types.ts: 素材、任务和 Provider HTTP 数据的共享 TypeScript 契约（含 `transcript` 转写 bundle 类型）；将缺少生命周期字段或 durable `jobId` 绑定的历史 Asset 归一为 `completed`，保留有 jobId 的 Atlas 视频与通用异步语音 `queued/running` 状态，不把旧素材误显示为生成中。

依赖边界

本页面只调用 Daemon 的 `/v1/media/*` API 与隐藏 media scope 的 Agent Session；该 scope 只承载资产归属与 Agent 上下文，不是 App、没有磁盘 App 包，也不会由 iframe 承载。兼容的图片、视频或音频上传与图片粘贴先导入平台 Asset Registry，再发送已选择的模型 ID、同 Provider 的凭据 ID 和资源引用 ID，密钥始终不离开 Daemon，前后端均按模型能力限制引用类型，服务端是最终校验边界。Provider、BYOK Credential 和用途模型 Route 仍在全局 SettingsPanel 管理。资产文件由平台 Asset Registry 管理，业务 App 不可直接读取其存储路径。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
