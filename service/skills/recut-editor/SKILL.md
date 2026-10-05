---
name: recut-editor
description: Recut 核心时间线剪辑器（CapCut 风格）。AI 以「导演」身份处理新片创作与已有时间线的局部修改：读取当前结构，选择合适的 treatment，使用可 undo 的时间线操作、组件/媒体资产、视觉验证与导出。素材只经 assetId 引用。
references: data-model.md, timeline-workflow.md, params.md, keyframes.md, directing.md, shot-library.md, music-beat-sync.md, captions.md, speech-editing.md, subject-protection.md, voiceover.md, voice-assets.md, video-generation.md, verification.md, errors.md, preview-export.md
---

# recut-editor · 剪辑器（AI 全权编辑）

Editor 是 `recut.editor` project App：AI 负责导演判断，剪辑器负责**可回退**的编辑，成果是可持续编辑的时间线。两个唯一入口——**状态** `workflow.context`（+ `timeline.read`）与**写** `timeline.command`；素材永远以工具返回的 `assetId` 引用，不臆造项目结构或素材标识。时间线是 2D 编辑模型，3D 只作特效层。

结构：① 时间线数据结构 → ② 元素与轨道 → ③ 工具列表 → ④ 常用工作流程 → ⑤ 纪律与规则。细节按需读 `references/`（文末路由）。

## 一、时间线数据结构

时间统一用**秒**（后台 `tick = round(sec * 120000)`；读取同时给 `*Sec` 与 `*Ticks`）。

```ts
// Project → Scenes → Tracks → Elements（每个 Scene 自带一整套轨道）
type Project = {
  id: string
  settings: { fps; canvasSize: { width; height }; background? }
  version: number                 // 单调递增；每次写 +1
  scenes: Scene[]                 // 2D 编辑模型（3D 只作特效层）
  aiLock?: { owner; token }       // project.lock 建立；锁内 UI 整份保存被拒
}

type Scene = {
  id: string; name?: string; isMain?: boolean   // 主场景从 0 开始
  tracks: { main: Track; overlay: Track[]; audio: Track[] }
}

type Track = {
  id: string; name: string
  type: 'video' | 'text' | 'audio' | 'graphic' | 'effect'   // main 是槽位，其 type 仍是 'video'
  muted?: boolean; hidden?: boolean
  role?: 'anchor' | 'follower' | 'none'   // 音频轨：驱动 auto-duck
  captionStyle?: object                   // text 轨带它 = 字幕轨（全轨共享样式）
  elements: Element[]
}

type ElementRef = { trackId: string; elementId: string }   // 来自 timeline.read / element.get

type Element = {
  id: string; name: string
  type: 'video' | 'image' | 'text' | 'graphic' | 'component' | 'audio' | 'effect'
  startSec: number; durationSec: number; trimStartSec: number; trimEndSec: number  // 存储用 tick，MCP 一律秒
  params: Record<string, unknown>     // 扁平键：'transform.positionX' / 'opacity' / 'volume' / 'content'…（组件 inputs 展开）
  animations?: Record<string /* 可动画路径 */, { keys: Keyframe[] }>   // 关键帧通道
  hidden?: boolean; muted?: boolean; effects?: object[]; masks?: object[]; retime?: object
  subtitle?: { source: 'srt' | 'ass' | 'transcript'; cueIndex?: number }
  transcript?: object
  mediaId?: string; assetId?: string; componentId?: string; definitionId?: string
  effectType?: string; sourceType?: 'upload' | 'library'; sourceUrl?: string
}

// 关键帧：确定性 f(t)，禁止墙钟/随机。可动画路径：
//   transform.positionX/positionY/positionZ / transform.scaleX/scaleY/rotate / opacity / volume / color
//   params.<key>（组件/graphic 参数） / effects.<eid>.params.<key>
type Keyframe = {
  time: number                          // 元素内相对 tick（MCP 写入用 { path, atSec, value }，atSec 是时间线绝对秒）
  value: number | string
  segmentToNext?: 'linear' | 'hold' | 'bezier'   // 缺省 linear
  leftHandle?; rightHandle?; tangentMode?
}
```

