---
name: recut-worlds
appId: recut.platform
description: 操作 World 与 World Canvas 工具集的通用技能：属性/关系/类型的建模与关联、画布元素的显示与提升，以及世界语境里的媒体生成（先提案、后确认）。
---

# World 与 World Canvas 操作技能（recut-worlds）

World Canvas 是平台把「一个 App」第一公民化的产物：没有独立安装包，却有自己的画布界面、工具面（`recut.worlds.*`）与元数据。本技能是它的**通用操作技能**，只回答一个问题：**怎么调用 World / World Canvas 的工具，才能把脑中的世界变成 AI 可消费的结构化设定？**

它不描述任何具体世界的内容——那属于 `world.md`（经 `recut.worlds.brief.skill` 内联）。内容归世界，操作归本技能；生成提示词的形状归 `recut-director（references/generation-prompt）`。

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

**提升（`recut.worlds.promote`）决定边的语义**：

- `entity → entity` = **关系**（`relationType`，写 `world_relations`）。
- `entity → 自由元素` = **属性绑定**（`field` 绑定到实体属性；自由元素转为引用投影，并生成一个 attr 锚点元素，与右侧属性面板共享同一数据源）。
- 便签/文本提升 = 变成**草稿实体**（`isProvisional`），原元素保留为投影。

画布元素**永不产 revision**；只有 `recut.worlds.promote` 与 Canon 写才产。

## 工具地图（意图 → 工具）

**内容写入收口在画布接口（方案 A，World 即画布）**：MCP 不再有独立的语义 CRUD 工具，实体/关系/类型都经下列接口。

| 意图 | 工具 | 说明 |
|---|---|---|
| 发现 / 读取世界 | `recut.worlds.list` / `get` / `brief` / `readiness` / `resolve` | `brief` 是默认单次可生产入口（身份 + world.md + 实体属性 + `references[]` 可引用项表） |
| 读取内容 | `entities.list` / `entities.get` / `relations.list` / `entityTypes.list` / `evidence.list` | 只读；`entities.list` 支持 `parentId`（子设定）与 `includeProvisional`（草稿） |
| 读画布 | `recut.worlds.doc`（某层）/ `recut.worlds.docs`（层索引） | `contextId=""` 为根画布 |
| 写内容（画布接口） | `recut.worlds.entity` | op：`create`（可带 `contextId` 自动落投影卡）/ `update`（只覆盖显式字段）/ `archive` / `restore` / `confirm`（草稿转正） |
| | `recut.worlds.relation` | op：`create` / `update` / `archive` / `restore`；`scopeEntityId` 非空为局部关系 |
| | `recut.worlds.entityType` | 定义/覆盖类型 schema（不产 revision） |
| 写画布布局（不产 revision） | `recut.worlds.doc.update` | 元素级 ops：insert / update / remove；自由元素含 `note` / `text` / `shape` / `arrow` / `link` / `attr` / `media` |
| 提升草稿为 Canon | `recut.worlds.promote` | 便签/文本→草稿实体；箭头→关系 / 属性绑定 |
| 多步会话 | `recut.worlds.lock` / `recut.worlds.unlock` | 多步画布编辑前上 advisory 锁，结束务必释放 |
| World 生命周期 | `worlds.create` / `update`（world.md/identity）/ `fork` / `delete` / `bind_project` / `evidence.archive` | 世界级操作，不是内容编辑 |

## 门禁（违反会被拒绝或造成事故）

1. **非 local 世界只读**：任何写工具返回 `WORLD_READ_ONLY` 是边界不是失败——说明并提议 `recut.worlds.fork`，经用户确认在副本上继续。
2. **写 Canon 需要用户明确授权**：onboarding/画布 UI 的确认动作即明确授权；无用户请求绝不主动写。
3. **乐观并发**：所有 Canon 写携带 `expectedRevisionId`；`WORLD_REVISION_CONFLICT` 时停止整批、重读、刷新提案，绝不静默覆盖。
4. **草稿免费**：`isProvisional: true` 的实体是探索草稿，不产 revision、不进 Canon、不计入 readiness；用 `recut.worlds.entity` op=`confirm` 转正。
5. **删除是软删除**：`recut.worlds.entity` op=`archive` / `relation` op=`archive` = 归档（`archived_at` + 墓碑 + changeLog，可 `restore` 恢复），画布元素删除 = 本地移除。`worlds.delete` 是永久操作，只在用户明确要求并确认世界名称时调用；`evidence.archive` 是归档不是删除；**底层 media asset 永不因世界内容删除而删除**。
6. **生成产物默认不进 Canon**：见下。
7. **视频先提案、用户确认**：视频（及标记 `requiresProposal` 的高价模型）必须先落**全局提案资产**（`status=proposed`，不花钱），再把该 `assetId` 写进画布媒体元素；**绝不直接直生**。确认权只属于用户，Agent 不代确认。图片/语音成本低，可直接生成——拿到 `assetId` 就落「图片节点 + 属性边」（`assetStatus:"generating"`），不等生成完成。

