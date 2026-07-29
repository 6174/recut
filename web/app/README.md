# web/app/

> L2 | 父级: /web/README.md

成员清单
layout.tsx: 工作台 HTML 外壳与全局元数据；不挂载悬浮控制，页面 Header 通过共享组件初始化全局 service 状态。
page.tsx: 固定桌面双栏工作台；Project、Apps 与素材库共享同一个 Tab、Header 和 Agent 面板。新建项目使用受控 App 选择面板，只展示项目型 App、预览用途和身份、直达语义详情，并引导到 Apps 添加更多能力；Apps 将已安装（含系统 App）与静态应用市场分区，顶部提供“新建应用”AI Prompt，指向公开标准并要求在用户 App 目录创建、验证和重启 service，任何条目均可离线进入详情，service 仅提供安装状态、安装和 Git 更新；其余依赖 service 的工作台功能在 cloud mode 提供本地安装和已有远程 service 的连接入口，而 local mode 已与 service 同进程，不显示安装引导或独立 UI/service 版本失配；新建 Agent 会话显示由 App manifest、全局设置或平台兜底解析出的非空引导卡；Header 右侧复用 service 状态与全局设置操作。
media/: 平台级素材库系统应用；素材库内容作为工作台的第三个 Tab 承载，旧 `/media` 地址会回到该 Tab；左侧按类型管理跨项目媒体资产，可主动批量上传图片、视频或音频，提交创建后由单条 Recut Asset SSE 原位呈现，活跃 Asset 显示实时用时、终态显示持久化耗时；以紧凑下拉框选择已连接 Provider 模型、在独立缩略图选择弹框中按需添加参考图，并引导添加缺失 Provider；右侧复用标准 Agent 会话，Provider 和用途模型仍在全局设置中管理。
apps/: 静态 Catalog App 的语义详情路由；详情内容仍嵌在工作台主框架和 Agent 面板中，标题下提供返回应用目录的入口，展示发布时固定的身份、来源与版本，只从 service 查询是否已安装并按状态提供安装或创建项目入口。
projects/[id]/page.tsx: 项目详情的服务端路由壳；只导出静态站需要的占位参数并挂载客户端容器，不能使用浏览器 API，避免客户端组件导出 `generateStaticParams`。
projects/[id]/project-detail-client.tsx: 固定桌面项目详情客户端容器；从真实路径（兼容旧查询串）读取项目 ID，Header 右侧复用 service 状态、全局设置与项目 App 版本升级入口；左侧全高 iframe 承载 App UI，右侧为独立滚动且可拖拽调宽、持久化宽度的 Agent 对话栏，并转发项目事件与 iframe 请求；App API 的结构化失败原因必须透传到 iframe。
globals.css: 工作台的全局设计 token：白色画布、黑色内容、明亮品牌绿操作，以及状态色、圆角、阴影与基础排版。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
