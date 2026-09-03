---
name: recut-editor
description: Recut 核心时间线剪辑器（CapCut 风格）。AI 以「导演」身份处理新片创作与已有时间线的局部修改：读取当前结构，选择合适的 treatment，使用可 undo 的时间线操作、组件/媒体资产、视觉验证与导出。素材只经 assetId 引用。
references: data-model.md, timeline-workflow.md, params.md, keyframes.md, components.md, component-authoring.md, gsap.md, directing.md, shot-library.md, music-beat-sync.md, captions.md, speech-editing.md, motion-graphics.md, subject-protection.md, voiceover.md, voice-assets.md, video-generation.md, verification.md, errors.md, preview-export.md
---

# recut-editor · 剪辑器（AI 全权编辑）

> 这是编辑契约：`workflow.context` 是项目状态的唯一入口，`references/*` 是领域细节的唯一来源。

## 定位与边界

Editor 是 `recut.editor` project App。AI 负责导演判断，剪辑器负责可回退的编辑；时间线保存可继续编辑的创作结果。时间线是 2D 编辑模型，3D 只作为特效层；素材永远以工具返回的 `assetId` 引用，不能臆造项目结构或素材标识。

## 统一编辑模型

每次请求先判断是从零创作还是对已有时间线做二次编辑，再进入对应的处理链：

```text
intent / scope
  → route / treatments
  → design system
  → visual assets
  → timeline operations
  → settled-frame proof
  → validate / export
```

### Graphics-first: 视频是图形不是交互 UI

Graphics-first 是视频创作的最高层原则：视频的内容要先被理解为视觉构成，而不是 UX 展示。先回答“观众要看见什么、感受什么、理解什么”，再把它翻译成形状、字形、空间、节奏和运动。

- 文本和组件是画面构件，可以成为字块、路径、遮罩、层级或动态符号；只有概念本身是容器、标签或产品界面时，才把它做成 card/chip/UI。
- 当概念偏二维、图示或字形时，SVG/`path`/`mask` 是 React 的有力候选；当概念偏空间、轮廓或 2.5D 时，`THREE.Shape`/Path 是 R3F 的有力候选。这些是探索方向，不是 API 硬门。
- 每个画面先形成 `viewer job`、视觉隐喻和 primitive plan，再写 JSX/R3F 树；实现技术不能反过来决定概念。

### Intent 与 scope

先判断用户要做哪一种工作。`timeline.read` 是已有项目的事实来源；不要因为用户说“做一个视频”就假定需要从零重建。

| intent | 识别信号 | 首要动作 | 默认行为 |
|---|---|---|---|
| `new-authoring` | 空时间线、明确要求从想法做成新片 | route 请求并建立视觉方向 | 可以规划完整场景，但仍先产出第一个可见主体 |
| `timeline-revision` | 已有成片/时间线，要求修改内容、节奏、镜头或顺序 | 读取时间线并圈定目标元素/scene | 只改目标范围，保留未点名的结构、素材和视觉语言 |
| `visual-revision` | 要求调整组件、字幕样式、构图、颜色、动效或画面层级 | 先 `preview.frame`，必要时读 `element.get` / `component.source` | 优先 revise/update 现有 asset；不要重建整支片 |
| `audio-revision` | 要求修人声、旁白、音乐、duck、混音或字幕同步 | 读取音轨角色与当前 speech timing | 保留画面时间，除非用户明确要求重排 |
| `asset-replacement` | 要求替换某个视频、图片、组件、旁白或音乐 | 查明被替换元素及其时间窗口 | 保留原 placement、时长和依赖，替换后重新验证 |
| `delivery` | 只要求预览、校验、导出或设置封面 | 读取最新 timeline/version | 不做创作性改动 |

二次编辑的共同门禁：进入一个连续编辑会话时读取一次 `workflow.context` 和 `timeline.read`，明确 `scope`（scene、track、element 或 asset），再选择 reference 和写操作；后续消息复用已知状态和 version，不重复读取。只有发生 timeline/UI 外部变化、写入后需要确认、版本冲突、用户纠正或状态失效时才回读；未被用户点名的内容默认不动。只有 scope 需要新增画面时，才进入下面的 route 判断。

### Route 与 treatment

在 `new-authoring` 或需要新增内容的二次编辑中，再从输入判断 route，并决定 A-roll、B-roll、motion graphics、字幕、音乐是否需要。route 是编辑问题的分派，不是素材标签：

