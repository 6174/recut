<!--
 * [INPUT]: 依赖 service/worlds_mcp.go（现有 recut.worlds.* 工具面与 dispatch）、world_events.go（worldMutatingTools）、
 *   service/runtime.go（ctx.worlds.* App capability）、worlds_canvas.go / worlds_canvas_doc.go（属性同步、promote、delete/restore），
 *   以及 platform recut skill / recut-worlds skill / world-onboarding reference 的现行指引
 * [OUTPUT]: 定义「World 的 AI 写入面收口」决策（方案 A）：MCP 只保留只读 + World 生命周期 + 画布接口；
 *   内容写入（实体/关系/类型）统一经 recut.worlds.entity / relation / entityType（不另加 .canvas 层，World 即画布）；
 *   语义 CRUD（entities.upsert/create_child/promote、relations.create/update、entityTypes.upsert）下线；含迁移与验证
 * [POS]: rfc 的 World/画布 Agent 交互收口决策；解决上一版「canvas 与语义 CRUD 两套写面」的心智与维护重复
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# World 的唯一写入面：画布接口（World Canvas Sole Write Surface）

- 状态：已实施（2026-09-15）
- 日期：2026-09-15
- 关联：[递归世界画布](./2026-09-07-recursive-world-canvas.md)、[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、[生成参考引用协议](./2026-09-15-generation-reference-protocol.md)

## 1. 问题

World 曾对 AI 暴露两套写面：

- **语义 CRUD（设定/表单视图）**：`entities.upsert` / `entities.create_child` / `entities.promote`、`relations.create` / `relations.update`、`entityTypes.upsert`。
- **画布**：`recut.worlds.doc.update` / `recut.worlds.promote` / `recut.worlds.lock` / `recut.worlds.unlock`。

同一个产品里两套心智：AI 不知道该「直接改实体」还是「摆画布」，skill 与 MCP 描述也随之重复；且语义写不保证画布一致（实体改了、卡没落）。此外上游还残留 evidence 时代死代码（`worldReferenceRoleSchema` 等）与事件一致性缺口（`evidence.archive` 写 Canon 却不广播）。

## 2. 决策（方案 A）

**World 即画布。AI 的一切内容写入都经画布接口；不再保留并行的语义 CRUD。**

保留：

- **只读**：`list/get/brief/resolve/readiness`、`entities.list/get`、`relations.list`、`entityTypes.list`、`evidence.list`、`recut.worlds.doc/docs`、`revisions.list`、`export`、`proposals.list`。
- **World 生命周期**（世界级，不是内容编辑）：`worlds.create/update/fork/delete/bind_project`、`revert`、`import`、`evidence.archive`。
- **画布布局 / 提升 / 会话**：`recut.worlds.doc.update`（元素级 insert/update/remove，不产 revision）、`recut.worlds.promote`（便签/文本→草稿实体；箭头→关系 / 属性绑定）、`recut.worlds.lock/unlock`（多步编辑 advisory 锁）。

新增（内容写入，工具名**不加 `.canvas` 层**——World 本身就是画布；既有 `recut.worlds.canvas.*` 一并扁平为 `recut.worlds.*`）：

| 工具 | op | 语义 |
|---|---|---|
| `recut.worlds.entity` | `create` | 新建实体（`typeId`+`name`；给 `contextId` 时自动在该画布层落投影卡） |
| | `update` | 只覆盖显式给出的字段（`name/intro/detail/attrs/parentId/...`），省略的保持原值 |
| | `archive` / `restore` | 软删除（归档 + 墓碑，可恢复）/ 恢复 |
| | `confirm` | `isProvisional` 草稿转正式并产 revision |
| `recut.worlds.relation` | `create` / `update` / `archive` / `restore` | 分派到既有 `CreateRelation` / `UpdateRelation` / `DeleteRelation` / `RestoreRelation`；`scopeEntityId` 非空为局部关系 |
| `recut.worlds.entityType` | （无 op） | 定义/覆盖类型 schema（不产 revision） |

**既有画布工具扁平化**：`canvas.doc` → `doc`、`canvas.docs` → `docs`、`canvas.doc.update` → `doc.update`、`canvas.promote` → `promote`、`canvas.lock`/`unlock` → `lock`/`unlock`（限 MCP 工具名；`world.canvas.lock/unlock` 事件名与 store 方法名不变）。

下线（MCP 不再注册）：`entities.upsert`、`entities.create_child`、`entities.promote`、`relations.create`、`relations.update`、`entityTypes.upsert`。

**画布路径覆盖内容的机制**（补三处缺口）：

1. **一等字段**：`recut.worlds.entity` op=`update` 直接写 `name/intro/detail`；画布 attr 元素经 `syncAttrElementValue` 可写普通属性，两者都回写同一真相。
2. **类型 schema**：`recut.worlds.entityType`。
3. **删除/恢复**：`recut.worlds.entity` / `relation` 的 `archive`/`restore`（画布 remove 仍只删投影，不归档实体）。

## 3. 不变式

- **语义真相只在 `world_entities` / `world_relations`**；画布元素是投影，写画布布局不产 revision。
- **Canon 写需用户明确授权**；非 local 世界只读，写返回 `WORLD_READ_ONLY` → 提议 Fork。
- **乐观并发**：Canon 写带 `expectedRevisionId`，冲突即停。
- **事件一致**：所有 MCP 写工具（含 `entity/relation/entityType` 与 `evidence.archive`）写入 `worldMutatingTools`，成功后广播 `world.changed`，已打开画布据此刷新。

## 4. 分层语义：MCP（AI 接口）vs App capability（内部便路）

本收口只约束 **MCP**，因为 MCP 是**面向 AI 的唯一接口**；两者是不同的消费者与契约，不互相替代：

| 层 | 契约 | 消费者 | 策略 |
|---|---|---|---|
| **AI 接口** | MCP `recut.worlds.*` | Agent / 外部 AI | **收口**：只读 + 生命周期 + 画布写面；内容写入经 `entity/relation/entityType` |
| **App 内部便路** | App runtime capability `ctx.worlds.*`（`worlds.write` 权限） | 已安装 App 的 background.js | **保留最便捷路径**（`entities.upsert` / `references.attach` 等），不受本收口约束 |

- AI 的 skill 只应描述 MCP 面；`ctx.worlds.*` 对 AI 不可见、也不应写入 AI skill。
- 两者共享同一 `WorldStore` 与同一 Canon/并发门禁，差异只在暴露面与便利性取舍。

## 4.1 前序 review 其余项的处置

原「缺失状态/接口」清单已全部落地：

| 项 | 处置 |
|---|---|
| G6 revisions | 暴露 `recut.worlds.revisions.list` / `recut.worlds.revert`（store 已有 `ListRevisions` / `RevertToRevision`） |
| G7 export/import | 暴露 `recut.worlds.export`（base64 bundle，含 name/sizeBytes）/ `recut.worlds.import`（base64） |
| G8 提案可观测 | 暴露 `recut.worlds.proposals.list`（跨画布层收集 `kind=media` 且带 `props.proposal` 的元素，含 status/jobId）；`jobId → recut.job.status` 桥接写进描述 |
| G4 attrPatch | `recut.worlds.entity` op=update 增 `attrPatch`（按 key 合并单条属性，避免回读全量） |
| 2.4 本地化 | 新增 `worldsToolDescriptionsEN`，`worldsMCPToolDefinitions(locale)` 按 locale 输出英文描述（schema 内属性描述暂留中文） |
| O3/O5 | `resolve` 描述标注 App/运行时专用；角色词表权威收敛到 `recut-directing-generation-prompt`（运行期镜像 `canvas-proposal.ts`） |
| 时间戳排序 | 全库 `order by <time>` 改用 `julianday(...)`（修 RFC3339Nano 尾零导致的字典序错序，连同会话列表 flaky 测试） |

## 5. 实施清单（已落地）

| 文件 | 变更 |
|---|---|
| `service/worlds_mcp.go` | 删 6 个语义写工具与 4 个死 schema；新增 `entity/relation/entityType` 与 `revisions.list/revert/export/import/proposals.list` 工具与 dispatch；`entity` op=update 支持 `attrPatch`；`entities.list` 暴露 `parentId`/`includeProvisional`；修正 `evidence.list`/`entities.get` 描述；英文描述本地化 |
| `service/worlds.go` | `ListEntitiesInput` 增 `ParentID` 过滤 |
| `service/world_events.go` | `worldMutatingTools` 改为画布写集 + `revert`/`import`/`evidence.archive`（修事件缺口） |
| `service/agent.go` | `mcpToolLabels` 同步 |
| `service/skills/recut-worlds` | 工具地图 / 门禁改为画布写面；role 词表指向 generation-prompt；模型权威声明 |
| `service/skills/recut`、`references/world-onboarding.md`、`recut-directing-generation-prompt` | 指引改画布写面；role 词表单一权威 |

## 6. 验证

- `worlds_mcp_test.go`：断言新写工具注册、6 个语义 CRUD 下线；`TestWorldsMCPCanvasWriteSurface`（create 自动落卡、一等字段 update、parentId 过滤、archive/restore）；`TestWorldsMCPRevisionsProposalsAndAttrPatch`（attrPatch 合并、revisions/revert、proposals.list）；`TestWorldsMCPDescriptionsLocalized`（en/zh 覆盖且不相等）。
- `go test ./...` 全绿；会话列表 flaky 测试 100× 通过。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
