---
name: recut-worlds
appId: recut.platform
description: 操作 World 与 World Canvas 工具集的通用技能：属性/关系/类型的建模与关联、画布元素的显示与提升，以及世界语境里的媒体生成（视频待用户确认）。
references: content-model.md, content-templates.md, production-layer.md, canvas-hierarchy.md, media-generation.md, pitfalls.md
---

# World（Canvas）操作技能（recut-worlds）

**World 默认指它的 World Canvas**：一个世界 = 一块无限画布，实体是画布上的节点、关系是连线、画布元素是投影。本技能回答：**怎么调用 `recut.worlds.*` 管理这块画布**——建 / 改节点与类型、连线、布局、生成并落位媒体。世界自身的内容在 `world.md`（`recut.worlds.get` 的 `skillMd`）；生成提示词的形状归 `recut-director（references/generation-prompt）`。

结构：① 画布数据结构 → ② 默认节点（实体）与操作 → ③ 工具列表 → ④ 常用工作流程 → ⑤ 纪律与规则。细节按需读 `references/`（文末路由表）。

## 一、画布数据结构

画布分两层：**语义层**（实体 + 关系，Canon 真相）+ **表达层**（画布元素，投影，不产 revision、可重建）。

```ts
// ── 语义层（Canon）─────────────────────────────────────────────
type World = {
  id: string
  identity?: {             // 世界级属性（不是实体）
    style?: unknown        // 一个世界一个 STYLE LOCK
    constraints?: { always?: string[]; never?: string[]; prefer?: string[] }
  }
  entities: Entity[]       // 语义层
  relations: Relation[]
  canvases: CanvasDoc[]    // 表达层：多张画布，构成一棵树（见下）
}

type Entity = {
  id: string
  typeId: string          // 预设 work | script | character | location | prop，或自定义
  name: string
  intro?: string          // 一句话简介
  detail?: string         // 正文（内容本体）
  cover?: Media           // 封面 —— 一等字段，不是 attr
  attrs: Attr[]           // 有序；只放真 meta（时长/画幅/镜号等短字段）与 media
}

type Attr = {
  key: string             // 类型级预设字段（locked，如 character_reference）或实例属性 a_*
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'media'
  value: string | number | boolean | string[] | Media
}

type Media = {            // 素材唯一通道：只引用 assetId，不复制二进制
  assetId?: string; url?: string; name?: string
  kind?: 'image' | 'video' | 'audio'; segment?: unknown
}

type Relation = {         // 双向语义
  fromEntityId: string; toEntityId: string
  fromRole: string; toRole?: string
}
```

```ts
// ── 表达层：World 有多张画布，挂成一棵树（递归世界画布）──────────
type CanvasDoc = {
  contextId: '' | string    // 树定位：'' = 世界根画布；<entityId> = 该实体的内层画布
  elements: Element[]
}
// 树形（每张画布都是整棵树上的一层）：
//   ''（世界根）
//    └─ <entityId>          （其投影卡 shape:<entityId> 挂在父层画布上）
//        └─ <entityId>      （递归：entity 元素可下钻到它自己的内层画布）
// 例：世界根 '' 上挂「作品」投影卡；作品的内层画布（contextId=<workId>）上平铺 script 与视频节点；
//     角色 / 场景 / 道具等锚点直接挂世界根，是独立分支

type Element = {
  id: string              // entity→shape:<entityId>；世界根→shape:world；语义关系边→arrow:<relationId>
  kind: 'entity' | 'attr' | 'media' | 'note' | 'text' | 'shape' | 'arrow' | 'link' | 'group'
  refId?: string          // entity 投影指向实体（refKind:'entity'）；props 只存视图偏好
  name?: string
  props: Record<string, unknown>      // 内容 / 绑定：attr|media 卡存 label、assetId、assetStatus；group 靠 props.groupId 派生成员
  geometry: { x: number; y: number; width?: number; height?: number; zIndex?: number }
  layer?: string
}

// 边（kind: 'arrow' | 'link'）：起点必须是 entity 元素
type EdgeProps = {
  fromElementId: string   // = shape:<entityId>
  toElementId: string
  edgeType?: 'attr'       // entity → attr | media：属性边，共享 entity.attrs 单一数据源
}
// entity → entity    = Relation（写 world_relations）
// entity → attr|media = 属性边（值不复制，属性卡只持引用投影，编辑按 label 回写实体）
```

> 封面 / 属性粒度 / locked 字段 / 世界级属性 / 显示三层 / 提升语义 → `references/content-model.md`。

## 二、默认实体与操作

