<!--
 * [INPUT]: 依赖 rfc/2026-09-17-editor-clone.md（三层克隆总纲与 G1–G5 门禁）、rfc/2026-09-17-reference-understanding.md
 *   （参考理解工具与 recut-reference/recut-clone 两个全局 skill）、rfc/2026-09-19-asset-model-simplification.md
 *   （Asset = kind+status+content+attributes）、rfc/2026-09-20-video-script-storyboard-sheet.md（script 预设类型 +
 *   一图 N 宫格分镜表 + recut.media.gridSlice + storyboard role）、rfc/2026-09-15-generation-reference-protocol.md
 *   （<reference> 与 role 词表）、rfc/2026-09-16-media-generation-proposal.md（proposed 生命周期与确认权）、
 *   rfc/2026-09-14-rich-context-composer-protocol.md（@ 与 XML 引用）；platform media（recut.media.* 参考理解工具面、
 *   recut.image/video/speech.generate 能力面、recut.media.gridSlice）、service/skills/recut-clone（SKILL + workflow +
 *   anchors + placement）、service/skills/recut-reference、service/skills/recut-director（remix/shot/generation-prompt/b-roll/
 *   motion/captions/sound/editing/hooks/qc）、service/skills/recut-editor（video-generation/captions/timeline-workflow/data-model）、
 *   service/skills/recut-motion-graphic、World 实体模型（character 类型字段与 recut.worlds.get.references[] role 投影）
 * [OUTPUT]: 定义「克隆 = 一次导演化生成」的完整方案：① 用一次真实会话复盘定位七类根因；② 确立「AI 生成是一种可被导演的
 *   连续媒介」的核心判断（场景/连续段为素材单位、分镜图+分镜脚本→一次多镜生成、首尾帧与多参考续接、模型时长上限）；
 *   ③ 把 clone 中间协议收敛为 AI 直读的 markdown（Reference/Treatment/Plan/Assembly/Progress，意义优先、拒绝 XML/字段表）；
 *   ④ 在 clone 链路中补入导演段（remix → Treatment → shot → generation-prompt → 生产观看回路）；⑤ 场景媒介判定
 *   （generate/component/typography/hybrid/supplied）与 motion-graphic、上屏文案的接线；⑥ 参考/角色声线的完整接线
 *   （worlds.get.references[] role 表、video 走 references+audioAssetIds、World 增 voice_reference 字段与指引）；
 *   ⑦ 生成政策、G1–G5 门禁（新增 G2 计划门）、平台/工具契约修复、技能改动清单、M0–M4 里程碑与风险
 * [POS]: rfc 的「克隆执行与生成导演化」决策；承接 editor-clone 总纲与分镜表 RFC，把克隆从「一图一视频一声音的素材装配线」
 *   升级为「读懂参考 → 导演一支新片 → 用连续生成兑现」；不新增运行时引擎、不引入 XML/DSL 中间语言
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# 克隆的导演化生成：从「一图一视频」到分镜驱动的连续场景

- 状态：M0（技能/指引）与 M1（World `voice_reference` 字段 + `references[]` 声明 role + `world.md` 指引）**已实施**；M2–M4 待实施。M1 的 `references[]` 声明态需**重建并重启 Recut service** 后在运行中的 daemon 生效（旧 daemon 仍走推断）。
- 作者：Recut
- 日期：2026-09-22
- 关联：[Editor 克隆总纲](./2026-09-17-editor-clone.md)、[参考理解与克隆执行](./2026-09-17-reference-understanding.md)、[素材模型简化](./2026-09-19-asset-model-simplification.md)、[视频脚本与一图分镜表](./2026-09-20-video-script-storyboard-sheet.md)、[生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)、[富文本上下文输入协议](./2026-09-14-rich-context-composer-protocol.md)
- 复现会话：project `c8323fb54bec736787c826fc`（阿蛋深夜·AI搭子克隆测试，`recut.editor`）、World `6ab9ebc7ec45066f91c1c5dc`（阿蛋的深夜客厅）、参考 `b3993e9799e59b884b91bdaf`
- 决策范围：克隆工作流的导演过程、中间协议形态、素材单位与生成政策、场景媒介判定、参考/声线接线、World 字段与指引、门禁与技能修订；不新增渲染引擎、不引入 XML/DSL

