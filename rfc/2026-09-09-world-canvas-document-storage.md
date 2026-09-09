<!--
 * [INPUT]: 以 rfc/2026-09-07-recursive-world-canvas.md 的 world_canvas element 级模型为基线，吸收实体容器上线后暴露的「同一元素行跨层复用」问题
 * [OUTPUT]: 定义 World Canvas 的文档粒度存储模型：一张画布 = 一个 Document，内层画布是独立 Document，实体/关系语义数据保持共享
 * [POS]: rfc 的 World Canvas 存储层重构决策；取代 element 级 world_canvas 的读写契约与迁移路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: World Canvas 文档粒度存储——一张画布一个 Document

- 状态：已实施（M1-M4 落地；旧 world_canvas 表保留 30 天供回滚）
- 作者：Recut
- 日期：2026-09-09
- 关联：[递归语义世界模型](./2026-09-07-recursive-world-canvas.md)、[实施计划](./2026-09-07-recursive-world-canvas-plan.md)
- 决策范围：画布存储粒度（element 级 → 文档级）、读写契约（REST/MCP）、实体投影的位置归属、迁移与回滚

## 摘要

Recursive World Canvas 上线后，element 级存储（`world_canvas` 一行一元素，靠 `context_id` 区分层级）暴露出一个结构性问题：

> **实体投影卡（`shape:<entityId>`）的身份跨层复用一行，内层画布调整位置会写穿到外层。**

在 element 模型内打补丁（`geometry.inner[contextId]` 分层位置 map）是把「文档级行为」塞进「元素级行存储」，读写两侧都要携带 context 语义，复杂度分散在每个读写点。经权衡，改为**文档粒度存储**：

> **一张画布 = 一个 Document；进入实体 = 打开一个独立的内层 Document；实体/关系等语义数据（`world_entities` / `world_relations`）保持共享不变。**

核心收益：

- **位置归属天然清晰**：每个 Document 自己持有自己层里所有卡片/元素的位置，"外层位置"与"内层位置"是两个文档里的两条记录，互不覆盖——不再需要 inner map、ghost 影子元素、context 感知的读写 helper。
- **读写面简化**：前端一次取整个文档，本地自由编辑，去抖整包保存（带 version 乐观锁）；服务端不再逐元素 upsert。
- **与渲染层同构**：pomelo 文档同步层本来就是"文档 → blocks 全量重建"，存储粒度与视图粒度对齐。

## 1. 数据模型

### 1.1 新表 `world_canvases`（文档级）

```sql
create table world_canvases (
  id          text primary key,              -- doc id（内层用 `ctx:<entityId>`，根文档固定 `root`）
  world_id    text not null,
  context_id  text not null default '',      -- '' = 根画布（Level 0）；非空 = 该实体的内层画布
  doc_json    text not null,                 -- 文档正文：元素数组（见 1.2）
  version     integer not null default 1,    -- 乐观锁：每次保存 +1
  created_at  text not null,
  updated_at  text not null,
  unique(world_id, context_id)
);
```

要点：

- **一个 world 的画布集合 = `world_canvases` 按 `context_id` 索引的文档列表**。根文档 `context_id = ''`；进入实体 X 即打开/懒创建 `context_id = 'X'` 的文档。
- **文档不进 Canon、不产 revision**——与现有一致，画布是表达层。`version` 只做保存并发控制，不是语义版本。
- 文档正文 `doc_json` 是**不透明 JSON**，服务端只做整包存取与校验（大小上限、JSON 合法性），不理解内部字段。

### 1.2 文档正文结构

```jsonc
{
  "docVersion": 1,                  // 正文格式版本，独立于行级 version
  "elements": [
    {
      "id": "shape:ent_abc",        // 沿用现有 shape id 约定（镜像前端 block id）
      "kind": "entity",             // entity | note | text | attr | media | shape | arrow | world
      "refKind": "entity",
      "refId": "ent_abc",           // entity/attr 指向语义对象；自由元素为空
      "name": "新人物",
      "props": { "collapsed": false },
      "geometry": { "x": 120, "y": 80, "width": 200, "height": 110, "zIndex": 1 },
      "style": {},
      "layer": "0"
    }
    // ...同文档内其余元素
  ]
}
```

- `elements[]` 的元素结构与现有 `world_canvas` 行完全同构——**迁移 = 按 `context_id` 分组把行搬进数组**，前端类型 `WorldCanvasElement` 原样复用。
- **同一实体投影可以同时存在于根文档和内层文档**（两份位置），这是文档模型的自然结果，不再需要任何去重/同步逻辑。

### 1.3 语义层保持不变（共享）

| 层 | 存储 | 是否变化 |
|---|---|---|
| 实体（Character/Location/...） | `world_entities`（含 parent_id 递归容器、is_provisional） | 不变 |
| 关系（受控词表有向边） | `world_relations`（含 scope_entity_id 局部子图） | 不变 |
| 实体类型目录 | `world_entity_types` | 不变 |
| 证据 / 引用 | `world_asset_refs` | 不变 |
| 画布（表达层） | `world_canvas`（element 级）→ **`world_canvases`（文档级）** | **重构** |

**关系的画布投影归属**：语义边只存 `world_relations`；边的**视图几何**（fromAnchor/toAnchor/bend）随所在文档的 arrow 元素存储。同一语义边在根文档与内层文档可以有不同的弯度/锚点——视图分层、语义共享。

### 1.4 内层文档与实体的绑定规则

- 内层文档懒创建：第一次进入实体 X 的画布时，若无 `context_id='X'` 的文档则返回空文档（不预写行）。
- 实体被删除：其内层文档**级联归档**（软删，保留 30 天可恢复），不阻塞实体删除。
- 文档内容不校验 refId 存活（元素允许"悬空引用"，渲染层自行跳过）——实体删除/恢复不需要回写所有文档。