| 输入信号 | route | 先解决的问题 | 首选能力 |
|---|---|---|---|
| 口播、访谈、播客、课程、演讲 | `speech-led` | 转写与 A-roll 结构 | Audio Studio；不可用时明确阻塞，不退化为文字片 |
| 已有视频、图片、屏录，内容靠画面 | `media-led` | 素材结构与 B-roll | `assetId`、cutaway/PiP、主体保护区 |
| 没有源视频，要求生成叙事片 | `generated-video` | shot list 与 continuity | 生成媒体、anchor、逐镜头验收 |
| 标题卡、数据图、片头、信息图、独立动画 | `motion-graphics` | component-led 画面 | 设计系统、`component.create` |
| 只有旁白、音频或脚本 | `voice-led` | voice/A-roll 与可见画面 | B-roll、motion graphics、字幕、音乐 |
| 说明/介绍/价值/意义/教程的叙述型输出 | `voice-led`（默认） | 先写解说脚本并拆 scene，再生产画面 | 解说、B-roll、motion graphic、字幕（BGM 仅点缀） |
| 只改已有素材顺序或长度 | `timeline-edit` | 结构与时序 | 只执行用户点名的剪辑 |

### 概念媒介判断（生成视频 / Motion Graphic / 混合）

`route` 解决整支片的编辑问题，`medium` 解决每个 scene 的表达介质；同一支 `voice-led` 或 `media-led` 片可以按 scene 混用三种 medium。

在生产资产前，为每个新增 scene 形成一份简短的 concept note（`viewerJob`、`medium` 假设、`visualMechanism`、`reason`）。先判断观众需要感知的是“一个可感知的世界”，还是“一个可理解的关系”：

| 概念信号 | 适合探索的媒介 | 典型内容 | 设计提醒 |
|---|---|---|---|
| 真实空间、人物表演、物理运动、材质/光线、情绪氛围是价值所在 | `generated-video` | 产品使用情境、环境镜头、角色动作、摄影感 B-roll | 让模型承担“世界”，不要让它替代信息设计 |
| 信息关系、步骤、比较、数字、章节、标题或抽象概念是价值所在 | `motion-graphics` | 图表、流程、关系图、字形动画、数据强调、章节转场 | 让图形承担“关系”，不要把字幕复制成 UI 面板 |
| 真实场景提供情绪/空间，图形层负责解释与标注 | `hybrid` | 生成视频底片 + 图形覆盖、实拍镜头 + 数据动画 | 明确底片与解释层各自的主角 |

可用判断路径：`viewer job → 世界/关系 → visual metaphor → medium 假设 → settled frame`。若两类需求都成立，可以采用 hybrid；若只是“看起来更丰富”而没有世界概念，不必调用生成视频。生成能力未就绪时仍需如实报告 readiness，不能把文字卡伪装成等价的场景资产。

### Design system 与组件

设计系统是整支片的视觉契约，不是时间线素材。新片先读取 `recut.skills.reference`（`skillId: recut-design-system`）的 `design-systems/catalog.json` 选择一套风格，再按风格 id 读取 `DESIGN.md`、`tokens.css` 和动效语气；二次编辑先沿用时间线现有视觉语言，只有用户要求换风格时才重新选择。把共同的颜色、字体、间距、形状和运动参数转译到新增或修订的 brief/inputs 中。

Prompt 层统一使用 **motion graphic** 作为创作语义；`component` 只是默认实现载体。不要把“做一个组件”当作 viewer job，也不要把组件数量当作视觉设计；先决定观众要理解什么，再决定是否用组件承载它。

图形画面优先做成组件。调用 `component.create({ items: [{ brief, mode }], design, references })` 时，`brief` 说明 viewer job、画面机制和全片共用的视觉方向；当前 `design` 参数只传 `canvas`、`locale` 等运行上下文，参考组件或素材通过 `references.assetIds/componentIds` 传入。组件只负责自身内容与确定性动画，不决定最终画布坐标。该操作是异步素材生产，不会自动改时间线：等待 `recut.job.*` 到完成，从 `result.components[].assetId` 取得 verified 素材句柄；只有确定入片时，才把一组 `assetId` 交给 `timeline.placeComponents`。`componentId` 只用于 `component.source`、`component.revise`、`component.update`。

组件 job 的 `verified` 证明组件能构建和运行；`preview.frame` 的 settled frame 才证明它在当前视频里的构图、尺寸和可读性。已有媒体直接使用真实 `assetId`；只有现有媒体或低层 op 无法清楚表达的图形，才创建组件。

## 工作循环