**Motion Graphic 元素**：`type:"component"`，由 `assetId` + `componentId` 指向 `recut.motion-graphic` 的 **verified** 素材；组件的 `inputs` 展开进 `params.<inputKey>`，可对这些 key 打关键帧（路径 `params.<key>`）。落轨用 `timeline.placeComponents`（须 verified），修订用 `recut.motion-graphic.revise/update`。

- **version**：`timeline.command` / `history.*` 写后 +1；写入带 `baseVersion`，过期返回 `{ ok:false, conflict:true, currentVersion, opsSince }`。
- **aiLock**：`project.lock` 建立；`project.unlock` 或 5 分钟空闲超时解除。

> 完整字段与类型以 `references/data-model.md`、`references/params.md`、`references/keyframes.md` 为准。

## 二、元素与轨道（默认节点与操作）

**元素 type 与落轨约束**（`timeline.validate` 的 `track-type` 校验）：

| 元素 type | 落轨 | 关键字段 |
|---|---|---|
| `video` / `image` | main（或 overlay video 轨） | `mediaId` / `sourceUrl` |
| `text` | overlay text 轨（带 `subtitle` = 字幕 cue） | `params.text` / `subtitle` |
| `graphic` | overlay graphic 轨 | `definitionId`（默认 rectangle） |
| `component` | overlay graphic 轨 | `componentId`（来自 `recut.motion-graphic.list`） |
| `audio` | audio 轨 | `sourceType:"upload"`→`mediaId`；`"library"`→`sourceUrl` |
| `effect` | overlay effect 轨（全画布） | `effectType` |

**元素操作**（都经 `timeline.command { op }`）：`insert` / `delete` / `trim`（`ripple` 平移后续）/ `split` / `param`（`atSec` 语义见 keyframes）/ `keyframe-upsert` / `keyframe-remove`。**一次调用只放一个 op**，批量用多次调用（每步可 undo）。

**字幕轨**：text 轨带 `captionStyle` 即字幕轨；cue 的 `param` 修改广播全轨（`content` 除外）；`caption-style` 设全轨样式；`subtitle.import` / `subtitle.export` 批量导入导出。

**轨道 / 场景 / 项目**：`track-add/remove/mute/visible/role`、`scene-create/rename/delete`、`bookmark-add/remove`、`settings`。

> op 目录与编排模式 → `references/timeline-workflow.md`；参数键 → `references/params.md`；关键帧 → `references/keyframes.md`；字幕 → `references/captions.md`。

## 三、工具列表

