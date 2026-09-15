---
name: recut-worlds
appId: recut.platform
description: 操作 World 与 World Canvas 工具集的通用技能：属性/关系/类型的建模与关联、画布元素的显示与提升，以及世界语境里的媒体生成（先提案、后确认）。
---

# World 与 World Canvas 操作技能（recut-worlds）

World Canvas 是平台把「一个 App」第一公民化的产物：没有独立安装包，却有自己的画布界面、工具面（`recut.worlds.*`）与元数据。本技能是它的**通用操作技能**，只回答一个问题：**怎么调用 World / World Canvas 的工具，才能把脑中的世界变成 AI 可消费的结构化设定？**

它不描述任何具体世界的内容——那属于 `world.md`（经 `recut.worlds.brief.skill` 内联）。内容归世界，操作归本技能；生成提示词的形状归 `recut-directing-generation-prompt`。

## 核心模型：先懂这个，再调工具

**Entity = 身份（name / intro / detail）+ 类型（typeId）+ 属性列表（attrs）+ 关系（edges）。**

| 概念 | 真相位置 | 说明 |
|---|---|---|
| 身份 | `name` / `intro` / `detail` | 名称、一句话简介、正文长文（`detail` 是一等字段，不是普通属性） |
| 类型 | `world_entity_types` | 预设人物/场景/物件/故事/风格/规则 + 自定义；决定默认字段 schema |
| 属性 | `entity.attrs`（有序 `{key,label,type,value}`） | 数组顺序即 UI 顺序，可排序 |
| 关系 | `world_relations`（双向语义） | 受控词表 + 自定义 relationType |
| 画布元素 | `world_canvas`（投影 / 表达） | 不产 revision、可重建 |

**属性两种粒度：**

- **类型级字段（schema）**：定义在 entityType 上，该类型的所有实例共享。预设字段 `locked`（label/type/删除被锁，值可改）；`+ 添加字段` 追加 unlocked 共享字段，对既有实例「缺失即空」，不回填。
- **实例级属性**：只属于某个实体（key 形如 `a_xxx`），可自由增删改 label/值。

**属性类型**：`text / textarea / number / boolean / select / media`。

**素材 = media 属性（唯一通道）**：实体挂图片/视频/音频，就是一条 `type:"media"` 的 attr，值为 `{assetId, name?, kind?, segment?}`。**没有独立的「参考素材 / 证据」层**（evidence 已退役）；不复制二进制，只引用素材库 `assetId`，`segment` 保留「只引用某一段」的能力。

**预设类型字段（locked）**：`character` 外貌与标志/性格/声音/不可变特征；`location` 描述/氛围；`object` 描述/材质/来历/用途/重要时刻；`story` 前提/关键时刻/情绪；`style` 视觉/guidance/避免；`rule` 规则文本。每类另带一个 **unlocked `background`（media）** 字段。

## 属性怎么显示：三层分工

不要让一处承担所有信息。三层各司其职：

| 层 | 职责 | 显示什么 |
|---|---|---|
| **实体卡**（画布，略读） | 一眼识人 | 封面（第一条 image 属性）、相册（全部 image 属性）、背景（image/video 属性轮播；`background` 属性有值则锁定为它）、名称、简介（2 行）、至多 2 条已填 primitive 字段（`label: value`）、子设定/素材计数徽标 |
| **详情面板 EntityEditor**（精读 / 编辑） | 改内容 | 身份区（名称/简介/正文）+ 字段区（schema 字段 + schema 外属性**续排同一渲染路径**，media 属性与普通属性同一路径）+ 关系区；先读后写、blur 即存、行内「已保存」 |
| **画布属性卡**（空间表达） | 把某个属性摆到画布上 | 一张 `kind="attr"` 元素卡，通过一条**属性边**关联到实体；编辑卡片正文即回写实体 |

规则：**卡片只略读，不承载编辑**（编辑走面板或属性卡）；**长文不进卡片**；封面/相册/背景都从 media 属性派生，不要单独维护素材字段。

