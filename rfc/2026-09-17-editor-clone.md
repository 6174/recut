<!--
 * [INPUT]: 依赖 service/media（media_assets 生命周期与 metadata、AssetStatusProposed、/v1/media/* 与 recut.media.* MCP）、
 *   2026-09-16-media-generation-proposal（proposed 生命周期与配方契约）、2026-09-15-generation-reference-protocol（typed 参考与 role 词表）、
 *   2026-09-09-unified-entity-model（attrs 有序 typed key-value 范式）、2026-08-29-global-directing-skills（全局技能库形态与唯一性原则）、
 *   2026-08-21-ai-narration-audio-asset-lifecycle（timeline.placeAudio / 可播放性）、2026-08-22-editor-captions-audio-studio-asr（能力桥 audio.transcribe）、
 *   apps/editor（timeline/scene/element 写侧与 film.package.import 先例）、apps/editor/skills/recut-editor、
 *   外部对照物 /tmp/hypit（只取判断，不取语法）
 * [OUTPUT]: 在 apps/editor 内实现「参考视频克隆」的三层方案——① 全局参考理解工具（platform media capability）+ 全局 skill `recut-reference`，
 *   解耦可单测、跨 App 复用；② 素材元素 AssetElement 挂在 Editor 素材层（扩展 editor_assets：attrs + content + recipe），
 *   复用 proposed 生命周期，先计划后生成；③ editor skill 内的 clone 路由与薄适配层。含端到端走查、契约影响、M0–M4 里程碑与验收
 * [POS]: rfc 的「克隆执行层」决策；把 clone 收进 Editor 而不新增 XML 中间语言或平台一等对象，
 *   为「参考视频 → 可复跑新片」提供可落地的实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# Editor 克隆：参考视频 → 素材元素 → 生成 → 时间线

- 状态：总纲（roadmap）。实际按序拆为独立 RFC 推进：① [宿主与素材迁移](./2026-09-17-editor-native-migration.md) → ② 视频理解 → ③ 素材 attrs 协议层 → ④ clone skill（本文件作为目标与验收的总览，各步详细设计以对应 RFC 为准）
- 日期：2026-09-17
- 关联：[媒体生成提案](./2026-09-16-media-generation-proposal.md)、
  [生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)、[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、
  [全局导演技能库](./2026-08-29-global-directing-skills.md)、[AI 解说音频素材生命周期](./2026-08-21-ai-narration-audio-asset-lifecycle.md)、
  [字幕 × audio-studio ASR](./2026-08-22-editor-captions-audio-studio-asr.md)、[Editor AI 成片质量](./2026-08-19-editor-ai-video-authoring-quality.md)
- 外部对照：Hypit（`/tmp/hypit`）。只借用其「参考真相与目标真相分离、先理解再生成、素材可复用」的产品判断，**不引入 SVML/SVS 语法、语义中间语言或 Author Package 体系**。
- 非目标：不新增 XML/DSL；不新增平台一等对象（素材元素直接扩展全局媒体资产，不建 ReferencePack/Production 表）；不重写 Editor 时间线模型；首版不做语义锚点与一变多（列 M4）。

## 0. 摘要

**判断**：克隆的终态是「AI 理解原视频 → 生成一组素材 → 放到时间线上」。Editor 的写侧（`timeline.command` / `placeComponents` / `placeAudio` / validate / export）与「结构化包 → clips」的先例（`film.package.import`）都已存在，所以**不需要另一套中间语言，也不需要另一个 App**。真正缺的是两件事：

1. **「理解原视频」没有可归档、可复用、可单测的工具与技能**。今天只存在于聊天记忆里，且每个 App 都要重造一遍；
2. **素材在生成之前没有载体**。`clip`（timeline element）太薄，无法承载「我要一个什么素材、它从参考的哪一段来、它是 A-roll 还是 B-roll、用什么提示词和参考图」。

**方案**：在 `apps/editor` 内分三层实现克隆，层与层之间只通过稳定契约（assetId / 素材元素 / skill）耦合：

```
Layer 1  参考理解：全局工具（platform media capability）+ 全局 skill `recut-reference`
         ingest · probe · words · boundaries · frames · contactSheet · clip · measure
         完全解耦、可单测、跨 App 复用（editor / remix / worlds / cover / ai-short-film）
              │  产出证据（ReferencePack）——只描述「原片做了什么」
              ▼
Layer 2  素材元素（AssetElement）挂在 Editor 素材层（扩展 editor_assets）
         attrs[] + content + recipe：A-roll / B-roll / MG / Caption / Voice / Music / SFX 同一模型
         先计划（planned，本地不花钱）→ 用户批准 → 触发生成 → 物化（全局资产 / 组件）
              ▼
Layer 3  editor skill 内的 clone 路由（薄适配）
         clone.md 指向全局 `recut-reference`（怎么读懂）与 recut-director/references/remix（换什么）
```

核心主张：**「一个 clip 无非是包含更多信息」——那就让 clip 只引用素材，把信息放在素材上；而素材就用全局 asset，统一最简单。** 素材元素是「有属性、有正文、有计划态」的全局媒体资产，语义对齐 World Canvas 的 Entity（有序 typed attrs + 长正文），不是一个新的时间线对象，也不是一个新的项目态对象。

## 1. 背景与问题

### 1.1 今天有什么、缺什么

| 能力 | 现状 | 判定 |
|---|---|---|
| 时间线读写 | `timeline.read`（condensed）/ `element.get` / `timeline.command` / `history.*` | 齐 |
| 结构化放到时间线 | `film.package.import`：`pkg.scenes[].assetIds` → main 轨、`sc.title` → text、`voiceoverAssetId` → audio | 有先例，但顺序累加、单场景、无生成计划 |
| 素材生成门禁 | `recut.video.generate` 默认 propose；`recut.media.proposals` 全链路（`status='proposed'`） | 齐（可直接复用） |
| 参考素材入库 | `recut.files.fetch`（≤100MB）/ `recut.media.import_url` | 有，但无「视频理解」 |
| 视频理解 | 无 probe / 边界 / 关键帧 / 接触表；无复用技能（词级时间可选，非必需） | **缺（Layer 1）** |
| 素材的计划态 | `proposed` 只承载**生成配方**，无「角色/来源/属性/正文」语义 | **缺（Layer 2）** |
| 克隆工作流 | 仅 `recut-director/references/remix` 决策（声明介质中性、不含工具调用） | **缺执行层（Layer 3）** |

### 1.2 两个关键简化

**（a）理解工具是全局能力，不是 Editor 私有。** 「读懂一支参考视频」在 editor clone、remix 仿拍、World 参考、封面参考、AI 短片取材里都要用。因此它落为**平台媒体能力 + 全局 skill**，Editor 只是消费者之一。

**（b）素材元素挂在 Editor 素材层。** 因为 MotionGraphic 也需要同一套属性，而 MG 是 Editor 自有的组件资产、不是全局媒体资产；放进 Editor 素材层（扩展 `editor_assets`），media / MG / speech / caption 才能用同一个模型表达。素材元素只持引用，字节真相仍在全局资产与组件系统；「是否需要全局统一属性模型」留待后续（§11）。

### 1.3 为什么不是「让 clip 带更多字段」

Timeline element 是**渲染/编排**对象：职责是「在什么时间、什么 transform、呈现哪个素材」。克隆产生的信息（角色、来源片段、可迁移判断、提示词、参考绑定）是**素材的创作信息**，发生在素材存在之前。若塞进 element：时间线模型被污染、素材无法在「尚未生成」时表达、同一素材被多 element 复用时信息重复、与「素材只经 assetId 引用」的既有纪律冲突。所以信息放素材，element 只持引用。

### 1.4 为什么不需要新的中间语言

Hypit 的 SVML 收口的是「词级锚定 + 语义事件」，那在 Recut 对应的是**后续 M4 的 anchor 字段**，而不是一份新文档语言。首版克隆只需要「证据 → 计划素材 → 生成 → 落轨」，全部能用现有 JSON 契约与 op 表达。

## 2. 总体设计

### 2.1 三层解耦

- **Layer 1 ↔ Layer 2**：只通过 assetId 与证据结构耦合。Layer 1 不 import Editor、不碰时间线；Layer 2 只消费证据。
- **Layer 2 ↔ Layer 3**：只通过 op 契约耦合。Skill 调用 `recut.media.*` / `timeline.*`，不直接改项目数据。
- **Layer 3 ↔ 决策层**：clone 的「换什么、保留什么」复用 `recut-director/references/remix`；`clone.md` 只做介质适配。

### 2.2 术语

| 术语 | 含义 |
|---|---|
| **参考证据 / ReferencePack** | Layer 1 对一支参考视频的结构化观察（时长/词级转写/边界/关键帧/接触表），只描述「原片做了什么」，不含创作解释 |
| **素材元素 / AssetElement** | Editor 项目内的素材记录（扩展 `editor_assets`）+ 其 `attrs`/`content`/`recipe`；`media`、`graphic` 等类型共用同一模型 |
| **配方 / Recipe** | 素材元素的确定性生成/构建参数（kind/capability/model/output/references/componentBrief），计划态即拥有 |
| **计划态 / planned** | Editor 本地状态：有意向、有配方、无全局资产、无 job、不花钱 |
| **物化 / materialize** | 把计划态推进为真实字节（生成资产或组件），即触发生成 → completed / verified |

## 3. Layer 1：全局参考理解工具 + 全局 skill

### 3.1 交付形态

| 交付 | 位置 | 说明 |
|---|---|---|
| **全局工具** | `service/media`（MCP `recut.media.*`） | 平台媒体能力，任何 App 可调；不依赖 Editor/Runtime Profile |
| **全局 skill** | `service/skills/recut-reference/`（SKILL.md + references） | 回答「怎么读懂一支参考并留下可复用证据」；放入即被 `service/recut_skills.go` 自动发现，无需改 Go |

复用点（为何是全局）：`apps/editor` 克隆、`recut-director/references/remix` 仿拍、`recut-worlds` 参考实体、`apps/cover-studio` 参考封面、`apps/ai-short-film` 资料研究。

**全局 skill 的工具引用边界**：与 `recut-worlds` 引用 `recut.worlds.*` 同理，全局 skill **可以**引用平台级工具（`recut.media.*`），**不得**引用任何 App 私有 op。

### 3.2 全局 skill `recut-reference` 的内容契约

```text
service/skills/recut-reference/
  SKILL.md                唯一决策问题：怎么读懂一支参考并留下可复用证据
  references/
    reading.md            整片↔细节的读法（whole-piece 与 close reading 互证）
    evidence.md           ReferencePack 契约与项目文件布局
    tools.md              recut.media.* 各工具用法、参数、失败诊断
    transferable.md       「可迁移 vs 不可复制」的判据（与 director/remix 交界，指向 remix）
```

- 与 `recut-director/references/remix` 的分工：**`recut-reference` 负责「看懂并留证据」，`remix` 负责「迁移什么、选哪段」**；`remix` 的输入证据由本 skill 产出。
- 与各 App 的关系：App 的 `references/clone.md` 等薄适配层指向本 skill，不复制其内容。

### 3.3 工具清单

| 工具 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `recut.media.probe` | assetId | `{durationSec,width,height,fps,hasAudio}` | ffprobe |
| `recut.media.words` | assetId / transcriptAssetId | 词级转写资产（见 3.4） | 可选；复用 audio-studio ASR 的词级输出，默认关闭 |
| `recut.media.boundaries` | assetId, `{threshold?}` | `[{atSec, kind:"hard-cut", thumbnailAssetId?}]` | ffmpeg scene detect；文档标注对渐变/手势转场不可靠 |
| `recut.media.frames` | assetId, `{atSec[] \| interval+range}` | `[{atSec, assetId}]` | 抽帧入库 |
| `recut.media.contactSheet` | assetId, `{range, interval, columns, cellPx, transcriptAssetId?}` | 单图 assetId | **带时间码；可叠词标签**（对齐 Hypit `tile --transcript`） |
| `recut.media.clip` | assetId, `{startSec, endSec}` | 视频资产 | 源片段（动作证据 / B-roll 候选） |
| `recut.media.measure` | text 或 script 片段 | `{estimatedDurationSec}` | 纯本地朗读时长估算，不调模型 |

> ingest 不新增 op：复用 `recut.files.fetch` + `recut.media.import_url`，并在 `tools.md` 固化「链接/文件 → 参考 assetId」的推荐路径与体积/公网限制。

### 3.4 词级时间（可选增强，不是内容理解的前提）

**先厘清一个常见误解**：理解参考片的内容，**段落级转写就够了，不需要词级**；词级也不是一套 XML 标记，而是 ASR / forced-alignment 自身的一种输出——Whisper 原生给出 token 时间，whisperx 再做强对齐校准，存成 `segments[].words[]` 数值数组即可，**无需任何 markup**。

词级唯一买的是**精度**：把「一个画面 / 图形 / 音效 / 要删的口癖」精确钉到某个具体的词，以及把切点落在词边界。这是段落级做不到的；「秒级」也不够，需要亚秒（典型 ±50–200ms）。

对克隆要分清两个对象：

| 对象 | 词级的作用 | 是否必需 |
|---|---|---|
| **参考片** | 提高「某个图形/镜头响应的是哪个词」的分析精度 | 可选；段落级同样能读懂内容 |
| **目标片（新配音 / A-roll）** | M4 锚点：字幕、图形、删词精确绑定到词 | M4 需要；首版不需要 |

- 存储：transcript 资产 `segments[].words[] = { text, startSec, endSec }`（兼容：无 `words` 时按段落用）。
- 产出：audio-studio `audio.transcribe` 增 `wordTimestamps` 选项；Editor 经能力桥读取（复用 `subtitle.generate` 同一条桥）。
- **默认关闭**：未启用时 Layer 2/3 按段落 / 秒定位；只有「卡拉OK 字幕 / 词级图形绑定 / 单词口癖删除」才开。

### 3.5 解耦硬要求（可单独测试）

1. **纯函数与 IO 分离**：时间/区间/标签/网格布局/边界解析为纯函数（无 ffmpeg、无文件系统），单测覆盖；ffmpeg/ffprobe 调用集中在单一 adapter 层。
2. **不依赖 Editor、不依赖时间线、不依赖 Runtime Profile**；命令式执行，不建 Build。
3. **产物一律 assetId 或项目文件路径**，不返回内存图像。
4. **失败带可诊断错误**（缺 ffmpeg / 缺文件 / 无音轨 / 区间越界），不静默降级。

### 3.6 ReferencePack（证据契约，非解释）

Layer 1 结束时产出可归档的证据包，落到项目文件（`references/<ref>/`）：

```jsonc
ReferencePack {
  source:   { assetId, url?, durationSec, width, height, fps, hasAudio },
  transcript: { assetId, language, wordLevel: bool },
  boundaries: [{ atSec, kind, thumbnailAssetId? }],
  keyframes:  [{ atSec, assetId }],
  sheets:     [{ range: [startSec,endSec], assetId, transcriptAssetId? }],
  clips:      [{ startSec, endSec, assetId, label? }]
}
```

**红线**：ReferencePack 只装「观察」。`format/hook/beats/transferable` 这类**解释**由 Agent 在 Layer 2/3 产出，不写进证据包。

## 4. Layer 2：素材元素（AssetElement）挂在 Editor 素材层

### 4.1 定位

**素材元素 = Editor 项目内的一个素材元素记录 + 它的创作信息**，落在 **Editor 素材层**（扩展 `editor_assets`，其头注释本就写明「保留未来 media/reference 类型的统一入口」）。项目通过素材元素引用全局资产或组件；**全局媒体资产仍是字节与生命周期的唯一真相**，素材元素只持有它的引用。

为什么不挂全局 `media_assets`：**MotionGraphic 也需要同一套属性，而 MG 是 Editor 自有的组件资产，不是全局媒体资产**。把属性放在 Editor 素材层，media / MG / speech / caption 才能用同一个模型表达；「全局资产属性模型」是否需要统一，留待后续（见 §11）。

它统一两类经济学相反的素材：

- **代码可渲染**（MG / Caption）：`planned → component.create → verified`，免费、确定性、本地；
- **模型生成**（A-roll / B-roll / Voice / Music / SFX）：`planned →（触发生成时创建/绑定全局 proposed 资产）→ confirm → queued → completed`，花钱、需批准。

### 4.2 数据契约（扩展 `editor_assets`）

`editor_assets` 从「引用索引」升级为「素材元素索引」：主键 `asset_id` 改为稳定生成 id（`ae_<ulid>`）；已有 component 行迁移为 `kind='graphic'`、`ref_id=componentId`。新增列：`kind`、`role`、`attrs_json`、`content`、`recipe_json`、`state`、`media_asset_id`、`ref_source_json`、`anchor_json`。

```jsonc
AssetElement {
  assetId: "ae_01J...",              // 稳定 id（主键）
  projectId,
  kind: "media" | "graphic" | "speech" | "audio" | "reference",
  role: "a-roll" | "b-roll" | "mg" | "caption" | "voice" | "music" | "sfx",
  name,
  attrs: [ { "key": "shotKind", "label": "镜头", "type": "text", "value": "产品喜剧" } ],
  content: "提示词 / 文稿 / 说明（markdown，长正文）",
  recipe: {
    kind: "generation" | "component" | "text",
    capability: "image.generate",           // generation
    modelId: "gpt-image-2",
    provider: "atlas-cloud",
    output: { "aspectRatio": "1:1", "resolution": "1K", "durationSec": null },
    references: [ { "id": "asset_a1", "kind": "image", "role": "prop", "label": "我的产品" } ],
    componentBrief: "...",                  // component
    promptFrom: "content"
  },
  state: "planned" | "proposed" | "queued" | "running" | "completed" | "failed" | "archived",
  mediaRef:    { assetId: null },           // 物化后指向全局媒体资产
  componentRef:{ componentId: null, versionId: null },   // MG 物化后
  refSource:   { assetId: "asset_ref_xxx", startSec: 12.4, endSec: 15.1 } | null,
  anchor:      { kind: "word" | "segment" | "moment", id: "" } | null,   // M4
  createdAt, updatedAt
}
```

- **attrs 与 Entity 同构**（09-09）：有序 typed key-value，`{key,label,type,value,options?,locked?}`，`type ∈ text|textarea|number|boolean|select|media|ref`。承载理解/角色（`role/subject/setting/shotKind/style/keepReplace`）、生成参数（`aspectRatio/resolution/durationSec`）、溯源（`refSourceLabel/transferable`）。
- **content 是长正文**，不塞进 attrs，避免 attrs 变成散装 JSON。
- **生成类**在触发生成时创建/绑定全局资产：`mediaRef.assetId` 指向 09-16 的 proposed 资产，`recipe` 的 generation 视图写入其 `metadata.proposal`（复用既有提案，不另造）。素材元素的 `state` 对生成类是其生命周期投影，真相仍在全局资产。
- **MG（graphic）** 不经全局资产：`componentRef` 指向 `editor_components`，源码仍由组件系统拥有，本 RFC 不合并实现存储，只统一计划载体。

### 4.3 素材元素 ≠ 组件源码 / 全局资产

素材元素是**计划载体**，不是实现存储：MG 的源码仍在 `editor_components`，生成类的字节仍在全局 `media_assets`。素材元素只持引用（`componentRef` / `mediaRef`），编辑它不触碰实现层。

### 4.4 生命周期

```
planned（Editor 本地，无全局资产、不花钱）
   │  触发生成
   ├── generation ──> 创建/绑定全局 proposed 资产 ──confirm──> queued ──> completed
   ├── graphic    ──> component.create ──verified──> completed          // 免费
   ├── text       ──> 本地物化（排版），无生成
   └── reject（软删墓碑）
```

- **`planned` 是 Editor 本地状态**：不落全局资产、不写 `media_jobs`、不消耗 provider；克隆的计划阶段全程停在这里。
- **触发生成**才创建/绑定全局 proposed 资产（09-16）；此后生成类素材元素的 `state` 是全局资产状态的投影，真相在全局。
- `confirm` 复用同一全局 `assetId`，时间线引用无需重指；`graphic` / `text` 的物化不消耗生成额度。
- **确定性**：
  1. `recipe` 按固定字段顺序 canonical 序列化得 `recipeHash`，同 hash 视为同一请求，可复用已完成产物，避免重复计费；
  2. 无墙钟/随机量进入 recipe 或 attrs；
  3. `references` 顺序即提交顺序，role↔kind 在 propose/confirm 两处自检 fail closed（复用 09-15/09-16）；
  4. `video.generate` 强制 propose，其他按 `requiresProposal`；`confirm` 是唯一花钱动作。

### 4.5 素材元素如何变成 clips

- 物化后，`timeline.placeComponents`（graphic）、`timeline.placeAudio`（voice/music/sfx）、`timeline.command insert`（media）落轨；element 的 `assetId` / `componentId` 指向该素材（全局资产或组件）。
- **element 保持薄**：不新增克隆字段。`timeline.read` 在 clip 上回传 `assetId`（已有）与可选 `assetElementId`；详细 attrs/content 经 `assetElement.get` 按需读取（渐进下钻，照顾 48KB 预算）。
- 时间排布：首版按「源片段秒数 / 计划时长」顺序铺（复用 `film.package.import` 的 cursor 逻辑，但支持多场景与来源对齐），M4 引入 anchor 后改为语义编译。

### 4.6 不变式

- 素材元素的 attrs/content/recipe 变更不触碰时间线；落轨后只改引用目标。
- `role` 与 `recipe.kind` 必须匹配（受控矩阵），非法组合 fail closed。
- `planned` 的素材元素绝不出现在导出物化路径上（导出前若存在 planned，视为未完成，不得声称交付）。
- 全局资产是字节真相，组件是 MG 源码真相；素材元素不复制二进制与源码。

## 5. Layer 3：Skill 封装（apps/editor）

### 5.1 intent / route 扩展

在 `apps/editor/skills/recut-editor/SKILL.md` 的 `new-authoring` 下新增 route `clone`：

| intent | 识别信号 | 首要动作 | 默认行为 |
|---|---|---|---|
| `new-authoring`（route=`clone`） | 用户提供参考视频/链接，要求「做成我的版本 / 换主体换产品换语言」 | 先建 ReferencePack 证据，再产计划素材元素 | 不复制源台词/构图/肖像；逐阶段确认 |

`clone` 是 `new-authoring` 的一种 route（不新增 intent）；决策指向 `recut-director/references/remix`，理解指向全局 `recut-reference`。

### 5.2 `references/clone.md`

新增 `apps/editor/skills/recut-editor/references/clone.md`，作为**薄适配层**（只写「怎么落到 editor 介质」）：

1. **理解**：按全局 `recut-reference` 调用 `recut.media.*` 建 ReferencePack，写 `references/<ref>/`；用带词码的接触表逐段读懂，写 `analysis.md`/`timeline.md`。
2. **抽象**：按 `remix` 判断「保留/替换」，整理成**计划素材元素清单**（role / attrs / content / recipe / refSource），写 `clone-plan.md` 供审阅。
3. **批准**：计划的展示与批准是硬门槛，未批准不生成。
4. **生成**：逐元素物化（component 走 `component.create`；media 走 propose→confirm）。
5. **落轨**：按计划排布到时间线，validate + settled-frame proof。
6. **交付**：`export.start` 后观察到终态；「Done means watched」。

`clone.md` 明确声明**不重复** reference/remix 的内容，也不引入 XML/锚点语法。

### 5.3 门禁

| 门 | 内容 | 不通过时 |
|---|---|---|
| G1 理解门 | ReferencePack 完整（至少 probe + 转写 + 一组证据帧） | 不可进入计划 |
| G2 计划门 | 计划素材元素齐全、role/kind 合法、有 refSource | 不可生成 |
| G3 付费门 | 用户批准账号/范围/预算；video 强制提案 | 不可 confirm |
| G4 落轨门 | timeline.validate 零违规 + 受影响 settled frame 通过 | 不可导出 |
| G5 交付门 | 实际观看成片 | 不得声称完成 |

## 6. 端到端走查（30s 参考视频 → 我的产品版本）

1. 用户给链接 + 「换成我的产品，保留排名格式」。
2. G1：`files.fetch` 入 assetId → `probe` → `words`（词级）→ `boundaries` → `contactSheet`（叠词码）→ 必要处 `clip`。写 `references/ref-xxx/`。
3. Agent 读证据，按 `remix` 判断：保留「榜单逐项揭示 + 卡词揭示」结构，替换主体/产品/台词。
4. 产计划素材元素（全部 `state=planned`，Editor 本地、不花钱）：1 个 a-roll（recipe.kind=generation, video.generate + 角色参考图 + refSource 口播段）、1 个 voice（speech.generate + 音色）、8 个 b-roll（image/video.generate + refSource 对应词段）、1 个 mg（recipe.kind=component，榜单板）、1 组 caption（recipe.kind=text）。写 `clone-plan.md`。
5. G2/G3：用户审计划、批准预算。
6. G4：confirm → 生成（复用同一 assetId）；物化落轨；validate + preview 抽检。
7. G5：导出并观看；计划与配方留档，后续可按 `recipeHash` 只重生成改动元素。

## 7. 与现有 RFC 的关系

- **2026-08-29-global-directing-skills**：Layer 1 的全局 skill 遵循其「唯一性原则」与「全局层不调用 App 私有工具」的边界，形态对齐 `service/skills/recut-design-system`，放入即自动发现。
- **2026-09-16-media-generation-proposal**：Layer 2 的 `proposed` 生命周期、`confirm` 复用 assetId、门禁**直接复用**，只在其 `metadata` 上扩 `element`。
- **2026-09-15-generation-reference-protocol**：`element.recipe.references` 与其 role 词表、resolver 顺序、fail-closed 对齐。
- **2026-09-09-unified-entity-model**：`attrs` 复用 Entity 的有序 typed key-value 范式，不引入第二套属性模型。
- **2026-08-21-ai-narration-audio-asset-lifecycle**：`timeline.placeAudio` / 可播放性校验是语音类素材元素落轨的既有通道。
- **2026-08-19-editor-ai-video-authoring-quality**：`clone` 是其 route/treatment 体系的新增 route，沿用 atomic transaction、门禁与预览/导出门。

## 8. 里程碑

| 里程碑 | 目标 | 交付 | 验收 |
|---|---|---|---|
| **M0 Layer 1（全局工具 + 全局 skill）** | 参考理解可解耦、可单测、跨 App 复用 | `media.probe/words/boundaries/frames/contactSheet/clip/measure` + 纯函数单测 + ffmpeg adapter；`service/skills/recut-reference/`（SKILL.md + references） | 给一段 30s 视频，产出完整 ReferencePack（稳定 assetId）；核心纯函数单测全绿；不依赖 Editor/Runtime；`recut.skills.list` 能发现 `recut-reference` |
| **M1 素材元素（全局资产扩展）** | 素材有属性/正文/配方/计划态 | `metadata.element` 契约 + 读写 op（复用 `media.propose/update_proposal`，新增 `attrs/content` 字段）；`recipe.kind` 路由 | 创建计划态素材元素（无字节、无 media_jobs、无花费）；attrs/content/recipe 往返一致；`proposed` 资产读得到 `element` |
| **M2 克隆计划** | 证据 → 计划素材元素 + 审阅 | `clone.md` 与 `clone-plan.md` 产出；计划门 G2 | 30s 参考 + 「换主体/产品」→ ≥N 个计划元素，含 role/attrs/content/recipe/refSource；全程无生成花费 |
| **M3 物化与落轨** | 批准后才生成并落时间线 | proposed→confirmed→completed 贯通；component/text/generation 三路由；placeComponents/placeAudio/insert；G4 | 批准前零花费；批准后按 `recipeHash` 不重复计费；最终时间线 validate 零违规 + settled frame 通过 |
| **M4 锚点与变体（推迟）** | 可复跑模板 / 一变多 | `element.anchor` + 元素绑定 + 确定性编译（Preview==Export） | 改一段文案 → 字幕与相邻 B-roll 自动重排；导出与预览一致；无锚点元素行为不变 |

M0 与 M1 可并行；M2 依赖两者；M3 依赖 M2；M4 独立可后置。

## 9. 受影响契约

- **platform media capability**：新增 `recut.media.probe/words/boundaries/frames/contactSheet/clip/measure`；transcript 资产 schema 增可选 `segments[].words[]`。
- **`media_assets.metadata`**：新增 `element`（role/attrs/content/recipe/refSource/anchor）；既有 `proposal` 作为 generation 视图兼容读取。**不改 `media_assets` 状态机**（`proposed` 即计划态）。
- **MCP**：`recut.media.list_assets` / `propose` / `update_proposal` 的读写字段扩 `attrs`/`content`/`recipe.kind`（向后兼容，缺省不出现）。
- **全局 skill**：新增 `service/skills/recut-reference/`（`recut_skills.go` 自动发现，无需改 Go）；`recut.skills.list/read` 可见。
- **editor App**：新增 route `clone` 与 `references/clone.md`（薄适配）；`timeline.read` 输出增 `assetId` 关联（已有 `assetId`，无需新增字段）。
- **能力桥**：`audio.transcribe` 增 `wordTimestamps`（可选），不影响既有调用。
- **无迁移**：不新增表、不改 `editor_assets` 用途（组件索引保持原样），不建 ReferencePack 持久表（证据落参考素材 facet）。

## 10. 非目标

- 不引入 SVML/SVS 或任何 XML/DSL 中间语言；不引入 Author Package/npm 分发。
- 不新增平台一等对象，不建 Production/ReferencePack 表；素材元素不建项目态副本。
- 不合并组件源码存储（`editor_components` 保持独立），只统一计划载体。
- 不重写时间线/场景/选区模型；不动渲染与关键帧系统。
- 首版不做语义锚点、一变多、批量变体渲染（M4）。
- 不做云端批量渲染；不变更既有提案门禁与导出路径。

## 11. 风险与未决问题

1. **词级时间的代价**：它只影响**定位精度**，不影响内容理解；默认关闭。需评估「卡拉OK / 词级绑定 / 单词删除」这类场景真正需要时才产出的产物体积与 UI 复杂度。
2. **边界检测准确率**：ffmpeg scene detect 对渐变/手势转场不可靠。首版如实标注置信度，是否引入更重模型留 M0 决策。
3. **metadata 膨胀与跨项目语义**：素材元素挂在全局资产上，`element` 会随资产被别的项目读到。缓解：`element` 只存可复用创作信息（角色/来源/配方），项目私有语义用 attrs 的 scope 字段；必要时在读取侧按项目过滤展示。
4. **计划态被误用**：`proposed` 资产若被落轨或导出会产出空缺。缓解：不变式「计划态不入物化路径」，导出前校验并拒绝。
5. **`film.package.import` 复用程度**：现实现顺序累加、单场景；是否升级为通用「计划包 → 时间线」入口，或仅在 clone 内另建排布逻辑，留 M3 决策。

## 附录 A：示例计划素材元素（`metadata.element` 节选）

```jsonc
{
  "id": "asset_ae_broll_hattrick",
  "status": "proposed",            // 计划态
  "kind": "image",
  "metadata": {
    "element": {
      "role": "b-roll",
      "attrs": [
        { "key": "role", "label": "角色", "type": "select", "value": "b-roll", "locked": true },
        { "key": "shotKind", "label": "镜头", "type": "text", "value": "产品喜剧 / 静物" },
        { "key": "transferable", "label": "迁移判断", "type": "textarea", "value": "保留「视觉双关」机制，替换运动鞋为我的产品" }
      ],
      "content": "A surreal visual pun rendered as a polished studio photograph: ... no text, no logos.",
      "recipe": {
        "kind": "generation",
        "capability": "image.generate", "modelId": "gpt-image-2",
        "output": { "aspectRatio": "1:1", "resolution": "1K" },
        "references": [{ "id": "asset_prod_01", "kind": "image", "role": "prop", "label": "我的产品" }],
        "promptFrom": "content"
      },
      "refSource": { "assetId": "asset_ref_xxx", "startSec": 12.4, "endSec": 15.1 }
    }
  }
}
```

## 附录 B：术语

- **参考 / Reference**：被克隆的原片素材。
- **参考证据 / ReferencePack**：对原片的结构化观察集合（无解释）。
- **素材元素 / AssetElement**：全局媒体资产 + `metadata.element`（attrs/content/recipe）。
- **配方 / Recipe**：确定性生成/构建参数；`recipeHash` 用于复用与幂等。
- **物化 / Materialize**：计划态 → 真实字节（生成资产或组件）。
- **计划门 / G2**、**付费门 / G3**：见 §5.3。
