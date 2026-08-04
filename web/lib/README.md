# web/lib/

> L2 | 父级: /web/README.md

成员清单
utils.ts: 提供 shadcn 组件共享的 Tailwind 类名合并函数。
app-catalog.ts: 发布时固定的可安装 App 身份目录；Apps 目录和详情页由它渲染，service 仅返回安装状态并执行安装；原生素材库不在此目录。
service-endpoint.ts: Recut service 根地址、`local`/`lan`/`cloud` 工作台模式、格式校验与本地地址判断；嵌入式 local 工作台始终以浏览器同源地址连接 service，LAN 开发工作台复用当前主机名和 service 端口，不持有运行时状态。
service-store.ts: 基于 Zustand persist 的 service 状态唯一真相；持久化 endpoint 并让所有 HTTP、SSE、WebSocket 调用订阅该值，ServiceControl 负责连接轮询，避免路由切换或刷新后退回旧地址。
agent-store.ts: Agent 低频元数据与按 scope 会话列表的内存缓存；运行时、模型、引导和列表请求按 endpoint 去重，单会话 SSE 仍只归对话面板所有。
workspace-store.ts: 项目、App 与已安装 App 的内存目录缓存；首次读取和写操作后显式刷新，禁止页面级轮询。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