## 属性怎么关联：边即关联，值不复制

**单一数据源**：`entity.attrs / intro / detail`。画布上的属性卡只持**引用投影**（`props.value`），不是副本。

**属性关联 = 一条 arrow 边**（`edgeType="attr"`）：`fromElementId` 是实体元素、`toElementId` 是 attr 元素。**不要在画布上复制值，只连边。**

两条同步方向：

- **画布 → 实体**：编辑属性卡正文，按 label 映射回实体——`简介/介绍/intro → intro`、`正文/内容/detail → detail`，否则写同名 attr key（无则新建）。空值不回写；删除属性只在右侧面板做。
- **实体 → 画布**：面板改字段后，绑定该字段的属性卡投影值自动刷新；字段被删则投影清空，不留陈旧副本。

**提升（`canvas.promote`）决定边的语义**：

- `entity → entity` = **关系**（`relationType`，写 `world_relations`）。
- `entity → 自由元素` = **属性绑定**（`field` 绑定到实体属性；自由元素转为引用投影，并生成一个 attr 锚点元素，与右侧属性面板共享同一数据源）。
- 便签/文本提升 = 变成**草稿实体**（`isProvisional`），原元素保留为投影。

画布元素**永不产 revision**；只有 `canvas.promote` 与 Canon 写才产。

## 工具地图（意图 → 工具）

| 意图 | 工具 | 说明 |
|---|---|---|
| 发现 / 读取世界 | `recut.worlds.list` / `get` / `brief` / `readiness` / `resolve` | `brief` 是默认单次可生产入口（身份 + world.md + 实体属性 + `references[]` 可引用项表） |
| 浏览 Canon | `entities.list` / `entities.get` / `relations.list` / `entityTypes.list` / `evidence.list` | 只读；`evidence.list` 仅兼容读取，素材权威在 media 属性 |
| 读画布 | `canvas.doc`（某层）/ `canvas.docs`（层索引） | `contextId=""` 为根画布 |
| 写 Canon（产 revision） | `entities.upsert` / `entities.create_child` / `entities.promote` / `relations.create` / `relations.update` / `entityTypes.upsert` / `worlds.update`（skillMd）/ `worlds.create` / `worlds.fork` | 语义事实或 schema |
| 写画布布局（不产 revision） | `canvas.doc.update` | 元素级 ops：insert / update / remove；自由元素含 `note` / `text` / `shape` / `arrow` / `link` / `attr` / `media` |
| 提升草稿为 Canon | `canvas.promote` | 便签/文本→实体；箭头→关系 / 属性绑定 |
| 门禁与绑定 | `worlds.bind_project` / `evidence.archive` / `worlds.delete` | 绑定 / 归档 / 删除 |

## 门禁（违反会被拒绝或造成事故）

1. **非 local 世界只读**：任何写工具返回 `WORLD_READ_ONLY` 是边界不是失败——说明并提议 `recut.worlds.fork`，经用户确认在副本上继续。
2. **写 Canon 需要用户明确授权**：onboarding/画布 UI 的确认动作即明确授权；无用户请求绝不主动写。
3. **乐观并发**：所有 Canon 写携带 `expectedRevisionId`；`WORLD_REVISION_CONFLICT` 时停止整批、重读、刷新提案，绝不静默覆盖。
4. **草稿免费**：`isProvisional: true` 的实体是探索草稿，不产 revision、不进 Canon、不计入 readiness；用 `entities.promote` 转正。
5. **删除是软删除**：设定/关系删除 = 归档（`archived_at` + 墓碑 + changeLog，可逐条撤销），画布元素删除 = 本地移除。`worlds.delete` 是永久操作，只在用户明确要求并确认世界名称时调用；`evidence.archive` 是归档不是删除；**底层 media asset 永不因世界内容删除而删除**。
6. **生成产物默认不进 Canon**：见下。
7. **视频先提案、用户确认**：画布上的视频只落 `proposal`（`props.proposal.status="pending"`），**绝不直接调用 `recut.video.generate`**；确认权只属于用户，Agent 不代确认。图片/语音成本低，可直接生成。

