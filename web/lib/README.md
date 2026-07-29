# web/lib/

> L2 | 父级: /web/README.md

成员清单
utils.ts: 提供 shadcn 组件共享的 Tailwind 类名合并函数。
service-endpoint.ts: 浏览器持久化的 Recut service 根地址；校验 http(s) 根地址，并提供本地默认地址恢复能力，所有 API 连接从此处收敛。
service-store.ts: 基于 Zustand 的 service 状态唯一真相；ServiceControl 在根布局初始化和轮询，业务页面只读取当前 endpoint 的连接阶段、版本与自更新能力，避免路由切换时重新判定离线。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
