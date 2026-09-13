<!--
 * [INPUT]: 依赖 PGC 平台 World RFC（2026-08-28，源格式/manifest/Catalog/origin 三元/只读+Fork）、
 *   递归世界画布 RFC（2026-09-07）、统一 Entity 模型 RFC（2026-09-09，type/name/intro/detail/attrs + media attr + evidence 废弃）、
 *   画布文档存储 RFC（2026-09-09，world_canvases 文档粒度），以及现有实现逐文件核查
 *   （scripts/worlds-publish.mjs、service/worlds_platform.go、service/worlds_canvas.go、service/worlds_canvas_doc.go、
 *   web/app/worlds/[worldID]/canvas/*、web/lib/pomelo/world-canvas/*、web/lib/recut-worlds-client.ts、web/lib/marketing-worlds.ts）
 * [OUTPUT]: 定义 World 源格式 v2（一个对象一个文件：world.json 索引 + entities/<id>.json + assets/<id>.json 素材协议 + canvas.json）
 *   与发布 manifest v2、物化 v2（含 world_canvases 落库）、media 双源 {assetId|url} 与统一 URL 解析适配层、
 *   PGC/UGC 同一源格式的管理模型（全文件导出/导入/发布，导出携带 recipe 血缘）、只读画布预览交互契约与官网直接预览；
 *   含现有 9 个 worlds 与 v1 manifest 的快速迁移（源优先 + 自动画布）
 * [POS]: rfc 的 World 内容格式与管理决策；把「PGC 用一套格式、UGC 用另一套」收敛为「同一源格式，差异只在来源与信任」，
 *   承接 08-28 PGC RFC 的 Catalog/origin/只读边界，落地 09-09 统一 Entity 模型到 PGC 内容链路
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: World 内容格式 v2——统一 Entity + Canvas 的一体化发布与只读预览

- 状态：落地中（P1 物化 v2/媒体单点解析、P2 迁移+发布 v2、P3 export/import（service HTTP + 工作台 UI）已实现；官网 pomelo 只读态待后续）
- 作者：Recut
- 日期：2026-09-13
- 关联：[PGC 平台 World](./2026-08-28-pgc-platform-worlds.md)、[递归世界画布](./2026-09-07-recursive-world-canvas.md)、[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、[画布文档存储](./2026-09-09-world-canvas-document-storage.md)、[vello-native 渲染](./2026-09-13-vello-native-rendering-implementation.md)
- 决策范围：World 源格式与发布 manifest 的统一（Entity/Type/Canvas/Media）、物化映射、媒体 URL 统一解析、PGC 与 UGC 的管理与流转、只读画布预览、迁移

## 摘要

画布模式与统一 Entity 模型上线后，平台世界的内容链路出现了三个断层：

1. **源格式还是老的**。`worlds/<slug>/world.json` 仍是 v1 形态（`kind/title/summary/content` + 独立 `evidence[]`），没有 `entityTypes`、没有 `attrs`、没有 canvas。而存储侧早已是 `type_id/name/intro/detail/attrs_json` + `world_entity_types` + `world_canvases`。
2. **物化是「胶水式」有损映射**。`service/worlds_platform.go` 把 `kind→type_id`、`content.body→detail`、其余 content 键一律降级为 `text` attr（丢失 label/type），把 `evidence[]` 写进**已被统一 Entity 模型判废的 `world_asset_refs`**，并且**完全不写 `world_canvases`**——平台世界的画布永远是空的。
3. **媒体只有 assetId 一条腿**。`web/app/worlds/[worldID]/canvas/canvas-image.ts` 的 `mediaAttrSource` 只认 `assetId`，而 PGC 的图是 CDN URL；URL 预览能力只散落在 legacy `evidenceSource` 与画布元素的 `mediaSource` 里，各写各的。

本 RFC 的立场：

> **PGC 与 UGC 使用同一套源格式与世界模型，差异只在「来源（origin）」和「信任（谁发布、怎么更新）」，不在格式。**
> **画布是世界内容的一等公民：能配置、能发布、能物化、能以只读态完整显示。**
> **媒体只有一种引用（`{assetId|url}` 二选一），只有一处把它解析成可渲染 src。**

具体决策：

- **源格式 v2**：`world.json`（`entityTypes` + 统一 `entities`） + `canvas.json`（各 `contextId` 一层的画布元素）+ `world.md` + `references/` + 资源目录；发布产物为**单文件自包含 manifest v2**（内联 canvas，媒体 URL 已镜像为 CDN 绝对地址）。
- **物化 v2**：manifest v2 直接落统一模型（types/entities/relations/**canvases**），媒体落 media attr（`{url}`）而非 evidence；`world_asset_refs` 在 PGC 链路正式退出。
- **媒体统一解析**：新增 `resolveMediaSrc(apiBase, {assetId|url})` 单点适配——asset 走媒体库 content 流，url 优先直连 CDN、跨域时回退 `/v1/files/remote` 同源代理；画布渲染、详情面板、卡片、公开预览全部走它。
- **管理模型**：in-app World 是**创作面**，源 bundle（v2）是**交换/可移植单位**，CDN manifest + Catalog 是**分发单位**。UGC 导出/导入 = 同一 bundle 的 `worlds.export/import`；PGC 与「分享的 UGC」都走既有 CDN Catalog（`kind=platform|published`），materialize 到本地只读。
- **UGC 导出是「全文件协议」**：不绑定 assetId，导出时把素材**文件**随 bundle 落地（`assets/`），媒体值以相对路径引用；并携带素材的**生成配方（Prompt / 参考资源 / 模型与参数）**。导入即还原文件与配方，无需原素材库。
- **只读预览**：in-app 平台世界详情直接以只读画布呈现（服务端 `checkWritable` 已是硬边界）；官网**直接挂载同一套只读画布渲染**（从 manifest v2 读 canvas + CDN 媒体），不另做一套降级实现。

## 问题（结合现状代码）

| # | 现状 | 代码位置 | 后果 |
| --- | --- | --- | --- |
| 1 | 源格式 v1：实体只有 `kind/title/summary/content`，无 `attrs`/`entityTypes` | `worlds/*/world.json`、`scripts/worlds-publish.mjs:143-152` | 结构化字段（appearance 等）没有类型 schema/label，作者无法表达统一模型 |
| 2 | 物化把 content 其余键降级为 `text` attr，`label=key` | `service/worlds_platform.go:334-366` | 丢失字段语义与 preset locked 字段绑定，UI 与 brief 都退化 |
| 3 | 物化把 evidence 写入 `world_asset_refs` | `service/worlds_platform.go:373-388` | 统一 Entity RFC 已判废 evidence（P3 删表）；brief/readiness/短片链路读 evidence，PGC 与本地模型分叉 |
| 4 | 物化不写 `world_canvases` | `worlds_platform.go`（无该表写入） | 平台世界画布永远为空；`GetCanvasDocument` 惰性建空文档 |
| 5 | 媒体解析只有 assetId | `canvas-image.ts:36-46`（asset）；`canvas-media.ts:16`（assetId\|url，但返回裸 url）；`canvas-image.ts:20`（legacy evidence 走代理） | PGC 的 CDN 图在统一 media attr 下无法显示，只靠 legacy evidence 兜底 |
| 6 | 公开营销预览只读 evidence 图，不读 canvas | `web/lib/marketing-worlds.ts:89-93` | 官网无法展示世界画布；只读画布的 CDN URL 路径无处承载 |
| 7 | 只读交互「半残」：readOnly 禁用大量交互但未定义允许集 | `canvas-pomelo-plugin.ts`、`canvas-context-menu.tsx`、`RENDERING-NOTES.md:119` | 平台世界预览既不能创作，也不确定能不能导航/进入/预览 |

## 核心决策

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 格式统一 | PGC/UGC 共用源格式 v2 与 manifest v2 | 「管理差异」属于来源与信任层，不属于格式层；一套解析/校验/物化/渲染 |
| Entity 承载 | `entityTypes[] + entities[]`（typeId/name/intro/detail/attrs），废弃 `kind/title/summary/content` 与独立 `evidence[]` | 直接对齐统一 Entity 模型；零有损映射 |
| 画布承载 | 源侧 `canvas.json`（多 contextId）；发布侧 `manifest.canvases[]`；存储侧 `world_canvases` | 画布是表达层、不产 revision，但必须随内容分发才能只读显示 |
| 画布引用 | 源/manifest 用**源实体 slug**，物化时命名空间化为存储 ID | 与实体 ID 同一套确定性映射；跨设备一致 |
| 媒体引用 | media attr value = `{assetId?, url?, name?, kind?, segment?}`，二者恰一 | 与 08-28 Evidence 双源同构，但落在统一模型的 media attr 上 |
| 媒体解析 | 单点 `resolveMediaSrc(apiBase, ref)`：asset→媒体库流；应用内 url→同源代理（保纹理可读）；官网 url→直连 | 消灭 `mediaAttrSource/evidenceSource/mediaSource` 三份分叉 |
| 管理模型 | 创作面（in-app local World）→ 交换单位（源 bundle）→ 分发单位（CDN manifest + Catalog） | 回答「UGC 怎么手动维护/导出、PGC/分享怎么在 CDN 管」 |
| 只读契约 | 只读 = 可导航（pan/zoom/选中/进入容器/预览媒体），不可变（禁创建/拖拽/连线/promote/删除/编辑） | 预览要「看得全、走得进」，写边界由服务端 `checkWritable` 硬保证 |
| 公开预览 | manifest v2 → records 适配，in-app 复用 pomelo 只读态；官网用静态画布投影（同一 canvas 数据 + CDN 图，DOM 绝对定位，SEO 友好） | 同一数据；官网不引入 WebGPU 依赖，pomelo 只读态列后续 |

## 1. 统一源格式 v2

**一个对象一个文件**：world 是索引，entity / asset 各自独立成文（同一 `assets/<id>.json` 协议也用于 UGC 导出与 recipe 血缘），canvas 单列。这样大配置轻、diff 细、可复用、可脚本化。

```text
worlds/<slug>/
  world.json        # 世界索引：身份 + entityTypes + relations + provenance（不含 entities）
  entities/         # 一实体一文件：<entityId>.json
    xiaohei.json
    style-dna.json
  assets/           # 一素材一包：<assetId>.json（sidecar）+ <assetId>.<ext>（二进制）
  canvas.json       # 可选：{ docVersion, canvases: [{ contextId, elements }] }
  world.md          # 世界技能（同 v1 约定）
  references/       # 长文（detail/$file）
