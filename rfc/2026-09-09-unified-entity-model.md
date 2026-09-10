<!--
 * [INPUT]: 设定视图与画布视图对 Entity 的呈现/编辑差异 review（world-detail-settings.tsx 硬编码字段表 vs canvas entityTypes schema + EntityPanel），以及 service 层实体模型现状（worlds.go / worlds_canvas.go / project.go）
 * [OUTPUT]: 统一 Entity 概念的目标模型：共用基础（名称/介绍/详情/属性列表/类型）+ 预制类型 locked 字段 + 可扩展 attrs + 双向关系图；素材统一为 media attr、废弃 evidence/参考类型；清理不在此定义内的 legacy 字段与双套 UI
 * [POS]: rfc 的 World Entity 模型统一决策；落地前冻结 schema、共享编辑器与迁移方案
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: 统一 Entity 模型——设定视图与画布共享同一套实体定义

- 状态：落地中（P0/P1/P2 已实现；P3 清理进行中）
- 作者：Recut
- 日期：2026-09-09
- 关联：[递归世界画布 RFC](./2026-09-07-recursive-world-canvas.md)、[画布文档存储](./2026-09-09-world-canvas-document-storage.md)、[产品重构](./2026-08-14-creation-worlds-product-reframe.md)
- 决策范围：Entity 的最小公共定义、属性（attrs）模型、类型目录与 locked 字段、关系图、设定视图/画布视图的共享编辑能力、legacy 清理

## 摘要

今天同一个「实体」在产品里有两种活法：

- **设定视图（form 模式）**：`world-detail-settings.tsx` 里硬编码的 `fieldDefinitions`（L40–73）驱动整表单对话框，按 legacy kind 枚举（character/story/style/rule/location）分组，整表单一次性 `entities.upsert`。不认识自定义类型、不认识 `content.body`、没有关系与删除。
- **画布视图（canvas 模式）**：`canvas-store.ts` + `panel/entity-panel.tsx` 按服务端 `entityTypes[].fields` schema 逐字段 blur 即存（contentPatch），支持草稿流、自定义类型、加字段、关系、素材网格、递归子设定。

两套字段模型、两套编辑 UI、两套素材管理、两套实体卡，数据同一个 `world_entities` 表。这不可维护。

本 RFC 把 Entity 收敛为一个**统一的最小公共定义**：

> **Entity = 身份（name / intro / detail）+ 类型（type）+ 属性列表（attrs，有序 typed key-value）+ 关系（双向边）**

核心主张：

1. **共用基础四件套**：`name`（名称）、`intro`（介绍）、`detail`（详细内容，即今天的 `content.body` 提升为一级概念）、`attrs`（属性列表）。所有类型共享，UI 也共享。
2. **属性是列表，不是散装 JSON**：`attrs` 是有序的 `{key, label, type, value}[]`，type 支持 text / textarea / number / boolean / select / media（图片、视频、音频都是 media 的子类）。
3. **素材即 media attr，evidence 层废弃**：实体挂图片/视频/引用，直接就是一条 media attr；不再维护独立的「参考/evidence」层（`world_asset_refs` + purpose/status/collection/segment 那套表单式元数据）。两个概念说的是同一件事，留两套就是脱裤子放屁。
4. **预制类型 + locked 字段**：系统预置类型（人物、场景、物件、故事、风格、规则）的字段标 `locked: true`，用户不可改名/删除/改类型，但可以**追加**自定义 attr。**不再预置「参考」类型**：原 reference 类型的价值（挂素材/引用）由 media attr 直接表达。
5. **扩展 attrs 用户全权编辑**：非 locked 字段可改 label、改值、增删 key-value pair。
6. **双向关系构成图**：关系边统一为无向语义边（渲染上双向），沿用受控词表 + 自定义 relationType；画布连线与设定视图的关系列表是同一份 `world_relations` 的两个投影。
7. **一套编辑器，两个宿主**：抽出一个共享 Entity 编辑组件（字段行 + 属性管理 + 关系列表），设定视图与画布 EntityPanel 都渲染它。产品早期用户很少，**不为历史数据做兼容设计**，旧字段直接迁移/丢弃。

