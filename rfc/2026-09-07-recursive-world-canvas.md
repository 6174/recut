<!--
 * [INPUT]: 以现有 Creation World 的语义（Entity/Relation/Evidence/Revision/Binding）为参照，但按「从零设计的基石」重新定义数据结构
 * [OUTPUT]: 定义 Recut World 从「表单设定本」演化为「递归语义世界画布」的目标模型与可扩展数据结构
 * [POS]: rfc 的 Recut World 无限画布演化决策；在实现前冻结语义分层、递归容器与数据结构契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: Recut World 无限画布演化——递归语义世界模型

- 状态：草案（Draft）
- 作者：Recut
- 日期：2026-09-07
- 关联：[Creation Worlds 初版 RFC](./2026-08-12-creation-worlds.md)、[产品重构](./2026-08-14-creation-worlds-product-reframe.md)、[Onboarding](./2026-08-28-world-onboarding.md)、[PGC 平台 World](./2026-08-28-pgc-platform-worlds.md)
- 决策范围：World 的语义分层、递归 Entity Container、可扩展数据结构、tldraw 投影层、Agent 读模型

## 摘要

现有 Creation World 已经是一个结构化的 Semantic Graph：`world_entities`（角色/场景/风格/规则/故事）+ `world_relations`（有向语义关系）+ `world_asset_refs`（多模态证据）。它解决了「让 AI 记住设定」的问题，但**交互是表单式的**——用户在详情页的字段表单里编辑，无法在空间上自由组织、无法进入某个实体内部的局部上下文、无法把探索草稿与正式 Canon 分开。

本 RFC 把 World 从「表单设定本」演化为**递归语义世界画布（Recursive Semantic World Canvas）**：

> **以 Entity 为基本单位，以 Semantic Relationship 为图谱骨架，以 Evidence/Reference 为实体上下文，以递归 Entity Container 承载局部探索。**

核心主张与用户草案一致：

- **Entity 是节点，也是可进入的 Context Container**——双击进入其局部空间。
- **Reference（证据）≠ Relationship**——引用不默认产生图边。
- **空间自由，语义结构化**——画布上随便摆，但关系必须走受控词表。
- **Exploration 与 Canonical 分层**——草稿可被 Promote 成正式实体/关系。
- **World Model 是数据源，tldraw 是 View + Interaction Layer**——不把语义真相绑定在 Shape 视觉状态里。

本 RFC 的任务是：**定义一套干净、直接、可扩展的数据结构，让「递归容器」「局部子图」「画布元素」「探索/正式分层」「自定义 entity type」都能被自然表达。** 产品处于早期、用户很少，不为历史数据做兼容设计；数据模型按「基石」的定位从零设计。

## 现状参照（不是兼容约束）

现有实现作为语义参照，不代表我们要被它的 schema 绑住：

- `world_entities(kind, title, summary, content_json)`：Entity 主干方向正确。
- `world_relations(from, to, relation_type)`：有向语义边方向正确。
- `world_asset_refs`：多模态证据，已是「Reference ≠ Relationship」的正确形态。
- `world_revisions` + `creation_context_bindings`：不可变 Canon 与 Project/Job 绑定，是 Agent 可追溯的地基。