## 世界内的媒体生成：先提案、后确认

在世界/画布语境里生成媒体，走「读世界 → 写提示词 → 落提案（视频）/ 直接生成（图音）→ 用户确认 → 落位」：

1. **读**：`recut.worlds.brief({ worldId })` 取 `world.md` 全文、该世界实体属性，以及 **`references[]`**——从实体 media 属性派生的可引用项（`{id,label,kind,role,source,assetId/url,entityId}`，`role` 是建议值）。世界风格（风格实体、world.md 的视觉语言）就是 **STYLE LOCK 来源**；`references[]` 就是可直接锚定的候选清单，不必自己翻属性找图。
2. **写提示词**：用 `recut-directing-generation-prompt` 的骨架——STYLE LOCK 逐字冻结；参考用受控 role 声明（`pov / color-card / environment / character / prop / style-ref / motion-ref / voice / sfx / music`），引用世界的角色、风格、示例图与音色。
3. **解析绑定**：把参考导出为 `references: [{id, kind, role, label}]`（`id` = assetId），按**出现顺序**得到 `referenceIds`；任一 role 与 kind 不匹配、或 prompt/model 缺失即拒绝提交（fail closed）。
4. **执行**：
   - **视频**：**不得直接调用 `recut.video.generate`**。视频成本高，必须先落「生成提案」，由用户在画布上确认后才真正生成（见下）。
   - **图片 / 语音**：成本低，可直接调用 `recut.image.generate` / `recut.speech.generate`（异步 job，用 `recut.job.wait` 等终态）。
5. **落位**：结果写成实体 **media 属性**（`{assetId, name, kind}`）或画布 `media` 元素；**默认是自由元素/属性，不自动进 Canon**。
6. **可追溯**：`references` 就是「这次生成引用了什么、各自什么 role」的绑定记录，随节点保存，可重生成、可回溯 Canon。

### 视频必须先提案（proposal gate）

画布上的视频节点有两种状态：**提案态（未生成、不花钱）** 与 **结果态（已生成、可播放）**。生成命令的触发权只在用户手里——**Agent 只负责把提案放上画布，等用户点「确认生成」**。

提案就是一个 `kind="media"` 的画布元素，`props.modality="video"` 且 `props.proposal` 描述这次生成意图。用 `canvas.doc.update` 的 `insert` 放它（画布元素不产 revision、不花钱）：

```json
{
  "op": "insert",
  "element": {
    "id": "shape:media-<唯一后缀>",
    "kind": "media",
    "name": "镜头 3 · 雨夜电台",
    "props": {
      "modality": "video",
      "proposal": {
        "status": "pending",
        "prompt": "[STYLE LOCK]\n<冻结风格全文，逐字复用>\n\n参考锚定表\n参考图1 作为林小满人物视觉锚定。\n\n第 3 镜，约 5 秒。中景，雨夜电台门口……",
        "references": [
          { "id": "asset_a1", "kind": "image", "role": "character", "label": "林小满" }
        ],
        "modelId": "<当前可用的视频模型 id>",
        "params": {},
        "aspectRatio": "9:16",
        "durationSec": 5,
        "note": "承接上一场结束状态；确认后可再调提示词与本镜时长",
        "proposedBy": "agent"
      }
    },
    "geometry": { "x": 200, "y": 120, "width": 220, "height": 150 }
  }
}
```

规则：

- `proposal.status` **只写 `"pending"`**；`generating` / `done` / `failed` 由平台流转，不要手写。
- `references` 是这次生成的**绑定记录**（`id` = assetId、`kind`、`role`、`label`），也是模型提交顺序的依据。`prompt` 里可以内联 `<reference>` 标签供人审阅，但**权威是 `references[]`**，二者必须一一对应；不确定时以 `references[]` 为准。
- role 必须与 kind 匹配（`voice/sfx/music` 只能 audio，`color-card` 只能 image），否则平台自检会阻断确认。
- `modelId` 留空则用户在确认时再选；不确定当前可用模型时先留空，不要编造。
- `note` 写意图/承接关系，帮用户判断；`aspectRatio` / `durationSec` 按世界或分镜口径填。
- 一次可落多条（同一场戏的分镜），用户逐条确认或放弃。

