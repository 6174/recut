<!--
 * [INPUT]: 依赖统一 Entity 模型（world_entity_types 预设类型/attrs/media）、World 详情面板引导动作
 *   （web/lib/world-entity/guided：entity-actions/cards/context/registry/types）、生成提示词参考引用协议
 *   （generation-reference-protocol 的 role 词表与 PROPOSAL_ROLES 三处镜像）、平台媒体生成（recut.image/video.generate
 *   + 图片直生 / 视频提案 gate）、媒体理解工具（recut.media.*）与 recut-director（references/shot、generation-prompt、short-drama）
 * [OUTPUT]: 定义「视频脚本（script）+ 一图 25 宫格分镜表（storyboard sheet）」的完整设计方案：① 新增 script 预设实体类型；
 *   ② 一图 N 宫格分镜表协议（网格等分 + R{r}C{c} 坐标 + panel manifest）；③ 引导动作改造（story.storyboard →
 *   25 宫格、story.script → script 实体、script.* 动作组）；④ 切格 → 细化 → 视频提案流水线（新增 recut.media.gridSlice
 *   原语 + storyboard role）；⑤ Director/Skill 引导；⑥ 风险与里程碑
 * [POS]: rfc 的分镜连续性决策；把「逐张零散分镜」升级为「一张宫格分镜表作连续性中枢，按坐标切格再逐格细化」，
 *   服务视频故事与视频脚本两条核心链路；不改生成/Canon 门禁与 @/reference 协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# 视频脚本与一图分镜表（Video Script & Storyboard Sheet）