| 目的 | 工具 | 规则 |
|---|---|---|
| 读取 | `workflow.context` / `timeline.read` / `element.get` / `project.get` | 只读；condensed 优先，细节按需读取 |
| 普通写入 | `timeline.command { op }` | 时间线唯一通用写入口，统一日志，可 undo |
| 组件落轨 | `timeline.placeComponents` | 一组 verified motion graphic 一次批量放置，避免逐条 insert |
| 音频/旁白落轨 | `timeline.placeAudio` | 一组媒体音频素材一次批量放置；AI 只给 assetId+start/duration，source 由后端推导 |
| 历史 | `history.undo` / `history.redo` | AI 与 UI 共用同一历史 |
| 会话 | `project.lock` / `project.unlock` | 返回 owner/token；多步编辑时独占，结束时带回同一凭据 |
| 工作单元 | `work.checkpoint` / `work.cancel` | checkpoint 绑定 lock owner/token；打断按 seq undo（不能按 version，undo 会递增 version） |
| 增量同步 | `timeline.delta` | 版本缺口时读取增量；不要把完整项目读取当成正常编辑同步 |
| 视觉预览 | `preview.frame` / `preview.batch` / `preview.contact-sheet` | 编辑器未打开 → `editor-not-open`；`mode:headless` → `headless-unavailable` |
| 文稿 | `script.attach` / `script.read` / `script.apply` / `script.clean` / `script.find` / `script.fix-transcript` | speech-track 的 canonical 文稿面 |
| 视觉语言 | `recut.skills.reference`（`skillId: recut-design-system`） | 平台级只读参考；先读一套风格，再转译到 brief/inputs |
| 媒体资产 | `recut.media.list_assets` / `recut.image.generate` / `recut.video.generate` / `recut.speech.generate` / `recut.job.*` | **统一 generate → 稳定 assetId → 立即落位、不空等**；视频由平台落为待用户确认态，**AI 只提交与落位，绝不代确认**；`recut.motion-graphic.create` 必须 `verified` 才落轨 |
| 混音 | `track.role` / `audio.smooth` | anchor/follower 自动 duck，结构稳定后再 smooth |
| 效果与音效 | `library.browse` | catalog-first；目录无匹配才生成 |
| 导入与导出 | `film.package.import` / `export.start` / `recut.job.*` | `export.start` 返回 `jobId`；headless 未实现。必须观察到终态才交付 |

平台 skill 参考 `recut.skills.reference` 与媒体工具 `recut.media.*` 不属于 `recut.editor.*`，但它们是 Editor 导演链路的合法上游能力。

## 四、常用工作流程

**统一编辑链**：

```text
intent / scope
  → route / treatments
  → design system
  → visual assets
  → timeline operations
  → settled-frame proof
  → validate / export
```

### ① Intent 与 scope

先判断从零创作还是对已有时间线二次编辑；`timeline.read` 是已有项目的事实来源，**不要因为用户说"做一个视频"就假定需要从零重建**。

| intent | 识别信号 | 首要动作 | 默认行为 |
|---|---|---|---|
| `new-authoring` | 空时间线、明确要求从想法做成新片 | route 请求并建立视觉方向 | 可以规划完整场景，但仍先产出第一个可见主体 |
| `timeline-revision` | 已有成片/时间线，要求修改内容、节奏、镜头或顺序 | 读取时间线并圈定目标元素/scene | 只改目标范围，保留未点名的结构、素材和视觉语言 |
| `visual-revision` | 要求调整组件、字幕样式、构图、颜色、动效或画面层级 | 先 `preview.frame`，必要时读 `element.get` / `recut.motion-graphic.source` | 优先 revise/update 现有 asset；不要重建整支片 |
| `audio-revision` | 要求修人声、旁白、音乐、duck、混音或字幕同步 | 读取音轨角色与当前 speech timing | 保留画面时间，除非用户明确要求重排 |
| `asset-replacement` | 要求替换某个视频、图片、组件、旁白或音乐 | 查明被替换元素及其时间窗口 | 保留原 placement、时长和依赖，替换后重新验证 |
| `delivery` | 只要求预览、校验、导出或设置封面 | 读取最新 timeline/version | 不做创作性改动 |

二次编辑共同门禁：进入连续编辑会话读一次 `workflow.context` 与 `timeline.read`，明确 `scope`（scene / track / element / asset），再选 reference 与写操作；后续消息复用已知状态与 version，只有 timeline/UI 外部变化、写入后确认、版本冲突、用户纠正或状态失效时才回读；未被点名的内容默认不动。只有 scope 需要新增画面时，才进入 route 判断。

### ② Route 与 treatment

`route` 是编辑问题的分派，不是素材标签：

