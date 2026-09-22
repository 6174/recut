---
name: recut-clone
appId: recut.platform
description: 用一支参考导演出一条新片：先立 editor 项目并把参考读法、目标设计、计划、组装写进项目内的 markdown（BRIEF/reference/TREATMENT/PLAN/PROGRESS），以「段/场景」为素材单位导演化生成（一次多镜连续生成、分镜图 + 分镜脚本 + 首尾帧合同、场景媒介判定、声线接线），图片直生、视频先落待确认素材，最后用 timeline-editor（recut.editor.*）按锚点组装、校验与交付。
---

# 克隆执行技能（recut-clone）

本技能回答一个问题：**给定一支参考与一个目标（换主体/产品/语言/CTA），怎么把它导演成一条可编辑、可交付的新片？**

它不重复理解方法、不重复迁移判断、不定义素材协议、不教时间线 op 语法——它把这些**串成一条最短路径，并设三个门**。规范与契约：`rfc/2026-09-22-clone-director-generation.md`。

## 0. 一个主张（其余都是它的展开）

**克隆不是「参考 → 素材」的搬运，而是「读懂参考 → 重新导演一支新片 → 用连续生成兑现」。**

AI 生成的素材单位是**一个可被导演的「场景/连续段」**，不是一帧、一段 5s、一条音：

- 一段连续动作**优先一次生成**（多镜连续段、内部硬切），而不是拆成 N 个独立 clip 硬拼；
- 模型时长上限**是设计输入**（如 Seedance 2.0 Mini 可到 15s），不默认 5s；
- 身份/世界靠**参考锚点**（角色/场景/风格/声线）跨段带过去，连续性靠**首尾帧合同**，不靠祈祷。

## 1. 最短路径

```text
S0 立项   editor 项目 + 项目内 markdown 工作档
S1 读参考  recut-reference：证据写参考素材，读法写 reference.md
S2 导演    remix（换什么）→ Treatment（这支新片是什么）→ shot + generation-prompt（怎么拍）→ PLAN.md
S3 做完    计划门 → 生成（段/场景为单位）→ 按 anchor 落轨 → 校验
S4 交付    实际观看 → 报告
```

**文档（都在 `workflow.context.paths.projectFilesRoot`；给 AI 读、意义优先、不追求结构）：**

- `BRIEF.md` —— 用户目标、受众、约束、**已批准的付费范围**。
- `reference.md` —— 参考为什么有效：整片机制 + 带源时间的节拍 + **上屏文案/字形/位置/强调系统** + 可迁移/不可复制。
- `TREATMENT.md` —— 导演的答案：创意前提、观众体验、情绪走向、逐拍意图、**逐场景媒介意图**、连续性、声音、上屏文字系统。
- `PLAN.md` —— 分镜计划：**以「段/场景」为单位**（意图 / 镜头 / 起止状态 / 媒介 / 参考 / 锚点 / directing brief）；生成后回填 assetId、落轨后回填窗口。
- `PROGRESS.md` —— 当前问题、待办、assetId、下一步。

> 参考的**观察**写参考素材的 `content`/`attributes`（跨目标复用）；目标侧判断只写项目 markdown。**不建 analysis/clone-plan 等多份冗余文档。** 续跑先校验参考身份（见 §4 S0）。

## 2. 门（计划门是新增硬门）

| 门 | 内容 | 不通过 |
|---|---|---|
| G1 理解 | 参考机制可定位到源时间；有可读 `speech@` 转写或明确用 `clock@` | 不进导演 |
| **G2 计划** | `TREATMENT.md` + `PLAN.md` 完整：逐场景媒介、镜头意图、起止状态、连续性合同、directing brief、锚点、预算；**可被用户审阅/修改** | 不进生成 |
| G3 花钱（硬门） | 一次性呈报 Plan 与预算并获批；视频强制 proposal，AI 不代确认 | 不生成 |
| G4 落轨 | `timeline.validate` 零违规 + 受影响 settled frame 通过 | 不导出 |
| G5 交付（硬门） | **Done means watched**：导出后实际观看/试听再报告 | 不得称完成 |

- G1/G4 是自检，不打断生成；**G2/G3/G5 需要用户**。
- **视频确认是第二个人工门**：不得承诺「批准后一路到导出」；同一段/同一批提案应支持批量确认。
- 同一项目内已批准过的同类预算直接沿用；用户说「开始 / 继续 / 就按这个来」即视为批准，立即提交，不要复述计划再等一次。

## 3. 边界声明