## 现状问题清单

### 1. `kind` 有两套语义，已经互相矛盾

- `service/worlds.go L51–68`：closed enum `worldEntityKinds`（6 个），注释还说 closed。
- `service/worlds_canvas.go L108–146`：类型目录 preset（含 `object`），`object` 不在 enum 里；`ensureEntityType`（L211–237）对任意未知 kind 字符串自动建 custom type。
- HTTP/MCP 层 `WorldEntityKind(...)` 强转任意字符串。

结论：**类型目录（`world_entity_types`）已是事实真相，enum 应删除**。实体只存 `type_id`，不再存独立 `kind`。

### 2. 字段模型三个真相源

- 服务端 `entityTypes[].fields`（`EntityTypeField{Key,Label,Type,Required,...}`，`worlds_canvas.go L94–103`）——画布侧用。
- `world-detail-settings.tsx L40–73` 硬编码 `fieldDefinitions`——设定视图用，且缺 object/reference、缺自定义类型。
- `worlds_readiness.go L157–164` `requiredFieldsByKind`——完整度评分又一份镜像。

实体的 `content_json` 是无 schema 散装 JSON，写入不校验，UI 各自过滤（`key !== "type"` 的旧字段幽灵过滤散见 L129/L55）。没有顺序、没有 attr 级类型（media 字段在设定视图根本渲染不了）。

### 3. 基础概念没有归位

- `title / summary` 是列，`body` 藏在 content 里，画布 EntityPanel 把 `body` 提为「正文」而设定视图把它当普通字段混进前 3 项展示。
- 名称在画布上还有第三份投影（元素 `name` attr，`canvas-store.ts` renameEntity 同步），未来 attrs 化后应单向投影。

### 4. 关系是单向模型但产品是双向语义

`world_relations` 是有向边 + 受控词表（people/world/video/story 四组）。人物 A 是 B 的父亲 ⇔ B 是 A 的孩子，现在要求用户选对方向或建两条边。设定视图完全没有关系 UI。画布 relation panel 只展示「touch 该实体」的边（`ListRelations` L658–686），方向感对用户是噪音。

### 5. 双套 UI 明细（重复实现清单）

| 能力 | 设定视图 | 画布 | 状态 |
|---|---|---|---|
| 字段目录 | `fieldDefinitions` 硬编码 | `entityTypes.fields` | 分叉 |
| 字段编辑 | SettingDialog 整表单提交 | FieldRow blur 即存 contentPatch | 分叉 |
| 素材管理 | ObjectEvidenceManager（表单式） | EntityPanel 素材网格 + 拖拽挂卡 | 分叉 |
| 实体卡 | SettingCard | Pixi EntityCardBlock | 分叉 |
| 关系 | 无 | RelateDialog + RelationPanel | 缺失 |
| 删除 | 无 | DeleteConfirmDialog | 缺失 |
| 类型目录 | 仅 5 个预设 section | CreateMenu + NewTypeDialog + AddFieldDialog | 分叉 |

另有 demo 遗产双通道：`EntityCardBlock` 同时读 `cover`(emoji)/`coverUrl`(真图)、`photos`/`photoUrls`（`entity-card-block.ts L122–125, L238–257`）；evidence purpose 列表在 `canvas-media.ts` 与 `world-detail-panels.tsx` 各维护一份。

## 目标模型

### 1. Entity 记录（`world_entities` 重定义）

```
Entity {
  id, world_id
  type_id        -- 指向 world_entity_types，唯一类型真相；取代 kind 列
  name           -- 原 title
  intro          -- 原 summary
  detail         -- 原 content.body，长文本正文，升级为一级概念
  attrs_json     -- Attr[]，见下
  parent_id, container_role   -- 递归容器，沿用
  is_provisional -- 草稿，沿用
  created_at, updated_at, archived_at
}
```

删除 `kind` 列与 `content_json`（attrs 取代）。`content_json` 中不属于 body 的历史字段由迁移脚本转为 attrs（见迁移节）。

### 2. Attr 模型

