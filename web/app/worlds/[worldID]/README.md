# [worldID]/

> L2 | 父级: /web/app/worlds/README.md

成员清单
page.tsx: 世界详情路由的服务端壳；静态导出只需 `/worlds/app/` 一个占位路径，Worker 在边缘把任意 `/worlds/<id>` 映射到它，浏览器地址保留真实 id。
world-detail-client.tsx: 世界详情客户端容器；从 `window.location.pathname` 读取真实 worldID（兼容旧查询串 `?id=`），Overview 头部显示名称、类型、revision 与 canonical hash，五个实体区域按 kind 分组，References 区把已完成全局 Asset 以 `character_reference` 等语义 role 附加到世界或实体；实体编辑以 JSON 文本框维护 `content`，保存后平台在同一事务产出新 revision。

依赖边界

本目录不持有业务状态；详情与实体缓存位于 `lib/worlds-store`，传输契约位于 `lib/recut-worlds-client`。任何写操作成功后调用 `worlds-store.invalidate(worldID)` 显式失效，禁止页面级轮询。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