## 0. 摘要

一次真实的「用 World 克隆抖音口播」会话暴露出的不是参数问题，而是**克隆链路的定位错误**：它把「AI 生成」当成一条素材装配线（一图 → 一段 5s 视频 → 一条配音），于是必然产出硬拼接、无连续性、无 motion-graphic、无上屏文案、无角色声线的成片。

核心判断（本 RFC 的唯一主张）：

> **克隆不是「参考 → 素材」的搬运，而是「读懂参考 → 重新导演一支新片 → 用连续生成兑现」。AI 生成的素材单位是一个可被导演的「场景/连续段」，不是一帧、一段 5s、一条音。**

由此给出四件事：

1. **补导演段**：在 `recut-clone` 的 S2/S3 之间硬插 `remix → Treatment → shot → generation-prompt` 的导演链，把 `references/shot` 与 `references/generation-prompt` 设为必经技能。
2. **改素材单位**：计划与生成以「段/场景」为单位；一段戏用**一次多镜连续生成**（Seedance 支持到 15s、多参考、首尾帧、视频续接）兑现，而不是 N 个独立 clip。
3. **中间协议是 markdown**：一份 AI 直读、意义优先的工作文档（Reference / Treatment / Plan / Assembly / Progress），不引入 XML/SVML 或字段表。
4. **接全参考**：从 `recut.worlds.get.references[]` 的 role 表构建锚定（character / environment / voice / …）；视频走 `references` + `audioAssetIds`；World 给 `character` 补 `voice_reference` 字段并修指引。

## 1. 背景与证据

### 1.1 会话事实（可复查）

| 事实 | 证据 |
|---|---|
| 续跑时先用了**错参考** `7b0e8446…`（url `…/video/7108307189999160612`，26.8s 蒙太奇），被用户纠正后才重新下载 | 用户消息「参考的视频不同了，你要重新下载视频」；新参考 `b3993e97…` 的 url `…/video/7548028834538589492` 与用户首条 `modal_id` 一致 |
| Plan 表 assetId 列**全程未回填**（6 关键帧 + 6 视频提案生成后仍为 `—`） | `/Users/chenxuejia/.recut/projects/c8323fb54bec736787c826fc/files/clone.md:66-76` |
| 6 段视频**全部 5s、`generateAudio:false`、只传 `imageAssetIds`** | 会话事件 `recut.video.generate` ×6（assetId `c2b826b1/5bcd58c4/1968502a/41d6dba6/7c154b11/c711903b`） |
| 角色**声线参考存在但未进入任何生成链路** | 参考 `3c919b7a…`（kind=audio，`worlds.get.references[]` 报 `role:"voice"`）；VO 实际用 CosyVoice2 默认音 |
| 声线在实体里是**匿名野字段** `属性-1551`（label 同名，type=media） | `recut.worlds.entities.get` 的 阿蛋 entity `attrs[]` |
| 环境就绪/重试摩擦：whisper-small 未装→失败→改 qwen3-asr-0.6b；TTS save 先失败后成功；yt-dlp 落盘后需搬进 workspace 才能 import | 会话 02:31 / 02:39→02:50 / 02:30 |
| 编辑器操作未带 `projectId` 时**静默返回空项目**（version 0 / projectId "" / stage brief） | 会话事件 4118/4121；末尾补 target 后拿到 version 188 |
| 用 `find ~/.recut/media -newermt` 猜 assetId→文件 | 会话事件 4053/4084/4102 |

### 1.2 与既有设计的关系