```go
type EntityAttr struct {
    Key    string `json:"key"`              // 稳定 id（创建时生成，如 a_xxxx），改名只动 label
    Label  string `json:"label"`            // 用户可见名
    Type   string `json:"type"`             // text | textarea | number | boolean | select | media
    Value  any    `json:"value,omitempty"`  // 与 Type 匹配；media 为 {assetId, name, kind}
    Options []string `json:"options,omitempty"` // select
    Locked bool   `json:"locked,omitempty"` // 来自类型的预设字段，结构不可改
}
```

约束：

- **顺序持久化**：attrs 数组顺序即 UI 顺序，用户可拖动排序。
- **value 类型由 attr 自带**，不再依赖「从类型 schema 推断」——类型 schema 定义默认结构，实例 attrs 持有最终结构。这样 custom attr（schema 外）与 preset attr 走同一条渲染/编辑路径。
- media attr 的 value 存 `{assetId, name?, kind?, segment?}`：assetId 指向平台素材库（不复制二进制）；`segment`（可选 `{startSec, endSec}`）保留「只引用视频/音频某一段」的能力，这是原 evidence segment 的唯一值得保留的语义。

### 2.1 素材统一为 media attr（evidence 层废弃）

现状有三条「实体 ↔ 素材」通道：`world_asset_refs`（evidence，带 purpose/status/collection 表单元数据）、media 类型 attr（画布 EntityPanel 的 AssetFieldRow）、画布 media 自由元素挂接。三者归一：

- **media attr 是唯一通道**。拖素材到画布实体卡、EntityPanel「添加属性→媒体」，落点都是一条 media attr（`saveEntityField({attrPatch})`）。
- 原 evidence 的 purpose/status/collection 机制**不迁移**：purpose 的语义（外貌参考/声音参考/场景参考）用 attr 的 label 表达（如「外貌参考」），status（primary/supporting）的语义用 attr 排序表达——第一个 image attr 就是封面。
- 实体卡封面 = 第一个 image 类型 attr；`photoUrls` 网格 = 全部 image attrs。不再有「primary evidence」独立状态。
- `world_asset_refs` 表与 `evidence.attach/update/archive/list` API、MCP `evidence.*` 工具在 P0 冻结写入、P3 删除；`DeleteEntity` 的 evidence 级联改删 media attrs（attrs 随实体行走，天然级联）。
- World 级（非实体挂接）的素材若有需要，走平台素材库 attach 到 project，不新增 World 私有表。

### 3. 类型目录（`world_entity_types`，基本沿用 + locked 语义）

`EntityTypeField` 增加 `locked`（preset 字段默认 locked）。类型仍是 `scope: preset | builtin | custom`，写路径沿用 `UpsertEntityType`（preset id 更新本世界 builtin 副本；type 行不进 Canon/revision，维持现状）。

预置类型示例（locked 字段）：

| 类型 | locked 字段 |
|---|---|
| 人物 character | appearance / personality / voice / invariants |
| 场景 location | description / atmosphere |
| 物件 object | description / material / origin / usage / moment |
| 故事 story | premise / moment / emotion |
| 风格 style | visual / guidance / avoid |
| 规则 rule | text |

**「参考 reference」不进预置表**：它的用途（挂图片/视频/链接）由 media attr 直接表达；已有 reference 类型实体不做特殊迁移，用户可自建同名 custom 类型或直接改用 media attr。

**locked 的含义仅限结构**（label/type/删除被禁），value 用户随时可编辑；用户可在任意类型的实体上追加自定义 attr，也可在类型上追加共享字段（`AddFieldDialog`，新增字段默认 unlocked，对既有实例以「缺失即空值」投影，不回填实例）。

### 4. 关系：双向化

- 数据层保留 `world_relations(from, to, relation_type, metadata, scope_entity_id)`，**不做 schema 变更**；新增约定：边在产品语义上视为双向，读取侧按「touch 实体」聚合（现状已如此）。
- 受控词表为每条 relation spec 增加可选 `inverseId`（如 father ↔ child、teacher ↔ student、located_in ↔ contains），创建关系时 UI 只让用户选一个方向的叙述（"A 是 B 的 ___"），存储仍存一条有向边，展示时若无 inverse 就用 `references` 类中性标签双向渲染。
- `ListRelations` 增加 `direction` 投影字段（out/in），供关系面板显示「指向谁/被谁指向」。
- scope 局部关系、画布 arrow → relation promote 流程全部沿用。