| 输入信号 | route | 先解决的问题 | 首选能力 |
|---|---|---|---|
| 口播、访谈、播客、课程、演讲 | `speech-led` | 转写与 A-roll 结构 | Audio Studio；不可用时明确阻塞，不退化为文字片 |
| 已有视频、图片、屏录，内容靠画面 | `media-led` | 素材结构与 B-roll | `assetId`、cutaway/PiP、主体保护区 |
| 没有源视频，要求生成叙事片 | `generated-video` | shot list 与 continuity | 生成媒体、anchor、逐镜头验收 |
| 标题卡、数据图、片头、信息图、独立动画 | `motion-graphics` | motion-graphic-led 画面 | 设计系统、`recut-motion-graphic`（`recut.motion-graphic.create`） |
| 只有旁白、音频或脚本 | `voice-led` | voice/A-roll 与可见画面 | B-roll、motion graphics、字幕、音乐 |
| 说明/介绍/价值/意义/教程的叙述型输出 | `voice-led`（默认） | 先写解说脚本并拆 scene，再生产画面 | 解说、B-roll、motion graphic、字幕（BGM 仅点缀） |
| 只改已有素材顺序或长度 | `timeline-edit` | 结构与时序 | 只执行用户点名的剪辑 |

### ③ 概念媒介判断（生成视频 / Motion Graphic / 混合）

`route` 解决整支片，`medium` 解决每个新增 scene 的表达介质；同一支 `voice-led` 或 `media-led` 片可以按 scene 混用三种。生产资产前，为每个新增 scene 形成简短 concept note（`viewerJob`、`medium` 假设、`visualMechanism`、`reason`）；先判断观众要感知的是"一个可感知的世界"还是"一个可理解的关系"：

| 概念信号 | 适合的媒介 | 典型内容 | 设计提醒 |
|---|---|---|---|
| 真实空间、人物表演、物理运动、材质/光线、情绪氛围是价值所在 | `generated-video` | 产品使用情境、环境镜头、角色动作、摄影感 B-roll | 让模型承担"世界"，不要让它替代信息设计 |
| 信息关系、步骤、比较、数字、章节、标题或抽象概念是价值所在 | `motion-graphics` | 图表、流程、关系图、字形动画、数据强调、章节转场 | 让图形承担"关系"，不要把字幕复制成 UI 面板 |
| 真实场景提供情绪/空间，图形层负责解释与标注 | `hybrid` | 生成视频底片 + 图形覆盖、实拍镜头 + 数据动画 | 明确底片与解释层各自的主角 |

判断路径：`viewer job → 世界/关系 → visual metaphor → medium 假设 → settled frame`。两类需求都成立可用 hybrid；只是"看起来更丰富"而没有世界概念，不必调用生成视频。生成能力未就绪时如实报告 readiness，不能把文字卡伪装成场景资产。

### ④ 视觉方向与组件

设计系统是整支片的视觉契约，不是时间线素材：新片先读 `recut.skills.reference`（`skillId: recut-design-system`）的 `design-systems/catalog.json` 选一套风格，再读其 `DESIGN.md` / `tokens.css` 与动效语气；二次编辑沿用现有视觉语言，只有用户要求换风格才重选。把共同的颜色、字体、间距、形状、运动参数转译到新增/修订的 brief/inputs。

Prompt 层统一使用 **motion graphic** 作为创作语义，`motion graphic` 只是默认实现载体。不要把"做一个组件"当作 viewer job，也不要把组件数量当作视觉设计；先决定观众要理解什么，再决定是否用组件承载它。

图形画面优先做成组件；**组件的创作方法由全局技能 `recut-motion-graphic` 负责**，本技能只负责把已验证素材落到时间线。调用 `recut.motion-graphic.create({ items: [{ brief, mode }], design, references })` 时，`brief` 说明 viewer job、画面机制与全片视觉方向，`design` 只传 `canvas` / `locale` 等运行上下文，参考组件/素材经 `references.assetIds/componentIds` 传入。该操作是异步素材生产、不自动改时间线：等 `recut.job.*` 到完成，从 `result.components[].assetId` 取句柄；确定入片时才把一组 `assetId` 交给 `timeline.placeComponents`。`componentId` 只用于 `recut.motion-graphic.source/revise/update`。