| 谁 | 负责 | 不负责 |
|---|---|---|
| `recut-reference` | 看懂、留证据、参考分析（写参考素材） | 不决定换什么 |
| `recut-director（references/remix）` | 反推公式、保留/替换判断 | 不教工具用法、不落轨 |
| `recut-director（references/{shot,generation-prompt,hooks,b-roll,motion,captions,sound,editing}）` | 镜头/分镜/生成意图/上屏文案/声音的导演决策 | 不落轨 |
| `recut-motion-graphic` | 把信息/图形/数据/排版做成组件素材 | 不决定导演取舍 |
| `timeline-editor`（`recut.editor.*`） | 时间线组装、字幕/图形、预览、校验、导出 | 不决定 clone 流程 |
| **`recut-clone`（本技能）** | 编排 S0–S4、门、段式计划 + anchor、生成与落轨 | 不重复上述三者内容 |

## 4. 分步

### S0 立项

- 无目标项目：`recut.editor.project.create` 一步建可编辑剪辑项目；用户已给 project target 就直接用。
- `recut.editor.workflow_context` 取 `paths.projectFilesRoot`；建上述 markdown 工作档，随后每步更新。
- **续跑先校验参考身份**：用户给出的来源 URL/描述与参考资产的 `url`/内容不一致时，必须重新 `recut.media.import`，并作废旧 Reference / Treatment / Plan；不得因为「已有工作」就沿用旧参考。
- **作用域显式**：所有 `recut.editor.*` 调用显式带 `projectId`，不依赖隐式「当前项目」。

### S1 读参考

- 载入 `recut-reference`：引入（`recut.media.import`）→ 标为参考（`role=reference`）→ 读（`probe` / `contactSheet` / 按需 `frames`）→ 转写（`recut.audio-studio.audio.transcribe`）。
- 分析写参考素材的 `content`/`attributes`（跨目标复用）；**本目标要用的带源时间读法写 `reference.md`**，其中必须显式记录**上屏文案系统**（句子、层级、位置、强调规则、结尾卡/数据卡）与**镜头语言**（景别/机位/运镜/构图/节奏/调色）。
- 读取产物（`frames` / `contactSheet` / `gridSlice` / `clip`）是普通素材，**可复用为生成的参考**（见 §6「镜头语言锚点」）；它们是 workspace 级分析物，不入项目素材库。
- 模型不能读图时立即终止并提示切换有视觉能力的模型。

### S2 导演（本技能的核心）

1. 载入 `recut-director（references/remix）`：反推公式，产出 keep/replace，每条定位到拍 → `TREATMENT.md`。
2. **写 `TREATMENT.md`**：这支新片是什么——创意前提、观众体验、情绪走向、逐拍意图、**每个场景的媒介**（见 §5）、连续性、声音、上屏文字系统。用导演语言，不写参数。
3. 载入 `recut-director（references/shot）` + `references/generation-prompt`：把 Treatment 落成**段/场景式分镜**，写 `PLAN.md`。每条至少含：
   - 意图（这一拍要让观众感到什么）；
   - 镜头（景别/机位/运动）与**起止状态**（下一段起＝上一段止，即连续性合同）；
   - 媒介（`generate` / `component` / `typography` / `hybrid` / `supplied`）；
   - 参考锚点：**新主体/世界**取 World `references[]`（角色/场景/声线等）；**镜头语言**取参考本身（`style-ref` 调色质感、`motion-ref` 运镜与动作时序、`storyboard` 构图分镜）。两者并列，缺一不可（见 §6）；
   - `anchor`（`speech@` / `clock@`）与 directing brief（写意图与表演，不堆参数）；
   - 需要**一次多镜连续生成**时，明确把几拍合进一个 request，并说明拆分依据。

### S3 做完（计划 → 生成 → 落轨）

1. **G2 计划门**：呈报 Treatment + Plan（§2）。用户可改。
2. **G3 花钱门**：呈报预算获批后连续执行到落轨；视频提案需用户确认。
3. **生成**（§6 政策）：以段/场景为单位提交；拿到稳定 assetId **立即回填 `PLAN.md`**；只有下一步依赖产物内容时才 `recut.job.*` 等待。
4. **落轨**：目标 A-roll 先 `script.attach` + `script.read` 定基准；按 `anchors.md` 把 anchor 映射为窗口，`timeline.command` / `placeAudio` / `placeComponents` 落轨，回填窗口。字幕走 `subtitle.import`。
5. **自检**：`timeline.validate` 零违规 + `preview.frame` 抽检受影响场景。

### S4 交付

- `export.start` → `recut.job.wait` 到 `completed` → **实际观看/试听** → 报告（含 Plan / assetId，便于只重做改动项）。

## 5. 场景媒介判定

给每个场景**先定媒介再写 prompt**：

| 价值落在哪 | 媒介 | 产物 |
|---|---|---|
| 世界/人物/表演/摄影/材质 | `generate` | `recut.video.generate` / `image.generate` |
| 信息/关系/数据/流程/标题/UI | `component` | `recut.motion-graphic.create`（等 `verified`） |
| 上屏文字/强调/独立书写 | `typography` / `caption` | 字幕轨 / 文本元素 |
| 底片 + 图形解释两层 | `hybrid` | shot + component overlay |
| 已有素材 | `supplied` | 直接引用 assetId |