### 5. 画布投影规则（不变式重申）

- 语义真相只在 entities/relations；画布元素（`kind:"entity"` 骨架 + 自由元素）永远是投影，写画布不产 revision（现状 `worlds_canvas.go L591–594`）。
- 实体卡渲染改为消费统一投影：`name / intro / cover（第一个 image attr）/ photoUrls（全部 image attrs）`。**删除 emoji 双通道**（cover/photos 遗留通道）。
- **实体卡背景默认轮播**：默认把实体 attrs 中所有 `image | video` 类型的 attr（value 含 `assetId`）取出作为背景源，在卡内低频轮播（视频静音循环/图片淡切，节奏建议 6–8s，画布渲染循环内实现、不落额外状态）。用户想固定某张时，通过一条**显式背景 attr** 覆盖：
  - 类型目录每类可带一个 preset 字段 `background`（type=media，unlocked，value 空=跟随默认轮播）；用户在该字段设定素材后，背景锁定为它，轮播关闭。
  - 判定规则简单单向：`background` attr 有值 → 单图/单视频背景；否则 → attrs 内媒体轮播。空类型目录（自建类型）也自动走轮播，无需任何配置。
- rename 后元素 `name` 投影由共享保存器单向同步（entity → element），画布上的 inline 改名仍走 `saveEntityField`。

## 共享编辑器（设定视图 ⇄ 画布）

抽包 `web/components/world-entity/`：

```
EntityEditor          -- 统一容器：身份区(name/intro/detail) + AttrsSection + RelationsSection
  FieldRow            -- 从 canvas panel/field-row.tsx 提升（blur 即存 / ⌘↵ / 全屏编辑）
  AttrRow             -- 单 attr 渲染 + locked 锁标 + 自定义 attr 的 label 改名/删除/排序；media attr 内嵌素材选择/预览
  AttrsSection        -- 列表渲染 + 「添加属性」（含「添加媒体」快捷项）
  RelationsSection    -- 关系列表 + 建立关系（词表方向选择）
  useEntitySaver      -- 统一保存器：saveEntityField 语义（name/intro/detail/attrPatch + expectedRevision 乐观锁 + 冲突 refresh 重试）
```

- **保存语义统一为 FieldRow 模式**（局部 patch、即改即存），SettingDialog 整表单提交废弃。乐观锁冲突沿用 canvas-store 的「revision 冲突 → refresh → 重试一次」约定（canvas-store.ts L660），提升进 `useEntitySaver`。
- 设定视图宿主：EntityEditor 放进 EntityDetailDialog / 编辑态；列表分组从「legacy kind 分组」改为「type 目录分组」（`entityTypes.list`），SettingCard 改读统一投影。
- 画布宿主：EntityPanel 变成 `<EntityEditor layout="panel" />` 的薄壳，保留草稿确认条、子设定导航、画布特有动作。
- 删除 `world-detail-settings.tsx` 的 `fieldDefinitions` 与 `contentEntries` 的 `key!=="type"` 过滤。
- `requiredFieldsByKind`（readiness）改为按类型目录声明 `requiredKeys`，消除第三份镜像。

## 数据迁移（一次性脚本）

产品早期，无兼容包袱：

1. `kind → type_id`：`ensurePresetEntityTypes` 已把 preset 复制为本世界 builtin 行，`base_kind` 即旧 kind，直接映射；未知 kind 已有 custom type 行对应。
2. `content_json` 解体：`body` → `detail`；命中类型 schema key 的 → 对应 attr（继承 schema 的 label/type，标 locked）；命中 `type` 等已知幽灵字段 → 丢弃；其余 → 追加为 `text` 自定义 attr（key=原 key，label=key）。reference 类型不再预置，其世界 builtin 行标记停用，存量实体保留原 type_id。
3. `world_asset_refs` → media attrs：每条未归档 evidence 生成一条 media attr（label 取原 label 或 purpose 中文名；segment 保留进 value）；purpose/status/collection 丢弃；归档态 evidence 不迁移。迁移完成后 `world_asset_refs` 置为只读。
4. `world_revisions` canonical_hash 会整体变化：接受一次全量 revision（early product，不做 hash 兼容）；fork/绑定链路读取时按 type_id 解析即可。
5. 画布元素：实体骨架元素 attrs 中 `title/desc` 投影键改名 `name/intro`，宿主合成代码同步改；画布 media 元素的 attach 边改为关联 attr key。