## 世界内的媒体生成：先提案、后确认

在世界/画布语境里生成媒体，走「读世界 → 写提示词 → 视频落提案（用户确认后生成）/ 图音提交即落位」：

1. **读**：`recut.worlds.brief({ worldId })` 取 `world.md` 全文、该世界实体属性，以及 **`references[]`**——从实体 media 属性派生的可引用项（`{id,label,kind,role,source,assetId/url,entityId}`，`role` 是建议值）。世界风格（风格实体、world.md 的视觉语言）就是 **STYLE LOCK 来源**；`references[]` 就是可直接锚定的候选清单，不必自己翻属性找图。
2. **写提示词**：用 `recut-director（references/generation-prompt）` 的骨架——STYLE LOCK 逐字冻结；参考用受控 role 声明（词表权威见该技能《参考锚点表达规则》），引用世界的角色、风格、示例图与音色。
3. **解析绑定**：把参考导出为 `references: [{id, kind, role, label}]`（`id` = assetId），按**出现顺序**得到 `referenceIds`；任一 role 与 kind 不匹配、或 prompt/model 缺失即拒绝提交（fail closed）。
4. **执行**：
   - **视频**：**先落全局提案，绝不直生**。调用 `recut.video.generate`（默认 propose）或 `recut.media.propose` 得到 proposed 资产，再把 `assetId` 写进画布媒体元素；由用户在画布上确认后才真正生成（见下）。
   - **图片 / 语音**：成本低，直接调用 `recut.image.generate` / `recut.speech.generate`。返回的 `assetIds` **立即可用**，务必**提交即落位**（见下「生成中节点 + 属性边」），不要用 `recut.job.wait` 把落位堵在终态之后。
5. **落位**：图片 / 语音拿到 `assetId` 就**立即**在画布上落一个**图片节点**，并用**属性边**把它连到目标实体——「节点 + 边」才是实体的一条**可见属性**（如「环境卡」）；只写实体 attrs 不会在画布上出现节点。`assetStatus:"generating"` 让画布先显示等待态。
6. **可追溯**：`references` 就是「这次生成引用了什么、各自什么 role」的绑定记录，随节点保存，可重生成、可回溯 Canon。

### 图片 / 语音：拿到 assetId 就落位（生成中节点 + 属性边）

`recut.image.generate` / `recut.speech.generate` 返回的 `assetIds` 在**排队/生成中**就已稳定可引用。**不要等图片/语音生成完成**——拿到 `assetId` 立刻用 `recut.worlds.doc.update` 按下面两步把「节点 + 属性边」放上画布（图片用 `media:"image"`，语音用 `media:"audio"`），`props.assetStatus="generating"` 让画布立即显示蓝边「生成中」等待态，素材就绪后**平台自动切换**成真实素材（失败则显示失败态）。

**① 确保实体元素在画布上**（属性边只能从实体元素出发）。先用 `recut.worlds.doc` 读目标层，确认是否已有 `shape:<entityId>` 的实体元素；没有才放（服务端会自动补该 id、名称与默认几何）：

```json
{ "op": "insert", "element": { "kind": "entity", "refKind": "entity", "refId": "<entityId>" } }
```

**② 落图片节点（属性卡）+ 属性边**。图片节点 = `kind="attr"` 且 `props.media="image"`；属性边 = `kind="arrow"`，`fromElementId` 指向实体元素、`toElementId` 指向图片节点、`edgeType="attr"`。两笔放进同一个 `recut.worlds.doc.update` 的 `ops` 数组：

```json
{
  "ops": [
    {
      "op": "insert",
      "element": {
        "id": "shape:attr-<唯一后缀>",
        "kind": "attr",
        "name": "属性 · 环境卡",
        "props": {
          "media": "image",
          "label": "环境卡",
          "assetId": "<recut.image.generate 返回的 assetId>",
          "assetStatus": "generating"
        },
        "geometry": { "x": 200, "y": 120, "width": 260, "height": 140 }
      }
    },
    {
      "op": "insert",
      "element": {
        "id": "shape:arrow-<唯一后缀>",
        "kind": "arrow",
        "name": "属性边 · 环境卡",
        "props": {
          "fromElementId": "shape:<entityId>",
          "toElementId": "shape:attr-<唯一后缀>",
          "attrMedia": "image",
          "edgeType": "attr"
        }
      }
    }
  ]
}
```

规则：