组件 job 的 `verified` 只证明它能构建运行；`preview.frame` 的 settled frame 才证明它在当前视频里的构图、尺寸与可读性。已有媒体直接用真实 `assetId`；只有现有媒体或低层 op 无法清楚表达的图形才创建组件。

### ⑤ 工作循环

1. **上下文**：会话开始调 `workflow.context`，读 stage、settings、version、aiLock、allowedActions、paths；同一会话复用快照。
2. **范围判断**：定 intent、scope、route、scene concept、treatments；首次处理已有时间线读 `timeline.read`，后续基于已知 version 增量修改。
3. **视觉方向**：新片选 design system；二次编辑读目标 frame、保持现有视觉语言。
4. **盘点素材**：用 `recut.media.list_assets` / `asset.list` 找真实 `assetId`；项目素材库只放上时间线的素材（`asset.add` 加入 / `asset.remove` 解挂）；`origin=understand` 的参考理解产物需 `includeAnalysis` 显式查询。
5. **准备资产**：**凡要生成图片/视频，先加载 `recut-director` 形成导演意图**（route + viewer job + 媒介 + 段/场景 + 风格锁定 + 参考，见 `references/video-generation.md` 第 0 步）再提交。**图片/语音走「先落位」**：拿到 `assetId` 立即落轨并标生成中，不等终态；**组件与视频仍有门禁**：`recut.motion-graphic.create` 必须 `verified` 才落轨，视频按 continuity/验收口径确认。
6. **写入**：多步编辑 `project.lock` → 立刻 `work.checkpoint` → `timeline.placeComponents` / `timeline.command` 写 op → 带同一 `owner/token` 调 `project.unlock`；每次写入带最新 `baseVersion`。用户中途纠正用 `work.cancel({ checkpointSeq, owner, token })`，不继续未提交队列。
7. **验证与精修**：按 `verification.md` 先取结构 proof，再用 `preview.frame` / `preview.batch` / `preview.contact-sheet` 检查受影响 settled frames；只在 proof 后做有限关键帧精修。
8. **交付**：只有用户要求预览/导出时才 `export.start`（编辑器必须打开）；拿到 `jobId` 用 `recut.job.wait` 到 `completed` 并取得 video Asset 再报告。

### 典型操作

- **新片创作**：intent=`new-authoring` → route → scene concept/medium → design system → 生成/组件 → 落轨 → settled-frame proof → `timeline.validate` → 导出。
- **二次编辑**：`timeline.read` + 圈 scope → 按 intent（timeline / visual / audio / asset revision）**只改目标**，保留未点名内容 → 受影响 scene 的 proof。
- **交付导出**：`timeline.validate` 零违反 → settled-frame proof → `export.start` → `recut.job.wait` 到 `completed`。

## 五、纪律与规则（Rules）

**视觉**

1. **Graphics-first**：视频内容是视觉构成，不是 UI 展示。先回答"观众要看见什么、感受什么、理解什么"，再翻译成形状、字形、空间、节奏、运动；文本/组件可以成为字块、路径、遮罩、层级或动态符号，只有概念本身是容器/标签/界面时才做成 card/chip/UI；先定 `viewer job`、视觉隐喻与 primitive plan，再写 JSX/R3F。

**质量门禁**

