# web/lib/

> L2 | 父级: /web/README.md

成员清单
utils.ts: 提供 shadcn 组件共享的 Tailwind 类名合并函数。
service-endpoint.ts: Recut service 根地址的默认值、格式校验与本地地址判断；不持有运行时状态。
service-store.ts: 基于 Zustand persist 的 service 状态唯一真相；持久化 endpoint 并让所有 HTTP、SSE、WebSocket 调用订阅该值，ServiceControl 负责连接轮询，避免路由切换或刷新后退回旧地址。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