## 2. 读写契约

### 2.1 REST / MCP（取代原 canvas.upsert / canvas.list / canvas.remove）

```
canvas.get      { worldId, contextId }              → { doc, version }        // 幂等读，懒创建语义
canvas.save     { worldId, contextId, doc, version} → { doc, version }        // 整包保存；version 冲突返回 CANVAS_VERSION_CONFLICT
canvas.docs     { worldId }                          → [{ contextId, version, updatedAt }]  // 文档索引（大纲/全局搜索用）
```

- **保存策略**：前端本地编辑 + 去抖（1–2s）整包 `canvas.save`；冲突时拉取远端合并失败则提示刷新（早期单用户，last-write-wins 足够）。
- **AI / MCP 的元素级操作面保留**：新增 `canvas.doc.update { worldId, contextId, ops: [{ op: "insert"|"update"|"remove", element }] }`——服务端在文档 JSON 内应用 ops 后整包落库。**存储是文档粒度，操作面保持元素粒度**，`promote` 等既有 MCP 契约不变。
- 原 `canvas.upsert / canvas.list / canvas.remove` 下线（见 §4 迁移），不做双轨。

### 2.2 前端状态层（canvas-store 重构点）

| 现状（element 级） | 重构后（文档级） |
|---|---|
| `load()` 按 contextId 拉元素行数组 | `load()` 拉 `{ doc, version }`，元素数组进 state |
| 每次结构变化 `upsertElement` 单行写 | 本地改 doc + `dataVersion++`；去抖 `canvas.save` 整包 |
| `persistGeometry` 逐元素写几何 | 拖拽结束把新几何写进本地 doc 元素，随统一保存落库 |
| `moveElement` ghost 影子元素 + inner map | **删除**——元素本来就在文档里，改本地对象即可 |
| `geometry.inner[contextId]` 分层位置 helper | **删除**——位置就是元素在本文档里的 `geometry` |
| entityElementPosition 按 refId 跨层找回 | 各文档各自定位：根文档找根文档的元素，内层找内层的 |

渲染层（canvas-pomelo.tsx `buildPomeloRecords`）不受影响：它消费的仍是 `state.elements`，只是这个数组现在来自"当前打开的文档"。

### 2.3 「进入实体」的完整语义

```
双击实体卡
  → setContext({ entityId })
  → canvas.get({ worldId, contextId: entityId })   // 内层文档
  → 空/已有文档渲染为独立画布（实体卡位置=本文档自己的记录）
  → 返回上一层（面包屑）：根文档原样还在，外层布局未被触碰
```

内层新建元素（子实体/便签/属性）：写进**内层文档**；子实体同时通过 `parent_id` 挂到语义树（大纲/容器视图可见），语义与视图两条线各管各的。

## 3. 取舍记录

**为什么放弃 element 级 + inner map**（本 RFC 的前身方案）：

- inner map 要求所有读写点携带 context 语义（persistGeometry/moveElement/elementPosition/entityElementPosition/liveGeometry key…），复杂度分散且每个新视图属性都要重复一次"分层化"。
- inner map 只解决"位置"，解决不了"同一行两种身份"的根因——实体卡在内层添加 props（如 hidden、折叠态）依然会写穿。
- 文档模型下"两份"是免费的：根文档和内层文档各持一份元素记录，任何视图态（位置/尺寸/折叠/隐藏）都天然 per-layer。

**文档粒度的代价与对策**：

| 代价 | 对策 |
|---|---|
| 整包保存的写放大（大画布拖拽频繁） | 去抖 1–2s + 空闲合并；画布元素轻（无富文本/二进制），单文档 < 数百 KB，SQLite 整行 upsert 开销可忽略 |
| 多端并发整文档覆盖 | version 乐观锁 + 早期单用户假设；多端需求出现后再引入 op 级合并（复用编辑器 op 总线经验） |
| 服务端失去元素级可查询性（attr 投影同步等） | `syncAttrProjections` 移到前端保存前合并（面板是值真相源）；跨文档查询走 `canvas.docs` 索引 + 按需拉取，早期无跨文档查询场景 |
| AI 元素级契约看似被破坏 | `canvas.doc.update` 保留 ops 元素级操作面（§2.1） |

## 4. 迁移与实施

1. **M1 存储层**（service）：建 `world_canvases` 表 + get/save/docs/doc.update 四个能力；`world_canvas` 保留只读。
2. **M2 迁移**（一次性脚本，服务启动时惰性执行）：按 `(world_id, context_id)` 分组，把 `world_canvas` 行搬进对应文档的 `elements[]`（元素结构原样，含 id/props/geometry）；成功后旧表数据保留 30 天后清理。
3. **M3 前端重构**（canvas-store）：读写切到文档契约，删除 ghost/inner/逐元素 persist 逻辑；`canvas-pomelo.tsx` 仅改数据来源，不改渲染。
4. **M4 契约清理**：下线 `canvas.upsert/list/remove` REST+MCP 端点，更新 worlds_http/worlds_mcp 与 recut-worlds-client、RFC 0907 的 §5 画布章节引用。
5. **回滚**：M2 后 30 天内旧表仍在，可整体回退到 element 读写路径。

## 5. 验收

- 进入实体调整卡片位置 → 返回外层：外层布局逐像素不变；再次进入：内层位置保留。
- 同一实体在根文档与内层文档分别摆放两个位置，互不影响；实体字段/关系在两层编辑同源（面板仍走 `world_entities`）。
- 拖拽去抖保存期间杀进程：最多丢最后一次去抖窗口，无半写状态（整包落库）。
- MCP `canvas.doc.update` 可完成原有 upsert/remove 的全部场景；promote 流程回归通过。