创建 / 更新统一用 `recut.worlds.entity` op=`create` / `update`。**正文写 `detail`，attr 只放真 meta**：

| 类型 | 是什么 | 正文 `detail` 放什么 | attr 真 meta |
|---|---|---|---|
| `work` | **交付单位**（挂成片与总进度；可多脚本） | **作品完整内容，一次写全、不压缩** | 无（封面走 `cover`） |
| `script` | **一集的完整脚本 + 可生成规格**（一集一个 script） | 本集结构（钩子→推进→落点）/ 旁白·台词逐字 / 场景初步规划（含每一段视频的拍摄设计） | 一句话概括 / 目标时长 / 画幅 / 目标平台 / 整片分镜（可选，仅预览） |
| **视频节点** | **一次视频生成的单位**（画布上的媒体元素，不是实体） | 拍什么写进对应 `script.detail`；节点只引用生成出的 `assetId` | `kind:"media"` + `props.modality:"video"` / `assetStatus` |
| `character` | **角色**（人物 / 动物 / 生物） | 角色身世 / 关系（长文） | 外貌与标志 / 性格 / 声音与说话方式 / **声线参考 `voice_reference`** / **角色卡 `character_reference`** / 不可变特征 |
| `location` | **场景** | 场景细节（长文） | 描述 / 氛围 / **场景卡 `location_reference`** |
| `prop` | **道具** | 道具细节（长文） | 描述 / 外观与标志 / **道具卡 `prop_reference`** |

**生产结构与视频节点（硬契约）：**

- 层级只有两层：`work → script`（一个作品可多个脚本）。**一次视频生成的单位是画布上的「视频节点」**（媒体元素），不再拆出场 / 镜实体；一段连续动作优先一次多镜连续生成。
- **结构真源 = 结构关系 `has_script`**（父→子），**不是 `parentId`**（后者只是通用归属文件夹）。`childTypes` 声明默认子类型（`work.childTypes=["script"]`，script 是叶子）。
- **产物**：按需的 media 属性走实体（作品挂成片、关键帧 / 配音挂相关锚点或脚本实体）；视频节点直接引用生成出的 `assetId`。

**组织与层级（建实体前必读）：**

1. **锚点实体**（`character` / `location` / `prop` / `work`）建在**世界根层**（`contextId: ""`），归属留空。
2. **生产实体**（`script`）与**视频节点**建在**作品层**（`contextId` 与 `parentId` 都给 `<workId>`），彼此同级，不再逐级下钻。

> **画布树不是文件夹**：一个作品的相关内容尽量放同一张画布（`work → script / 视频节点` 全铺在作品层），别逐层分层。见《五、规则｜画布组织》。

> 完整正文模板 → `references/content-templates.md`；生产结构（`work → script`）与视频节点 → `references/production-layer.md`；树形排版 / 加深例外 → `references/canvas-hierarchy.md`。

## 三、工具列表（意图 → 工具）

实体 / 关系 / 类型 / 画布都经下列画布接口写入。

| 意图 | 工具 | 说明 |
|---|---|---|
| 发现 / 读取世界 | `recut.worlds.list` / `recut.worlds.get` | `get` 是**单一入口**：概览 + world.md（`skillMd`）+ 实体图 + `facts` + `constraints` + `references[]` + `readiness.missing`；不传 `selection` 即整库 |
| 读取内容 | `recut.worlds.entities.list` / `entities.get` / `entityTypes.list` | 只读；`entities.list` 支持 `typeId` / `parentId` / `text` / `includeProvisional` |
| 读画布 | `recut.worlds.doc`（某层）/ `docs`（层索引） | `contextId=""` 为根画布 |
| 写内容 | `recut.worlds.entity` | op：`create`（可带 `contextId` 落投影卡）/ `update` / `archive` / `restore` / `confirm` |
| | `recut.worlds.relation` | op：`create` / `update` / `archive` / `restore`；`scopeEntityId` 非空为局部关系 |
| | `recut.worlds.entityType` | 定义 / 覆盖类型 schema（不产 revision） |
| 写画布布局（不产 revision） | `recut.worlds.doc.update` | 元素级 ops：insert / update / remove；自由元素含 `note` / `text` / `shape` / `arrow` / `link` / `attr` / `media` |
| 提升草稿为 Canon | `recut.worlds.promote` | 便签 / 文本→草稿实体；箭头→关系 / 属性绑定 |
| 多步会话 | `recut.worlds.lock` / `unlock` | 多步画布编辑前上 advisory 锁，结束务必释放 |
| World 生命周期 | `recut.worlds.create` / `update`（world.md/identity）/ `fork` / `delete` / `revert` / `import` | 世界级操作，不是内容编辑 |