## 分阶段落地

1. **P0 服务端**：`world_entities` 加列（type_id/name/intro/detail/attrs_json）+ 迁移脚本 + `UpsertEntity` 改为统一输入（含 attrPatch）；删 `worldEntityKinds` enum 校验；`world_asset_refs` 冻结写入；relation spec 加 inverse；MCP/HTTP 契约同步（`entities.upsert` 的 `content` 字段替换为 `detail` + `attrs`，`evidence.*` 停用）。
2. **P1 共享编辑器**：抽 `web/components/world-entity/`，画布 EntityPanel 先切过去（回归最小），FieldRow/useEntitySaver 提升；EntityPanel 素材网格并入 AttrsSection 的 media attr。
3. **P2 设定视图切换**：类型分组列表 + EntityEditor + SettingCard 统一投影；删除 SettingDialog/fieldDefinitions/ObjectEvidenceManager。
4. **P3 清理**：删 `world_asset_refs` 表与 `evidence.*` API/MCP 工具；EntityCardBlock emoji 双通道、`content.type` 幽灵字段、双份 purpose 常量表、demo doc-sync 遗留 attrs；readiness 改 requiredKeys。

> 落地记录（2026-09-10）：P1/P2 已按本 RFC 实现 —— `web/components/world-entity/{entity-editor,field-row}.tsx` 共享编辑器；画布 `EntityPanel` 与设定视图 `EntitySettingsPanel`（右侧 320px 面板，替代原整表单 EntityDialog）为两个宿主；通用「素材」属性选项已移除（媒体拍平为素材（图片/视频/音频））；设定视图补齐关系（词表）与删除；§2.1 再确认：独立「参考素材」网格/封面按钮/A 虚线挂接线/素材来源浮层的实体目标通道已全部移除，媒体唯一表示 = media attrs（卡面图源 = 遍历 media attrs 的投影），拖素材到实体卡 = 写 media 属性。残留见 P3。

## 非目标

- 画布自由元素（text/note/media/arrow）与 promote 流程不动（仅 media 挂接落点改为 attrPatch）。
- 类型 schema 的版本化/类型继承（extendsId 已预留，暂不启用）。
- 关系的存储方向改造（仅加 inverse 词表投影）。

## 风险

- **迁移丢字段**：`content_json` 散装数据落到「自定义 text attr」兜底，不删除用户数据；幽灵 `type` 字段是唯一显式丢弃项（本就是 UI 隐藏字段）。
- **Attr key 稳定性**：key 用生成 id 而非 label，改名不破坏引用；但脚本/Agent（`ctx.worlds.entities.upsert`）现在按 key 写 content，MCP 契约要同步声明 attrs patch 语义，否则运行时 App 写入会静默失效——P0 必须连带改 `service/runtime.go L974–1017` 能力面。
- **evidence 消费方连锁**：世界 brief（`recut.worlds.brief`）、readiness 场景蓝图、AI 短片链路都在读 `evidence.list` / `WorldEntity.References` 做外貌/声音/场景参考；P0–P3 期间这些读取面必须切换为「实体 attrs 中的 media attr」，否则生成链路会静默拿不到参考图。`requiredFieldsByKind` 之外的 evidence 期望项（readiness）同步改为 media attr 期望。
- **画布渲染成本**：背景轮播意味着实体卡要解码多张图/视频纹理；Pixi 侧需限制并发纹理数（如只预取当前+下一张，视频默认首帧+低帧率更新），实体不可见（滚出视口/在内层画布）时释放。
- **设定视图回归**：SettingCard 完整度徽标、素材画廊依赖旧字段模型，P2 需按统一投影重写评分展示。