**Agent 的正确结尾**：落完提案后，告诉用户「已提交 N 条视频提案，请在画布上确认生成」并停下。**不要**替用户确认、不要为「跑通」改走 `recut.video.generate`、也不要自己轮询采纳。

**资源口径优先**：world.md 的「资源口径」章节决定哪些属性/素材可作生成参考。例如小黑世界规定示例图只作低频视觉校准（`role="style-ref"`）、不进入默认生成路径——必须遵守。

## 何时用本技能

- 用户要搭建、编辑、整理某个世界：建实体、填属性、连关系、建类型、摆画布。
- 用户要在世界语境里生成媒体：先读 world.md，再走 `recut-directing-generation-prompt`；**视频只落提案，等用户确认**。
- 不用于：描述某个具体世界的内容（读 world.md）、写生成提示词本身（用生成提示词技能）。

## 常见误用

- **把 world.md 当操作手册**：它是内容/生产工作流；工具怎么调看本技能。
- **还在用「证据」概念**：素材唯一表示是 **media 属性**；不要创建独立素材层或 A 挂接线。
- **在画布上复制属性值**：属性卡只连边、持投影；真相在 `entity.attrs`。
- **把长文/编辑控件塞进实体卡**：卡片只略读，编辑走面板或属性卡。
- **写 Canon 不等授权**：无用户明确请求就 upsert/promote 是越权。
- **忘记 `expectedRevisionId`**：并发写会静默覆盖，必须带乐观锁。
- **直接生成画布视频 / 替用户确认提案**：把 `proposal.status` 写成 `generating`/`done` 或自行轮询采纳都是越权；确认只属于用户。
- **在画布元素上写语义真相**：语义只存实体/关系；画布只承载投影与表达。

## References 路由表

| 问题 | 读什么 | 用途 |
|---|---|---|
| 某个世界的内容与生产工作流 | `recut.worlds.brief` 的 `skill`（world.md） | 该世界的定位、工作流、资源口径 |
| 完善一个世界的标准工作流 | platform `recut` skill 的 `references/world-onboarding.md` | readiness → research → generate → 提案 → 确认写回 |
| 生成提示词形状与参考锚定 | `recut-directing-generation-prompt` | STYLE LOCK、role 锚定、多镜连续段 |
| 属性/画布数据模型与产品行为 | 仓库设计文档 `rfc/2026-09-09-unified-entity-model.md`、`docs/world-canvas-prd-v2.md` | 属性模型、卡片/面板/属性卡、提升规则 |
| 世界源格式与发布 | 仓库设计文档 `rfc/2026-09-13-world-content-format-v2.md` | world.json/canvas.json/world.md 物化 |

## 介质声明

本技能是**操作层**，显式引用 `recut.worlds.*` 与媒体生成工具；它不定义任何业务内容，内容永远来自世界自身（world.md + 实体属性）。

## 版本与来源

- 工具权威：`service/agent.go` 的 `mcpToolLabels` 中 `recut.worlds.*` 清单（2026-09-15 实测）。
- 属性/画布模型：`rfc/2026-09-09-unified-entity-model.md`（attrs 统一、evidence 退役）与 `web/app/worlds/[worldID]/canvas/README.md`（画布实现现状）。
- 生成提案实现：`web/app/worlds/[worldID]/canvas/canvas-proposal.ts`（`references`/`PROPOSAL_ROLES`/自检/`referenceIds`）与 `rfc/2026-09-15-generation-reference-protocol.md`。
- 产品：`docs/world-canvas-prd-v2.md`。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