## 四、常用工作流程

> **Plan-first**：非简单任务先在目标 World 的 `paths.filesRoot` 写 `PLAN.md`（要建什么、用哪些参考、生成 / 排序列），呈报用户、每步回填。

### 典型操作 1｜从需求搭建世界资产

输入：用户一句需求 / 参考链接。目标：落成可生成的世界观资产（角色 / 场景 / 道具）。

1. **取缺口清单**：`world.get` 的 `readiness.missing` → 工作清单；onboarding 标准工作流（research → 生成候选 → 用户确认 → 写回）见 platform `recut` 的 `references/world-onboarding.md`。
2. **Plan**：把要建的资产、需要的参考、生成 / 排序列写成 `PLAN.md`，呈报用户。
3. **建设定实体**：基础操作 B——`entity` op=`create`（世界根层），内容写 `detail`。
4. **生成锚点参考并落位**：基础操作 C——`image.generate`（带参考）→ 节点 + 属性边 + Canon media 属性；一拿到 `assetId` 就落位。
5. **连线 / 提升 / 排版**：`relation`、`promote`、`doc.update`；相关联内容放同一张画布（见《五、规则｜画布组织》）。

**本操作规则**

- 每个锚点实体尽量配**核心参考图**（`character_reference` / `location_reference` / `prop_reference`）；没有参考图，后续生成必漂。
- 相关联的资产放**同一张画布**，别分到内层子世界。

### 典型操作 2｜基于已有资产建一个新作品

输入：世界里已有角色 / 场景 / 道具。目标：产出一个 `work` 及其脚本与视频节点。

1. **读世界**：基础操作 A——`world.get` 取已有资产、`references[]`、风格。
2. **建作品**：基础操作 B——`work` 建在根画布，`work.detail` 写**完整内容（一次写全）**。
3. **写脚本**：一个作品可多集，**一集一个 `script`**（`script.detail` = 本集脚本；模板见 `content-templates.md`）。
4. **拆段为视频节点**：把脚本里每个「一次生成的视频段」写成一段拍摄设计（空间 / 调度 / 摄影 / 灯光 / 声音 / 旁白·台词，一次生成 ≤ 单次上限），作为画布上的**视频节点**提交生成——不建场 / 镜实体。`script.detail` 就是这段设计的料场。
5. **逐段生成并落位**：基础操作 C——`video.generate`（待用户确认）→ `assetId` 落进视频节点；关键帧 / 配音走 `image` / `speech.generate`。
6. **排版**：`work → script / 视频节点` 平铺在作品层（见 `canvas-hierarchy.md`）。

**本操作规则（作品内容质量）**

- **`work.detail` 必须写清楚**：它决定后面分集、拆场与生成能达到的**细节上限**。
- **故事类按小说写**：把因果链、关键场景和**人物对话逐字写清**（谁对谁说、什么语气、什么反应），有对话与细节才有真实感；只写梗概 → 生成必然空洞。
- **不压缩、不跳步**：不要为「塞进某个时长」把长内容压成短摘要；**把故事与时间进展在作品层写足，生成的视频才不会漏内容、不会把时间进展压扁**。作品层没写出来的，成片里就没有。

### 基础操作 A｜读世界（生成 / 编辑前必做）

1. **`recut.worlds.get({ worldId })`（单一入口，缺省整库）**：一次拿到身份、world.md、实体图、`facts`、`constraints`、`references[]` 与 `readiness.missing`。**不要习惯性传 `selection`**——会丢掉主角色与风格锚点。
2. **按需深读**：单实体用 `entities.get`；大世界用 `entities.list` 分页；`graphTruncated=true` 时补读。

### 基础操作 B｜建 / 改作品与内容

写内容用 `entity` / `relation` / `entityType`；写布局用 `doc.update`；提升草稿用 `promote`。

**建一个作品 = 容器 + 子实体**：归属（`parentId`，进 Canon 的通用文件夹）与落卡（`contextId`，内层画布）是两件独立的事。

1. **选层**：作品落在**根画布**（`contextId: ""`）；仅当用户明确要求归到某容器内层才给容器 id。
2. **建作品**：op=`create`，给 `typeId` + `name` + `intro` + `detail`。`typeId` 用相符预设；**没有合适的先用 `entityType` 定义，不要临时编 id**（未知 id 会静默建成空类型）。
3. **子实体**：同一调用里**同时给** `parentId: <容器 id>` + `contextId: <容器 id>`；生产实体（`script`）在作品下**同级平铺**，服务端自动补 `has_script` 链。
4. **读回**：内层画布 `recut.worlds.doc {contextId: <作品 id>}`；子设定 `entities.get`（`children`）或 `entities.list {parentId}`。