- `2026-09-17-editor-clone.md` 原设计本有 **Layer 2 计划素材元素 AssetElement**（`role/attrs/content/recipe/refSource/state=planned`）与 **G1–G5 门禁**（含 G2 计划门），以及 §6 走查示例（1 a-roll + 1 voice + 8 b-roll + **1 mg** + 1 组 caption）。
- 落地的 `recut-clone/SKILL.md:13` 明说**已精简**：「不再使用 content-first 占位素材，不再有独立 analysis/clone-plan 文档，不再做锚点升级往返」；`:95` 「无占位素材：计划只在 clone.md」。
- 结果：计划被压成一张 7 列表（`item|role|anchor|spec|refs|assetId|tlWindow`，`:69-77`），**装不下镜头意图、起止构图、连续性、媒介、上屏文案、recipe、refSource**；导演工作整体消失。
- `2026-09-20-video-script-storyboard-sheet.md` 已在 World 侧定义了 `script` 类型、一图 N 宫格分镜表、`recut.media.gridSlice`、`storyboard` role。本 RFC 复用其原语，补齐**执行侧**（clone 如何用它们导演与生成）。

## 2. 根因

### 2.1 定位错误：把生成当装配线，不是当媒介

模型（Seedance 2.0）能一次演完一段连续动作、多拍、带表演与运镜；平台能力面也齐备（`catalog_seed.go:88` mini 的 `Maximum:15`；`:144` 多参考 图≤9/视频≤3/音≤3；`:94` `returnLastFrame`；`mcp.go:2067` `videoAssetIds`；`mcp.go:155` `recut.media.gridSlice`）。但 clone 默认「一张关键帧 → 一段 5s」，把这些能力全部闲置。

**表现**：素材单位被定成「一镜＝一图＋一段 5s＋一条音」，只能硬拼；连续性、表演、长时长、MG/字幕媒介全部丢失。

### 2.2 没有导演过程

hypit 的链条是 `Brief → Treatment（导演的答案）→ Direction（逐素材的表演/镜头意图）→ Composition → Watch/Refine`。clone 只有 `参考 → keep/replace 表 → 一句画面描述 → 生成 → 落轨`。缺：

- **Treatment**：没有先定「这支新片要让观众体验什么」，于是每镜只是「把这一句话画出来」。
- **Direction**：prompt 是物体/动作清单，不是可表演的意图（态度、关系、哪句落一个动作）。
- **shot 结构与连续性**：没有节拍表、分镜表、首尾帧合同，没有「一段连续动作用一个 request」的取舍。
- **生产观看回路**：生成后不「看一遍再决定怎么改」。
- **媒介判定**：默认全部 `video.generate`，信息/数据/排版/标题场景没有走 motion-graphic。

### 2.3 参考/声线接线断裂（World 字段 + 技能政策）

- `recut-clone/SKILL.md:87`：**「角色/世界/风格参考一律放 `imageAssetIds`（image 能力只读该字段），不要放 `references`」**——这是 **image 专用**规则，被套到 video 上后，视频生成既不传 role，也永远不可能带声线/音频参考。editor 的 `video-generation.md:41` 恰恰要求 video 用 `references:[{id,kind,role,label}]`。
- World `character` 类型（`entityTypes.list`）字段只有 `appearance/personality/voice(textarea)/invariants/人像(options:["image"])/background`——**没有语义化的 `voice_reference`（media, audio）字段**；真正的声线音频落在自动 key `属性-1551`，`entities.get` 里读不出语义；文本 `voice`（语气描述）与「声线参考」同名异义。
- World `world.md`/`constraints` 只要求传**人像/场景图**，音频只提「环境底 + 极简钢琴」；**从未要求把角色声线传入生成**。「按指引执行」的结果就是不传。
- 结果：`role:"voice"` 只在 `worlds.get.references[]` 以 `roleInferred:true` 推断出现，生成调用却完全忽略。

### 2.4 计划载体太薄 / 不回填

Plan 表的列结构承载不了导演信息（见 §1.2）；且「拿到 assetId 立即回填」未被遵守，续跑即丢失映射、存在重复生成风险。

### 2.5 门禁错位

`recut-clone/SKILL.md:38-43` 用「一次性花费门 + 交付门」替代了 RFC 的 G1–G5；**没有 G2 计划门**，用户看不到、也改不了「这支片要成为什么」，只能审预算。

### 2.6 平台/工具契约缺口（次要但真实）