2. 新增或重做的 scene 先有主体、viewer job、视觉机制和 settled frame，再写动效；局部修订只验证受影响 scene。默认一个主动作、1–3 个动画属性，每属性一组入场/落定关键帧，入场约 0.8–1.2 秒并保留至少 1 秒 hold。
3. 每个新增 scene 先做 medium 假设，再用 settled frame 检查是否服务 concept：`generated-video` 看世界是否成立，`motion-graphics` 看关系是否清楚，`hybrid` 看两层是否各司其职。评审组件时先问"它是否 graphics-first"，再问"SVG / Shape·Path / DOM / mesh 哪个最贴合概念"；不要为遵守某个实现偏好牺牲画面。
4. 只有在本次 scope 会新建/改变 A-roll 时，才先冻结 A-roll 再落 motion graphics / B-roll / 字幕 / 音乐。
5. 每次 `timeline.command` 带当前已知 `baseVersion`；成功后用返回 version；冲突 `{ conflict, currentVersion, opsSince }` 时重读后重放，不把完整项目重载当正常同步。
6. 所有 `mediaId` / `assetId` / `sourceUrl` / `trackId` / `elementId` 必须来自工具返回值；时间统一秒。
7. 动画必须是可寻址关键帧 `{ path, atSec, value }` 的确定性函数，**禁止** rAF / spring / `Date.now` / `Math.random` 等墙钟或随机源。
8. `timeline.validate` 与 settled-frame proof 是**工作单元级**验证：结构定稿（导出/交付前）跑一次 validate（无 asset / track / overlap / range / motion-graphic / param 违规），同一工作单元内再做一次 settled-frame proof。编辑中途不为"确认"重复 validate 或重读。
9. 导出 job queued/running 时不能声称完成；必须观察到 `completed` 并拿到最终 video Asset。编辑器未打开或 headless 失败时只能报告草稿，**禁止用结构校验冒充交付**。
10. `workflow.context.authoring.headlessPreview/headlessExport` 与 `capabilities.headless` 均为 false；不要假设无头渲染可用。

**中断与回滚**

11. 每个连续编辑会话是可观察的工作单元：`project.lock` 后立刻 `work.checkpoint`。用户新指令或纠正出现时：停止未提交队列 → 未入库的 motion-graphic/media job 用 `recut.job.cancel`（已 verified 未落轨素材保留并标 superseded）→ 已提交 mutation 用 `work.cancel({ checkpointSeq, owner, token })` 按 seq 循环 undo（**不要按 version**，undo 会递增 version）→ preview/export 已编码则不伪造取消成功、阻止后续 delivery claim → 把新约束写入 `project.md`，从受影响 scene 重跑。用户反馈是上游事实，不能排队等装饰动画结束。

**事实源与禁止**

12. 不调用 `project.load` / `project.save` 作为 AI 编辑路径；所有修改走统一写入口。版本缺口才用 `timeline.delta`，完整项目读取只用于恢复。
13. 不绕过时间线操作直接改项目数据；不手写或臆造项目结构 JSON。

## References 路由

| 问题 | 读什么 |
|---|---|
| 时间线数据契约（字段/类型/单位/锁） | `references/data-model.md` |
| `timeline.command` op 目录与编排模式 | `references/timeline-workflow.md` |
| 参数键与默认值（transform/opacity/blendMode/text/音量…） | `references/params.md` |
| 关键帧语义与 `atSec` 规则 | `references/keyframes.md` |
| 组件创作（视觉语法 / surface / inputs / 构建验证） | 全局技能 `recut-motion-graphic`（`appId="recut.platform"`） |
| 导演与镜头 | `references/directing.md` / `references/shot-library.md`（薄适配，决策见 `recut-director（references/motion / editing / shot）`） |
| 口播 / 主体保护 / 字幕 / 音乐卡点 | `references/speech-editing.md` / `subject-protection.md` / `captions.md` / `music-beat-sync.md`（薄适配，决策见对应 `recut-director` 子技能） |
| 旁白与声音资产 | `references/voiceover.md` / `references/voice-assets.md` |
| 生成视频（concept / shot list / anchor / continuity） | `references/video-generation.md` |
| 验证 / 错误 / 预览导出 | `references/verification.md` / `references/errors.md` / `references/preview-export.md` |
| 设计系统风格包 | `recut.skills.reference`（`skillId: recut-design-system`） |

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
