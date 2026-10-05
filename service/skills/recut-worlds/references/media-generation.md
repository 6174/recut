# 媒体生成深规则：视频待确认、落位边界与资源口径

> `recut-worlds` 的二级参考。**入口《四、基础操作 C》已给出可照做的配方**（主流程、图片 / 语音落位 JSON、参考集配方、视频两步）。本文件只补入口放不下的边界规则与生命周期。提示词形状见 `recut-director（references/generation-prompt）`。

## 统一口径与自查

- 世界已有声线参考时，角色台词 / 旁白**必须用该声线**，不静默换成默认音色。
- 生成以「段 / 场景」为单位（一段连续动作优先一次多镜连续生成），不逐帧、逐段 5s 硬拼。
- **提交前自查（未过不提交）**：这次生图 / 生视频引用了几条参考、各是什么 role？画面会出现主角色却没有任何 `role="character"` 参考图 → 停下补齐（关键道具缺 `role="prop"` 同理）。只有明确不出现任何角色的纯空场景才可省略 `character`；「这次忘了先读」不是理由。

## 图片 / 语音落位的边界规则

- **摆位贴着要连的对象**：落节点前先读该层已有 `geometry`，把新节点显式放在**它要连的那个元素旁边**（如实体卡右侧 320px、纵向对齐）。不传 x/y 时服务端只会贴到已有内容右侧兜底，会「内容飞很远、边拉很长」。
- **节点 + 边缺一不可**：只有节点没边 = 孤立图片；只有边没节点 = 边无所指。三笔都在**同一个 `contextId` 层**（根画布 `""`，实体容器用该实体 id）。
- `props.label` 就是属性名，边标签显示「属性 · 场景卡」，`name` 建议 `属性 · <label>`。
- `props.assetStatus` 只写 `"generating"`；`"ready"` / `"failed"` 由平台流转，**不手写、不轮询、不回写**。
- **画布与 Canon 都要写**：`recut.worlds.entity` op=`update` + `attrPatch` 写同名 media 属性（核心参考用语义 key `character_reference`/`location_reference`/`prop_reference`，补充素材用 `a_<后缀>`），`label` 与节点一致。**只写 Canon 不落节点 = 用户看不到；只落节点不写 Canon = 设置视图看不到。**
- **Canon media 属性接受未就绪 `assetId`**（`proposed` / `queued` / `running` 都可写；只有 `failed` / `deleted` 被拒），因此画布节点与实体属性可以一起落位、不必等终态。
- 若用户只要「画布上先看着」、暂不沉淀为设定，则只落「节点 + 边」，Canon 留待用户确认。

## 视频默认待用户确认（全局资产，平台策略）

视频由平台落为**全局素材库里的一个待确认资产**（不是画布私有字段）：带完整配方（prompt / 参考+role / 模型 / 参数 / 画幅 / 时长 / 备注）落进素材库，画布只引用它的 `assetId`。确认后**复用同一 `assetId`** 转成生成中 → 完成，画布元素无需重指。

```jsonc
// ① recut.video.generate({ text, references:[{id,kind,role,label}], imageAssetIds?/videoAssetIds?/audioAssetIds?,
//      aspectRatio?, durationSec?, note?, batchId? }) → { assetId, referenceIds:[...] }

// ② 画布只引资产
{ "op": "insert", "element": {
    "id": "shape:media-<唯一后缀>", "kind": "media", "name": "镜头 3 · 雨夜电台",
    "props": { "modality": "video", "assetId": "<返回的 assetId>", "assetStatus": "generating" },
    "geometry": { "x": 200, "y": 120, "width": 220, "height": 150 } } }
```

规则：

- **提交即落位**：一返回 `assetId` 就**立刻**把媒体元素放上**它所属的画布层**（待确认 / 生成中态），不停在等待。
- **内容与状态都在资产**：画布不写 `props.proposal`。
- `references` 是这次生成的**绑定记录**，也是模型提交顺序依据；role 必须与 kind 匹配，否则被拒。
- `modelId` 留空则由用户在确认时选；不确定当前可用模型时先留空，不要编造。`aspectRatio` / `durationSec` 按世界或场次口径填。
- **改配方不用重提**：待确认资产还是 `proposed` 时，用 `recut.media.asset.update({ assetId, prompt?, references?, referenceIds?, modelId?, output?, aspectRatio?, durationSec?, note? })` **原地**改配方，同一条 `assetId`、画布元素无需重指；确认后配方冻结。
- **正文标签必须绑定**：`prompt` 正文里出现的每个参考 token 都必须在 `references[]` 有绑定，未绑定会在创建 / 更新时被拒（`unbound_prompt_reference`）。
- 一次可提交多条（同一场戏分镜，`batchId` 归组），用户逐条确认或放弃。
- **Agent 的正确结尾**：提交并放上画布后，告诉用户「已提交 N 条视频，请在画布上确认生成」并停下。**不要**替用户确认、也不要自己轮询采纳。

## 资源口径优先

world.md 的「资源口径」章节决定哪些属性 / 素材可作生成参考。例如小黑世界规定示例图只作低频视觉校准（`role="style-ref"`）、不进入默认生成路径——必须遵守。