```jsonc
// ① 作品：根画布，只给 contextId:""
// entity({ op:"create", typeId:"work", name:"《想找个人说话》", intro:"深夜独处切片 01",
//   detail:"<作品正文>", contextId:"" }) → { id:"<workId>" }
// ② 锚点（角色/场景/道具）在世界根层：只给 contextId:""
// entity({ op:"create", typeId:"character", name:"阿蛋", contextId:"" })
// ③ 生产实体（脚本）平铺在作品内层：parentId 与 contextId 都给作品 id
// entity({ op:"create", typeId:"script", name:"口播版 45s", parentId:"<workId>", contextId:"<workId>" })
// ④ 视频节点：在作品内层落一张媒体元素，生成后把 assetId 写进 props（不是实体）
```

边界：归属只在创建时定（`update` 不接受 `parentId`）；`archive` 作品级联归档整棵子图、`restore` 按批次原位恢复；实体从不跨 World。属性显示与关联（实体卡略读、属性卡只连边）→ `references/content-model.md`。

### 基础操作 C｜世界内媒体生成与落位

**调 generate → 拿 assetId → 落位**；视频由平台落为待用户确认态，用户在画布确认后才生成。

**参考自查（生图 / 生视频 / 配音通用；Rules 为硬约束）**：提交前先取参考，不许「纯文本直出」——先读 `references[]`，画面出现主角色带 `role="character"`（`character_reference`）、关键道具带 `prop`（`prop_reference`）、场景 / 风格 / 色卡按 `environment` / `style-ref` / `color-card`（场景取 `location_reference`）、角色说话带声线 `voice`（`voice_reference`）；视频用 `references:[{id,kind,role,label}]`（含 audio role）+ 需要发声时 `audioAssetIds`；只有**明确无角色**的纯空场景可省参考。

**主流程**：读 world → 用 `recut-director（references/generation-prompt）` 写提示词 → 导出 `references`（`id`=assetId，顺序即 `referenceIds`）→ 执行（`video.generate` / `image.generate` / `speech.generate`）→ 落位。

**落位（生成中节点 + 属性边）**：`assetId` 在排队 / 生成中已稳定可引用，**不要等生成完成**。用 `recut.worlds.doc.update` 在同一层放两笔：

```jsonc
// ① 确保实体元素在画布上（属性边只能从实体元素出发；服务端自动补 id/名称/默认几何）
{ "op":"insert", "element":{ "kind":"entity", "refKind":"entity", "refId":"<entityId>" } }
// ② 图片节点（属性卡）+ 属性边
{ "op":"insert", "element":{ "id":"shape:attr-<后缀>", "kind":"attr", "name":"属性 · 场景卡",
    "props":{ "media":"image", "label":"场景卡", "assetId":"<assetId>", "assetStatus":"generating" },
    "geometry":{ "x":200, "y":120, "width":260, "height":140 } } }
{ "op":"insert", "element":{ "id":"shape:arrow-<后缀>", "kind":"arrow", "name":"属性边 · 场景卡",
    "props":{ "fromElementId":"shape:<entityId>", "toElementId":"shape:attr-<后缀>", "edgeType":"attr" } } }
```

- **摆位贴着要连的对象**：先读该层 `geometry`，把新节点放在它要连的元素旁边（如右侧 320px、纵向对齐）；不传 x/y 服务端只会兜底贴到右侧。
- **节点 + 边缺一不可**；三笔都在同一 `contextId` 层。`props.assetStatus` 只写 `"generating"`，`ready`/`failed` 由平台流转。
- **画布与 Canon 都要写**：`entity` op=`update` + `attrPatch` 写同名 media 属性（核心参考用 `character_reference` / `location_reference` / `prop_reference`），`label` 与节点一致。

**参考集配方（按产物类型）**：

| 产物 | 参考集（role） |
|---|---|
| 场景 / establishing 全景 | 场景（`environment`）+ 主角色（`character`，出现时必带）+ 风格（`style-ref`） |
| 关键道具 / 道具特写 | 道具（`prop`）+ 场景（`environment`）+ 主角色（`character`，出现时）+ 风格（`style-ref`） |
| 角色设定 / 表情版 | 该角色（`character`）+ 风格（`style-ref`） |
| 关键帧 / 预览（测试） | 场景（`environment`）+ 主角色（`character`）+ 风格（`style-ref`） |
| 视频节点（默认，资产驱动） | 主角色（`character`）+ 场景（`environment`）+ 道具（`prop`，出现时）+ 风格（`style-ref`）+ 声线（`voice`，说话时） |
| 音色 / 配音 | 声线（`voice`） |

