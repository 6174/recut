# [worldID]/

> L2 | 父级: /web/app/worlds/README.md

成员清单
page.tsx: 世界详情路由的服务端壳；静态导出只需 `/worlds/app/` 一个占位路径，Worker 在边缘把任意 `/worlds/<id>` 映射到它，浏览器地址保留真实 id。
world-detail-client.tsx: 世界详情页面编排容器；从真实 worldId/revisionId 签发 Work Surface，并将当前 Entity 的完整状态上报为 Focus；World 技能为首个 Tab，负责结构化设定、资源库与从故事创建视频。
world-detail-settings.tsx: 设定视图的右侧实体面板宿主 EntitySettingsPanel（与画布共用 web/components/world-entity 的 EntityEditor：名称/简介/正文 + attrs 字段 + material media 属性 + 关系词表 + 删除），统一保存器局部 patch 即改即存；另导出 attrs 驱动的卡片投影助手（非空文本条目 / 完整度 / 媒体值）。
world-detail-panels.tsx: 设定展示分区；设定卡片内嵌图片画廊并可整卡点开右侧实体面板（统一 Entity 模型投影与编辑），隐藏 revision/hash 等系统细节。
world-onboarding.tsx: Onboarding 引导卡（仅 local 世界）；消费 readiness 投影展示就绪度进度与最值得先做的缺失项，可展开完整清单，「让 AI 帮我完善」只预填 composer 草稿（绝不自动发送、绝不自动写入）。

依赖边界

本目录不持有业务状态；详情与实体缓存位于 `lib/worlds-store`，传输契约位于 `lib/recut-worlds-client`。任何写操作成功后调用 `worlds-store.invalidate(worldID)` 显式失效，禁止页面级轮询。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
