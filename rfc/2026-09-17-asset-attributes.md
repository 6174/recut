<!--
 * [INPUT]: 依赖 service/media（media_assets 的 kind/origin/metadata、RenameAsset、CreateReferenceAsset、SSE asset.updated、/v1/media/*）、
 *   rfc/2026-09-17-editor-native-migration（Material{bytes|code}、组件/素材平台化、timeline-editor 为素材消费者、Render Host）、
 *   rfc/2026-09-09-unified-entity-model（Entity 的 name/intro/detail + 有序 typed attrs 范式与 locked 语义）、
 *   rfc/2026-09-16-media-generation-proposal（metadata.proposal 系统配方）、
 *   rfc/2026-09-17-reference-understanding（参考证据与真实内容参考）、
 *   rfc/2026-09-17-reference-understanding（参考理解与克隆执行，计划素材消费 attrs/content）、
 *   web/components/asset-preview-dialog.tsx（既有全局素材预览框）与 web/timeline-editor（素材面板 / 组件预览）
 * [OUTPUT]: 定义「全局素材能力」：以 Material（backing = bytes|code）为唯一素材载体，只加两个创作字段——
 *   content（非结构化长正文）+ attributes（有序 typed，带 provenance 溯源）；系统数据（proposal/reference 等）沿用既有 metadata 键，
 *   不新增命名空间。给出读写 op、统一预览编辑面、真实内容参考素材接口、MG/组件从 editor 私有 SQLite 迁到全局素材的迁移方案、
 *   与 Entity / editor-clone 的对齐与取代关系、迁移兼容、里程碑与验收
 * [POS]: rfc 的「素材属性协议层」决策；四步路线第三步，前承 video understanding，后接 clone skill；
 *   取代 editor-clone 把创作信息私有在 editor_assets 的方案，确立「editor 素材 == 全局素材」；
 *   并把 MG/组件从 editor 私有 SQLite 迁为全局素材
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# 全局素材能力：Material（bytes|code）+ content + attributes

- 状态：落地中（2026-09-17 M0 素材属性模型与 M3 统一预览编辑面已实施：`service/media/material.go` + `recut.media.asset.get/update` + `PATCH /v1/media/assets/{id}` + `AssetPreviewDialog` 属性/正文编辑 + 编辑器素材面板接入，测试 `service/media_material_test.go`）
- 日期：2026-09-17
- 关联：[Editor 迁移](./2026-09-17-editor-native-migration.md)、[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、
  [媒体生成提案](./2026-09-16-media-generation-proposal.md)、[参考视频理解](./2026-09-17-reference-understanding.md)、
  [参考理解与克隆执行](./2026-09-17-reference-understanding.md)
- 取代：[Editor 克隆](./2026-09-17-editor-clone.md) §4「素材元素挂 Editor 素材层」——创作信息不再私有在 `editor_assets`，统一落在全局 Material
- 非目标：不新增字节目录；不重写 `media_assets` 生命周期与生成门禁；不做素材「类型目录 + 字段 schema」系统（见 §5）；不改 World Entity 的 attrs。

## 0. 摘要

素材现在只有 `name / kind / status / metadata`，承载不了「这条素材是什么、从哪来、该配什么」。World Entity 已经有成熟范式——**有序 typed `attrs` + 长正文**——但素材没有。本 RFC 把同一套能力给到**全局素材**，并把它确立为**唯一素材载体**：

1. **Material 是唯一素材**：`backing = "bytes" | "code"`。字节素材是 `media_assets`；代码素材是组件（Motion Graphic / 特效 / 文本模板）。**MG 也是素材，不私有于 editor**——同一份 code material 在 `timeline-editor`、World 画布、remix、AI 短片里都能生成与复用；今天存在 editor 私有 SQLite 里的组件由此迁为全局素材（见 §8）。
2. **editor 素材 == 全局素材**：`timeline-editor` 的素材面板就是全局素材库的视图，时间线元素只持稳定引用（`assetId` / `componentId`）；创作信息在全局 Material 上。`editor_assets`（迁移后）退化为**项目引用索引**，不再承载属性与计划态，「添加进来的素材」与「全局素材」在逻辑上完全对等。
3. **双击预览 == 全局素材预览框**：素材面板双击、素材库、World 画布、实体属性字段、工具结果统一复用同一个预览框（`AssetPreviewDialog`），既展示也编辑——字节预览 + `content`（正文）+ `attributes`（属性，带来源）。
4. **只加两个创作字段**，服务两类场景：
   - **`content`**（非结构化长正文）与 **`attributes`**（结构化、有序 typed）承载 AI/人对素材的理解与描述，且**每个字段带 `provenance` 溯源**——AI 生成的字段能追到 `jobId / modelId / op / at`。

一句话边界：**字节/源码是真相，`content` + `attributes` 是素材自述（可复用、可溯源）；proposal/reference 等系统数据沿用既有 `metadata` 键，不是新概念；目标相关的解释留在项目里。**

## 1. 问题

- 素材只有展示字段：`name` 可改（`RenameAsset`），`kind` 是字节类型，`metadata` 被各功能当作私有口袋（`proposal`、转写、平台元数据混放），没有通用的「属性」层。
- 下游想给素材附加信息（角色、来源、可迁移判断、配方、引用）只能往 `metadata` 里随便塞，无顺序、无类型、无键稳定、无审计。
- **AI 写进去的字段无法溯源**：一个「主体 / 镜头 / 风格」字段是谁写的、依据哪次生成、依据哪些参考素材，今天无处表达。
- **导入的参考视频没有内容表达**：只有字节和原始链接，没有「这支片是什么、画面与结构如何」的可读理解，下游 clone/remix 每次都要从零重读。
- **MG 被私有化在 editor**：组件（code）与媒体（bytes）是同一个创作概念的两面，却一个在 editor 私有表、一个在全局素材库，导致同一份 MG 无法在其他场景复用，也逼出了「editor 素材元素」这套私有属性层。
- **editor 素材与全局素材错位**：`editor_assets` 想扩成承载 attrs/content/recipe 的素材元素表，等于在全局素材之外再造一份属性真相（[editor-clone](./2026-09-17-editor-clone.md) §4）。
- World Entity 已证明「有序 typed attrs + 长正文 + preset locked 字段」可用且好维护；素材应复用同一套，而不是发明第二套。

## 2. 模型

### 2.1 载体：Material（bytes | code）

素材即迁移 RFC 的 **Material**（[editor-native-migration](./2026-09-17-editor-native-migration.md) §7）：

```
Material {
  backing: "bytes" | "code",
  id,                     // bytes → media assetId；code → component assetId/componentId
  version?,               // code backing 的版本
  name,
  content, attributes,           // 本 RFC 定义的创作信息层（两个 backing 同一模型）
  // bytes: contentHash/mime/dimensions/duration/status…（既有字段）
  // code:  source/bundle/bundleHash/surface/inputsSchema…
}
```

三条主张：

1. **MG 即素材**：`code` backing 是一等全局素材，不再「editor 自有」。生成/编辑归属平台（MaterialService + Render Host），消费方包括 `timeline-editor`、World 画布、remix、AI 短片。**落点是迁移**：MG 今天维护在 `apps/editor` 的私有 SQLite（`editor_components` / `editor_component_versions`），本 RFC 把它迁到全局素材（见 §8）。
2. **editor 素材就是全局素材**：素材面板 = 全局素材库的项目视图；时间线元素只持引用，不复制属性。`editor_assets` 退化为项目引用索引（这个项目引了哪些素材），**不再承载 attrs/content/recipe/state**。
3. **引用不改**：媒体用 `assetId`、组件用 `componentId/versionId`，时间线元素与既有 op 不变。

### 2.2 两个创作字段（系统数据不进新命名空间）

素材只加两个创作字段，跨项目、跨 App 复用：

```jsonc
Material.metadata {
  "content": "……",                  // 非结构化长正文（markdown）
  "contentMeta": { Provenance },     // content 的写入溯源
  "attributes": [ Attr, ... ],       // 结构化、有序、用户/Agent 可扩展
  // 系统数据沿用既有键，不新造命名空间：
  "proposal": { ... },               // 既有生成配方（09-16）
  "reference": { ... }               // 既有研究/参考数据；真实内容参考证据写这里
}
```

- 刻意**不引入 `facets`**：它是额外一层概念，而 proposal/reference 早已是稳定的既有键。系统数据由各自 owner op 写、只读展示，用户不把它们当作可编辑属性。
- 只有 `content` 与 `attributes` 是「新概念」；其余都是既有字段，读取时按需展示。

### 2.3 Attr（对齐 World Entity，增加溯源）

```
Attr {
  key: string,          // 稳定 id
  label: string,        // 用户可见名
  type: "text" | "textarea" | "number" | "boolean" | "select" | "media" | "ref" | "url",
  value: any,           // 与 type 匹配
  options?: string[],   // select
  locked?: boolean,     // 系统/模板字段，结构不可改
  source?: "system" | "agent" | "user",  // 快速筛选：谁写的（缺省 user）
  provenance?: Provenance                 // 完整溯源（AI 字段必填）
}
```

```
Provenance {
  by: "system" | "agent" | "user",
  op?: string,          // 写入 op，如 asset.update / reference.attach
  jobId?: string,       // AI 生成字段：来源生成任务
  modelId?: string,
  assetIds?: string[],  // 依据素材（参考图/源片段）
  at: string            // ISO-8601
}
```

- **有序且持久化**：数组顺序即展示顺序，可拖动排序（与 Entity 一致）。
- `media` 值：`{ assetId, kind?, name?, segment? }`——引用素材库条目，可带 `segment` 表示「只用其中一段」（沿用 Entity media attr 的 segment 语义）。
- `ref` 值：`{ kind: "entity" | "project" | "world", id }`——跨对象引用（World 实体、项目、世界）。
- `url` 值：字符串 URL，用于溯源（如参考的原始链接）。
- `source` 是 `provenance.by` 的便捷投影，便于按来源筛选；Agent 写入时服务端强制填 `source=agent` 并补 `provenance`，不可由调用方伪装成 `system`。

### 2.4 Content（非结构化长正文）

- 一段 markdown 长正文，承载**叙述性理解**：这条素材是什么、讲了什么、画面/结构/风格特征。
- 与 `attributes` 的分工：能被枚举、比较、筛选、被机器消费的进 `attributes`；整段叙述进 `content`。避免把 `content` 塞成散装 JSON。
- `contentMeta` 记录溯源（谁写的、依据哪些素材或哪次理解），与 `attr.provenance` 同形。
- 对齐 Entity 的 `detail`（`content` ⇔ `detail`），素材暂不引入 `intro`（摘要可由 `content` 首段或一个 `text` attr 表达）。
- **`content` 是素材的「说明」，也是生成时的规格（本 RFC 的核心用法）**：它既能描述**已有字节**（参考视频「这是什么」），也能描述**尚无字节**的素材（「我要它是什么」）。后者的 **content-first 流程**是：**先建空素材（无字节）+ 写 `content`**（富文本，可 @ 引用其它素材 / 实体 / World），AI 真正执行生成时读这份说明作为提示词、把 @ 引用解析为生成参考，产物**原位填回同一 assetId**（与 09-16 提案门禁一致：proposed → confirm）。

### 2.5 系统数据（沿用既有键，只读展示）

- 生成配方仍写 `metadata.proposal`（09-16 的 `propose / update_proposal / confirm` 不变）。
- 参考/研究数据仍写 `metadata.reference`（既有 `create_reference` 已用此键）；真实内容参考的证据（观察层）也写这里，字段由 [reference-understanding](./2026-09-17-reference-understanding.md) §3.2 定义。
- 这些键**由各自 owner op 写入**，用户不可任意编辑；预览框只读展示，不进入属性列表。
- **红线**：系统数据只装客观观察/指针；素材级的描述性理解写 `content`/`attributes`，目标相关的解释（keep/replace/hook）写项目——详见 §4.3。

### 2.6 与既有字段的关系

| 字段 | 职责 | 是否可改 |
|---|---|---|
| `name` | 展示名 | 可改（RenameAsset / asset.update） |
| `kind` / `backing` | 字节/源码类型 | 不可改（真相） |
| `status` / `origin` / `contentHash` / `bundleHash` | 生命周期与溯源 | 不可改 |
| `content` | 非结构化长正文 | 用户/Agent 可改（带 contentMeta） |
| `attributes` | 结构化属性 | 用户/Agent 可改（locked 字段除外） |
| `metadata.proposal` / `metadata.reference` 等 | 系统数据（既有键） | 只由拥有 op 写 |

## 3. 接口

### 3.1 通用读写（素材 = Material 统一入口）

| op | 语义 |
|---|---|
| `recut.media.asset.get` | 读单个素材完整视图（`backing` / `name` / `content` / `attributes` / 系统键）；code backing 待迁移 RFC 平台化后并入同一入口，此前经组件工具做只读投影 |
| `recut.media.asset.create`（**待补**） | 建「空素材 + 说明」的占位（无字节、无需先定 capability）：先落 `content`/`attributes`，生成时再补配方并 confirm。当前 `propose` 要求 `capability`+`text`，无法表达纯占位 |
| `recut.media.asset.update` | 改 `name` / `content` / `attributes`（整体替换）/ `attrPatch`（按 key 合并，避免回读全量）；`locked` 结构项不可改，越权 fail closed |

- 语义对齐 `recut.worlds.entity.update`：`attrs` 整体替换 vs `attrPatch` 按 key 合并。
- `content` 写入同时更新 `contentMeta`；attrs 写入由服务端填 `source` / `provenance`（Agent 调用即 `by=agent`，只有 system 能创建锁定字段）。
- `content` = 长正文，与 `contentMeta`（来源）同表存储；正文支持平台**内联引用**（`<media assetid>` 等，见 [富文本上下文输入协议](./2026-09-14-rich-context-composer-protocol.md)）。
- 写入发 `asset.updated` SSE（既有通道），供工作台/画布/编辑器实时刷新。

### 3.2 系统数据写入（既有 owner op）

- `metadata.reference`：由 `recut.media.reference.attach` 写入（幂等，见 §4.2）。
- `metadata.proposal`：既有 `propose / update_proposal / confirm` 不变。
- 通用规则：这些键只由拥有 op 写，用户不可任意编辑；不新增命名空间。

### 3.3 参考素材：**真实内容优先的新接口**

现有 `create_reference` 面向公开链接，不抓取内容。真实内容参考走**不同接口**：

```jsonc
// 新：真实内容参考（本地/已上传素材）
recut.media.reference.create({
  assetId,        // 已上传/导入的视频/图片/音频素材（必填）
  sourceUrl?,     // 原始公开链接，仅作溯源保存，不抓取
  name?           // 展示名（缺省沿用素材名）
})
→ { referenceAssetId, kind: "video" }
```

- 它**不新建字节**：把既有素材标记为参考（写 `metadata.reference.provenance = { sourceUrl?, createdAt }`），素材 `kind` 仍是 `video`/`image`/`audio`。
- URL 只作溯源，**不做去重身份**（去重仍按素材 `contentHash`）。
- 与既有 `create_reference` 的分界：

| 接口 | 输入 | 用途 | 字节 |
|---|---|---|---|
| `recut.media.create_reference`（既有） | 公开链接 | 文章/网页/平台链接的 research 引用 | 无（不抓取） |
| `recut.media.reference.create`（新） | 真实素材 `assetId`（+ 可选 url） | 复刻/仿拍的参考视频 | 已有素材字节 |

- **命名未决**：新接口也可叫 `reference.mark` / `reference.register`；若采用，`create_reference` 保持不动。

### 3.4 理解证据写 `metadata.reference`

```jsonc
recut.media.reference.attach({
  referenceAssetId,
  evidence: { kind: "probe"|"transcript"|"frames"|"boundaries"|"clip"|"sheet", ... }
})
```

- 幂等：按 `(referenceAssetId, evidenceKind, assetId/params)` 去重，重复理解复用派生资产。
- 只写观察，不写解释（解释留目标项目，见 §4.3）。

### 3.5 统一预览编辑面

- **唯一预览框**：`web/components/asset-preview-dialog.tsx` 的 `AssetPreviewDialog`。素材库、World 画布媒体面板、实体属性字段、工具结果、AI 消息已复用它；`timeline-editor` 素材面板点击/双击媒体素材打开同一框。
- 预览内容 = 字节预览（图/视频/音频/转写）+ **可编辑的 `attributes` 与 `content`** + 系统数据（只读）。
- 属性按类型渲染输入（text/textarea/number/boolean/select/url），支持增删；每条属性带来源标签（AI / 系统 / 手动）与 provenance；`locked` 项结构只读。
- 保存经 `PATCH /v1/media/assets/{id}`（`{content, attributes}`），失败 fail closed；随 `asset.updated` SSE 回推刷新。
- **组件（code backing）**：复用同一预览壳，内嵌既有 `ComponentPreview`，并展示组件素材的 `content`/`attributes`。
- 意义：预览框成为「素材即对象」的统一门面——打开即看到并编辑这条素材的全部创作信息，编辑器不需要另建详情面板。

## 4. AI 理解与溯源（本 RFC 服务的两类场景）

### 4.1 生成字段可溯源

AI 生成素材时，配方已在 `metadata`（`prompt/modelId/provider/output/referenceIds`，见 09-16）。本 RFC 再加一层「**字段级溯源**」：

- AI 写入的每条 attr 都带 `provenance`（`by=agent` + `op/jobId/modelId/assetIds/at`），可一路回溯到具体生成任务与参考素材；
- `content` 带 `contentMeta`，说明理解来自哪次理解/哪些证据；
- 素材级血缘（`parentId` / `referenceIds`）与字段级溯源互补，回答「这个字段/这条素材是谁、因何、依据什么产生的」。

### 4.2 参考视频的 AI 内容表达

导入的真实参考视频，经理解后同时获得**结构化**与**非结构化**表达：

1. 用户丢入真实视频 → 平台导入为 `video` 素材（既有上传/`import_url`）。
2. `recut.media.reference.create({ assetId, sourceUrl? })` → 标记为参考。
3. `recut.media.probe / frames / contactSheet / boundaries / clip` → 产出派生资产。
4. `recut.media.reference.attach` → 写入 `metadata.reference`（**观察层**：时长/转写/边界/关键帧/接触表指针）。
5. Agent 写素材自身的理解：
   - `content`（**非结构化**）：整体描述——「一支 30s 产品广告，榜单逐项揭示 + 卡词，快节奏，实拍静物」；
   - `attributes`（**结构化**）：`subject / setting / shotKind / language / duration / style…`，各带 `provenance`。
6. 同一参考被第二个目标复用：直接读 `content`/`attributes`/`metadata.reference`，不重复理解；解释（keep/replace）各目标写在自己项目里。

### 4.3 三层分离（与 reference-understanding 的红线对齐）

| 层 | 归属 | 内容 | 例子 |
|---|---|---|---|
| **素材自述**（可复用、可溯源） | 全局素材 `content` + `attributes` | 描述性理解 | 「这是一支榜单式产品广告」、`shotKind=静物` |
| **机器证据**（客观，owner op 写） | 全局素材 `metadata.reference` 等既有键 | 观察与指针 | 时长/转写/边界/关键帧/接触表 |
| **目标解释**（目标相关、不可复用） | 目标项目文件 | 迁移判断 | `analysis.md`（keep/replace）、`timeline.md` |

- reference-understanding 的「证据只装观察」红线**不变**；素材级的描述性理解不写 `metadata.reference`，而写 `content`/`attributes`，因此既能被下游复用，又不会伪装成客观机器证据。
- 「这支参考对我这个目标意味着什么」（keep/replace/hook）始终不挂全局素材，避免污染别的项目。

## 5. 与 World Entity attrs 的对齐与差异

| Entity（worlds） | 素材（本 RFC） | 说明 |
|---|---|---|
| `name` | `name` | 同名概念 |
| `intro` / `detail` | —（`intro` 不引入）/ `content` | `content` ⇔ `detail`；摘要由 `content` 首段或 `text` attr 表达 |
| `attrs: Attr[]`（有序 typed） | `attributes: Attr[]` | **同一形状**，复用渲染/编辑/序列化思路；素材额外带 `provenance` |
| `type_id` + `entityTypes.fields`（类型目录 schema） | **不引入类型目录** | 素材是「字节/源码 + 生命周期 + 系统键 + 自由 content/attrs」；系统数据用既有 `metadata` 键，不新增命名空间 |
| preset `locked` 字段 | `locked` / `source` / `provenance` | 同锁定语义，并把「谁写的、依据什么」显式化 |
| `parent_id` / 容器 | 不引入 | 素材无递归容器需求 |

设计取舍：**不照搬 entity 的类型目录**。Entity 需要类型目录因为它是领域对象（人物/场景/…各有字段）；素材只加 **content/attributes** 两个创作字段，系统数据沿用既有 `metadata` 键，因此不为素材再造一套 schema 管理系统。

## 6. 消费方

- **`timeline-editor` 素材面板**：全局素材库的项目视图；双击打开统一预览框；落轨只持引用（见 §2.1）。
- **Motion Graphic / 组件**：`code` backing 的全局素材，跨 `timeline-editor`、World 画布、remix、AI 短片复用。
- **参考理解**：`content` + `attributes`（理解）+ `metadata.reference`（证据）。
- **Clone 计划**：计划态素材用 `attributes`（role/shotKind/transferable…）+ `content`（提示词/文稿）+ `metadata.proposal`（配方），clip 只引用素材。
- **World / 画布 / 封面**：经 `media` / `ref` 类型 attr 互相引用，不复制二进制。
- **搜索/筛选（可选，后续）**：`list_assets` 可按 attr key/value 过滤（对齐 `entities.list` 的 text/type 过滤）。首版不做。

## 7. 迁移与兼容

1. **`metadata.proposal` 不破坏**：既有键原样保留，`propose/update_proposal/confirm` 不变。
2. **现有 `kind=reference` 素材**（链接引用）不受影响；`reference.create` 只作用于真实素材。
3. **旧 `metadata` 散字段**（转写/平台元数据）保留原样；新能力不强制回填；收口目标：`metadata` 只允许 `content/contentMeta/attributes` + 既有系统键。
4. **`editor_assets` 退化**：不再扩展为素材元素表；保留为项目引用索引（`asset_id/type/ref_id/version/status`），attrs/content/recipe/state 全部回全局 Material。已按 editor-clone 草案落地的部分需迁回（若尚未落地则直接按本 RFC）。**MG/组件的私有 SQLite → 全局素材迁移见 §8。**
5. **取代 editor-clone §4**：`AssetElement` 的 `attrs/content/recipe` 契约并入本 RFC 的 Material 层；`planned` 计划态由 `metadata.proposal` + 项目计划文件表达，不落 `editor_assets`。
6. **回滚**：`content`/`attributes` 是新增键，移除读写 op 即可退回现状。

## 8. 组件（MG）素材全局化：从 editor 私有 SQLite 到全局素材

MG / 组件今天由 `apps/editor` 的私有 SQLite 维护，且**按项目归属**（`project_id not null`）：换项目即消失，也无法被 editor 之外的场景复用。本 RFC 把它迁为**全局素材（`code` backing）**，与字节素材同属性层、同预览面、同复用纪律。

### 8.1 现状（源）

| 位置 | 表 / 字段 | 说明 |
|---|---|---|
| editor 应用 SQLite（每项目） | `editor_components(component_id PK, project_id, name, surface, keywords_json, head_version_id, archived_at, mode, created_at, updated_at)` | 组件元数据；`project_id` 是归属，`mode`（local/fullscreen）是布局提示 |
| 同上 | `editor_component_versions(version_id PK, component_id, version, source, bundle, bundle_hash, inputs_json, status, test_report_json, cover_path, created_at, verified_at)` | 版本与源码/构建产物 |
| 同上 | `editor_assets(asset_id PK, project_id, type='component', ref_id=componentId, ref_version_id, status)` | 项目→组件的引用索引（已有回填 `editorBackfillComponentAssets`） |

### 8.2 目标（全局 Material）

```
全局 code material（平台，非某项目私有）
  component_materials(material_id PK, name, surface, keywords_json, head_version_id,
                      origin_app_id, origin_project_id?, archived_at, created_at, updated_at)
  component_material_versions(version_id PK, material_id, version, source, bundle, bundle_hash,
                      inputs_json, status, test_report_json, cover_ref, created_at, verified_at)
  material metadata: content / attributes            // 与字节素材同一创作层
```

- **ID 稳定**：`component_id` → `material_id`、`version_id` 原样保留。时间线元素 `componentId/versionId` 与 `editor_assets.ref_id/ref_version_id` **无需重指**（迁移不改引用）。
- **所有权去项目化**：删 `project_id not null`，降级为 `origin_project_id`（仅溯源，不参与权限/生命周期/可见性）；`origin_app_id = recut.editor`。
- **引用索引保留**：`editor_assets`（或改名 `project_materials`）继续记录「这个项目引了哪些组件」，角色从「资产真相」退为「引用连接」，与字节素材经 `media_asset_projects` attach 完全对等。
- **存储分 backing**：媒体字节仍在 `media_assets`，组件源码/构建在 `component_materials`，不塞进同一张字节表（沿用迁移 RFC §2 纪律）；对上层暴露统一的 Material 读视图（§3.1）。
- **构建/渲染归平台**：组件构建与渲染由平台 Render Host 承担（迁移 RFC M2/M3），不再依赖 editor 的 `component-build.js` 与 UI bundle。

### 8.3 迁移动作

1. **建全局表**：`component_materials` / `component_material_versions` + `project_materials` 引用表。
2. **逐项目搬运**：读每个项目 editor SQLite 的组件行与版本行，写入全局表（`component_id`/`version_id` 原样）；（项目 → 组件）引用写入 `project_materials`。
3. **封面归位**：`cover_path` 迁到平台存储并登记为一条 `media` attr 或素材引用，供统一预览使用。
4. **属性回填（可选）**：把原 `name/surface/keywords/mode` 投影为 `attributes`（如 `surface`、`mode`、`keywords`），`source=system`；`content` 暂空，由后续理解/编辑补充。
5. **写侧切换**：`component.create/revise/update/archive/list/source` 改为读写全局表（op 名与 payload 冻结不变）；`component.list` 默认返回**当前项目引用**的组件，另提供全局浏览。
6. **冻结旧表**：搬运完成后 editor 私有组件表置为只读，P3 归档（"保留只读归档 1 个版本周期"，与迁移 RFC 一致）。
7. **不可逆点后置**：先「双写/读双份比对」再切写权威，回退可切回 editor 私有表（沿用迁移 RFC 的 goja 兜底与 golden 套件）。

### 8.4 迁移不变式

- 迁移**不改任何时间线引用**：`componentId`/`versionId` 稳定是硬约束。
- **不新增按项目的组件副本**：同一组件只存一份全局行，项目经引用表连接。
- **不合并同源组件**：`component_id` 是随机稳定 id，跨项目不会真重复；不做自动合并以免引用分叉（同 `bundleHash` 仅可作展示去重，不改变 identity）。
- 组件从「项目内」变「全局可见」，其 `content/attributes` 与字节素材一样跨项目可读；项目私有的计划态/解释仍留项目（§4.3 三层分离）。

## 9. 里程碑与验收

| 里程碑 | 交付 | 验收 |
|---|---|---|
| **M0 素材属性模型** | `content` + `attributes`（两个创作字段）；`asset.get` / `asset.update`（attrs / content / attrPatch，locked 校验，provenance 填充） | 给素材加/改/删/排序 attrs、写 content 往返一致；AI 写入自动带 `source=agent` + `provenance`；locked 越权被拒；`asset.updated` 广播；不破坏 `proposal` **（已实施）** |
| **M1 真实内容参考** | `reference.create`（assetId + 可选 url） | 真实视频标记为参考（`kind` 仍为 video）；`sourceUrl` 可溯源；与 `create_reference` 分界清晰；不做 URL 去重 |
| **M2 参考证据** | `reference.attach` + `metadata.reference` | 理解证据幂等写入；同一参考被第二个目标复用不重复理解；证据只装观察 |
| **M3 统一预览编辑面** | `AssetPreviewDialog` 展示并编辑 content/attributes；`timeline-editor` 素材面板接入 | 打开素材即可编辑属性/正文并保存；来源与 provenance 可见；编辑器与素材库同一框 **（已实施）** |
| **M4 MG 全局化迁移** | 全局 `component_materials` 表 + 逐项目搬运 + `component.*` 写侧切全局；旧表冻结 | `componentId`/`versionId` 不变、时间线引用零重指；换项目后可见/复用同一 MG；`component.list` = 项目引用视图；回退可切回私有表 |
| **M5 消费对接** | editor / clone / World / MG 跨场景 | editor 素材 == 全局素材（无私有属性层）；clone 计划用 content/attrs；MG 在 editor 外场景可复用；回归无差异 |

依赖：M0 是 M1/M2/M3 的前置；M1/M2 可与 [reference-understanding](./2026-09-17-reference-understanding.md) 的 M0–M2 并行；M4 依赖迁移 RFC 的 store 落点与 Render Host；M5 依赖 clone skill 与 M4。

## 10. 受影响契约

- **素材元数据**：新增 `metadata.content` / `metadata.contentMeta` / `metadata.attributes`（Attr[]，带 provenance）；系统数据沿用既有 `metadata.proposal` / `metadata.reference`；覆盖 `code` backing 的组件素材。
- **全局组件素材**：新增全局表 `component_materials` / `component_material_versions` 与项目引用表（替代 editor 私有 `editor_components` / `editor_component_versions` 的权威地位）；`component.*` op 名与 payload 不变，写侧改全局。
- **MCP / agent**：新增 `recut.media.asset.get` / `recut.media.asset.update` / `recut.media.reference.create` / `recut.media.reference.attach`；`list_assets` 输出可含属性摘要（向后兼容）；组件素材的 attrs/content 读写随迁移 RFC 的 MaterialService 并入。
- **Web / editor**：`AssetPreviewDialog` 成为唯一素材预览编辑框（属性/正文可编辑）；`timeline-editor` 素材面板接入；`editor_assets` 退回引用索引并在 M4 迁为 `project_materials`。
- **SSE**：沿用 `asset.updated`（组件变更并入素材变更事件）。
- **不改**：`media_assets` 列与生命周期、生成门禁、`create_reference` 与 parts 机制、时间线 op 与读模型。

## 11. 风险与未决问题

1. **占位入口缺失（content-first 的前置）**：`recut.media.propose` 要求 `capability`+`text`，无法「只建空素材 + 写说明」。需补 `recut.media.asset.create`（draft/proposed 占位）或放开 `propose` 的 capability 必填；在此之前 content-first 只能用「propose 一个最可能能力 + `asset.update` 写 content」近似。

2. **参考接口命名**：`reference.create` vs `reference.mark` vs 扩展 `create_reference`（加 `assetId` 分支）。**未决**，倾向独立 op 以免混淆语义。
3. **`metadata` 口袋继续膨胀**：新旧字段并存可能长期脏。缓解：系统键有 owner；设「`metadata` 只允许 content/contentMeta/attributes + 既有系统键」的收口目标。
4. **全局可变性**：content/attrs 在全局素材上，会被其他项目读到。缓解：只放可复用的描述性信息与证据，目标私有语义留项目；attrs 带 `source` 供读取侧过滤。
5. **素材级理解 vs 目标解释的边界**：容易把 keep/replace 这类主观判断写进全局 content。缓解：§4.3 三层分离作为硬纪律，skill 与契约都明确声明。
6. **`ref` 类型的解析与权限**：引用 World 实体/项目时的可见性校验。**未决**：跨作用域引用是否 fail closed。
7. **搜索/索引**：按 attr 过滤需要索引，首版不做；需评估素材库规模。
8. **MG 迁移的数据一致**：组件从项目内变全局，存在「原项目间同名/同源组件」「引用索引与组件行不一致」两类脏数据。缓解：ID 稳定不合并、迁移按引用表回填、双写比对后再切写权威（§8.3/§8.4）。**未决**：组件是否需要 `origin_project_id` 之外的可见性/权限模型。
9. **组件属性回填的边界**：`keywords/mode` 是系统语义，回填为 `attributes` 时须标 `source=system` 并避免与用户可编辑字段混淆。**未决**：哪些字段进 attrs、哪些直接保留为 Material 一级字段。
9. **code backing 的落地时序**：M0–M3 可在 bytes backing 上先落；M4 依赖迁移 RFC 的 store/Render Host，若迁移滞后则 MG 的属性/预览只读投影，不阻塞字节素材。

## 12. 排期

四步路线的第三步：

1. [Editor 迁移](./2026-09-17-editor-native-migration.md)
2. [参考视频理解](./2026-09-17-reference-understanding.md)（与 M0/M1 并行）
3. **本 RFC（素材属性协议层）**
4. [参考理解与克隆执行](./2026-09-17-reference-understanding.md)
