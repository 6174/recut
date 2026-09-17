<!--
 * [INPUT]: 依赖 service/media（media_assets 的 kind/origin/metadata、RenameAsset、CreateReferenceAsset、SSE asset.updated、/v1/media/*）、
 *   rfc/2026-09-09-unified-entity-model（World Entity 的有序 typed attrs 范式与锁定语义）、rfc/2026-09-16-media-generation-proposal（metadata.proposal 系统配方）、
 *   rfc/2026-09-17-reference-understanding（reference facet 与真实内容参考）、rfc/2026-09-17-editor-native-migration（Material{bytes|code}）、
 *   rfc/2026-09-17-clone-skill（计划态素材元素消费 attrs）
 * [OUTPUT]: 定义「全局素材属性能力」：在素材（Material）上提供对齐 World Entity 的**有序 typed attrs**（用户/Agent 可扩展）
 *   与**系统 facet 组**（结构化、locked，proposal 归位、reference 为首个用例）；给出读写 op、真实内容参考素材的新接口
 *   （区别于 create_reference 的公开链接引用）、与 Entity 的对齐/差异、迁移兼容、里程碑与验收
 * [POS]: rfc 的「素材属性协议层」决策；四步路线第三步，前承 video understanding，后接 clone skill
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# 全局素材属性能力：统一 attrs + 系统 facet（含真实内容参考素材）

- 状态：提案（待评审）
- 日期：2026-09-17
- 关联：[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)、
  [参考视频理解](./2026-09-17-reference-understanding.md)、[Editor 迁移](./2026-09-17-editor-native-migration.md)、[Clone Skill](./2026-09-17-clone-skill.md)
- 非目标：不新增字节目录；不重写 `media_assets` 生命周期与生成门禁；不做素材「类型目录 + 字段 schema」系统（见 §6）；不改 World Entity 的 attrs。

## 0. 摘要

素材现在只有 `name / kind / status / metadata`，承载不了「这条素材是什么、从哪来、该配什么」这类信息。World Entity 已经有成熟范式——**有序 typed `attrs`**——但素材没有。本 RFC 把同一套通用属性能力给到**全局素材（Material）**，并区分两类信息：

1. **attrs**（有序 typed key-value，用户/Agent 可扩展、可排序）——像 Entity 的属性列表；
2. **facet**（系统管理的结构化组，locked、由专属 op 写入）——承载 `reference`、`proposal` 这类**机器契约**，字段随 `schemaVersion` 演进。

同时解决一个具体缺口：**参考素材应该是「真实视频内容」而不是公开链接**。现有 `recut.media.create_reference` 是「公开链接 → research 引用」，服务不抓取内容；我们需要一个**不同接口**：把已上传/导入的真实视频（可选保存 `sourceUrl`）标记为参考，理解证据写进它的 `reference` facet。

## 1. 问题

- 素材只有展示字段：`name` 可改（`RenameAsset`），`kind` 是字节类型，`metadata` 被各功能当作私有口袋（`proposal`、转写、平台元数据混放），没有通用的「属性」层。
- 下游想给素材附加信息（角色、来源、可迁移判断、配方、引用）只能往 `metadata` 里随便塞，无顺序、无类型、无键稳定、无审计。
- World Entity 已证明「有序 typed attrs + preset locked 字段」可用且好维护；素材应复用同一套，而不是发明第二套。
- 参考场景错位：`create_reference` 面向**链接/文章**（`kind=reference`、`origin=research`、URL 去重、不下载内容）；而 clone/复刻要的是**真实素材内容**（用户上传或导入的视频），原始 URL 只作溯源。

## 2. 模型

### 2.1 载体

素材即迁移 RFC 的 **Material**（当前是 `media_assets`，将来含 `code` backing 的组件）。属性挂在素材上，跨项目、跨 App 复用。

两类属性分区存放，避免互相污染：

```jsonc
media_assets.metadata {
  "attributes": [ Attr, ... ],          // 用户/Agent 可扩展，有序
  "facets": {                            // 系统管理，locked，结构化
    "proposal":  { ... },                // 既有 metadata.proposal 归位
    "reference": { ... }                 // 本 RFC 首个新 facet
  },
  "proposal": { ... }                    // 兼容期保留（读取时与 facets.proposal 合并）
}
```

### 2.2 Attr（对齐 World Entity）

```
Attr {
  key: string,          // 稳定 id
  label: string,        // 用户可见名
  type: "text" | "textarea" | "number" | "boolean" | "select" | "media" | "ref" | "url",
  value: any,           // 与 type 匹配
  options?: string[],   // select
  locked?: boolean,     // 系统/模板字段，结构不可改
  source?: "system" | "agent" | "user"  // 审计；缺省 user
}
```

- **有序且持久化**：数组顺序即展示顺序，可拖动排序（与 Entity 一致）。
- `media` 值：`{ assetId, kind?, name?, segment? }`——引用素材库条目，可带 `segment` 表示「只用其中一段」（沿用 Entity media attr 的 segment 语义）。
- `ref` 值：`{ kind: "entity" | "project" | "world", id }`——跨对象引用（World 实体、项目、世界）。
- `url` 值：字符串 URL，用于溯源（如参考的原始链接）。

### 2.3 Facet（系统结构化组）

```
Facet {
  schemaVersion: number,
  value: object,                 // 该 facet 的字段结构由拥有它的 RFC 定义
  writtenBy: string,             // 写入 op / owner
  updatedAt: string
}
```

- **只由拥有 op 写入**，用户不可任意编辑；可读、可审阅。
- `facets.proposal` = 既有 `metadata.proposal`（09-16）**归位**：读取时二者合并，写入仍走既有 `propose/update_proposal`，字段不变。
- `facets.reference` = 参考理解证据（见 §4），字段由 [reference-understanding](./2026-09-17-reference-understanding.md) §3.2 定义。
- facet 用 `schemaVersion` 演进，不做无版本散装 JSON。

### 2.4 与既有字段的关系

| 字段 | 职责 | 是否可改 |
|---|---|---|
| `name` | 展示名 | 可改（RenameAsset / asset.update） |
| `kind` | 字节类型（image/video/audio/reference/transcript/component…） | 不可改（字节真相） |
| `status` / `origin` / `contentHash` | 生命周期与溯源 | 不可改 |
| `attributes` | 通用属性 | 用户/Agent 可改（locked 字段除外） |
| `facets` | 系统契约 | 只由拥有 op 写 |

## 3. 接口

### 3.1 通用读写

| op | 语义 |
|---|---|
| `recut.media.asset.get` | 读单个素材完整视图（含 `attributes` 与 `facets`）；`list_assets(ids)` 保持轻量（可只回属性摘要） |
| `recut.media.asset.update` | 改 `name`、`attributes`（整体替换）或 `attrPatch`（按 key 合并，避免回读全量）；`locked` 结构项不可改，越权 fail closed |

- 语义对齐 `recut.worlds.entity.update`：`attrs` 整体替换 vs `attrPatch` 按 key 合并。
- 写入发 `asset.updated` SSE（既有通道），供工作台/画布/编辑器实时刷新。

### 3.2 facet 写入（系统 op）

- `facets.reference`：由 `recut.media.reference.attach` 写入（幂等，见 §4.2）。
- `facets.proposal`：既有 `propose / update_proposal / confirm` 不变。
- 通用规则：facet 写入 op 必须校验 facet 归属与 `schemaVersion`，不允许其它 op 直写。

### 3.3 参考素材：**真实内容优先的新接口**

现有 `create_reference` 面向公开链接，不抓取内容。真实内容参考走**不同接口**：

```jsonc
// 新：真实内容参考（本地/已上传素材）
recut.media.reference.create({
  assetId,        // 已上传/导入的视频/图片/音频素材（必填）
  sourceUrl?,     // 原始公开链接，仅作溯源保存，不抓取
  name?           // 展示名（缺省沿用素材名）
})
→ { referenceAssetId, kind: "video", facet: "reference" }
```

- 它**不新建字节**：把既有素材标记为参考（写 `facets.reference.provenance = { sourceUrl?, createdAt }`），素材 `kind` 仍是 `video`/`image`/`audio`。
- URL 只作溯源，**不做去重身份**（去重仍按素材 `contentHash`）。
- 与既有 `create_reference` 的分界：

| 接口 | 输入 | 用途 | 字节 |
|---|---|---|---|
| `recut.media.create_reference`（既有） | 公开链接 | 文章/网页/平台链接的 research 引用 | 无（不抓取） |
| `recut.media.reference.create`（新） | 真实素材 `assetId`（+ 可选 url） | 复刻/仿拍的参考视频 | 已有素材字节 |

- **命名未决**：新接口也可叫 `reference.mark` / `reference.register`；若采用，`create_reference` 保持不动。

### 3.4 理解证据落 facet

```jsonc
recut.media.reference.attach({
  referenceAssetId,
  evidence: { kind: "probe"|"transcript"|"frames"|"boundaries"|"clip"|"sheet", ... }
})
```

- 幂等：按 `(referenceAssetId, evidenceKind, assetId/params)` 去重，重复理解复用派生资产。
- 只写观察，不写解释（解释留目标项目，见 understanding RFC §3.3）。

## 4. 参考素材案例（与 understanding RFC 合流）

1. 用户丢入真实视频 → 平台导入为 `video` 素材（既有上传/`import_url`）。
2. `recut.media.reference.create({ assetId, sourceUrl? })` → 标记为参考。
3. `recut.media.probe / frames / contactSheet / boundaries / clip` → 产出派生资产。
4. `recut.media.reference.attach` → 写入 `facets.reference`（观察层）。
5. 同一参考被第二个目标复用：直接读 facet，不重复理解；解释（keep/replace）各目标自己写在项目里。

## 5. 与 World Entity attrs 的对齐与差异

| Entity（worlds） | 素材（本 RFC） | 说明 |
|---|---|---|
| `name` | `name` | 同名概念 |
| `intro` / `detail` | —（不引入） | 素材正文由 `content`（后续 clone/attrs 协议）或 facet 承载，避免重复 |
| `attrs: Attr[]`（有序 typed） | `attributes: Attr[]` | **同一形状**，复用渲染/编辑/序列化思路 |
| `type_id` + `entityTypes.fields`（类型目录 schema） | **不引入类型目录** | 素材是「字节 + 生命周期 + 少量系统 facet + 自由 attrs」；facet 承担系统 schema（见 §6） |
| preset `locked` 字段 | `locked` / `source` | 同锁定语义 |
| `parent_id` / 容器 | 不引入 | 素材无递归容器需求 |

设计取舍：**不照搬 entity 的类型目录**。Entity 需要类型目录因为它是领域对象（人物/场景/…各有字段）；素材的系统结构由**facet**表达（有版本、有 owner），自由信息由 **attributes**表达。这样不会为素材再造一套 schema 管理系统。

## 6. 消费方

- **参考理解**：`facets.reference`（本 RFC 提供机制）。
- **Clone 计划**：计划态素材元素用 `attributes`（role/shotKind/transferable…）+ `recipe`（后续 clone/attrs 细节），clip 只引用素材。
- **World / 画布 / 封面**：经 `media` / `ref` 类型 attr 互相引用，不复制二进制。
- **搜索/筛选（可选，后续）**：`list_assets` 可按 attr key/value 过滤（对齐 `entities.list` 的 text/type 过滤）。首版不做。

## 7. 迁移与兼容

1. **`metadata.proposal` 不破坏**：作为 `facets.proposal` 的兼容视图，读取合并、写入仍走既有 op；后续可一次性迁名。
2. **现有 `kind=reference` 素材**（链接引用）不受影响；`reference.create` 只作用于真实素材。
3. **旧 `metadata` 散字段**（转写/平台元数据）保留原样；新能力不强制回填。
4. 回滚：`attributes`/`facets` 是新增命名空间，移除读写 op 即可退回现状。

## 8. 里程碑与验收

| 里程碑 | 交付 | 验收 |
|---|---|---|
| **M0 属性模型** | `attributes` + `facets` 命名空间；`asset.get` / `asset.update`（attrs / attrPatch，locked 校验） | 给素材加/改/删/排序 attrs 往返一致；locked 越权被拒；`asset.updated` 广播；不破坏 `proposal` |
| **M1 真实内容参考** | `reference.create`（assetId + 可选 url） | 真实视频标记为参考（`kind` 仍为 video）；`sourceUrl` 可溯源；与 `create_reference` 分界清晰；不做 URL 去重 |
| **M2 证据 facet** | `reference.attach` + `facets.reference` | 理解证据幂等写入；同一参考被第二个目标复用不重复理解；facet 只装观察 |
| **M3 消费对接** | clone 计划 / World 引用 | clone 计划用 attrs；World/封面经 `media`/`ref` attr 引用素材；回归无差异 |

依赖：M0 是 M1/M2 的前置；M1/M2 可与 [reference-understanding](./2026-09-17-reference-understanding.md) 的 M0–M2 并行；M3 依赖 clone skill。

## 9. 受影响契约

- **素材元数据**：新增 `metadata.attributes`（Attr[]）与 `metadata.facets`（含 `proposal` 兼容视图、`reference`）。
- **MCP / agent**：新增 `recut.media.asset.get` / `recut.media.asset.update` / `recut.media.reference.create` / `recut.media.reference.attach`；`list_assets` 输出可含属性摘要（向后兼容）。
- **SSE**：沿用 `asset.updated`。
- **不改**：`media_assets` 列与生命周期、生成门禁、`create_reference` 与 parts 机制。

## 10. 风险与未决问题

1. **参考接口命名**：`reference.create` vs `reference.mark` vs 扩展 `create_reference`（加 `assetId` 分支）。**未决**，倾向独立 op 以免混淆语义。
2. **`metadata` 口袋继续膨胀**：新旧字段并存可能长期脏。缓解：facet 有 owner 与版本；设一个「metadata 只允许 attributes/facets/proposal 兼容视图」的收口目标。
3. **全局可变性**：attributes 在全局素材上，会被其他项目读到。缓解：attrs 放可复用信息，项目私有语义用 `source` 或索性留项目。
4. **`ref` 类型的解析与权限**：引用 World 实体/项目时的可见性校验。**未决**：跨作用域引用是否 fail closed。
5. **搜索/索引**：按 attr 过滤需要索引，首版不做；需评估素材库规模。
6. **与组件 Material 的统一**：组件平台化后，`attributes`/`facets` 是否原样适用。倾向适用（同一 Material 模型），待迁移 RFC 落地后验证。

## 11. 排期

四步路线的第三步：

1. [Editor 迁移](./2026-09-17-editor-native-migration.md)
2. [参考视频理解](./2026-09-17-reference-understanding.md)（与 M0/M1 并行）
3. **本 RFC（素材属性协议层）**
4. [Clone Skill](./2026-09-17-clone-skill.md)