- 编辑器操作无显式 `projectId` 时静默返回「空项目」（应报错）。
- 视频确认门与「批准后连续推进到导出」的承诺自相矛盾（多段视频需多次人工确认）。
- 生成式 VO 的锚点契约不成立（`speech@` 需要转写，TTS 合成资产没有转写）。
- 用 `find -newermt` 猜 assetId→文件；应走 asset/job 返回的 path。
- 分析/关键帧产物被误挂项目（asset `811c5086…` 的 `projectIds` 含项目）。
- ASR/TTS 环境未预检（whisper-small 未装）。

## 3. 目标与非目标

### 目标

1. 把克隆定位为**导演化生成**：先导演，再生成；生成单位是场景/连续段。
2. 定义 **AI 直读的 markdown 中间协议**（Reference/Treatment/Plan/Assembly/Progress），意义优先，不引入 XML/字段表。
3. 在 clone 链路中补入**导演段**：`remix → Treatment → shot → generation-prompt`，并接入 `references/shot`、`references/generation-prompt`。
4. 用**一次多镜连续生成 + 首尾帧合同 + 多参考续接**取代硬拼接；把模型时长能力纳入设计。
5. 定义**场景媒介判定**（generate / component / typography / hybrid / supplied），接 motion-graphic 与上屏文案。
6. 接全**参考与角色声线**：role 表、video `references`+`audioAssetIds`、World `voice_reference` 字段与指引。
7. 恢复 **G2 计划门**；明确视频确认门是第二个人工门。
8. 修掉 §2.4–2.6 的契约缺口（回填、作用域、锚点、产物归属、环境预检）。

### 非目标

- 不新增运行时编译器/渲染引擎；不引入 SVML/SVS 或任何 XML/DSL 中间语言、Author Package 体系。
- 不改媒体生成的门禁经济学（图片直生、视频 proposal、确认权在用户）。
- 不重写时间线模型；落轨仍走既有 op。
- 不要求逐镜人工审片；只要求「先看代表段再批量」。

## 4. 核心判断：AI 生成是一种可被导演的连续媒介

### 4.1 生成单位是场景/连续段

- **视频模型 = 摄影师＋演员＋剪辑**：能一次演完一段动作、表演与运镜。图片只负责**身份/世界锚点**，不是每一镜的入口。
- **一段连续动作优先一个 request**；需要拆时按「动作/机位/世界状态」关系拆，并把人/物/世界用参考带过去。
- **模型能产出的时长 ≠ 源片段时长**，也**≠ 默认 5s**；据此设计段长与拆分。

### 4.2 确定性连续性用「分镜图 + 首尾帧合同」

- **一图 N 宫格分镜表**（`references/shot` 宫格压缩法 + `2026-09-20` RFC）：一张 sheet 把整段序列放进同一生成上下文，冻结角色/服装/场景/光位；`recut.media.gridSlice` 确定性切格。
- **分镜脚本（panel manifest）**：每格景别/机位/运动/动作/时长/节拍/refs；一格一动作；**一格起止状态＝该镜首尾帧合同，下一格起始＝上一格结束**。
- **首尾帧即合同**（`references/shot/assets/keyframe-prompt-template.md`）：kf-first 是上一镜结束状态，kf-last 只在「结束是一张不同的照片」时生成；kf-first/kf-last 共享槽位逐字复用。

### 4.3 三类生成关系要选对

| 关系 | 何时用 | 平台接线 |
|---|---|---|
| reference-directed | 身份/世界/风格/产品连续性重要；镜不需精确端点 | `references[{id,kind,role}]`（`image`/`video`/`audio`） |
| first-/last-frame | 起/止画面本身是设计的一部分 | 关键帧 + 首尾帧参数（模型能力）；`returnLastFrame` 取尾帧 |
| text-directed | 不依赖既有视觉身份，需要变化 | 纯 prompt |

跨段续接：上一段产物作为 `videoAssetIds` 参考，或用 `returnLastFrame` 的尾帧作下一段首帧。

### 4.4 示例（阿蛋，同一段戏两种做法）