**视频默认待用户确认**：`recut.video.generate` 落为**全局素材库的待确认资产**（带完整配方，不花钱），画布只引用 `assetId`。**Agent 只做两步**：① 调 `recut.video.generate`；② 用 `doc.update` 把返回 `assetId` 写进媒体元素（`kind:"media"`, `props.modality:"video"`, `assetStatus:"generating"`），然后**停下**告诉用户「已提交 N 条视频，请在画布上确认生成」。确认后复用同一 `assetId`，画布无需重指。

> 媒体生成深规则（统一口径 / 视频生命周期 / 改配方 / 绑定自检 / 资源口径）→ `references/media-generation.md`。

## 五、纪律与规则（Rules）

**内容**

1. **正文写 `detail`，attr 只放真 meta**：作品故事 / 脚本细节（含每段视频的拍摄设计）都是**正文**；把正文塞进 attr、让 `detail` 空着＝**内容丢失**。
2. **素材 = media 属性（唯一通道）**：只引用 `assetId`，不复制二进制。
3. **语义真相只在实体 / 关系上**：画布元素只是投影，不写语义真相。
4. **实体卡只略读**：长文与编辑控件走详情面板 / 属性卡。

**画布生产**

5. **生成产物一拿到 `assetId` 就转成画布元素落位**（含 `proposed` / `queued` / `running`）：在**所属画布层**落「节点 + 属性边」并标 `assetStatus:"generating"`，让用户**在画布上直接感知到**；不等生成成功、不轮询回写。
6. **图片 / 语音同时写回 Canon**：`entity` + `attrPatch` 写同名 media 属性；画布与 Canon 都要写，`label` 一致。
7. **世界生成必带参考**（未过不提交）：主角色 / 关键道具 / 场景 / 风格 / 声线按需传入；只有明确无角色的纯空场景可省略。

**画布组织**

8. **画布树不是文件夹**：内层画布只在内容确实是独立子世界时才用；**相关联的内容尽量放同一张画布**——一个作品的 `work → script / 视频节点` 全铺在作品层这张画布，而不是逐级分层。画布是给人「一眼看全」的，每多一层就多下钻一次。

**门禁**

9. **非 local 世界只读**：写工具返回 `WORLD_READ_ONLY` 是边界不是失败——提议 `recut.worlds.fork`，经用户确认在副本上继续。
10. **写 Canon 需要用户明确授权**：无用户请求绝不主动写。
11. **乐观并发**：所有 Canon 写携带 `expectedRevisionId`；`WORLD_REVISION_CONFLICT` 时停止整批、重读最新 revision、基于最新状态重做。
12. **草稿免费**：`isProvisional: true` 的实体不产 revision、不进 Canon、不计入 readiness；用 op=`confirm` 转正。
13. **删除是软删除**：op=`archive` 可 `restore`；`recut.worlds.delete` 只在用户明确要求并确认世界名称时调用；**底层 media asset 永不因世界内容删除而删除**。
14. **生成产物默认不进 Canon**。
15. **视频默认待用户确认**：落待确认全局素材（不花钱），用户确认后才生成；**Agent 只提交与落位，不代确认**。

## References 路由表

| 问题 | 读什么 |
|---|---|
| 封面 / 属性粒度 / 属性类型 / 预设 locked 字段 / 世界级属性 / media 属性 / 显示三层 / 提升语义 | `references/content-model.md` |
| work / script 的完整正文模板与分集纪律 | `references/content-templates.md` |
| 生产结构（work → script）、结构链 has_script、产物与视频节点 | `references/production-layer.md` |
| 画布树形排版、加深例外、容器 / 递归边界 | `references/canvas-hierarchy.md` |
| 媒体生成深规则（视频生命周期 / 改配方 / 绑定自检 / 资源口径） | `references/media-generation.md` |
| 常见误用清单 | `references/pitfalls.md` |
| 某个世界的内容与生产工作流 | `recut.worlds.get` 的 `skillMd`（world.md） |
| 完善一个世界的标准工作流 | platform `recut` skill 的 `references/world-onboarding.md` |
| 生成提示词形状与参考锚定 | `recut-director（references/generation-prompt）` |

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