- **节点 + 边缺一不可**：只有 `kind="attr"` 图片节点、没有属性边，它只是画布上的孤立图片；只有边、没有节点，边无所指。二者一起才把图片接成实体的属性。
- 三笔都在**同一个 `contextId` 层**：属性边只能连同层实体元素；根画布用 `contextId:""`，实体容器用该实体 id。不确定先用 `recut.worlds.doc`/`docs` 读该层已有元素与 id。
- `props.label` 就是属性名（这里「环境卡」）。边标签会显示「属性 · 环境卡」；`name` 建议写成 `属性 · <label>`。
- `props.assetStatus` 只写 `"generating"` 表示「落位时素材未就绪」；`"ready"` / `"failed"` 由平台按素材真实状态流转，**不要手写**，也不要为了切到结果态而回写节点。
- 语音（`props.media="audio"`）与图片同策略：拿到 `assetId` 立即落节点、`assetStatus:"generating"`，不等终态。
- 加载态由素材状态自动驱动：**Agent 不轮询、不回写、不等 `recut.job.wait`**；只有在下一步依赖产物内容（要读图/听声再决策）时才等待。落位即可在结尾如实告诉用户「已放上节点，素材就绪后会自动显示」。
- **这条属性属于实体时，画布与 Canon 都要写**：用 `recut.worlds.entity` op=`update` + `attrPatch` 写同名 media 属性，让设置视图 / 实体卡封面 / readiness 也认这条属性：
  ```json
  { "op": "update", "entityId": "<entityId>", "expectedRevisionId": "<当前 revision>",
    "attrPatch": [{ "key": "a_<唯一后缀>", "label": "环境卡", "type": "media", "value": { "assetId": "<assetId>", "kind": "image" } }] }
  ```
  只写 Canon 不落节点 = 用户看不到节点（本次要修的反例）；只落节点不写 Canon = 设置视图看不到它。Canon 写需用户授权，`label` 与节点 `props.label` 必须一致。
- 若用户只要「画布上先看着」、暂不沉淀为设定，则只落「节点 + 边」，Canon 留待用户确认。

### 视频必须先提案（proposal gate，全局资产）

视频（及其它高价生成）走**「先提案、后确认」**，而提案本体是**全局素材库里的一个 `proposed` 资产**（不是画布私有字段）：它带着完整配方（prompt/参考+role/模型/参数/画幅/时长/备注）落进素材库，画布只引用它的 `assetId`。状态与内容都读资产——确认后**复用同一 `assetId`** 转成 `queued`→`running`→`completed`，画布元素无需重指。

**Agent 只做两步**：① 用媒体工具落提案；② 用 `recut.worlds.doc.update` 把 `assetId` 写进媒体元素，然后停下等用户确认。

`recut.video.generate` 默认就是 propose（返回 proposed 资产），也可用 `recut.media.propose` 显式指定 capability；`mode:"generate"` 是直生逃生门，画布语境不要用。确认前可用 `recut.media.update_proposal` 原地改配方、`recut.media.list_proposals` 查看状态。

```jsonc
// ① 落提案（视频默认 propose；references 是绑定记录，顺序即提交顺序）
// recut.video.generate({ text, modelId?, credentialId?, imageAssetIds?/videoAssetIds?/audioAssetIds?,
//   references:[{id,kind,role,label}], aspectRatio?, durationSec?, note?, batchId? })
// → { assetId, status:"proposed", proposal:{...}, referenceIds:[...] }

// ② 画布只引资产：媒体元素 props.assetId + assetStatus（画布据此渲染「待确认」态）
{
  "op": "insert",
  "element": {
    "id": "shape:media-<唯一后缀>",
    "kind": "media",
    "name": "镜头 3 · 雨夜电台",
    "props": { "modality": "video", "assetId": "<recut.video.generate 返回的 assetId>", "assetStatus": "generating" },
    "geometry": { "x": 200, "y": 120, "width": 220, "height": 150 }
  }
}
```

规则：

- **提案内容与状态都在资产**：画布不再写 `props.proposal`（旧元素仍可只读回退）。`recut.media.list_proposals` / `recut.worlds.proposals.list` 列出的都是这些 `proposed` 资产。
- `references` 是这次生成的**绑定记录**（`id`=assetId、`kind`、`role`、`label`），也是模型提交顺序依据；role 必须与 kind 匹配（`voice/sfx/music` 只能 audio，`color-card` 只能 image），否则提案会被拒绝。
- `modelId` 留空则确认时由用户选；不确定当前可用模型时先留空，不要编造。`aspectRatio` / `durationSec` 按世界或分镜口径填。
- 一次可落多条（同一场戏的分镜，`batchId` 归组），用户逐条确认或放弃（`recut.media.reject_proposal` 放弃）。
- **Agent 的正确结尾**：落完提案并放上画布后，告诉用户「已提交 N 条视频提案，请在画布上确认生成」并停下。**不要**替用户确认（`recut.media.confirm_proposal` 只由 UI/用户触发）、不要为「跑通」改走直生、也不要自己轮询采纳。

