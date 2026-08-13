# web/app/

> L2 | 父级: /web/README.md

成员清单
工作台数据规则: 项目、App、安装状态、项目详情与独立 App scope 由 `lib/workspace-store` 跨路由缓存；App、项目与已安装 App 的读取结果不可互相污染，安装列表成功返回空数组就是未安装，失败必须保留服务端原因；Provider、Credential 摘要与用途 Route 由 `lib/media-configuration-store` 缓存；首次读取及写操作成功后显式刷新，绝不使用 5 秒轮询。
layout.tsx: 工作台 HTML 外壳、全局元数据与品牌图标声明；根布局唯一挂载全局工作台壳 `agent-panel-host.tsx`，整体结构为顶部固定 64px Header 横贯全宽、其下 Body 左侧从 Header 下沿向下铺满的全局 Agent 对话栏、右侧内容区（用 `--side-panel-width` 预留左侧空间），页面只经 `lib/agent-panel-context` 声明素材上下文与草稿。
page.tsx: 固定桌面双栏工作台；`/` Studio、`/worlds`、`/projects`、`/media`、`/apps` 共同复用 Header 和各自可刷新状态的内容区，左侧 Agent 面板由根布局全局挂载为单一会话。顶部五个一级 Tab 在工作台内更新 URL 和内容，避免 Cloudflare 静态导出环境将切换降级为整页导航；Studio 是默认创作入口，提供由 `webgl-studio-hero.tsx` 绘制的分层动态视频背景和由日期稳定选出的两张紧凑创作场景卡；首访引导与普通创作模板共用同一随机池，不再单设区域。模板池覆盖完整视频、补充画面、Remotion 与剪纸风格等用户熟悉的表达，点击只将创作内容回填左侧创作框，用户可继续编辑且绝不自动提交；首页的 section 是无框的内容节奏层，所有标题、对象网格与空态沿同一内容边缘排列，只有项目、世界观、素材、模板和应用能力等可进入实体保留卡片边界；已安装 App 使用横向能力卡，卡内并列品牌图标、名称、用途和进入箭头，点击直接打开独立 App 或发起项目创建，详情统一收束到 Apps 管理页；Hero 与最近项目之间是「世界观」区，展示最近最多 5 个 World（只请求摘要、不加载实体正文），点击卡进入世界观，并始终以同栅格虚线占位卡提供新建世界观入口；页面同时展示紧凑的最近项目（读取 owner App 设置的 image/video `cover`）与最近 Assets 外显。Projects 独立承载新建项目与完整项目列表；Worlds 是系统级语义列表；Assets 是原生媒体库；Apps 管理已安装扩展与可添加目录。Agent 为跨路由的单一全局会话，不做按页面的会话过滤，页面只提供素材上传上下文。新建项目使用受控 App 选择面板，只展示项目型 App、预览用途和身份、直达语义详情；顶部提供“新建应用”AI Prompt 与“从 Git 安装”入口，后者把 GitHub 仓库交由 service 校验 manifest 并在成功后刷新目录；Git App 目录读取会检测远端更新，检查完成事件会刷新全局目录，详情和卡片可升级单项，远端更新与本地修改并存时明确显示“远端更新”与保护原因，存在可安全更新项时顶部才显示一键更新；素材库不进入 App Catalog、安装管理或 iframe；任何条目均可离线进入详情，service 仅提供安装状态、安装和 Git 更新；其余依赖 service 的工作台功能在 cloud mode 提供本地安装和已有远程 service 的连接入口，而 local mode 已与 service 同进程，不显示安装引导或独立 UI/service 版本失配；连接中主内容与 Agent 左栏均只显示骨架，连接失败后才显示诊断；主内容的 service 空态是无外框的原生工作区状态，以深色命令条、复制操作和次级远程连接入口引导恢复；发现 service 更新时继续保留当前核心入口，由 Header 右侧的醒目操作入口触发升级；Header 右侧复用 service 状态与全局设置操作。
media/: 原生 React Assets 能力；`page.tsx` 是 `/media` 独立入口壳，`media-library-panel.tsx` 为主工作台复用的内容组件；左侧按类型管理跨项目媒体资产，可主动批量上传图片、视频或音频，提交创建后由单条 Recut Asset SSE 原位呈现，活跃 Asset 显示实时用时、终态显示持久化耗时；创建弹框从 `media-configuration-store` 共享读取已连接 Provider 模型，在独立缩略图选择弹框中按需添加参考图，并引导添加缺失 Provider；桌面端左侧复用标准 Agent 会话。
worlds/: 原生 React Worlds 能力；`page.tsx` 是 `/worlds` 独立入口壳，`worlds-client.tsx` 为主工作台复用的内容组件，`[worldID]/` 承载单个世界的五个核心区域；World 是系统级列表，不进入 App Catalog、安装管理或 iframe。
appstore/: `/appstore` 到 `/apps` 的兼容深链；App 的主入口是 `/apps`，静态 Catalog App 的语义详情路由仍为 `/apps/[appID]`，展示发布时固定的身份、来源与版本，只从 service 查询是否已安装并按状态提供安装或创建项目入口。
workspace-app/: 工作区型 App 的独立工作台路由；为 standaloneView 建立不显示在项目桌面的稳定 App scope，复用 iframe 宿主与根布局全局挂载的 Agent 面板，但没有项目创建或项目名称。
projects/: `/projects` 独立项目桌面与单个项目详情的路由边界。
projects/[id]/page.tsx: 项目详情的服务端路由壳；只导出静态站需要的占位参数并挂载客户端容器，不能使用浏览器 API，避免客户端组件导出 `generateStaticParams`。
projects/[id]/project-detail-client.tsx: 固定桌面项目详情客户端容器；从真实路径（兼容旧查询串）读取项目 ID，Header 右侧复用 service 状态、全局设置与项目 App 版本升级入口；右侧全高 iframe 承载 App UI，左侧的 Agent 对话栏由根布局全局挂载（可拖拽调宽、持久化宽度），本页只经 context 声明项目 scope、当前页面上下文与回填草稿，并转发项目事件与 iframe 请求；App 经 `page.context` 宿主消息上报更具体的当前编辑页上下文；App API 的结构化失败原因必须透传到 iframe。
globals.css: 工作台的全局设计 token：白色画布、黑色内容、明亮品牌绿操作，以及状态色、低圆角、阴影与基础排版；小屏下工作台退化为单栏，Agent 仅保留在桌面工作面。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
