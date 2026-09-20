<!--
 * [INPUT]: 以 rfc/2026-09-09-unified-entity-model.md §6（双向关系图）与 rfc/2026-09-07-recursive-world-canvas.md §5.3（受控关系词表）为基线，吸收 relation 单标签 + inverse 外挂查找带来的方向/另一侧语义缺失问题
 * [OUTPUT]: 定义关系的双边语义模型：一条边 = {from, to, fromRole, toRole}；fromRole 沿用旧 relation_type 值域（读库零迁移），toRole 可空（空=未标记）；画布 toRole 非空才画双箭头；词表 inverse 退役为预设的 toLabel
 * [POS]: rfc 的 World 关系语义迭代决策；落地前冻结字段命名、兼容映射、渲染与面板改造
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: 关系双边语义——fromRole / toRole

- 状态：设计冻结（待实施）
- 作者：Recut
- 日期：2026-09-20
- 关联：[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、[递归世界画布](./2026-09-07-recursive-world-canvas.md)、[画布文档存储](./2026-09-09-world-canvas-document-storage.md)、[世界内容格式 v2](./2026-09-13-world-content-format-v2.md)
- 决策范围：关系的语义模型与字段命名、数据库兼容读、canonical/导出导入/源格式、画布单/双箭头渲染、关系面板与共享编辑器

## 摘要

现状：一条 `world_relations` 边只有一个 `relation_type`，另一端语义靠 `WorldRelationSpec.Inverse` 去全局词表查。后果：

- 自定义关系没有 inverse，另一端渲染不出来；读任意一侧都必须先知道全局词表。
- UI 强迫用户"先选对方向"再选类型，方向感成了噪音（统一 Entity RFC 已承认"边在产品语义上双向"）。
- 画布把"单向"当成表达事实，但连接本质是一条对称连接。

本 RFC 把边迭代为**一条对称连接 + 两端各带一个语义 role**：

```
edge { id, from, to, fromRole, toRole, scope?, metadata }
```

核心主张：

1. **`fromRole` 沿用旧 `relation_type` 的值域与物理列**：它是语义 token（catalog key `"references"`/`"father"`… 或自定义字符串），默认 `"references"`（显示「引用」）。读库时物理列 `relation_type` 直接当 `fromRole` 读，**零 backfill**。
2. **`toRole` 可空**：`""` = 未标记。非空即"另一端也定义了语义"，允许显式存 `"references"`。
3. **画布渲染跟标记走**：`toRole === ""` → 单箭头（现状）；`toRole !== ""` → 双箭头、两端各一个标签。
4. **`Inverse` 退役**：另一侧语义 inline 在 `toRole`；词表只保留 from 端 label 与可选的 to 端预设 label（用于一键填两端）。
5. **canonical 物理键不动**：内部仍以 `"type"` 序列化 `fromRole`，仅当 `toRole !== ""` 时追加 `"toRole"`——旧世界 hash 不变。
6. **兼容读写**：API/MCP/manifest 输入接受旧 `relationType` 作为 `fromRole` 别名；输出发 `fromRole`/`toRole`。

## 一、现状与问题

- 词表 `worldRelationTypes`（`service/worlds_canvas.go:39-63`）每条只带 `{LabelZh, Group, Inverse}`；`ListWorldRelationTypes`（同文件 66-82）只输出 `labelZh` + `inverseId`。
- 存储 `world_relations(id, world_id, from_entity_id, to_entity_id, relation_type, metadata_json, scope_entity_id)`（`service/project.go:602-614`），`unique(world_id, from_entity_id, to_entity_id, relation_type)`。
- `ListRelations`（`service/worlds_canvas.go:835-867`）只按"触及实体"聚合 + `direction` 投影，另一端语义要前端自行查词表。
- 画布投影 `canvas-pomelo.tsx:307-339` 把 `relationType` 写为单标签；块 `relation-arrow-block-v.ts` 只在 `geo.b` 画一个箭头、在中点画一个标签。
- 关系面板 `panel/relation-panel.tsx` 是"类型 select + 方向交换 + 范围"，用户被迫先理解有向存储。

## 二、目标数据模型

### 2.1 数据库（物理列）

```sql
-- 旧列 relation_type 保留，语义即 fromRole；新增可空 toRole。
alter table world_relations add column to_role text not null default '';
alter table world_relation_tombstones add column to_role text not null default '';
```

- 不改名、不 backfill：旧行 `relation_type` 直接读作 `fromRole`，`to_role=''` 即未标记。
- 唯一约束保持 `(world_id, from_entity_id, to_entity_id, relation_type)`：同一对端点要两条边仍需不同 `fromRole`（本 RFC 不改键，作为已知约束）。
- 后续可选：等旧版本下线后再 `RENAME COLUMN relation_type TO from_role`（不在本期）。

### 2.2 Go 类型与命名

```go
type WorldEntityRelation struct {
    ID           string `json:"id"`
    FromRole     string `json:"fromRole"`             // 旧 type / relation_type
    ToRole       string `json:"toRole,omitempty"`     // 空 = 未标记
    FromEntityID string `json:"fromEntityId"`
    ToEntityID   string `json:"toEntityId"`
    ScopeEntityID string `json:"scopeEntityId,omitempty"`
    Direction    string `json:"direction,omitempty"`  // out | in | scope（读投影，保留）
}
```

- 代码统一用 `FromRole`/`ToRole`；所有 SQL 的 `relation_type` 物理列名不变，仅 Scan 目标改名。
- 输入结构 `CreateRelationInput`/`UpdateRelationInput` 增加 `ToRole`；`RelationType` 字段重命名为 `FromRole`，调用方按 `fromRole || relationType` 兼容。
- `WorldRelationSpec` 去 `Inverse`，加 `ToLabelZh`：

```go
type WorldRelationSpec struct {
    LabelZh   string `json:"labelZh"`             // from 端语义
    ToLabelZh string `json:"inverseLabelZh,omitempty"` // to 端预设（一键填两端）
    Group     string `json:"group"`
}
```

- 预设示例：`"father": {LabelZh:"父亲", ToLabelZh:"孩子", Group:"people"}`、`"references": {LabelZh:"引用", Group:"story"}`。

### 2.3 默认值

- 新建关系：`FromRole="references"`（显示「引用」），`ToRole=""`（未标记）。
- `toRole` 判据：**非空即已标记**；显式填 `"references"` 也算标记（画双箭头），规则简单。

### 2.4 兼容映射表

| 层 | 名称 | 说明 |
|---|---|---|
| Go 字段 | `FromRole` / `ToRole` | 代码统一命名 |
| DB 物理列 | `relation_type`（旧）/ `to_role`（新） | 不 rename；`relation_type` 即 fromRole |
| JSON | `fromRole` / `toRole` | 输入接受 `relationType` 别名 |
| 前端 | `WorldEntityRelation.fromRole/toRole` | `type` 退役为读兼容别名 |

## 三、canonical / 导出导入 / 源格式

- **canonical**（`service/worlds.go:2052-2065`）：relation 记录内部键**保持 `"type"`**（承载 fromRole），仅当 `to_role != ''` 时追加 `"toRole"`。旧世界 canonical hash 不变；`to_role` 为空的现存关系逐字节等价。
- **平台 manifest v2 / 源格式**（`service/worlds_platform.go:69-75`，`worlds_bundle.go:295-310`）：`WorldManifestRelation` 增加 `fromRole`/`toRole`；`type` 保留为 fromRole 的兼容别名（读入 `fromRole || type`，输出 `fromRole`）。
- **物化**（`service/worlds_platform.go:597-599, 687-693`）：insert 增加 `to_role`。
- **导出**（`service/worlds_bundle.go:295-310`）：select + 输出两端 role。
- **fork/ID 重映射**（`service/worlds_platform.go:1519-1544`）：复制 `to_role`。
- **源脚本**：`scripts/worlds-publish.mjs`（220-223, 364）与 `scripts/worlds-migrate-v2.mjs`（199）透传/校验 role（可选，缺省 `fromRole="references"`, `toRole=""`）；`scripts/worlds-inspect.mjs`（58-89）打印两端标签。
- `worlds/*/world.json`：**不改**（role 可选，缺省对称引用）。

## 四、画布渲染：单/双箭头

- 投影 `canvas-pomelo.tsx`（256-293 草稿、307-339 关系）：attrs 写 `fromRole`/`toRole`；`hasReverse = toRole !== ""`；标签用 `labelZh` 解析 token。
- 块 `relation-arrow-block-v.ts`：
  - `blockStateSelector`（31-38）带出 `hasReverse` 与两端 label。
  - 单（`!hasReverse`）：现状——曲线 + `geo.b` 三角 + 中点标签（from）。
  - 双（`hasReverse`）：在 `geo.a` 追加反向三角（`angle + π`，复用 64-72 尺寸）；标签改为两端各一，from 端放 bezier `t≈0.25`、to 端放 `t≈0.75`；`labelOffsetIndex`（86-95）对两端各自生效。
- 语义提醒：双箭头 = "这条连接两端都有语义"，**不等同**对称互引；要对称就把两端填同值（如 `references`/`references`）。UI 文案需避免误读。

## 五、面板与共享编辑器

- `panel/relation-panel.tsx`：把"类型"单 select 拆成两行 token combobox：

  ```
  起点语义   [ 引用 ▾ ]            ← 可输入可选择；默认 references
  终点语义   [ (未设置) ▾ ] ＋     ← 空=未标记；输入即标记 → 画布变双箭头
  方向       A → B          ⇄     ← 交换端点 + 对调两端 role
  范围       全局
  ```

  预设项一键填两端（父亲/孩子）；只改一端就只改一端；改完写 store 即时重投影。
- `panel/entity-panel.tsx`（28-36）与 `components/world-entity/entity-editor.tsx`（41、301-315、408-480）：`RelationItem` 改为携带自身端 role；关系列表文案与 `RelationTypePicker` 改为双端。
- `world-detail-settings.tsx`（141-153）：同宿主同步。

## 六、分阶段实施 Checklist

**P0 后端 schema + 领域**
- [ ] `service/project.go`：加 `to_role` 列（`world_relations`、`world_relation_tombstones`），迁移块（~783）加 ALTER。
- [ ] `service/worlds.go:249-258`：`WorldEntityRelation` 加 `FromRole`/`ToRole`。
- [ ] `service/worlds_canvas.go`：`WorldRelationSpec`（26-34）去 Inverse、加 ToLabelZh；`worldRelationTypes`（39-63）+ `ListWorldRelationTypes`（66-82）；`CreateRelationInput`/`CreateRelation`（650-727）；`UpdateRelationInput`/`UpdateRelation`（729-829，含重复判定 810）；`ListRelations`（835-867）；`DeleteRelation`（873-912）；`PromoteCanvasElement`（1078-1085 默认改 fromRole="references", toRole=""）；`getEntity`（998-1013）、`worldGraph`（620-670）。
- [ ] `service/worlds.go`：`DeleteEntity`（1420-1450）、`RestoreEntity`（1514-1558）、`RestoreRelation`（1623-1660）、`revertToRevision`（2769-2775）墓碑列。
- [ ] `service/worlds.go:2052-2065` canonical：保留 `"type"`，条件追加 `"toRole"`。

**P0 后端导出/契约**
- [ ] `service/worlds_platform.go:69-75, 238-247, 389-398, 597-599, 687-693, 1519-1544`、`worlds_bundle.go:295-310`。
- [ ] `service/worlds_http.go`（428/437/453/460/493/583）、`service/worlds_mcp.go`（relation 工具 45、promote 43、描述 74/76/81/82/85/86）、`service/world_events.go:34`、`service/agent.go:2432`。

**P1 前端契约 + store + 渲染**
- [ ] `web/lib/recut-worlds-client.ts`：`WorldRelationType`（342）加 inverse label；`WorldEntityRelation`（82-89）加 `fromRole`/`toRole`；`relations.create/update`（451-452）、`canvas.promote`（448）、`entityTypes.list`（440/561）。
- [ ] `web/app/worlds/[worldID]/canvas/canvas-store.ts`：state/actions（865/1505/1555/1602/1607/2015/1715）。
- [ ] `canvas-pomelo.tsx`（256-293/307-339）、`canvas-pomelo-plugin.ts`（284/948-980）、`canvas-detail-panel.tsx`（126-130）、`canvas-context-menu.tsx`（83-147）、`canvas-dialogs.tsx`（108-266/362-396）、`canvas-toolbar.tsx`（77）、`selection-plugin.ts`（119-265/441）、`relation-arrow-block-v.ts`、`canvas-relation-candidates.ts`（Top4 → role 预设建议）。

**P1 面板/编辑器**
- [ ] `panel/relation-panel.tsx`（双 token combobox + 交换 + 范围）。
- [ ] `panel/entity-panel.tsx`、`components/world-entity/entity-editor.tsx`、`world-detail-settings.tsx`、`world-detail-client.tsx`（734）。

**P2 读模型 / 脚本 / 演示 / 文档**
- [ ] `web/lib/marketing-worlds.ts`（18-20/73-209）、`web/lib/context-catalog/sources/entities.ts:95`、`web/lib/world-entity/guided/entity-actions.ts`（286/451/547/648）。
- [ ] `web/lib/pomelo/world-canvas/{entity-color.ts,demo-store.ts,doc-sync.ts,detail-panel.tsx}`。
- [ ] `scripts/worlds-publish.mjs`、`worlds-migrate-v2.mjs`、`worlds-inspect.mjs`。
- [ ] `web/app/worlds/[worldID]/canvas/README.md`。

**测试**
- [ ] `service/worlds_canvas_test.go`、`worlds_contract_test.go`、`worlds_bundle_test.go`、`worlds_runtime_test.go`、`worlds_platform_test.go`、`worlds_mcp_test.go`；`web/lib/world-entity/guided/registry.test.ts`；`web/scripts/e2e-world-canvas*.mjs`。

## 七、验收

- 旧世界/旧 manifest 打开：`fromRole` 正确显示为旧 type 的中文 label，全部单箭头，canonical hash 不变。
- 端点 toRole 填值 → 画布该边变双箭头且两端各有标签，撤销恢复单箭头。
- 交换方向：端点互换且两端 role 随端点走，肉眼看到的两端标签不变。
- export → import round-trip：`fromRole`/`toRole` 完整，`toRole=''` 仍为未标记。
- 输入旧字段 `relationType` 等价于 `fromRole`。

## 八、风险与开放问题

- **机器 key vs 自由 label**：`fromRole`/`toRole` 是 token（沿用旧值域），聚合/着色/Agent 查询仍可按 token；若全量自由文本会牺牲按类型聚合，暂维持"catalog key + 自定义字符串"双通道。
- **同一对端点多边**：唯一键仍含 `fromRole`，两端 role 不同但 fromRole 相同的两条边会冲突；如需支持，后续将唯一键改为 `(world_id, from, to, from_role, to_role)`。
- **双箭头语义误读**：见 §4 提醒，需要 UI 文案与图例澄清。
- **canonical 键名**：本期保留 `"type"`；未来与其它 canonical 变更合并时再统一为 `"fromRole"`（届时一次性 hash 变更）。