**上屏文案是一等设计对象**：参考的文案常在画面上（逐句字幕/强调大字/数据卡）。生成图**禁止烧字**，但文案要作为独立层设计——数据卡/记录卡等走 motion-graphic，字幕走字幕轨，强调走 typography。信息/数据类场景默认 `component`，**不得降级为 b-roll 或塞进一句字幕**。

## 6. 生成政策

- **统一入口**：`recut.image.generate` / `recut.video.generate` / `recut.speech.generate` / `recut.motion-graphic.create`。提交即返回稳定 assetId，**立刻回填 `PLAN.md` 并继续**，不为确认而空等。
- **段/场景为单位**：一段连续动作**优先一个 request**（多镜连续段：一镜一信息变化 + 首尾帧合同 + HARD CUT 显式标注）；需要拆时按动作/机位/世界关系拆，并把人/物/世界用参考带过去。
- **模型能力是设计输入**：先读 `recut.context.media.readiness` 与模型目录的时长上限/多参考预算；段长按能力取值（如 Seedance 2.0 Mini 到 15s），**不默认 5s**。
- **三类生成关系**：reference-directed（身份/世界连续）／first-last-frame（端点画面本身是设计的一部分，用 `returnLastFrame` 取尾帧）／text-directed；跨段续接用 `videoAssetIds`。
- **镜头语言锚点（clone 的硬要求）**：clone 的目标镜头必须继承参考的「镜头感」，所以**参考的帧/接触表/片段要作为生成参考传入**，与新主体/世界锚点并列：
  - `style-ref`：参考帧/示例帧 → 调色、颗粒、质感、视觉语言；
  - `motion-ref`：参考片段 → 运镜、动作时序、表演节奏（视频参考，走 `videoAssetIds`）；
  - `storyboard`：参考的分镜/接触表 → 构图、调度、景别。
  只传目标关键帧和人像、不传参考镜头语言 = **生成不出相似镜头感**。
- **分镜图直接用（默认）**：一图 N 宫格分镜表（或单张分镜图）**整张作 `role="storyboard"` 参考直接提交**，与角色/场景/声线参考并列，由模型据此展开分镜；**参考名额有限，整张只占一个，不逐格占用**。
- **按需逐格细化**：仅当命中升级条件才 `recut.media.gridSlice` 切格 → 以该格为构图锚点细化关键帧（去格线/提分辨率）→ 作该段首尾帧/多参考：模型吃 storyboard 参考弱或分辨率明显不足、需精确首尾帧端点、或代表镜 proof 不过。
- **先看再批量**：代表段/代表镜的表演、连续性、构图通过 settled-frame proof 后，才扩到其余段。
- **参考提交口径（区分能力）**：
  - 图片：走 `imageAssetIds`（image 能力只读该字段）。
  - 视频：走 `references:[{id,kind,role,label}]`（含 `role:voice`）+ 需要模型发声时 `audioAssetIds`；`generateAudio` 必须与「本段是否说话」一致。
  - 锚定表从 `recut.worlds.get.references[]` 的 role 构建：`character` / `environment` / `voice` / `prop` / `style-ref` / `sfx` / `music`。
- **角色声线**：World 有声线参考时，角色台词/独白**必须用该声线**（参考音 → 声音角色 → 合成），不静默用默认 TTS。
- **图形**：`recut.motion-graphic.create` → 等 `verified` 才落轨。

## 7. 硬规则

- **一个主张**：克隆是导演化生成，不是素材搬运；计划与生成以「段/场景」为单位。
- **续跑校验参考身份**：来源不一致必须重新入库并作废旧计划。
- **回填**：拿到 assetId 立即回填 `PLAN.md`；不回填不得进入组装。
- **不复制，但要引用**：不复制源台词/肖像/具体构图（remix 红线），但**必须引用参考的镜头语言**（`style-ref` / `motion-ref` / `storyboard`）。「不复制」指不逐帧照搬，不是「不引用」；迁移的是可复用结构与拍法。
- **不代用户确认视频生成**；付费前必须获批。
- **分析产物不挂项目**：参考与读取产物（`contactSheet` / `frames` / `gridSlice`）是 workspace 级全局素材，**不传 `projectId`**；只有上时间线的素材才 `recut.editor.asset.add`。
- **不考古**：续跑只从项目 markdown 与素材 `content`/`attributes` 重建；**绝不读取宿主 session 数据库或其他会话**。
- **作用域显式**：所有 editor 调用显式带 `projectId`。
- **不猜文件**：assetId → 文件用 job/asset 返回值，不用 `find`/mtime 启发。
- **视觉前置**：模型不能读图立即终止。

## 参考文档

- `references/workflow.md`：S0–S4 完整步骤与自检清单。
- `references/anchors.md`：anchor token、计划写法、锚点→窗口映射、改稿重排、生成式 VO 分支。
- `references/placement.md`：用 `timeline-editor` 按 anchor 组装。