**资源口径优先**：world.md 的「资源口径」章节决定哪些属性/素材可作生成参考。例如小黑世界规定示例图只作低频视觉校准（`role="style-ref"`）、不进入默认生成路径——必须遵守。

## 何时用本技能

- 用户要搭建、编辑、整理某个世界：建实体、填属性、连关系、建类型、摆画布。
- 用户要在世界语境里生成媒体：先读 world.md，再走 `recut-director（references/generation-prompt）`；**视频只落提案，等用户确认**。
- 不用于：描述某个具体世界的内容（读 world.md）、写生成提示词本身（用生成提示词技能）。

## 常见误用

- **把 world.md 当操作手册**：它是内容/生产工作流；工具怎么调看本技能。
- **还在用「证据」概念**：素材唯一表示是 **media 属性**；不要创建独立素材层或 A 挂接线。
- **在画布上复制属性值**：属性卡只连边、持投影；真相在 `entity.attrs`。
- **把长文/编辑控件塞进实体卡**：卡片只略读，编辑走面板或属性卡。
- **写 Canon 不等授权**：无用户明确请求就 upsert/promote 是越权。
- **忘记 `expectedRevisionId`**：并发写会静默覆盖，必须带乐观锁。
- **直接生成画布视频 / 替用户确认提案**：视频必须先落 proposed 资产；自行调用 `recut.media.confirm_proposal`、把直生当默认、或自行轮询采纳都是越权；确认只属于用户。
- **等图片生成完成才落位**：图片/语音拿到 `assetId` 就应立刻落节点（`assetStatus:"generating"`）；用 `recut.job.wait` 把落位堵在终态之后、或轮询后回写节点都是多余动作。
- **只写实体属性、不落画布节点**：用户要的是画布上的「图片节点 + 属性边」（实体的一条可见属性）；只写实体 attrs 不会在画布上出现节点。两者都要做时，节点与边的 `label` 保持一致。
- **在画布元素上写语义真相**：语义只存实体/关系；画布只承载投影与表达。

## References 路由表

| 问题 | 读什么 | 用途 |
|---|---|---|
| 某个世界的内容与生产工作流 | `recut.worlds.brief` 的 `skill`（world.md） | 该世界的定位、工作流、资源口径 |
| 完善一个世界的标准工作流 | platform `recut` skill 的 `references/world-onboarding.md` | readiness → research → generate → 提案 → 确认写回 |
| 生成提示词形状与参考锚定 | `recut-director（references/generation-prompt）` | STYLE LOCK、role 锚定、多镜连续段 |
| 属性/画布数据模型与产品行为 | 仓库设计文档 `rfc/2026-09-09-unified-entity-model.md`、`docs/world-canvas-prd-v2.md` | 属性模型、卡片/面板/属性卡、提升规则 |
| 生成提案的资产模型与接口 | 仓库设计文档 `rfc/2026-09-16-media-generation-proposal.md` | proposed 生命周期、metadata.proposal、propose/confirm/update/reject |
| 世界源格式与发布 | 仓库设计文档 `rfc/2026-09-13-world-content-format-v2.md` | world.json/canvas.json/world.md 物化 |

## 介质声明

本技能是**操作层**，显式引用 `recut.worlds.*` 与媒体生成工具；它不定义任何业务内容，内容永远来自世界自身（world.md + 实体属性）。

**面与消费者**：`recut.worlds.*` 的 **MCP 面是面向 AI 的唯一接口**（本技能描述的就是它）；App 内部的 `ctx.worlds.*` capability 是已安装 App 的便路，不由 AI 调用、也不在本技能范围。

**模型权威**：属性/画布语义以 `rfc/2026-09-09-unified-entity-model.md` 与画布实现 README（`web/app/worlds/[worldID]/canvas/README.md`）为准；本技能只是操作摘要，冲突时以上述为准。

## 版本与来源

- 工具权威：`service/agent.go` 的 `mcpToolLabels` 中 `recut.worlds.*` 清单（2026-09-15 实测）。
- 属性/画布模型：`rfc/2026-09-09-unified-entity-model.md`（attrs 统一、evidence 退役）与 `web/app/worlds/[worldID]/canvas/README.md`（画布实现现状）。
- 生成提案实现：`rfc/2026-09-16-media-generation-proposal.md`（proposed 资产、`service/media/proposals.go`、`web/lib/media/proposal.ts`、`rfc/2026-09-15-generation-reference-protocol.md`）。
- 产品：`docs/world-canvas-prd-v2.md`。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