```

### 1.1 `world.json`（世界索引）

```jsonc
{
  "sourceVersion": 2,
  "version": "0.2.0",
  "world": {
    "id": "pgc.xiaohei",
    "name": "小黑怪诞正文配图",
    "type": "character_ip",
    "description": "…",
    "coverUrl": "assets/cover.png",       // 相对路径 → 构建期镜像并改写
    "identity": { "positioning": "…", "audience": ["…"], "tone": "…" }
  },
  // 可选：世界自定义/覆盖类型。缺省沿用平台 preset（character/location/object/story/style/rule）。
  "entityTypes": [
    {
      "id": "character", "scope": "builtin", "name": "人物", "icon": "user", "color": "#e879f9", "baseKind": "character",
      "fields": [
        { "key": "appearance", "label": "外貌与标志", "type": "textarea", "locked": true },
        { "key": "background", "label": "背景", "type": "media" }
      ]
    },
    { "id": "mecha", "scope": "custom", "name": "机甲", "baseKind": "object", "fields": [{ "key": "energy", "label": "能源类型", "type": "text" }] }
  ],
  // 实体不在 world.json：见 entities/<id>.json（§1.2）
  "relations": [
    { "id": "r-1", "type": "appears_in", "from": "xiaohei", "to": "style-dna", "scope": null }
  ],
  "provenance": { "author": "…", "license": "MIT", "repository": "…", "sourceRevision": "…" }
}
```

规则：

- `relations[].from/to`、`entities/<id>` 文件名、`canvas.contextId/refId` 全部使用**源 slug**；构建与物化各自做同一命名空间化（`<worldId>:<slug>`），保证跨设备一致。
- `entityTypes` 可选；缺省只用平台 preset。自定义类型必须在此声明，实体才能引用。
- `evidence[]` 在 v2 **移除**。旧的世界示例图 = 实体上的 `type=media` attr，落到 `assets/`（§1.3）。
- 预算沿用并扩展：skillMd ≤16KB、实体 detail 合计 ≤16KB、attrs 条目 ≤200/实体、manifest ≤2MB、canvases 元素合计 ≤2000（新）。

### 1.2 实体协议：`entities/<id>.json`

一个实体一个文件，文件名即实体 id（文件内 `id` 必须与之一致）。`entities/` 目录按文件名排序即为稳定顺序，构建期 glob、无中心清单。

`worlds/<slug>/entities/xiaohei.json`：

```jsonc
{
  "id": "xiaohei",                      // 与文件名一致；物化时命名空间化为 pgc.xiaohei:xiaohei
  "typeId": "character",
  "name": "小黑",
  "intro": "黑色实心、白点眼、细腿、空表情的荒诞工作者。",
  "detail": { "$file": "../references/xiaohei-ip.md" },  // $file 仍在世界目录内（禁 .. 逃逸）
  "parentId": null,                     // 可选：递归容器（父实体 id）
  "containerRole": "",
  "isProvisional": false,
  "attrs": [
    { "key": "appearance", "label": "外貌与标志", "type": "textarea", "value": "黑色实心小怪物…" },
    { "key": "background", "label": "背景", "type": "media", "value": { "asset": "cover" } }
  ]
}
```

规则：

- `attrs[].key` 命中类型 schema 的 preset key 时继承其 label/type/locked（值仍作者可填）；未命中即自定义 attr。`type=media` 的 value 见 §1.3。
- `$file` 仅在**世界目录内**解析（`entities/x.json` 里写 `../references/a.md` 合法，不得逃出世界目录）；`detail` 与任意字符串字段均可 `$file`。
- 引用完整性：`parentId`、`relations` 两端、`attrs[].value.asset` 必须命中同 bundle 内的实体/素材 id，构建期硬校验。

### 1.3 素材协议：`assets/<id>.json` + 二进制

素材不写进 `world.json`，而是目录内**一素材一包**：一个二进制文件 + 一个同名 sidecar 描述。`world.json`/`canvas.json` 只引用素材 id，大配置因此保持干净、可 diff、可复用（同一素材被多实体/多画布引用只写一份）。

```text
worlds/<slug>/assets/
  cover.png          # 二进制（[ext] 随 kind：png/jpg/webp/mp4/mp3…）
  cover.json         # 素材协议描述（sidecar，与二进制同名不同扩展）
  style-03.png
  style-03.json