以下按「基石」重新设计目标数据模型，不承诺与上述物理 schema 逐列兼容。
```

关键分层规则（全部与现有代码语义一致）：

- **Relationship ≠ Reference**：`world_relations` 是图边，`world_asset_refs` 是上下文。已经在代码里分开，保持。
- **Global Graph 克制，Local Context 允许混乱**：全局只展示顶级实体与全局关系；实体内部用容器承载更多内容。
- **Exploration 与 Canonical 分层**：新增 `provisional` 态实体，Promote 后转正式并进入 revision。

## 可扩展数据结构设计（核心交付）

设计原则：**数据结构按「基石」从零设计，干净直接、可扩展，不为历史 schema 做兼容约束。** 下面是目标模型的完整定义。

### 5.1 递归容器：`world_entities.parent_id`

在 `world_entities` 增加递归容器字段：

```sql
alter table world_entities add column parent_id text references world_entities(id) on delete cascade;
alter table world_entities add column container_role text not null default '';  -- 可选：family/life/thought/creative_notes 等
alter table world_entities add column is_provisional integer not null default 0; -- 探索草稿
create index if not exists world_entities_parent on world_entities(world_id, parent_id);
```

- `parent_id = NULL` → 顶级实体，出现在 Global Graph。
- `parent_id = X` → 该实体是实体 X 局部上下文的一部分，只出现在 X 的 Entity View / Subgraph。
- `is_provisional = 1` → 探索草稿，不进入 `computeCanonicalTx`，不被 readiness 度量，Promote 后置 0 并产出 revision。

这**不新建实体表**，只给现有表加两列，递归容器就是「带 parent 的实体」。Story→Scene→Character 的层级天然可用：Story 是顶级，Scene 的 `parent_id=Story`，Character 的 `parent_id=Scene`。

### 5.2 局部子图：`world_relations.scope`

`world_relations` 已能表达有向边。为支持「局部上下文内的重要关系」，加一列归属：

```sql
alter table world_relations add column scope_entity_id text references world_entities(id) on delete cascade;
```

- `scope_entity_id = NULL` → 全局关系，进入 Global Graph 与 Canon。
- `scope_entity_id = X` → 关系只在 X 的局部上下文内有意义，`GetEntity(X)` 时才展开，不进入全局 Canon。

Canon 序列化（`computeCanonicalTx`）只序列化 `scope_entity_id IS NULL` 的关系，避免局部噪音污染 Agent 的全局读模型；`brief`/`resolve` 按需把局部关系随所选实体带出。

### 5.3 受控关系词表：relation 目录

不新建表，新增一个**内置只读 relation 目录**（代码常量，类似 `assetReferenceRoles`），把 `relation_type` 从自由字符串升级为「受控词表 + 自由扩展」双通道：

```go
// worldRelationTypes: 第一阶段受控词表（People/World/Video/Story 四组，见用户草案 §6.2）
var worldRelationTypes = map[string]WorldRelationSpec{
    "father":     {labelZh: "父亲", group: "people"},
    "mother":     {labelZh: "母亲", group: "people"},
    "child":      {labelZh: "子女", group: "people"},
    "spouse":     {labelZh: "配偶", group: "people"},
    "partner":    {labelZh: "伴侣", group: "people"},
    "friend":     {labelZh: "朋友", group: "people"},
    "teacher":    {labelZh: "老师", group: "people"},
    "student":    {labelZh: "学生", group: "people"},
    "colleague":  {labelZh: "同事", group: "people"},
    "enemy":      {labelZh: "敌人", group: "people"},
    "belongs_to": {labelZh: "属于", group: "world"},
    "located_in": {labelZh: "位于", group: "world"},
    "owns":       {labelZh: "拥有", group: "world"},
    "contains":   {labelZh: "包含", group: "world"},
    "created_by": {labelZh: "由…创作", group: "world"},
    "appears_in": {labelZh: "出现在", group: "video"},
    "followed_by":{labelZh: "接续", group: "video"},
    "precedes":   {labelZh: "先于", group: "video"},
    "adapted_from":{labelZh: "改编自", group: "story"},
    "causes":     {labelZh: "导致", group: "story"},
    "references": {labelZh: "引用", group: "story"},
    "depends_on": {labelZh: "依赖", group: "story"},
    "part_of":    {labelZh: "属于一部分", group: "story"},
}
```

- 内置词表可扩展（新增键即新类型），不破坏既有关系。
- 用户/Agent 仍可用自定义 `relation_type` 字符串，但 UI 优先给受控词表选择，保证图可读。

### 5.4 Entity 类型系统：预设 type + 用户自定义 type

Entity type 是模型的基石，必须留足扩展性——**用户甚至可以自己定义 type**，我们默认提供一套预设 type（人物、场景、故事、风格、规则…）作为开箱即用。它不是一个封闭枚举，而是一个**可扩展的类型目录**：每个 type 都携带自己的字段 schema、图标与配色，entity 只是某个 type 的一个实例。

#### 数据模型

新增一张 **entity type 目录表**（type 是 schema，entity 是实例）：

```sql
create table if not exists world_entity_types (
  id text primary key,                    -- type 标识，如 'character' 或用户自定义 'mecha'
  world_id text not null references worlds(id) on delete cascade,
  scope text not null default 'preset',   -- preset=内置预设 | custom=用户定义 | builtin=平台内置
  name text not null,                     -- 显示名，如「人物」「机甲」
  icon text not null default '',          -- 图标标识
  color text not null default '',         -- 类型色（画布/卡片）
  base_kind text not null default '',     -- 可选：归属的语义大类（character/location/...），用于 read 归类
  fields_json text not null default '[]', -- 字段 schema 数组，见下
  extends_id text references world_entity_types(id), -- 可选：继承自某 type（继承其字段）
  builtin boolean not null default 0,     -- 内置预设是否被用户覆盖过
  archived_at text
);
create index if not exists world_entity_types_world on world_entity_types(world_id);
```

每个字段 schema（`fields_json` 数组元素）：

```json
{
  "key": "appearance",
  "label": "外貌与标志",
  "type": "text" | "textarea" | "number" | "boolean" | "select" | "multi" | "media",
  "required": false,
  "placeholder": "例如：黑色短发，右侧一枚银色耳钉",
  "options": ["选项A", "选项B"],     // select/multi 时
  "invariant": true,                // 是否是不可改变的特征（进入 Canon 约束）
  "i18n": { "zh": "...", "en": "..." }
}
```

#### 预设 type（默认内置，用户可改）

第一阶段内置以下预设，与 `world_entities.kind` 的既有语义对齐：

| type | 名称 | 关键字段 |
| --- | --- | --- |
| `character` | 人物 | appearance, personality, voice, invariants |
| `location` | 场景 | description, atmosphere |
| `story` | 故事 | premise, moment, emotion |
| `style` | 风格 | visual, guidance, avoid |
| `rule` | 规则 | text |
| `reference` | 参考 | (证据) |

#### 规则：type 成本极低，在画布使用中自然涌现

**创建 type 的成本不该高**。用户不需要先想清楚 schema 才能开始；他是在画布上放东西的过程中，自然需要一种「新的东西」，type 才随之出现。

- **画布上随手创建**：用户把一个新的实体（或把一段自由便签 Promote）放到画布上，系统按当前世界默认提供一个 type（或就近推荐一个预设）。用户可随手命名，默认字段极简。
- **默认字段很简单**：一个新 type 落地时默认只带 `name` + `description` 两个通用字段，足够表达、足够上画布；`icon`/`color` 可用自动生成的占位值，不必手动填。
- **扩展字段后续自己定义**：字段 schema 不是创建时的必填前置，而是**按需生长**。用户在详情页填写时，遇到一个反复需要的新维度（比如给「机甲」加「能源类型」），才顺手加一个字段；`fields_json` 只保存用户真正加过的字段，未扩展的字段不存在，不显示空表单。
- **预设 type 只是「默认模板 + 极简字段」**：`character` 这类预设提供一组顺手可用的字段（见上表），但同样是「够用即可、可覆盖可扩展」，不是沉重约束。
- **`world_entities.kind` 存 type id**（`kind` 列仍是 text，直接存 `character` 或用户自定义 `mecha`）。`upsert` 对 type id 校验存在；为支持「随手建」，`upsert` 遇到未知 type 时**自动以默认极简字段创建该 type**（而不是拒绝），让创建不打断用户流程。
- **preset 跨 World 共享，custom 属 World**：内置预设是全局模板（`scope='preset'` 的系统目录，或随 World 复制一份 `scope='builtin'`），用户自定义 type 只属于当前 World。
- **readiness 与 Canon 归类**：`base_kind` 把自定义 type 归到语义大类（如自定义「机甲」→ `character`），复用现有 readiness 度量与 canonical 分组，无需新逻辑；未知 `base_kind` 按通用实体处理。
- **画布/卡片渲染**：type 的 icon/color/字段驱动画布卡片与详情表单，用户自定义 type 与内置 type 同等待遇。

**结论**：entity type 是可扩展的基石，但**不是创建的负担**。它遵循「先用默认、随手命名、按需加字段」的路径——用户在画布上自然地创造类型，schema 跟随使用生长，而不是倒逼用户先做设计。预设给开箱即用，`base_kind` 保证与现有 Canon/readiness/Agent 读模型兼容，无需 schema 迁移即可新增任意类型。

### 5.5 画布元素：`world_canvas`（Entity 骨干 + 自由表达元素）

单层画布的骨干是 Entity，但画布必须能承载用户自由创作表达的所有元素——**文本、图片、形状、箭头、便签、PDF、链接等**。tldraw 允许用户把任意元素拖到画布上、写字、贴图、画箭头。这些元素多数**不承载世界语义**（不是 Entity，不进入 Canon），但它们必须被持久化，否则刷新/重进就丢失。

因此画布不是「Entity 的布局表」，而是**一个可扩展的 Canvas 元素表**。两类元素共用一张表，用 `kind` 区分：

```sql
create table if not exists world_canvas (
  id text primary key,                          -- 元素 id（= tldraw shape id 的镜像）
  world_id text not null references worlds(id) on delete cascade,
  context_id text not null default '',          -- 所属上下文：'' = 全局画布；否则为父 Entity id
  kind text not null,                           -- entity | text | image | shape | arrow | note | link | ...
  ref_kind text not null default '',            -- entity 元素时 = 'entity'；否则 ''
  ref_id text not null default '',              -- entity 元素时 = entity_id；否则 ''
  name text not null default '',                -- 可选显示名
  props_json text not null default '{}',        -- 类型化属性（见下）
  geometry_json text not null,                  -- {x,y,width,height,rotation,zIndex}
  style_json text not null default '{}',        -- 视觉样式（颜色/线宽/字体/是否折叠/是否隐藏）
  layer text not null default '0',              -- 层级排序（前端画布次序）
  created_at text not null,
  updated_at text not null
);
create index if not exists world_canvas_world_ctx on world_canvas(world_id, context_id, layer);
```

**两类元素，一条骨干协议：**

- **`kind='entity'`（骨干）**：`ref_id` 指向 `world_entities.id`。它是「语义实体的视觉投影」——渲染时从 WorldStore 拉取名称/摘要/证据缩略，`props_json` 只存视图偏好（如折叠、是否显示关系标签），不复制语义。删除实体级联删除该元素。
- **`kind='text' | 'image' | 'shape' | 'arrow' | 'note' | 'link' | ...`（自由表达）**：不指向任何 Entity，`props_json` 承载类型化内容：
  - `text`/`note`：`{ text }`（便签 = 带颜色背景的 text）。
  - `image`：`{ assetId }`（可引用全局素材库，或内联 base64 小图）。
  - `shape`：`{ shapeType: 'rect'|'ellipse'|'triangle'|'diamond'|... }`。
  - `arrow`：`{ fromElementId, toElementId }`（画布内自由箭头；**画布边不是关系本身**，它只是编辑 `world_relations` 的视觉入口，见下）。
  - `link`：`{ url, title }`。

**边 ≠ 关系：画布与关系分离的权威规则**

这是本 RFC 数据干净度的核心。真正的语义关系**只存在于 `world_relations` 表**（带受控 `relation_type` + 归属 scope），画布上的连线只是它的视觉投影：

- **Entity 之间画一条边** → 不新增画布 `arrow` 元素，而是写入 `world_relations`（`canvas.upsert` 同时映射为 `relations.create`），`RecutRelationBinding` 渲染这条已存在的关系。
- **在画布上删一条边** → 删除对应的 `world_relations`，不残留孤儿画布边。
- **自由 `arrow`（不连实体）** → 只是画布草稿，不进 `world_relations`，不产生语义；用户可 `canvas.promote` 把它变成关系。
- **结果**：语义关系只有一个源（`world_relations`），画布边永不与关系失步，`computeCanonicalTx` 只读关系表。tldraw 的 binding 始终是从关系表**派生**的投影，不是写入真相。

**可扩展性保证：**

- `kind`、`props_json`、`style_json`、`geometry_json` 都是开放结构，新元素类型（如 `video`、`frame`、`group`、`embed`）只需新增 `kind` 值 + 前端渲染器，**无需 schema 迁移**。
- 元素表不承载语义真相：Entity 元素的内容来自 `world_entities`，自由元素只是用户画布表达。**整个 `world_canvas` 表不进入 `computeCanonicalTx`**，画布变更永不产出 revision。
- tldraw Store 是运行时投影，`world_canvas` 是它的可持久化镜像；两者通过 Projection/Sync 层双向同步。tldraw 的 group 可映射为 `kind='group'` 或仅作为前端临时组织，不落语义。

### 5.6 Context 归属：不新建表，用 `parent_id` + `scope_entity_id` 表达

用户草案里的 Context Store 不需要单独建表：**容器就是带 `parent_id` 的实体，局部关系就是带 `scope_entity_id` 的关系**。Context 是一个逻辑概念（某实体的局部空间），由这两列即可推导，无需物理 Context 表。这最小化 schema 增量，也保持 Canon 独立。

## Canon 序列化

`computeCanonicalTx` 序列化的是「世界语义事实」，不是画布表达。规则简单直接：

- `is_provisional=1` 的实体：**不进入** canonical（草稿不是事实）。
- `parent_id` 非空的实体：进入 canonical 时**携带 `parentId`**，保留容器层级。
- `scope_entity_id` 非空的关系：**不进入**全局 canonical（是局部上下文内的关系）。
- `world_canvas`（画布元素）与 `world_entity_types`（type 是 schema，不是实体事实）：**不进入** canonical。实体内容按 `kind`(=type id) 分组。

## 执行计划（MVP 优先）

目标：**尽快看到一个可交互的 MVP**，在这个骨架上迭代。计划按「先数据，再递归容器，再画布」排序，每阶段都有可运行验收点，可独立交付。

### Step 0 — 工作区骨架（0.5 天）

- 在 `web/app/worlds/[worldID]` 下新增 `canvas` 子路由与入口（详情页加「画布」Tab）。
- 引入 tldraw 并最小接入：在空白页 mount 一个可用的 tldraw 编辑器，验证 Next 16 / React 19 兼容（若引入成本过高，先用受约束的 SVG 手绘投影兜底）。
- 验收：打开世界详情能看到一个可拖拽、可缩放的空白画布。

### Step 1 — 数据结构落地（1.5 天）

- `service/project.go` schema：加 `world_entities.parent_id`/`container_role`/`is_provisional`；`world_relations.scope_entity_id`；新增 `world_entity_types`、`world_canvas` 表。
- `service/worlds.go`：新增 `worldRelationTypes` 受控词表常量；`world_entity_types` 目录读写（预设 seed + 自定义 upsert + 未知 type 自动创建极简字段）；`world_canvas` 元素 upsert/list（entity 骨干 + 自由元素）。
- Canon 序列化接入新规则（跳过 provisional/局部关系，携带 parentId，忽略 canvas/types）。
- 验收：`go test ./service` 新增用例绿；既有世界数据结构可读。

### Step 2 — 递归容器（1 天）

- `service`：`entities.create_child`、`entities.promote`、`relations.create/list`（带 scope）。
- web 详情页：进入实体查看 children + 局部子图；Story→Scene→Character 层级可编辑。
- 验收：能在「梁启超」下建「家族」，在家族下建「梁思成」，层级可浏览、可返回。

### Step 3 — 画布 MVP（2 天）

- 实现 `RecutEntityShape`（画 entity 卡）+ `RecutRelationBinding`（画 world_relations 边）。
- `world_canvas ↔ tldraw Store` 双向同步（entity 骨干位置持久化）。
- 自由元素（text/image/shape/arrow）落 `world_canvas`。
- 交互：从实体拖线→选受控关系→写 `world_relations`；拖图到实体→Evidence。
- 验收：在画布上摆实体、连关系、放便签，刷新后全部保留。

### Step 4 — Promote 闭环（1 天）

- 画布草稿（自由便签/箭头）`canvas.promote` → Entity / 关系，产出 revision。
- readiness 忽略草稿；Agent 建议写回走「提议→确认→写入」门禁。
- 验收：便签 Promote 成实体、箭头 Promote 成关系，revision 递增。

**MVP 里程碑（约 6 天）**：一个真实可用的无限画布——可放实体、连语义关系、加自由便签/图片、进入递归容器、草稿 Promote 成 Canon，数据全部持久化，Agent 能读能写。

## Agent 读模型

Agent 不应通过截图理解画布，仍读结构化 World Model。扩展后的查询面：

```text
getEntity(id)               # 完整内容 + 关系 + 证据 + parent/children
getRelationships(entityId)  # 全局关系 + 该实体为 scope 的局部关系
getReferences(entityId)     # 多模态证据
getContext(entityId)        # 进入容器：children + 局部子图
getCanvasElements(contextId) # 该上下文的画布元素（entity 骨干 + 自由元素，非语义）
promoteToCanonical(elementId | entityId | relationId)
```

新的/扩展 MCP 工具（在现有 `recut.worlds.*` 上增量，不删旧工具）：

| 工具 | 新增/扩展 | 用途 |
| --- | --- | --- |
| `recut.worlds.entities.create_child` | 新增 | 在实体下建局部子实体（容器） |
| `recut.worlds.entities.promote` | 新增 | 草稿 → 正式（置 is_provisional=0，产出 revision） |
| `recut.worlds.entityTypes.upsert` | 新增 | 定义/覆盖 entity type（含 fields_json 字段 schema） |
| `recut.worlds.entityTypes.list` | 新增 | 列出一世界的 type 目录（预设 + 自定义） |
| `recut.worlds.relations.create` | 新增 | 建受控语义关系（带 scope_entity_id 可选） |
| `recut.worlds.relations.list` | 新增 | 按实体列关系（全局 + 局部） |
| `recut.worlds.canvas.upsert` | 新增 | 写画布元素（entity 骨干 / 自由元素，均不产出 revision） |
| `recut.worlds.canvas.promote` | 新增 | 自由元素 → 正式（便签→Entity，箭头→关系，产出 revision） |
| `recut.worlds.entities.get` | 扩展 | 返回 parentId/children/provisional |

## tldraw 映射

tldraw 是 interaction substrate；World Model 是数据源。映射（对齐用户草案 §12、§25）：

```text
Recut World                 tldraw
------------------------------------------------
顶级 Entity Card            RecutEntityShape (custom shape, 持 entityId)
语义关系 Edge               RecutRelationBinding (custom binding, 持 relationId, 从 world_relations 派生)
自由文本 / 便签             text / sticky note shape (kind='text'|'note')
自由图片 / 链接             image / embed shape (kind='image'|'link')
自由形状 / 箭头             basic shapes / arrow binding (kind='shape'|'arrow')
Evidence Preview            RecutReferenceShape / asset preview
递归容器（可进入）           RecutContextShape (frame-like custom shape, 持 entityId + contextId)
局部子图                     Shape parent-child hierarchy + context 内的 shapes
画布元素持久化               world_canvas ↔ tldraw Store 双向同步
画布导航                     breadcrumb + 进入/返回 + minimap
```

实现要点：

- 基于 `BaseFrameLikeShapeUtil` 实现 `RecutContextShape` 作为**真正的容器**（子节点裁剪、拖入/拖出），而不是普通 Group（Group 只做「一起移动」）。
- **Entity 是骨干，自由元素是一等公民**：tldraw 原生 text/shape/image/arrow 直接可用，它们的 props 映射到 `world_canvas` 的 `props_json`/`style_json`；Entity 元素才走 `RecutEntityShape` 拉取语义。
- 自定义 Shape/Binding 的 `props` 只存 `entityId/relationId/contextId`（Entity/语义元素）或原生内容（自由元素），**不内联完整语义**；渲染时从 WorldStore 拉取。
- tldraw 的 `undo/redo` 只作用于视觉/交互层；语义写操作走既有 WorldStore + revision，两者分离。语义写成功后通过 Projection 刷新画布，视觉 undo 不撤销语义。
- 数据所有权规则不变：**Entity/Relation/Context/Reference ID 永远来自 Domain Model；自由元素内容只属于画布表达，不进 Canon。tldraw 只负责 position/size/rotation/selection/interaction**。

## 视觉语言

- **Card = Entity**：类型徽标 + 证据缩略 + 名称 + 简述 + @reference 数 + 关系数。
- **Edge = 语义关系**：带方向、线型、label、类型；只有 `world_relations` 画边。
- **@ = Reference**：证据用 @ 前缀视觉，明确「这是参考上下文，不是实体关系」。
- **颜色 → 实体类型/状态**，不承载关系语义；**方向+label → 关系**；**@ → 参考**。
- **进入提示**：有子实体的容器卡显示可进入标记（如 ⤷ 或折叠角标）。

## 交互（进入式导航）

- **创建实体**：`+ Character` 等，落在当前上下文的空白处。
- **进入实体**：双击/Enter 容器 → `World / 梁启超`，画布进入该实体局部空间。
- **建关系**：从实体拖出连线 → 选受控关系类型 → **写入 `world_relations`**，画布边是这条关系的投影（非独立元素）。
- **加参考**：拖图片到实体 → 识别为 Evidence，不自动建边。
- **自由表达**：工具栏可随时放置文本/便签/形状/箭头/图片/链接，作为画布上的自由草稿，不创建 Entity、不进 Canon。
- **Promote**：选中草稿（含自由箭头连到两个实体、或自由便签）→ `Promote to World` → 置正式并进入 revision（便签→Entity，箭头→`world_relations`）。
- **返回**：Breadcrumb / Back 回到父上下文。

## 非目标（对齐用户草案 §21）

- 不做通用白板（Miro/FigJam/Excalidraw）。
- 不做无限制自由连线。
- 不默认自动 Canonicalize 一切。
- World 不是 Timeline；Timeline 语义经 Scene/Story 连接，不并入 World。

## 开放问题

1. **tldraw 版本与 React 集成**：`web/package.json` 尚无 tldraw，需评估引入成本（体积、与 Next 16/React 19 兼容）。备选：MVP 先做「受约束的 SVG/canvas 手绘投影」，tldraw 作为 P1。
2. **局部关系的 canonical 携带深度**：进入容器时 `brief`/`resolve` 是否默认带出整个局部子图，还是按 selection 显式选择。建议按 selection，避免大世界观塞满每次请求。
3. **parent 是否允许一个实体有多个父**：MVP 单父（树状容器），多父（DAG）留 P2，避免关系语义模糊。
4. **画布元素是否跨设备同步**：本地单用户 MVP 画布随 World 存本地即可；未来多人协作再定冲突策略。
5. **entity type 目录的作用域**：内置预设是「跨 World 全局模板」还是「随每个 World 复制一份可覆盖的副本」。建议全局模板 + World 内覆盖副本（`scope='preset'` 引用 + `builtin` 覆盖标记），避免每个 World 重复维护；若未来需要 World 间共享自定义 type，再引入发布/复用机制。
6. **自由元素 Promote 的粒度**：自由 `arrow`/`note` 提升为正式关系/实体时，是「提升即新 revision 且原画布元素保留为投影」还是「提升后原元素消失」。建议前者（画布元素保留，关系/实体成为独立语义对象），避免误删用户表达。

## 验收标准

- 在画布上可放置实体卡、用受控关系连线、放自由便签/图片/形状/箭头，刷新后全部保留。
- 可双击进入实体容器，在其局部上下文内放置子实体并返回。
- 可创建局部关系（scope_entity_id），不进全局 canonical。
- 可创建草稿实体并 Promote，Promote 产出新 revision。
- 受控关系词表可扩展，自定义关系类型不被拒绝。
- 可定义自定义 entity type（fields_json 字段 schema）并用它创建实体，表单按 type 渲染；未知 type 随手建（默认极简字段）。
- 画布边是 `world_relations` 的派生投影，边与关系永不失步。
- Agent 可通过 `recut.worlds.*` 工具读取递归层级、type 目录与画布元素，并执行 Promote。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
