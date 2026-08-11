# web/lib/

> L2 | 父级: /web/README.md

成员清单
utils.ts: 提供 shadcn 组件共享的 Tailwind 类名合并函数。
app-catalog.ts: 发布时固定的可安装 App 身份目录；Apps 目录和详情页由它渲染，service 仅返回安装状态并执行安装；原生素材库不在此目录。
service-endpoint.ts: Recut service 根地址、`local`/`lan`/`cloud` 工作台模式、格式校验与本地事件流地址；本机默认把 SSE/WebSocket 切到相邻端口，避免长连接耗尽短 API 的浏览器连接池；嵌入式 local 工作台始终以浏览器同源地址连接 service，LAN 开发工作台复用当前主机名和 service 端口，不持有运行时状态。
service-store.ts: 基于 Zustand persist 的 service 状态唯一真相；持久化 endpoint 并让所有 HTTP、SSE、WebSocket 调用订阅该值，ServiceControl 负责连接轮询，避免路由切换或刷新后退回旧地址。
agent-store.ts: Agent 元数据、会话列表、当前会话和详情快照的内存缓存；请求按 endpoint 去重，面板拥有 SSE 连接但将增量回写缓存。
agent-panel-context.ts: 全局 Agent 面板上下文的内存状态；保存根布局唯一挂载的面板所需的当前路由 projectID（仅素材上传/引导上下文）、Header 高度、宿主回填草稿与当前页面上下文，`useReportPageContext` 让页面声明式上报并在卸载时清理，面板为单一全局会话，各页面只声明这些上下文，不再各自挂载面板。
media-configuration-store.ts: Provider、脱敏 Credential 与用途 Route 的按 endpoint 配置缓存；Settings、素材创建和 iframe App 宿主共享，绝不保存 API Key 输入草稿。
workspace-store.ts: 含可选 image/video `cover` 的项目、App、已安装 App、项目详情和独立 App scope 的内存目录缓存；App、项目与安装列表分别保留读取状态和服务端失败原因，安装列表成功返回空数组即是“尚未安装”，首次读取和写操作后显式刷新，禁止页面级轮询。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