```

`assets/<id>.json`（**素材协议 format**）：

```jsonc
{
  "id": "cover",
  "name": "封面",
  "kind": "image",                    // image | video | audio
  "file": "cover.png",                // 相对本 assets/ 目录；可省略，默认 <id>.<ext>
  "recipe": {                         // 可选：生成配方（UGC 导出必带；PGC 示例图可空）
    "provider": "skymind-token",
    "model": "gpt-image-2",
    "prompt": "白底手绘、怪诞清爽的 16:9 正文配图…",
    "params": { "aspectRatio": "16:9", "count": 1 },
    "references": ["style-dna"]      // 引用的其它素材 id（参考资源）
  },
  "provenance": { "author": "…", "license": "MIT", "source": "…" },
  "createdAt": "2026-09-13T00:00:00Z"
}
```

引用方式（`world.json` 实体 attrs / `canvas.json` 元素 props）：

```jsonc
{ "asset": "cover" }                              // 纯语义引用，元数据看 sidecar
{ "asset": "cover", "segment": { "startSec": 3, "endSec": 8 } }  // 视频/音频片段
{ "url": "https://…/x.png", "kind": "image" }     // 逃生舱：已在 CDN/外部的地址，无 sidecar
```

规则：

- **素材 id 即稳定 slug**，在 bundle 内唯一；引用只写 id，不写路径、不写 assetId。
- 构建期：读 `assets/*.json` → 校验 `kind`/`file` 存在且在世界目录内 → 把二进制镜像到 CDN（内容寻址）→ 在 manifest 中把引用**展开为** `{url, kind, name, recipe?}`（canonical-complete，物化器零网络）。
- 同一 `assets/*.json` 协议是 **UGC 导出/导入的载体**：导出即写出 sidecar + 二进制；导入即按协议还原素材并重建 recipe 血缘。因此 bundle 是**全文件协议**，不依赖原素材库与 assetId。
- `recipe.references` 引用**素材 id**（不是 assetId/url），保证 bundle 自洽、可递归解析；PGC 示例图 sidecar 可只留 `provenance`、`recipe` 为空。
- 旧字段 `evidence[]` 随之退役；迁移脚本把每条 evidence 生成一个 `assets/<id>.json`（id 取原 label/序号，kind=modality，二进制搬到 `assets/`，无 recipe），实体改引素材 id。

### 1.4 `canvas.json`

```jsonc
{
  "docVersion": 1,
  "canvases": [
    {
      "contextId": "",                    // "" = 根画布；非空 = 该实体的内层画布（源 slug）
      "elements": [
        { "id": "shape:xiaohei", "kind": "entity", "refKind": "entity", "refId": "xiaohei",
          "name": "小黑", "props": { "collapsed": false },
          "geometry": { "x": 120, "y": 80, "width": 264, "height": 328, "zIndex": 1 },
          "style": {}, "layer": "0" },
        { "id": "shape:note-1", "kind": "note", "refKind": "", "refId": "",
          "name": "便签", "props": { "text": "这里写世界观备注" },
          "geometry": { "x": 460, "y": 120, "width": 150, "height": 100, "zIndex": 1 },
          "style": { "color": "#fde68a" }, "layer": "0" },
        { "id": "shape:media-1", "kind": "attr", "refKind": "", "refId": "",
          "name": "风格示例", "props": { "media": "image", "asset": "style-03", "label": "风格示例" },
          "geometry": { "x": 120, "y": 480, "width": 260, "height": 150, "zIndex": 1 },
          "style": {}, "layer": "0" }
      ]
    },
    { "contextId": "xiaohei", "elements": [ /* 内层画布 */ ] }
  ]
}
```

规则：

- 元素结构与线上 `WorldCanvasElement` 完全同构，前端类型原样复用。
- **媒体元素/媒体 attr 的 url 允许世界目录内相对路径**，构建期镜像并改写为 CDN 绝对 URL；绝对 URL 仅 HEAD 验证。
- 画布不进入 canonical、不产 revision（表达层）；因此 manifest 中的 canvas 不参与内容哈希的可追溯语义，但仍受 manifest SHA-256 完整性保护。
- 只读世界画布中的媒体元素是「展示素材」，不是语义实体；实体语义仍只在 `world_entities`。

### 1.5 发布 manifest v2

```jsonc
{
  "manifestVersion": 2,
  "world": { "id", "name", "type", "description", "coverUrl", "skillMd", "identity" },
  "entityTypes": [ /* 同源，scope 原样 */ ],
  "entities": [ { "id", "typeId", "name", "intro", "detail", "parentId", "containerRole", "isProvisional", "attrs": [ /* media value 已为 CDN 绝对 url */ ] } ],
  "relations": [ { "id", "type", "from", "to", "scope" } ],
  "canvases": [ { "contextId", "elements": [ /* refId/contextId 仍为源 slug；媒体 url 已为 CDN 绝对 */ ] } ],
  "provenance": { "author", "license", "repository", "sourceRevision", "publishedAt" }
}
```

canonical-complete：构建期把拆分文件（`entities/*.json`、`assets/*.json`、`canvas.json`）合并为本单文件；源侧素材引用 `{asset:<id>}` 展开为 `{url,kind,name,recipe?}`。物化器零网络访问，只读这一个文件。

## 2. 物化 v2（service）

在 08-28 的 `materialize/archive` 原语上扩展 `WorldManifest` 与 `MaterializeWorld`：

1. **解析**：`manifestVersion==2` 走 v2 分支；`manifestVersion==1` 保留一个版本的**只读兼容 shim**（见 §6）。
2. **entityTypes**：先 `ensurePresetEntityTypesInTx`（保证 preset 存在），再按 manifest 逐条 upsert 到 `world_entity_types`；`scope` 原样（preset id 落 `builtin`，其余 `custom`），写 `fields_json`。
3. **entities**：直接插入 `type_id/name/intro/detail/attrs_json`（`kind` 列冗余填 `type_id` 以兼容旧读路径），ID 命名空间化。
4. **relations**：插入 `from/to/scope`，ID 与两端命名空间化。
5. **canvases（新增）**：对每个 `canvases[]`，`encodeCanvasDocPayload(elements)` 后 upsert `world_canvases`（`context_id` 非空时命名空间化；元素 `refId` 同步命名空间化；`version=1`）。同事务整包替换，与 entities 一致。
6. **evidence**：v2 无该字段；`world_asset_refs` 不再由 PGC 链路写入。已存在的 legacy 行在物化时随整事务清理。

物化仍是**幂等**的（hash 门 + 确定性 ID）。平台更新 = 恰好一个新 revision；画布不参与 canonical，所以「只改布局」不产 revision，符合表达层语义。

> 影响面（承接统一 Entity RFC 的 P3）：`brief`/`resolve`/`readiness`/`marketing` 目前读 `references`（evidence）取媒体，必须同步切到实体的 media attrs；`brief.Evidence` 改为从 attrs 投影，或保留 `facts` 内联 attrs。本 RFC 要求 P1 一并完成，否则 PGC 生成链路会静默拿不到参考图。

## 3. 媒体双源与统一解析

### 3.1 类型

```ts
// 存储/client 侧媒体值。注意 bootstrapping：源侧不出现 assetId，只有素材 id 引用（§1.3）。
type EntityAttrMediaValue = {
  assetId?: string;      // 平台素材库引用（本地世界/上传）
  url?: string;          // 远程资源（PGC CDN / 外部 URL）
  name?: string;
  kind?: string;         // image | video | audio
  segment?: { startSec: number; endSec: number };
  recipe?: {             // 生成配方（UGC 导出时随 sidecar 还原；PGC url 素材内联保留）
    provider?: string; model?: string; prompt?: string;
    params?: Record<string, unknown>;
    references?: EntityAttrMediaValue[];   // 参考素材（展开后）
  };
};
```

约束：`assetId` 与 `url` **恰好一个**非空；媒体 attr 的 `type==="media"`。`attrMediaValueOf` 同步接受 url 与 recipe。源侧引用 `{asset}` 在构建期展开为 `{url,kind,name,recipe?}` 写进 manifest，物化后即存储值。

### 3.2 单点适配（`web/lib/world-media.ts`，新）

```ts
export function resolveMediaSrc(apiBase: string | undefined, ref: EntityAttrMediaValue): string {
  if (ref.url) {
    if (!apiBase) return ref.url;                         // 官网静态：直连（<img>/DOM 投影，无需 CORS）
    if (isSameOrigin(ref.url)) return ref.url;
    return `${apiBase}/v1/files/remote?url=${encodeURIComponent(ref.url)}`;  // 应用内：同源代理保纹理可读
  }
  return ref.assetId && apiBase ? `${apiBase}/v1/media/assets/${encodeURIComponent(ref.assetId)}/content` : "";
}
```

规则：

- asset → 媒体库 content 流（依赖 service）。
- url + 应用内 service → `/v1/files/remote`（`service/media_server.go:486` 同源代理 + 内容寻址缓存）。**所有远程 url（含 cdn.recut.video）都走代理**：canvas 纹理对 CORS 敏感，代理是唯一稳定路径，且 RemoteFileCache 按 URL 缓存、重复加载零回源。
- url + 无 service（官网静态）→ 直连，用于 DOM `<img>` 投影，不喂给 WebGPU 纹理。

### 3.3 消费方收敛

- `canvas-image.ts`：`mediaAttrSource/entityMediaUrls/entityCoverMedia` 改调 `resolveMediaSrc`；`evidenceSource` 标记 legacy，随 evidence 删除退场。
- `canvas-media.ts`：`mediaSource(apiBase, props)` 改调 `resolveMediaSrc`（元素 props `{assetId?|url?}`）。
- `entity-attrs.ts`：`attrMediaValueOf` 接受 url；`entityMediaAttrs` 不变。
- `marketing-worlds.ts`：改读 manifest v2 的 `entities[].attrs`（media value 用 CDN url）+ `canvases`；`resolveMediaSrc(undefined, ref)` 取直连 url。
- pomelo block / vello adapter：**不改**。`coverImageOpsV` 入参仍是「一个已解析好的 URL」；适配在数据→render 边界完成，不在每个 block 里。

## 4. 管理模型：PGC 与 UGC

三层，同一格式：

```text
创作面（in-app）           交换单位（源 bundle）              分发单位（CDN）
World(local)          ⇄    world.json + canvas.json      →    manifest v2 + Catalog
画布/设定/技能/媒体          + world.md + references/assets      kind=platform 自动同步
origin=local                （可提交进 git / 可压缩分享）         kind=published 手动安装(P4)
```

- **UGC 手动维护 → 导出（全文件协议）**：`recut.worlds.export { worldId }` 从本地 World 生成源 bundle v2：`world.json + entities/*.json + canvas.json + assets/*.{json,ext} + world.md`。
  - 每个被引用的**本地素材**：下载二进制到 `assets/<id>.<ext>`，并写 sidecar `assets/<id>.json`，携带 `name/kind` 与 **recipe（provider / model / prompt / params / references）**；`references` 递归导出其引用的素材，形成自洽血缘。
  - **url 素材**：原样导出 `url`（sidecar 可留 recipe）。
  - 导出结果不出现 `assetId`——bundle 可离线、可 git、可压缩分享。
  - `recut.worlds.import { bundle, name? }` 反向：文件注册为本地素材、attrs 重写为 `assetId`、recipe 写回素材 metadata，创建 `origin=local` 新世界（实体/关系/画布 ID 全量重映射）。
- **PGC / 分享的 UGC 仍在 CDN 管**：源 bundle → `scripts/worlds-publish.mjs`（校验/镜像/确定性序列化）→ `cdn/buckets/worlds/<id>/<version>/world.json` + `catalog.json`；`kind=platform` 自动同步，`kind=published` 安装/更新（P4）。materialize 落到本地只读（`checkWritable` 硬边界），用户要改则 Fork。
- **一键发布（P4）**：`recut.worlds.publish { worldId }` = export → 上传素材到 CDN → 写 manifest + catalog `pub.*` 条目。v1 只冻结契约（`pub.` 前缀、素材上传落点、manifest v2 复用、uninstall=archive），实现列 P4。

## 5. 只读预览

### 5.1 应用内（平台/发布世界详情）

- 数据：materialize v2 后 `world_canvases` 有内容，`GetCanvasDocument` 返回真实布局；媒体 attr 为 CDN url。
- 渲染：`CanvasPomeloHost` 以 `readOnly` 挂载，`resolveMediaSrc` 提供纹理 URL；vello adapter 的 CORS 回退链不变。
- 交互契约（补齐现状）：

| 允许（预览） | 禁止（写边界，服务端 + UI 双保险） |
| --- | --- |
| pan/zoom/reset、选中元素、双击进入内层画布、面包屑返回 | 「+」手柄、创建菜单、独立元素插入 |
| 双击媒体预览浮层、打开链接 | 拖拽移动/缩放、连线、promote |
| 右侧属性面板只读查看（attrs 文本/媒体缩略图） | 删除、重命名、字段编辑、就地文本编辑 |

- 面板：`EntityEditor readOnly` + `AssetFieldRow readOnly` 已具备；补 media attr 缩略图走 `resolveMediaSrc`，字段全部静态渲染。
- 工具栏：只读时隐藏编辑组，保留 pan/zoom/outline。

### 5.2 公开/营销预览（无 service，静态画布投影）

- 数据：直接抓 CDN `catalog.json` + `world.json`（manifest v2，含 canvas 与实体 media attrs）。
- 交付：`marketing-worlds.ts` 把 manifest v2 投影为只读画布（根文档元素 → 绝对定位百分比布局；实体元素解析为卡片 + CDN 封面图，media 元素直出，便签出文本），官网详情页直接渲染。同一份 canvas 数据，零 WebGPU 依赖、SEO 友好。
- 后续：若要把 in-app 的 pomelo 只读态也搬到官网，复用同一份「manifest v2 → records」投影即可，不改数据。
- 兼容：旧 v1 manifest（未重发）仍从 evidence 取图，避免迁移期官网空白。

## 6. 迁移

**原则：从源迁移，不从 DB 迁移。** 现网 `worlds/*/world.json` 保有原始完整内容（结构化字段、reference、provenance），而本地 DB 已被旧物化的有损映射洗过一遍；从源脚本一次转换、git 可审阅，比导出 DB 更准。

1. **现有 8 个 `worlds/*` 转 v2**：一次性、幂等、可 diff 的 `scripts/worlds-migrate-v2.mjs`（已实现并执行）。
   - **拆分实体**：`world.json.entities[]` → `entities/<id>.json`；`kind→typeId`、`title→name`、`summary→intro`、`content.body→detail`（`$file` 路径改写为相对 `entities/` 的 `../references/...`）、其余 content 键按 preset `fields` 查 label/type 生成 locked attrs（查不到则 text/textarea，key 原样）。
   - **素材协议化**：`evidence[]` → `assets/<id>.json` sidecar（id 取文件名 slug，如 `01-two-breakpoints`；kind=modality；`file` 相对 `assets/` 目录，允许 `../examples/...`），二进制**原地不动**（不复制/移动）；实体 media attr 改引 `{asset:<id>}`。绝对 url 证据直接内联 `{url}`，不落 sidecar。
   - **`world.json` 收薄**：只留 world 身份 + 自定义 `entityTypes` + relations + provenance。
   - **自动画布**：脚本按实体生成确定性的 `canvas.json`（顶级实体分列栅格，4 列 × 320/400 间距），平台世界**迁移即拥有可读只读画布**；作者随后在 app 里精修，再用 export 覆盖。
   - `--check` 幂等：二次运行全部 skip。
2. **构建**：`worlds-publish.mjs` 升级为 v2（已实现）：glob `entities/*.json` + `assets/*.json`，解析 `$file` 与 `{asset}`，校验引用完整性（`parentId`/`relations`/`{asset}`/canvas refId）与预算，镜像素材到 CDN 绝对 URL，`{asset}` 展开为 `{url,kind,name,recipe?}`，产出 manifest v2（确定性，`sortKeys`）。
3. **物化**：`MaterializeWorld` 支持 v2（已实现：entityTypes/entities/relations/**canvases**，含单测）；**v1 旧路径原地保留**（evidence 写 `world_asset_refs`），因此线上旧 manifest 不受影响；v1 转换 shim 留待不再需要时删除。
4. **公开预览/营销**：`marketing-worlds.ts` 切 v2 读取（含 canvas 投影），旧 manifest 未重发前兼容 evidence（已实现）。
5. **回归**：`world_asset_refs` 仅剩 local 老世界的 legacy 只读投影；统一 Entity RFC 的 P3 删除按原计划执行。
6. **上线**：内容改到 v2 后需 `make worlds-publish`（构建 + seed + 上传 R2）把新 catalog/manifest 推到 CDN；在此之前远端 catalog 仍指向旧 v1 manifest，物化走旧路径，功能不回归。

## 7. 分期交付

- **P0 契约冻结**：源格式 v2（拆分文件 + 素材协议）、manifest v2、media 双源、`resolveMediaSrc`、只读交互契约、export/import、publish 契约。
- **P1 service + 前端适配（已实现）**：`WorldManifestV2` 解析/校验/物化（types/entities/attrs/**canvases** + 命名空间化 + 单测）；v1 旧路径保留；`web/lib/world-media.ts` 单点解析 + `canvas-image/canvas-media/entity-attrs/field-row/world-detail-settings` 收敛；卡片媒体 url 支持；`marketing-worlds.ts` 切 v2 读取。
- **P2 内容迁移 + 画布配置（已实现）**：`worlds-migrate-v2.mjs`（拆分 + 素材协议 + 自动画布）已迁移 8 个世界；`worlds-publish.mjs` v2；`--seed` 重生成嵌入种子；`--check` 通过。作者精修画布 → export 覆盖 `canvas.json` 留后续。
- **P3 export/import（已实现）**：service 侧 `ExportWorldBundle`/`ImportWorldBundle`（`service/worlds_bundle.go`，v2 zip，素材内嵌、内容哈希去重）+ HTTP `GET /v1/worlds/{id}/export`（zip 下载）、`POST /v1/worlds/import`（multipart 上传）+ 工作台 UI（Worlds 列表「导入 World」、World 详情「导出为 zip」）。Agent/MCP 暴露与官网 pomelo 只读态留后续。
- **P4 官网预览 + UGC 发布（官网部分已实现）**：官网用静态画布投影直接预览 manifest v2 的 canvas（`marketing-worlds` + `MarketingWorldCanvasPreview`）；`recut.worlds.publish`（素材上传 + `pub.*` Catalog + install/update/uninstall、World Store UI）待 P4。

## 8. 测试矩阵

| 层 | 必测 |
| --- | --- |
| 构建 | v2 schema 校验；glob `entities/*.json` + `assets/*.json`；`$file`/素材 file 禁逃逸并镜像改写；引用完整性（parentId/relations/{asset}）；同一源两次构建逐字节相同；预算超限拒绝；`sourceVersion!=2` 明确报错 |
| 物化 | v2 同 manifest 两次同步零 revision；content 变化恰好一个新 revision；canvas 仅布局变化**不产** revision 但落库；entityTypes/attrs/canvas refId 命名空间化正确且跨设备一致；v1 shim 产物与 v2 等价；hash 不符拒物化 |
| 媒体解析 | asset→content 流；可信 CDN url 直连；外部 url 应用内走 `/v1/files/remote` 且缓存命中；无 service 直连；空值返回空串；`attrMediaValueOf` assetId/url 恰一校验 |
| 只读 | 服务端所有写入口（entity/canvas/relation/skillMd）返回 `WORLD_READ_ONLY`；UI 仅允许导航/选中/进入/预览；面板无任何可编辑态 |
| 预览 | 平台世界根/内层画布渲染出正确布局与 CDN 图；进入/返回不写穿透；官网只读 canvas 与 manifest 一致 |
| export/import | round-trip：export→import 得到 origin=local 世界，实体/关系/attrs/画布完整；`assets/*.json` 协议与 recipe 血缘还原；bundle 不含 assetId；ID 重映射无悬挂 |
| 回归 | local 世界创建/编辑/绑定/revision 行为不变；marketing 旧/新 manifest 均可读；`make check` 全绿 |

## 9. 可观测性

```text
world.content.materialized   { worldId, version, manifestVersion, revisionId, entities, types, canvases }
world.content.migrated_v1    { worldId, version }            # v1 shim 命中
world.exported               { worldId, entities, canvases, mediaAssetOnly }
world.imported               { fromWorldId?, toWorldId }
world.publish.uploaded       { worldId, assets }             # P4
media.resolve.proxy          { host }                        # 外部 url 代理（限流/失败诊断）
```

## 10. 开放问题

1. **`canvas.json` 粒度**：建议单文件（一个世界多 contextId 一层）；若画布很大或作者偏好，支持 `canvas/<contextId>.json` 目录或 `$file` 引用二选一。
2. **`entities/*.json` 的目录上限**：预算按实体数/attrs 计；超大世界（数百实体）是否需要分片目录（`entities/<group>/<id>.json`）留待观察。
3. **自动画布布局算法**：迁移期的确定性布局（分列栅格/关系画边）规则一旦冻结即进入 `--check`；作者精修后以 `canvas.json` 覆盖，不回溯重排。
4. **官网无 WebGPU 的降级**：仅给静态首帧/实体卡 DOM 占位，还是保留一小份 SSR 快照？建议前者（成本低）。
5. **外部 url 素材的导出**：`export` 是否顺便抓取外部 url 落为本地素材文件（离线自洽）？建议 P4 评估（涉及配额与版权）。
6. **UGC 发布信任模型**：`pub.*` 的发布者身份/审核/签名沿用 08-28 P4 冻结位；本 RFC 只确定 manifest v2 为发布单位。

## 11. 风险

| 风险 | 处理 |
| --- | --- |
| 迁移丢字段 | content 未知键落自定义 text attr 兜底；evidence 转素材协议包；不删用户数据；脚本可 diff 且二次零 diff |
| v2/v1 双轨期 | shim 只读、只保留一个版本；CI 以 manifestVersion 计数，迁完即删 |
| 画布命名空间错位 | refId/contextId 与实体 ID 用**同一**命名空间函数，物化与 fork 共用并加单测 |
| 媒体 CORS 在公开预览失败 | 只允许可信 CDN 直连，外部 URL 降级占位；应用内走代理 |
| attrs 撑大 canonical 与 brief | 沿用 16KB detail + attrs 条目上限；媒体 value 只存引用不存二进制 |
| evidence 消费方连锁 | P1 同步切换 brief/readiness/短片/marketing；否则生成链路静默取不到参考图（统一 Entity RFC 已预警） |

## 12. 验收标准

1. **源可配置**：`worlds/<slug>/` 能表达 `world.json + entities/*.json + assets/*.{json,ext} + canvas.json + entityTypes`，`--check` 通过且构建确定性可复现。
2. **物化可显示**：发布一个带 canvas 的平台世界后，本地只读画布完整呈现根/内层布局与 CDN 图；布局改动不产 revision，内容改动恰好产一个新 revision。
3. **媒体单点**：画布、面板、卡片、官网四处媒体都经 `resolveMediaSrc`；不存在第二套 assetId/url 解析；PGC 图在应用内与官网均正确显示。
4. **全文件导出**：`export` 产出的 bundle 不含 assetId，`assets/<id>.json` 带 recipe（prompt/参考/模型）；离线 `import` 可完整还原世界与素材，实体/关系/画布无悬挂引用。
4. **只读是硬边界**：平台世界任何写操作（UI/HTTP/MCP）返回 `WORLD_READ_ONLY`，但导航/选中/进入容器/媒体预览全部可用。
5. **UGC 可流转**：`export → import` round-trip 得到 origin=local 且实体/关系/attrs/画布完整、ID 无悬挂。
6. **一致性**：同一 manifest 在两个新 daemon 物化后 canonical hash 相同；`world_asset_refs` 不再被 PGC 写入；`world_canvases` 内容跨设备一致。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
