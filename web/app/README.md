# web/app/

> L2 | 父级: /web/README.md

成员清单
工作台数据规则: 项目、App、安装状态、项目详情与独立 App scope 由 `lib/workspace-store` 跨路由缓存；Provider、Credential 摘要与用途 Route 由 `lib/media-configuration-store` 缓存；首次读取及写操作成功后显式刷新，绝不使用 5 秒轮询。
layout.tsx: 工作台 HTML 外壳、全局元数据与品牌图标声明；根布局唯一挂载全局工作台壳 `agent-panel-host.tsx`，整体结构为顶部页面 Header 横贯全宽、其下 Body 左侧内容区（用 `--side-panel-width` 预留右侧空间）、右侧从 headerHeight 向下铺满的全局 Agent 侧栏，页面只经 `lib/agent-panel-context` 声明素材上下文、Header 高度与草稿。
page.tsx: 固定桌面双栏工作台；`/` Studio、`/projects`、`/media`、`/apps` 共同复用 Header 和各自可刷新状态的内容区，Agent 面板由根布局全局挂载为单一会话。Studio 是默认创作入口，提供由 `webgl-studio-hero.tsx` 绘制的分层动态视频背景、创作意图输入、紧凑的最近项目（读取 owner App 设置的 image/video `cover`）、最近 Assets 外显和已安装 App 的快速进入；Projects 独立承载新建项目与完整项目列表；Assets 是原生媒体库；Apps 管理已安装扩展与可添加目录。右侧 Agent 为跨路由的单一全局会话，不做按页面的会话过滤，页面只提供素材上传上下文。新建项目使用受控 App 选择面板，只展示项目型 App、预览用途和身份、直达语义详情；顶部提供“新建应用”AI Prompt 与“从 Git 安装”入口，后者把 GitHub 仓库交由 service 校验 manifest 并在成功后刷新目录；Git App 目录读取会检测远端更新，详情和卡片可升级单项，存在可安全更新项时顶部才显示一键更新；素材库不进入 App Catalog、安装管理或 iframe；任何条目均可离线进入详情，service 仅提供安装状态、安装和 Git 更新；其余依赖 service 的工作台功能在 cloud mode 提供本地安装和已有远程 service 的连接入口，而 local mode 已与 service 同进程，不显示安装引导或独立 UI/service 版本失配；发现 service 更新时继续保留当前核心入口，由 Header 右侧的醒目操作入口触发升级；Header 右侧复用 service 状态与全局设置操作。
media/: 原生 React Assets 能力；`page.tsx` 是 `/media` 独立入口壳，`media-library-panel.tsx` 为主工作台复用的内容组件；左侧按类型管理跨项目媒体资产，可主动批量上传图片、视频或音频，提交创建后由单条 Recut Asset SSE 原位呈现，活跃 Asset 显示实时用时、终态显示持久化耗时；创建弹框从 `media-configuration-store` 共享读取已连接 Provider 模型，在独立缩略图选择弹框中按需添加参考图，并引导添加缺失 Provider；桌面端右侧复用标准 Agent 会话。
appstore/: `/appstore` 到 `/apps` 的兼容深链；App 的主入口是 `/apps`，静态 Catalog App 的语义详情路由仍为 `/apps/[appID]`，展示发布时固定的身份、来源与版本，只从 service 查询是否已安装并按状态提供安装或创建项目入口。
workspace-app/: 工作区型 App 的独立工作台路由；为 standaloneView 建立不显示在项目桌面的稳定 App scope，复用 iframe 宿主与根布局全局挂载的 Agent 面板，但没有项目创建或项目名称。
projects/: `/projects` 独立项目桌面与单个项目详情的路由边界。
projects/[id]/page.tsx: 项目详情的服务端路由壳；只导出静态站需要的占位参数并挂载客户端容器，不能使用浏览器 API，避免客户端组件导出 `generateStaticParams`。
projects/[id]/project-detail-client.tsx: 固定桌面项目详情客户端容器；从真实路径（兼容旧查询串）读取项目 ID，Header 右侧复用 service 状态、全局设置与项目 App 版本升级入口；左侧全高 iframe 承载 App UI，右侧的 Agent 对话栏由根布局全局挂载（可拖拽调宽、持久化宽度），本页只经 context 声明项目 scope、当前页面上下文与回填草稿，并转发项目事件与 iframe 请求；App 经 `page.context` 宿主消息上报更具体的当前编辑页上下文；App API 的结构化失败原因必须透传到 iframe。
globals.css: 工作台的全局设计 token：白色画布、黑色内容、明亮品牌绿操作，以及状态色、低圆角、阴影与基础排版；小屏下工作台退化为单栏，Agent 仅保留在桌面工作面。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