| | 现状（装配线） | 本 RFC（导演化） |
|---|---|---|
| 段 A（0–15s，拍 1–3） | 3 关键帧 + 3×5s 独立 clip | 1 张 3 格分镜图 + 分镜脚本 → **1 次 15s 多镜生成**（内部硬切） |
| 段 B（15–30s，拍 4–5） | — | 接段 A 尾帧的 **1 次生成** |
| 拍 6 记录卡 | 一句「mg/caption」含糊行 | **motion-graphic 组件**（信息上屏） |
| 独白 | 本地 TTS 默认音 | World 声线参考 → 声音角色 → 合成 |
| 产出 | 6 图 + 6 视频 | 2 分镜图 + 2 视频 + 1 组件 |

## 5. 中间协议：AI 直读的 markdown（意义优先）

### 5.1 只保留必要文档，每份一个职责

| 文档 | 职责 | 载体 |
|---|---|---|
| `BRIEF.md` | 用户目标、受众、约束、**已批准的付费范围** | 普通 markdown |
| `reference.md` | 参考**为什么有效**：整片机制 + 带源时间的节拍 + **上屏文案/字形/位置/强调系统** + 可迁移/不可复制 | markdown（可 @ 证据素材） |
| `TREATMENT.md` | **导演的答案**：创意前提、观众体验、情绪走向、逐拍意图、**逐场景媒介意图**、连续性、声音、上屏文字系统 | markdown，导演语言 |
| `PLAN.md` | 分镜计划：**以「段/场景」为单位**（见 §5.2），每条写意图/镜头/起止状态/媒介/参考/锚点/directing brief | markdown，句子而非字段 |
| `PROGRESS.md` | 当前问题、待办、当前 assetId、下一步 | markdown |

要点：**不追求结构**。文档是给 AI 理解意义的，允许叙述、判断、理由并存；Plans 可以是「一段话 + 若干条目」，不要求统一字段。参考的**事实**（观察）与**解释**（判断）在文内可读地区分即可。

### 5.2 Plan 的单位是「段/场景」，不是素材

Plan 每条 = **一个生成任务**（一段戏 / 一场 / 一个 MG）及其内部 shot 列表：

```md
### 段 A（0–15s｜生成｜含拍 1–3）
意图：把「我什么都没干成」演出来，让观众认出自己；不是讲道理，是让人被一杯热水的热气叫回。
连续性：阿蛋/蓝沙发/冷屏光在段内由同一次生成固定；段尾「手机暗下」＝段 B 首帧。
分镜（同一次生成内的硬切，非独立 clip）：
  1. 瘫坐刷手机，冷屏光映脸，固定＋极缓推近（起：手机举眼前 / 止：手指停住）
  2. 转头望向左扶手冒热气的黄杯（唯一暖黄）
  3. 盯着资料与绿植不动手，肩缩一下
生成关系：reference-directed（阿蛋人像 + 客厅 + 分镜图 role=storyboard）
锚点：clock 0–15s
```

### 5.3 场景媒介判定（generate / component / typography / hybrid / supplied）

| 价值落在哪 | 媒介 | 产物 |
|---|---|---|
| 世界/人物/表演/摄影/材质 | `generate` | video/image.generate |
| 信息/关系/数据/流程/标题/UI | `component` | motion-graphic（组件） |
| 上屏文字/强调/独立书写 | `typography`/`caption` | 字幕轨 / 文本元素 |
| 底片 + 图形解释两层 | `hybrid` | shot + component overlay |
| 已有素材 | `supplied` | 直接引用 assetId |

**硬约束**：给每个场景先定媒介再写 prompt；信息/数据/排版类场景默认 `component`，不得降级为 b-roll 或塞进一句字幕。

### 5.4 上屏文案要作为一等设计对象

参考的文案往往**就在画面上**（逐句字幕、强调大字、数据卡排版）。生成图必须**禁止烧字**（图像模型的中文渲染不可靠），但**文案要作为独立层被设计**：
- `Reference` 里记录其句子/层级/位置/强调规则；
- `TREATMENT.md` 定「全片文案系统」（字级、强调纪律、每屏一信息）；
- `Plan` 里明确每处文案是 caption / typography / MG 的哪一种；数据卡、记录卡等走 motion-graphic。

## 6. 导演过程：阶段 / 载入 / 产物 / 门