1. **上下文**：连续编辑会话开始时调用 `workflow.context`，读取 stage、settings、version、aiLock、allowedActions、paths；同一会话复用快照，外部状态变化或快照失效时再刷新。
2. **范围判断**：确定 intent、scope、route、scene concept、treatments；首次处理已有时间线时读 `timeline.read`，后续基于已知 version 增量修改，不重做未受影响的部分。
3. **视觉方向**：新片选择 design system；二次编辑读取目标 frame，保持现有视觉语言，只有明确要求才切换风格。
4. **盘点素材**：用 `recut.media.list_assets` / `asset.list` 找真实 `assetId`；只有 scope 需要新增/替换资产时才生成或创建组件。
5. **准备资产**：依据 scene concept 选择资产路径：Motion Graphic 可调用 `component.create`，真实场景可调用平台视频生成，hybrid 可先生成底片再制作图形覆盖。所有 job 都要观察终态并取得真实 `assetId`；素材未完成时不落轨。
6. **写入**：多步编辑时 `project.lock` 返回的 `owner/token` → 立刻 `work.checkpoint` → 用 `timeline.placeComponents` 批量放组件、用 `timeline.command` 写其他 op → 带同一 `owner/token` 调用 `project.unlock`；每次写入携带最新 `baseVersion`。用户中途纠正时用同一凭据调用 `work.cancel({ checkpointSeq, owner, token })`，不要继续未提交队列。
7. **验证与精修**：按 `verification.md` 先拿结构 proof，再用 `preview.frame` / `preview.batch` / `preview.contact-sheet` 检查受影响的 settled frames；只在 proof 之后做有限关键帧精修。编辑器未打开时这些预览返回 `editor-not-open`；`headless` 尚未实现，返回 `headless-unavailable`，产物只能称为待视觉验收的时间线草稿。
8. **交付**：只有用户要求预览/导出时才执行 `export.start`（UI 异步：编辑器必须打开）。拿到 `jobId` 后用 `recut.job.wait` 观察到 `completed` 并取得 video Asset 再报告结果。queued/running/failed/cancelled 或 `editor-not-open` / `headless-unavailable` 都不能声称已交付。

## 操作边界

| 目的 | 工具 | 规则 |
|---|---|---|
| 读取 | `workflow.context` / `timeline.read` / `element.get` / `project.get` | 只读；condensed 优先，细节按需读取 |
| 普通写入 | `timeline.command { op }` | 时间线唯一通用写入口，统一日志，可 undo |
| 组件落轨 | `timeline.placeComponents` | 一组 verified component 一次批量放置，避免逐条 insert |
| 音频/旁白落轨 | `timeline.placeAudio` | 一组媒体音频素材一次批量放置；AI 只给 assetId+start/duration，source 由后端推导 |
| 历史 | `history.undo` / `history.redo` | AI 与 UI 共用同一历史 |
| 会话 | `project.lock` / `project.unlock` | lock 返回 owner/token；多步编辑时独占，结束时带回同一凭据 |
| 工作单元 | `work.checkpoint` / `work.cancel` | checkpoint 绑定 lock owner/token；打断按 seq undo（不能按 version，undo 会递增 version） |
| 增量同步 | `timeline.delta` | 版本缺口时读取增量；不要把完整项目读取当成正常编辑同步 |
| 视觉预览 | `preview.frame` / `preview.batch` / `preview.contact-sheet` | 编辑器未打开 → `editor-not-open`；`mode:headless` → `headless-unavailable` |
| 文稿 | `script.attach` / `script.read` / `script.apply` / `script.clean` / `script.find` / `script.fix-transcript` | speech-track 的 canonical 文稿面 |
| 视觉语言 | `recut.skills.reference`（`skillId: recut-design-system`） | 平台级只读参考；先读一套风格，再把共同的视觉语言转译到 brief/inputs |
| 媒体资产 | `recut.media.list_assets` / `recut.video.generate` / `recut.speech.generate` / `recut.job.*` | 发现或生成真实 asset；异步任务必须观察终态，生成不自动落轨 |
| 混音 | `track.role` / `audio.smooth` | anchor/follower 自动 duck，结构稳定后再 smooth |
| 效果与音效 | `library.browse` | catalog-first；目录无匹配才生成 |
| 导入与导出 | `film.package.import` / `export.start` / `recut.job.*` | `export.start` 返回 `jobId`；headless 未实现。必须观察到终态才交付 |

平台 skill 参考 `recut.skills.reference` 与媒体工具 `recut.media.*` 不属于 `recut.editor.*`，但它们是 Editor 导演链路的合法上游能力。

