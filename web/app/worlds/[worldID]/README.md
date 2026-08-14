# [worldID]/

> L2 | 父级: /web/app/worlds/README.md

成员清单
page.tsx: 世界详情路由的服务端壳；静态导出只需 `/worlds/app/` 一个占位路径，Worker 在边缘把任意 `/worlds/<id>` 映射到它，浏览器地址保留真实 id。
world-detail-client.tsx: 世界详情页面编排容器；负责统一工作台壳、真实 worldID、结构化设定、World 级非结构化资源库与从故事创建视频；对象多模态信息只从所属设定项进入，资源则独立归属于 World。
world-detail-settings.tsx: 设定领域表单；一个编辑面板同时维护角色、故事、风格、规则和场景的文字字段与所属多模态证据，带 expectedRevisionId 安全保存且不展示 JSON。
world-detail-panels.tsx: 设定展示分区；主设定弹框只摘要多模态资料，二级管理弹框复用系统素材选择器处理单份资料；隐藏 revision/hash 等系统细节。

依赖边界

本目录不持有业务状态；详情与实体缓存位于 `lib/worlds-store`，传输契约位于 `lib/recut-worlds-client`。任何写操作成功后调用 `worlds-store.invalidate(worldID)` 显式失效，禁止页面级轮询。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