| 阶段 | 导演动作 | 载入技能 | 产物 | 门 |
|---|---|---|---|---|
| 读懂参考 | 反推为什么有效；**拆上屏文案系统** | `recut-reference` + `director/remix` | `reference.md` | G1 理解 |
| **Treatment** | 定这支新片是什么：前提/体验/逐拍意图/媒介/连续性/声音/文案系统 | `director/{remix,hooks,b-roll,captions,sound}` | `TREATMENT.md` | — |
| **分镜** | 逐场景定景别/机位/运动/**起止状态＝连续性合同**；决定一次连续生成还是拆镜 | `director/{shot,generation-prompt}` | `PLAN.md` | **G2 计划** |
| **directing brief** | 把意图翻成模型能演的指令（态度/表演/关系/镜头） | `director/generation-prompt` | `PLAN.md` 条目 | — |
| 生成 loop | 先出代表段/代表镜 → **看表演/连续性/构图** → 调 → 再批量 | `recut-editor/video-generation` + preview | 回填 assetId | G3 付费 |
| 组装审片 | 按锚点落轨；整段看图形/字幕/B-roll | `recut-editor` + `director/qc` | `Assembly` 记录 | G4 落轨 |
| 交付 | 实际观看后报告 | `recut-editor/preview-export` | — | G5 交付 |

对照现状：**缺 G2、缺 Treatment、缺 shot handoff、缺 generation-prompt 的多镜规则**。

## 7. 参考与角色声线的完整接线

### 7.1 从 World 的 role 表构建锚定

`recut.worlds.get` 的 `references[]` 已经给出 `{id, kind, role, label, entityId}`（含 `role:"voice"`）。克隆必须先读它，构建锚定表：

| role | kind | 用途 |
|---|---|---|
| `character` | image | 身份锚定（画面含主角色时必传） |
| `environment` / `style-ref` | image | 场景/风格锚定 |
| `prop` | image | 道具/产品事实 |
| `voice` | audio | 角色声线 |
| `sfx` / `music` | audio | 音效/配乐 |

### 7.2 提交口径（区分能力）

- **图片**：`imageAssetIds`（image 能力只读该字段）。
- **视频**：`references:[{id,kind,role,label}]`（含 audio role）+ 需要模型发声时 `audioAssetIds`；`generateAudio` 必须与「这一镜有没有台词」一致。
- **语音/TTS**：有 World 声线时，必须用该声线（参考音 → 声音角色 → 合成），不得静默用默认音。

> `recut-clone/SKILL.md:87` 必须拆成「图片走 imageAssetIds / 视频走 references+audioAssetIds」两句，删除「不要放 references」的通用措辞。

### 7.3 World 侧改动

1. **`character` 类型新增 `voice_reference`**：`type:"media", options:["audio"], label:"声线参考"`；把文本 `voice` 更名为 `voice_style`/`delivery`（语气描述）以消歧；迁移 `属性-1551` 到 `voice_reference`。
2. **`references[]` 的 role 由字段声明派生**，不再仅靠 `roleInferred`。
3. **`world.md` 指引加硬规则**：「画面出现主角色时，必须同时传 `role=character` 的人像与 `role=voice` 的声线参考；角色台词/独白必须使用该声线。」并在「交给视频生成」一节补「视频用 references 传多参考、必要时 audioAssetIds」。
4. 与 `2026-09-20-video-script-storyboard-sheet.md` 的 `script`/`storyboard` 字段协同（分镜图挂 `script.storyboard`）。

## 8. 生成政策

1. **先定段结构**：一段连续动作优先 1 个 request；需要拆时按动作/机位/世界关系拆并 carry forward 参考。默认一段 ≤ 模型能力上限（Seedance 2.0 Mini 15s）。
2. **多镜连续段**：一个 request 内可含多拍、硬切、多个说话轮次；用「每镜一信息变化 + 首尾帧合同 + HARD CUT 显式标注」写 prompt。
3. **分镜图驱动**：`storyboard` role sheet + panel manifest → `recut.media.gridSlice` 切格 → 逐格细化关键帧（去格线/提分辨率）→ 作为该段的多参考或首尾帧。
4. **先看再批量**：代表段/代表镜的表演、连续性、构图通过 settled-frame proof 后，才扩到其余段；生成后「看一遍」是导演回路的一部分。
5. **媒介先行**：生成前先按 §5.3 定媒介；MG 走 `recut.motion-graphic.create` 并等 `verified`。
6. **回填与复用**：稳定 assetId 立刻回填 `PLAN.md`；`proposed` 视频可先落轨，但导出前必须已完成。
7. **声画一致**：`generateAudio`、`audioAssetIds`、VO 声线三者与「本段有无台词」一致。

## 9. 门禁

| 门 | 内容 | 不通过 |
|---|---|---|
| G1 理解 | 参考整片机制 + 带源时间节拍 + 上屏文案系统 + 可迁移/不可复制；`speech@` 有可读转写 | 不进计划 |
| **G2 计划** | `TREATMENT.md` + `PLAN.md` 完整：逐场景媒介、镜头意图、起止状态、连续性合同、directing brief、锚点、预算；**可被用户审阅/修改** | 不进付费 |
| G3 付费 | 用户批准范围与预算；视频强制 proposal | 不 confirm/生成 |
| G4 落轨 | `timeline.validate` 零违规 + 受影响 settled frame 通过 | 不导出 |
| G5 交付 | 实际观看成片 | 不得称完成 |

**视频确认是第二个人工门**：不得承诺「批准后一路到导出」；UI 应支持批量确认同一段/同一批提案。

## 10. 平台 / 工具契约修复

| 问题 | 修复 |
|---|---|
| 无 target 的 editor 调用返回空项目 | 无 `projectId`（且无有效宿主 scope）时报错；Agent 侧一律显式带 `projectId` |
| 生成式 VO 无 `speech@` 锚点 | 明确：生成 VO 先转写再 `speech@`，否则用 `clock@` + VO 轨；`anchors.md` 补此分支 |
| `find -newermt` 猜文件 | 用 asset/job 返回的 `path` 或 `asset.get`；禁止 mtime 启发 |
| 分析/关键帧产物误挂项目 | 分析物留 workspace；只有上时间线素材 `asset.add`；关键帧作为生成输入不挂项目 |
| ASR/TTS 环境未预检 | S1/S2 前做 readiness 检查；转写自动选择已装模型或给出可执行错误 |
| `proposed` 视频先落轨的校验 | `timeline.validate` 对 `planned`/`proposed` 的媒体给出显式「待生成」状态，导出前拒绝未完成 |

## 11. 技能改动清单

### `service/skills/recut-clone/SKILL.md`

- **`:13 / :93 / :95`**：撤销「计划只在一张表、不建占位」的过强精简；恢复「文档职责分离」与「计划态可审」。
- **`:40`**：删去「不得中途再停」的绝对措辞，改为「批准后连续推进；视频确认是第二个人工门」。
- **`:65`（S2）**：从「载入 remix」升级为「载入 `remix → shot → generation-prompt`」，并要求产出 `TREATMENT.md`（含逐场景媒介与连续性）后过 G2。
- **`:69-77`（Plan）**：改为 §5.2 的段落式计划（段/场景为单位），字段由意义承载；必须回填 assetId。
- **`:87`（参考政策）**：拆为图片/视频两句（§7.2）。
- **`:86`（视频）**：补「一段连续动作优先一次多镜生成；用 model 时长上限与首尾帧/多参考续接」。
- 新增引用 `recut-motion-graphic`（MG）、`director/captions`（上屏文案）。

### `references/workflow.md` / `anchors.md` / `placement.md`

- workflow：补导演段、G2、场景媒介判定、生成回路。
- anchors：补生成 VO 锚点分支（§10）。
- placement：落轨前校验「段」的媒体完成状态与连续性。

### `recut-director` / `recut-editor`（接线，不重写）

- `references/shot`：把「宫格压缩法 + storyboard-sheet-template + keyframe first/last」从「可选」提到 clone 的必经路径。
- `references/generation-prompt`：「多镜连续段 + role 锚定 + STYLE LOCK」在 clone 中必用。
- `editor/video-generation.md`：明确视频用 `references`（含 voice/audio role）；`generateAudio` 与台词一致。

### 全局 Agent guide（硬约束）

- `service/prompts/core-agents.md.tmpl`（内建会话 guide）与 `service/skills/recut/SKILL.md`（第三方宿主 guide）都补一条**硬约束：涉及生成图片或视频，必须先加载 `recut-director`**，先形成导演意图（要什么/为什么/怎么拍/各场景媒介/段间连续）再生成；生成以「段/场景」为单位（一段连续动作优先一次多镜连续生成，段长按模型时长上限取值），禁止无导演意图的逐帧/逐段硬拼。例外仅为「明确的单点素材替换且既有导演意图已确定」。这条把 §2.1/§2.2 的根因在**入口层**堵死，使任何 App/链路都绕不过导演段。

## 12. 里程碑

| 阶段 | 目标 | 交付 | 验收 |
|---|---|---|---|
| **M0（纯技能，零平台改动）✅ 已实施** | 立即消除「一图一视频」与「无导演」 | 修订 `recut-clone` SKILL/workflow（§11）；核心 Agent guide（内建 + 第三方）加「生成必先导演」硬约束；Agent 产出 md 协议（§5）与段落式计划 | 同一参考跑一遍：计划含 Treatment + 段式分镜 + 媒介；视频以「段」为单位提交 |
| **M1（World 字段）✅ 已实施** | 声线/角色锚定可读 | `character.voice_reference` 字段（`worlds_canvas.go`）+ `references[]` role 由字段声明派生（`worlds_platform.go` `declaredMediaFieldRoles`）；阿蛋实体加 `voice_reference` + `world.md` 声线指引 | `entities.get` 直接看到「声线参考」；`references[]` role=voice 非推断（需重启 service） |
| **M2（G2 + 计划态）** | 计划可审可改、不花钱 | 计划态载体（md 或 RFC-09-17 的 planned AssetElement）+ G2 计划门 | 用户可审/改计划；批准前零花费 |
| **M3（分镜→连续生成）** | 一段戏一次连续生成 | 接线 `gridSlice`+`storyboard` role+首尾帧/`videoAssetIds`；`references`/`audioAssetIds` 全通 | 阿蛋 0–30s 由 2 次生成兑现，镜间连续 |
| **M4（语义锚点/重排）** | 改一句自动重排 | `script` 选择/时刻 → `speech@` 窗口编译 | 改一句台词，图形与 B-roll 自动重排 |

## 13. 风险

| 风险 | 缓解 |
|---|---|
| 多镜一次生成可控性差（串镜/漂移） | 分镜图 + 每镜一二句确定性描述 + 硬切标注；先在代表段验证再批量 |
| 模型时长/多参考能力随渠道漂移 | 读 `media.readiness` 与模型目录参数；段长按能力取值而非写死 5s |
| 恢复计划态导致「占位素材」回潮 | 计划态必须本地、不花钱、不进导出；导出前拒绝未物化项 |
| 用户仍想「一镜一镜可控」 | 保留拆镜逃生门：明确「拆镜＝独立重做代价」，由 Treatment 决定 |
| 声线字段迁移破坏旧 World | 只加字段不改状态机；`属性-1551` 软迁移（复制而非删除）+ 兼容读 |
| 导演段再次被「精简」 | 把「载入 shot/generation-prompt」与「Treatment 必产出」写成 G2 的硬条件 |

## 14. 可测试点

- **技能**：`recut-clone` 单测/示例校验 Plan 含「段」结构、媒介字段、连续性合同；SKILL:87 不再出现「一律放 imageAssetIds / 不要放 references」。
- **World**：新增 `voice_reference` 后 `entities.get`/`references[]` 往返一致；`roleInferred=false`；旧数据兼容。
- **生成**：一次 `recut.video.generate` 用 `references`（含 `role:voice`）+ `durationSec` > 5；分段续接用 `videoAssetIds`/`returnLastFrame`。
- **门禁**：G2 未过不得调用生成；未物化的 `planned`/`proposed` 在导出前被拒。
- **端到端**：同一参考 → md 协议 → 分镜图 → 连续生成 → 落轨 → `validate` 零违规 → 观看交付。
- **回归**：既有 `recut-reference`、`2026-09-20` 分镜表链路、视频 proposal 门禁不受影响。