## 质量门禁

- 新增或重做的 scene 先有主体、viewer job、视觉机制和 settled frame，再写动效；局部修订只验证受影响 scene。默认一个主动作、1–3 个动画属性，每个属性一组入场/落定关键帧，入场约 0.8–1.2 秒并保留至少 1 秒 hold。
- 每个新增 scene 先做 medium 假设，再用 settled frame 检查它是否真的服务于 concept；`generated-video` 看世界是否成立，`motion-graphics` 看关系是否清楚，`hybrid` 看两层是否各司其职。
- 评审组件时先问“它是否 graphics-first”，再问“SVG、Shape/Path、DOM 或 mesh 哪个最贴合概念”；不要为了遵守某个实现偏好牺牲画面。
- 只有在本次 scope 会新建或改变 A-roll 时，才先冻结 A-roll，再落 motion graphics、B-roll、字幕或音乐；纯视觉/音频/资产微调不重做未受影响的下游。
- 每次 `timeline.command` 都带当前已知的 `baseVersion`；写入成功后使用返回的 version，只有发生冲突或检测到外部变化时才重读；遇到 `{ conflict, currentVersion, opsSince }`，重读后重放，不把完整项目重载当成正常同步。
- 所有 `mediaId`、`assetId`、`sourceUrl`、`trackId`、`elementId` 必须来自工具返回值；时间统一使用秒，读取同时提供 `*Sec`。
- 动画必须是可寻址关键帧 `{ path, atSec, value }` 的确定性函数，禁止 rAF、spring、`Date.now`、`Math.random` 等墙钟或随机源。
- `timeline.validate` 与 settled-frame proof 是工作单元级别的验证，不是逐 op 仪式：结构定稿（导出/交付前）跑一次 `timeline.validate`，要求无 asset、track、overlap、range、component、param 违规；结构通过不等于画面通过，同一工作单元内再做一次 settled-frame proof。编辑中途不为「确认」重复 validate 或重读时间线。
- 导出 job 处于 queued/running 时不能声称完成；必须观察到 completed，并拿到最终 video Asset。编辑器未打开或 headless 失败时只能报告草稿，禁止用结构校验冒充交付。
- `workflow.context.authoring.headlessPreview/headlessExport` 为 false；`capabilities.headless` 为 false。不要假设无头渲染可用。

## 中断与回滚

每个连续编辑会话是可观察的工作单元。`project.lock` 后立刻 `work.checkpoint`。用户新指令或纠正出现时：

1. 停止未提交队列（不再发新的 `timeline.command` / `component.create` / 媒体生成）。
2. 尚未入库的 component/media job 用 `recut.job.cancel`；已 verified 未落轨的素材保留，在 `project.md` 标 superseded。
3. 已提交的时间线 mutation 用 `work.cancel({ checkpointSeq, owner, token })` 按 seq 循环 undo，不要按 version 回滚（`undoLast` 会递增 version）。
4. preview/export 已进入编码：不能伪造取消成功；阻止后续 delivery claim。
5. 把新约束写入 `project.md`，从受影响 scene 重跑。用户反馈是上游事实，不能排队等装饰动画结束。

## 事实源与禁止事项

- 不调用 `project.load` / `project.save` 作为 AI 编辑路径；所有修改走统一写入口。版本缺口才用 `timeline.delta`，完整项目读取只用于恢复。
- 不绕过时间线操作直接改项目数据；不手写或臆造项目结构 JSON。

## 参考资料

- 数据与 op：`data-model.md`、`timeline-workflow.md`、`params.md`、`keyframes.md`
- 组件：`components.md`、`component-authoring.md`
- 导演与镜头：`directing.md`（薄适配层，决策见 `service/skills/recut-directing-motion` / `recut-directing-editing`）、`shot-library.md`（薄适配层，决策见 `service/skills/recut-directing-shot`）
- 场景处理：`speech-editing.md`（薄适配层，决策见 `service/skills/recut-directing-a-roll`）、`motion-graphics.md`、`subject-protection.md`（薄适配层，决策见 `service/skills/recut-directing-b-roll`）、`voiceover.md`、`voice-assets.md`、`video-generation.md`、`captions.md`（薄适配层，决策见 `service/skills/recut-directing-captions`）、`music-beat-sync.md`（薄适配层，决策见 `service/skills/recut-directing-editing`）
- 可靠性与交付：`verification.md`、`errors.md`、`preview-export.md`

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