- 状态：设计中，M1 待落地（2026-09-20）
- 日期：2026-09-20
- 关联：[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、[World 详情面板引导提示操作](./2026-09-15-world-entity-guided-ai-actions.md)、[生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)、`service/skills/recut-director/references/shot/SKILL.md`、`service/skills/recut-director/references/generation-prompt/SKILL.md`、`service/skills/recut-worlds/SKILL.md`

## 0. 摘要

视频创作的核心是**视频故事**与**视频脚本**：故事给内容，脚本给可生成规格，分镜是把脚本落成画面的桥。今天 World 只有 `story`（前提/关键时刻/情绪），缺一个面向视频生产的**脚本层**；而分镜动作 `story.storyboard` 只是「输出 6–8 格草图」，每次生成彼此独立、连续性靠运气。

本方案给出两个关键改动：

1. **新增 `script`（视频脚本）预设实体类型**：承载节拍、口播、目标时长、画幅/平台，与 `story` 以关系相连；分镜画面挂在 script 上。
2. **一图 25 宫格分镜表（storyboard sheet）协议**：用**一张图**把 N 个连续分镜一次性生成出来，每格带 `R{r}C{c}` 坐标与镜号；再**按宫格坐标切格**，逐格细化为正式关键帧与视频提案。

核心判断：**一张宫格图 = 一次生成内的连续性中枢**。模型在同一次生成里同时「看到」全部相邻格子，人物、服装、场景、光位在同一上下文内被自然对齐；而坐标标签让切格成为确定性像素运算，细化阶段以该格为构图锚点，从而把连续性从「祈祷一致」变成「结构约束」。

链：`story（故事） → script（视频脚本） → 25 宫格分镜表（一张图） → 按坐标切格 → 逐格细化关键帧 → 视频提案 → 时间线`。

## 1. 背景与问题

### 1.1 分镜的连续性不是「画得像」，而是「同一上下文」

逐张生成分镜时，每一张都是独立条件：模型看不到上一格，同一角色在 10 张图里会漂成 10 个人。把 N 格放进**同一张图、同一次生成**，相邻格共享画面上下文（同一光照、同一机位逻辑、同一角色），一致性显著更好；这也是真实分镜师做「storyboard sheet」的原因。

### 1.2 现状：只有草图层，没有可生产的脚本层

- 预设类型 `character/location/object/story/style/rule`（`service/worlds_canvas.go:122`）没有「脚本」。
- `story` 的字段（premise/moment/emotion）是叙事内核，不含时长/画幅/口播/节拍，生成视频时这些只能临时口述。
- `story.storyboard`（`web/lib/world-entity/guided/entity-actions.ts:558`）只产「6–8 格草图」，格数与连续性都不面向后续视频生成。

### 1.3 用户的直接诉求

> 1. 「生成分镜表」的提示词改成 **24/25 分镜画面**——用一张图把连续分镜直接生成出来。
> 2. AI-director 引导 AI：生成脚本分镜时按 **25 分镜方式拆解**，分镜标注 **x-y 位置**，再用分镜的**宫格位置**创建细化分镜画面。
> 3. 主场景是生成视频，核心是**视频故事 + 视频脚本**；可在 story 之外新增「视频脚本」通用类型，与分镜画面结合。

## 2. 目标与非目标

### 目标

1. 新增 `script` 预设类型，把「叙事」与「可生成规格」分层；提供 story → script 的转化入口。
2. 定义**一图宫格分镜表协议**：网格等分、`R{r}C{c}` 坐标、panel manifest，让分镜可被机器按坐标切分与细化。
3. 改造 `story.storyboard` 并新增 `script.*` 引导动作，让点击即产出「一张宫格 sheet」而非多张散图。
4. 定义**切格 → 细化 → 视频**流水线，新增 `recut.media.gridSlice` 原语与 `storyboard` 参考 role。
5. 在 `recut-director`（shot/generation-prompt/short-drama）内引导 AI 按宫格法拆解脚本。
6. 与既有门禁零冲突：图片直生、视频仍只落提案、写 Canon 需授权、`role` 受控词表三处同步。

### 非目标

- 不做画布内新的生成浮层或第二套 Agent 通道。
- 不改 `recut.worlds.*` 工具面与 `@/reference` 协议（仅扩展 role 词表）。
- 不做任意图像编辑（只做规则网格切分；局部重绘另议）。
- 不在 M1 引入逐格视频的自动编排（仍由 Agent 按 timeline 工具落位）。

## 3. 数据模型：`script`（视频脚本）预设类型

### 3.1 类型定义

沿用「类型目录 + locked 字段 + 可扩展 attrs」（统一 Entity 模型 §3）。新增：

| 层 | 位置 | 改动 |
|---|---|---|
| 常量 | `service/worlds.go` | `EntityTypeScript = "script"` |
| 字段 schema | `service/worlds_canvas.go` `presetEntityTypeFields["script"]` | 见下表 |
| 展示顺序 | `presetEntityTypeOrder` / `presetEntityTypeNames` | 插入 `script`（`视频脚本`） |
| 首选类型 | `availableEntityKinds`（`worlds.go:709`） | 在 `story` 后插入 |
| readiness | `worlds_readiness.go` `requiredFieldsByKind["script"]` | `{"logline","beats"}` |

建议 locked 字段：

| key | label | type | 用途 |
|---|---|---|---|
| `logline` | 一句话概括 | text | 这部片子是什么 |
| `beats` | 节拍 / 叙事结构 | textarea | story 前提 → 可拍节拍 |
| `vo` | 口播 / 旁白 | textarea | 逐字旁白（供 `speech.generate`） |
| `durationSec` | 目标时长 | number | 决定分镜格数 |
| `aspectRatio` | 画幅 | select（9:16 / 16:9 / 1:1 / 4:5） | 影响构图与切格 |
| `platform` | 目标平台 | select | 节奏与安全区 |
| `storyboard` | 分镜表 | media | **一图 N 宫格 sheet** |
| `background` | 背景 | media | 预设约定 unlocked |

> `storyboard` 作为 locked media 字段：其值仍用户可改（统一 Entity 模型 §3「locked 仅锁结构」）。

### 3.2 关系

- `script —(script_of)→ story`：脚本改编自/对应某条故事线。
- `script —(features)→ character / location`：出场角色与场景（用于生成参考锚定）。
- 沿用 `world_relations` 双向语义与受控词表；未命中时用中性 `references` 标签。

### 3.3 与 story 的分工

| | `story` | `script` |
|---|---|---|
| 回答 | 讲什么、为什么 | 怎么拍成视频、多长、什么规格 |
| 字段 | premise/moment/emotion | beats/vo/duration/aspectRatio/platform |
| 产物 | 叙事内核 | 分镜表 + 关键帧 + 视频提案 |

story 不强制、script 可选；小项目可只用 script。二者分离避免把「叙事」与「时长/画幅」耦合。

## 4. 一图 N 宫格分镜表协议

### 4.1 网格与坐标

- **默认 5×5 = 25 格**；按模型能力可配 `4×6=24 / 4×4=16 / 3×3=9`（弱模型降格）。
- 每个格子：左上角小号坐标标签 `R{r}C{c}`（行上→下、列左→右）+ 镜号 `#nn = (r-1)×cols + c`。
- **严格等分、细黑缝**：让切格退化为确定性像素运算 `[c·W/cols, r·H/rows, W/cols, H/rows]`。
- 每格画面：景别 + 机位/角度 + 主体动作一句话（粗糙草图/色稿即可）；全图共享 STYLE LOCK、同一角色/服装/场景/光位。

### 4.2 panel manifest（文本，不进图）

图内文字渲染不可靠，**景别/动作/时长/节拍/参考都放 manifest**（存 script 的 text attr 或 Agent 侧）：

```json
[
  { "panel": 1, "coord": "R1C1", "shot": "#01", "size": "全景", "angle": "平视",
    "move": "固定", "action": "主角推门走进雨夜电台", "durationSec": 3,
    "beat": "开场钩子", "refs": ["character:<id>", "location:<id>"] }
]
```

坐标标签只用于切片校验；Agent 切格后按 `coord` 把每格素材与 manifest 条目配对。

### 4.3 拆解纪律（复用 shot 技能）

25 格 ≈ 40–100s 视频（约 2–4s/格）。每 beat 分 3–5 格；一格一动作；一格一起止状态且首尾闭环——直接复用 `references/shot/SKILL.md` 的「一镜一动作 / 首尾帧即合同 / 轴线守恒」。

### 4.4 `storyboard` 参考 role

新增受控 role `storyboard`（image）：宫格 sheet 与其切出的单格都作 `storyboard` 锚点，用于逐格细化时的**构图/调度锚定**（区别于 `style-ref` 的纯风格职责）。三处镜像同步：`web/lib/media/proposal.ts` `PROPOSAL_ROLES`、`web/lib/world-entity/guided/types.ts` `GenerationRefRole`、`rfc/2026-09-15-generation-reference-protocol.md`。

## 5. 引导动作改造

`web/lib/world-entity/guided/`：

| id | 名称 | 类别 | 产出 | 说明 |
|---|---|---|---|---|
| `story.storyboard`（改） | 生成分镜表 | sheet | img/direct | 一张 N 宫格 sheet + manifest（原「6–8 格草图」） |
| `story.script`（新） | 展开为视频脚本 | text | canon-proposal | 把 story 转为 `script` 实体 |
| `script.storyboard`（新） | 生成分镜表 | sheet | img/direct | 由 script 生成 N 宫格 sheet |
| `script.panels`（新） | 按宫格切分并细化 | derive | img/direct | 切格 + 逐格细化关键帧 |
| `script.shotlist`（新） | 输出镜头表 | plan | text | 由 manifest 出镜号/景别/时长清单 |
| `script.vo`（新） | 生成口播配音 | sound | aud/direct | 由 `vo` 走 speech.generate |
| `script.keyframes`（新） | 逐格生成关键帧 | derive | img/direct | 每格一张正式关键帧 |
| `script.videos`（新） | 逐格生成视频提案 | plan | vid/proposal | batchId 归组，待用户确认 |
| `script.consistency`（新） | 跨格连续性检查 | qc | text | 对比相邻格，列偏差 |

`cards.ts` 增 `STORYBOARD_SHEET_LAYOUT` 常量（与人物卡/环境卡/物体卡同层），供 story/script 共用，保证 sheet 版式提示词单一来源。

## 6. 切格 → 细化 → 视频流水线

### 6.1 平台原语 `recut.media.gridSlice`

`recut.media.gridSlice({ assetId, rows, cols, gutter? })` → `{ panels: [{ r, c, coord, assetId, region }] }`，用已有 ffmpeg crop 实现（`service/media`）。理由：确定性像素切分比模型重绘可靠、可复用（contact sheet 同构）。M1 若不做工具，Agent 可用 vision 读坐标 + ffmpeg crop 兜底。

### 6.2 Agent 流程

1. `recut.image.generate` 生成 sheet（带该 script/环境的 `storyboard`/`environment`/`character`/`style-ref` 参考）→ assetId。
2. `recut.media.gridSlice` 切出 N 格。
3. 逐格 `recut.image.generate`：`imageAssetIds:[该格, characterRef, environmentRef, styleRef]` + manifest 构图/动作 → 去掉格线编号、提升分辨率的正式关键帧。
4. `recut.video.generate` 落视频提案（`batchId` 归组）。
5. 时间线组装。

### 6.3 落位与门禁

沿用 `recut-worlds`：图片/语音拿到 `assetId` 即落「节点 + 属性边」并写同名 media attr（`label` 一致）；视频只落提案、Agent 不代确认；切格是本地操作、不花钱。

## 7. Director / Skill 引导

- `references/shot/SKILL.md`：新增「一图分镜表（宫格压缩法）」——何时用、sheet 契约、坐标标注、展开步骤；路由表加资产 `references/shot/assets/storyboard-sheet-template.md`。
- `references/generation-prompt/SKILL.md`：role 词表加 `storyboard`；补「一图含 N 格 + 每格以坐标细化」的锚定规则。
- `references/short-drama` / `ai-storyboard-director`：补交接说明——镜头设计可直接压成「每场一张 N 格 sheet」再按坐标展开。
- `recut-director/SKILL.md`：剧情/短剧链改 `story → script → short-drama → shot`；可新增「故事视频（分镜驱动）」Mode 指向 `story → script → shot → generation-prompt`。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 25 格模型不稳（糊/串格/漏格） | 按模型能力 9/16/24/25 格；必要时按行分 5 张、每张 5 格 |
| 单格分辨率低（1024²/25 ≈ 200px） | 宫格只当**草图锚点**，成片关键帧必须逐格重生成，不放大 |
| 切格错位 | 严格等分 + 细缝；切前用 vision 校验坐标标签 |
| role 三处漂移 | 同步 `PROPOSAL_ROLES` / `GenerationRefRole` / 协议文档 |
| 预设类型扩散 | `script` 只在 story 后插入；readiness 与 `availableEntityKinds` 同步 |

## 9. 里程碑

| 阶段 | 交付 | 验收 |
|---|---|---|
| M1 | `story.storyboard` 改 25 宫格 sheet + `STORYBOARD_SHEET_LAYOUT` | 点击 → 输入框预填宫格提示词；单测通过 |
| M2 | `script` 预设类型（Go+web）+ `script.*` 动作 + `story.script` + director 资产模板 | 建 script 实体；动作预填正确 |
| M3 | `recut.media.gridSlice` + `storyboard` role 三处同步 + 逐格细化链路 | sheet 可切 N 格并逐格出关键帧 |
| M4 | 逐格视频提案 + 时间线组装 | 一场戏从脚本到视频提案端到端 |

## 10. 可测试点

- 单测（guided）：`story.storyboard` / `script.*` build 输出非空、含格数与坐标说明；`script` 动作按 `applies` 过滤。
- Go 测试：新增预设类型后 `entities` 默认 schema 含 `script` 字段；readiness 对 `script` 的 requiredKeys 生效；既有预设测试不回归。
- 端到端（M3）：sheet → gridSlice → 逐格关键帧，格数与 assetId 一一对应。
- 门禁：视频动作不直接生成；只读世界动作不写 Canon。
