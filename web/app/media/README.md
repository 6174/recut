# media/

> L2 | 父级: /web/app/README.md

成员清单
page.tsx: `/media` 素材库深链壳；复用主工作台以保持 Header、Agent 面板和激活 Tab 一致。
media-library-panel.tsx: 工作区级原生 React 素材库内容；供 `/media` 与主工作台复用，标题与筛选经统一 `WorkspacePageHeader`/`FilterTabs` 与项目页对齐、整页随工作台内容区滚动（网格不再自持滚动容器）；素材网格按滚动位置虚拟化并随滚动自动加载后续素材，没有分页按钮，左侧按类型浏览（图片 / 视频 / 音频 / 转写 / 资料），预览媒体资产与可跨项目复用的 `reference` 研究资料；完成的视频卡片显示 iframe 子文档中的静音循环真实画面，所有素材卡共享 More 菜单重命名或经确认删除，顶部可主动批量上传图片、视频或音频；创建入口改为内容区底部常驻的 `MediaCreateComposer`（sticky），不再用右上角下拉菜单 + 居中模态弹框；所有 Asset 从单条 Recut SSE 快照/增量流消费，提交后一次 hydrate 用于即时呈现，运行态实时显示用时、终态只显示持久化耗时，任务卡不自行猜测时钟；详情可将已保存的提示词、模型和引用回填到 composer 再次生成，左侧 Agent 会话由主工作台承载。
media-create-composer.tsx: 素材库内容区底部常驻的「直接生成」composer（RFC 2026-10-09）；底栏左侧「生成类型」下拉四选一（图片 / 视频 / 音频 / 动作图形），参考缩略图与「参考」按钮位于输入框上方、prompt 用更高的 `RichComposer`（`@` 引用素材），底栏复用 `ModelPicker` + 音频音色 `CustomSelect` + `CompactParameters` + `RecipeParameters`，右上角可全屏编辑（`createPortal`），与 World 画布 `NodeGenerationComposer` 同源原子；图片/音频走 `POST /v1/media/jobs` 直生、视频走 `POST /v1/media/proposals` 待确认提案（门禁不变）；动作图形（MG）不提交生成，只把引导 prompt（空则给默认引导）经 `useAgentPanelContext.setDraft` 预填进左侧全局对话、不自动发送；对外导出 `MediaCreateComposer` 与 `MediaCreateDraft`/`ComposerModality` 供详情「再次生成 / Remix」原位回填。
asset-grid.tsx: 素材和尚未可见 Asset 的任务卡片；按行虚拟化（@tanstack/react-virtual，每行固定 5 张、行高动态测量），滚动容器外借工作台内容区 `[data-workspace-scroll]`（与项目页一致）、用 scrollMargin 定位虚拟行，滚动到哪就渲染到哪，因此素材再多也不需要分页按钮；使用与首页资源区相同的紧凑五列方形规格，完成视频显示 iframe 子文档中的静音循环真实画面，图片惰性加载并异步解码，资料 Asset 显示来源类型和事实摘要，Motion Graphic 组件 Asset（kind=component）有封面用封面、否则在网格内实时渲染组件，所有实体卡右上角复用 More 重命名/确认删除；详细提示词、来源与生成耗时收束到点击后的详情，转写 bundle 卡片直接显示分段数与时长。生成阶段显式三段：提交（queued，尚无 provider 任务信息）→ 等待结果（running 且已拿到 providerTaskUrl）→ 结果（completed/failed）；running 但无锚点显示“提交中”，因此用户能区分“还没提交”与“已提交等结果”。
asset-preview.tsx: 素材详情弹框的兼容入口；实际视图复用 components/asset-preview-dialog.tsx，从共享 Asset 缓存原位更新运行/终态并显示用时，展示生成提示词、参考素材缩略图和再次生成入口；转写 bundle 详情包含源声音播放、分段列表与 SRT/JSON parts 预览下载。
media-types.ts: 素材、任务和 Provider HTTP 数据的共享 TypeScript 契约（含 `transcript` 转写 bundle 与无本地二进制的 `reference` 研究资料类型）；将缺少生命周期字段或 durable `jobId` 绑定的历史 Asset 归一为 `completed`，保留有 jobId 的 Atlas 视频与通用异步语音 `queued/running` 状态，不把旧素材误显示为生成中。

依赖边界

本页面只调用 Daemon 的 `/v1/media/*` API 与隐藏 media scope 的 Agent Session；该 scope 只承载资产归属与 Agent 上下文，不是 App、没有磁盘 App 包，也不会由 iframe 承载。兼容的图片、视频或音频上传与图片粘贴先导入平台 Asset Registry，再发送已选择的模型 ID、同 Provider 的凭据 ID 和资源引用 ID，密钥始终不离开 Daemon，前后端均按模型能力限制引用类型，服务端是最终校验边界。Provider、BYOK Credential 和用途模型 Route 仍在全局 SettingsPanel 管理。资产文件由平台 Asset Registry 管理，业务 App 不可直接读取其存储路径。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
