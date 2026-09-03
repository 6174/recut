<!--
 [INPUT]: 依赖 recut-design-system skill 的视觉契约、Editor timeline.read/preview.frame 与 component.create/timeline.placeComponents。
 [OUTPUT]: Motion Graphics 的 style gate、代表性组件、逐镜头决策、摆放与验证规则。
 [POS]: motion-graphics route 的导演与组件编排参考；不替代 components.md 的 SDK/构建契约。
 [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# Motion Graphics 工作流（recut.editor）

Motion graphics 是帮助观众更快理解信息、关系或章节的视觉层，不是把字幕包进卡片，也不是给每个 scene 加一条装饰条。每个 motion graphic 必须有明确的 viewer job，并且同时满足视觉语言、画面构图和时间线证据。组件是实现载体，不是创作语义。

## 适用与前置条件

适用于标题卡、章节标记、关键引语、统计数字、列表、比较、流程、关系图、抽象概念和程序化视觉。开始前必须知道：

- 当前编辑会话的画布尺寸、fps、version、锁和已有轨道；没有新鲜快照时读取 `workflow.context`；
- motion graphic 服务的内容事实、目标观众和出现的 speech/visual beat；
- 目标 scene 的实际 settled frame（不是只凭时间戳猜位置）；
- motion graphic 是覆盖 A-roll 的透明 overlay，还是故意替代底片的 opaque/full-screen beat；
- 可变文字、颜色、数字、图片/视频来源哪些要做成 component inputs。

## 从 concept 到视觉语法

Motion Graphic 的目标是让观众看见关系、节奏和视觉隐喻，而不是把内容排成一个可操作的 UX 面板。先画 primitive plan，再探索最能承载它的 surface：

| 概念需要 | 可以探索的表达 | 何时换方案 |
|---|---|---|
| 二维文字、图表、流程、标注、图形转场 | React + SVG（`path`、`mask`、`clipPath`、`stroke/fill`） | 自然换行、复杂文本流或真实 HTML 语义更贴合 concept 时用 DOM |
| 平面/2.5D 图形、路径、空间关系、粒子或光线 | R3F + `THREE.Shape`/ShapeGeometry/曲线 Path | 体积、材质或光照本身成为 concept 时再用 mesh |
| 纯静态简单形状且低层 op 已能表达 | timeline graphic op | 需要逐元素动画、数据驱动或复用时升级为组件 |

避免把视频里的信息惯性实现为重复 rounded card、chip、表格或“网页截图”。它们可以成为一种视觉隐喻，但 brief 应说明它们为何服务于 viewer job。

如果请求是对已有 motion graphic 的调整，先把它当作局部视觉修订：读取目标 frame 和现有 component/source，沿用原有视觉语言与 placement，只修改用户点名的内容、参数或动效。只有现有形式无法承载新 viewer job 时，才创建新 component；不要因为一个局部改动重做整组 motion graphics。

没有 active style 时：用户已给出具体风格就照用；用户说“直接做/不要问”则从内容和素材选择一套明确但可更换的 Recut design system，并把它标为 provisional；否则先读取 recut-design-system 的 `design-systems/catalog.json`，选 2–4 个合理方向，说明差异后再开始批量制作。generic 的“高级、现代、干净、专业”不是视觉语言，不能直接拿来生成组件。

## 统一的 motion graphic 生产链

```text
style list/get
  → 确认本片视觉语言
  → 选择一个 viewer job 做 representative motion graphic
  → component.create（只生成素材，不落时间线）
  → recut.job.wait 到 verified
  → timeline.placeComponents 放置并 preview.frame
  → 代表性 settled frame 通过后，按相同 job/结构/form 批量扩展
```

一组相关 motion graphics 在批量创建前，至少有一个代表性组件已经在目标画面中通过 settled-frame proof。代表组件只能证明该视觉语言适用于同类任务，不能自动成为所有章节、引语、数据图和 CTA 的万能模板。

## 每个 motion graphic 的四个决定

| 决定 | 要回答的问题 | 必须产出 |
|---|---|---|
| Content | 哪个信息值得占用画面？ | 事实、数字、关系或引语，不只是复述字幕 |
| Timing | 何时进入、停留多久、何时退出？ | speech/visual anchor、read time、duration、动画节拍 |
| Form & placement | 用什么形式才能承载这个 job？ | lower-third、side treatment、quote、diagram、chapter、full-screen，以及目标 frame 的候选区域 |
| Background | 它叠在片上还是拥有整幅画面？ | `transparent` overlay 或 `opaque` full-screen beat |

motion graphic 的 brief 写内容、形式和背景，不写最终画布坐标。最终 `positionX/Y`、`scaleX/Y` 和 track 由目标 frame 的实际构图决定。

## 形式与复用边界

常见 viewer job 与适合形式：

- 身份/上下文：speaker name、产品名、日期、来源 → lower-third/context label；
- 关键观点/引语：definition、statistic、conclusion → pull quote、typographic emphasis 或短暂 full-screen beat；
- 结构化信息：步骤、列表、比较、排名 → stack、comparison、compact diagram；
- 章节/主题：opening、section change、topic divider → title overlay 或 opaque full-screen；
- 抽象关系：因果、循环、系统、框架 → diagram、cycle、relationship map。

只有以下条件都相同才复用同一组件 asset：viewer job、信息结构、视觉 form、画布角色。只要 job 不同，就创建新的 component asset，但共享同一套 palette、type、spacing、material 和 motion language。相同颜色不等于可以复用同一组件。

## 目标帧与保护区

创建前先对目标时刻调用 `preview.frame`，必要时用 `element.get` 查看现有 overlay。把 A-roll 的 face/head/mouth、关键手势、产品或 logo、字幕带和已有图层视为 protected regions；在剩余的最大低信息区放置 motion graphic，优先保证阅读尺寸，而不是固定“右下角”。

- transparent overlay 默认避开脸、嘴和字幕带；必须在目标帧完整可读；
- opaque/full-screen motion graphic 是有意的视觉节拍，可以覆盖人物，但必须有明确的章节、结论或信息承载理由；
- overlay 使用自然尺寸的 local component，最终画布位置由时间线决定；只有确实铺满整幅画面时才用 `mode:"fullscreen"`；
- 文字、图表和视觉主体在 1080p 画面中必须达到可读尺寸：主信息约 ≥56px、字幕 ≥40px、辅助信息 ≥32px；
- 任何 crop/contain/position 争议都要在实际 composed frame 中回看，不能只检查 asset 已进入素材库。

## 组件实现约束

组件的 SDK、surface、inputs、`getBaseSize`、`getContentBounds`、确定性动画和构建错误见 `components.md` / `component-authoring.md` / `gsap.md`。motion graphic 工作流额外要求：

- 所有可变文字、primary/accent colors、关键数字、image/video source 都是 inputs，并和时间线 `params` 同名；
- `brief` 最好同时写 `viewer job`、`visual metaphor`、`primitive plan` 和 `surface rationale`；不要只写“做一个高级卡片/现代组件”。
- 背景默认透明；需要 opaque surface 时由组件自己拥有 `background`/`bgColor` input，不另放一张 solid fallback；
- 动画统一走 GSAP Timeline（react/r3f）：先设计 settled frame，再设计入场；一镜只让一个层级主角承担主要动作，落定后留 hold；入场约 0.8–1.2s，禁止无意义的无限循环（`mode:"loop"` 只用于氛围元素，且需 brief 支持）；
- 用 flex/grid/gap/自然换行布局文本，给可变长文案预留空间；不要用散落的 absolute top 值把可读文本堆在一起；
- 不把 motion graphic 写成 UI 截图、重复 chip 或万能 rounded card；表面材质、渐变、glow、grain 只有在 design system 或 viewer job 要求时使用；
- 不把最终画布坐标写进 component source，也不把 `project.load/project.save` 当作组件交付路径。

## Recut 落轨与批量更新

1. `component.create({ items, design, references })` 一次创建同一批候选；把统一风格和 viewer job 的简短说明写进每项 `brief`，`design` 只传当前支持的 canvas/locale，参考组件或素材放在 `references`，然后等待统一 job 终态。
2. 从完成结果读取每个 `components[].assetId` 和 `componentId`；失败项不要用文字或 raw rectangle 静默替代。
3. 对用户要求入片的组件调用一次 `timeline.placeComponents({ baseVersion, items })`，每项至少包含真实 `assetId`、`startSec`、`durationSec`，必要时带 `params`。
4. `timeline.placeComponents` 成功后，读取 `timeline.read` 回读轨道、时间和 component ref；再对代表性 start/settled/end 时刻调用 `preview.frame`。
5. 只有同一视觉 form 的重复实例通过目标帧检查后，才批量扩展；不同 job 使用不同 component asset，并共享 design system，而不是复制源码后逐个微调。

## 失败分类与修复顺序

- build/shape/determinism 失败：读 job 错误，修 component source 或 inputs；不要重复提交相同坏 payload；
- asset ready 但构图失败：先改 timeline placement 的位置/尺寸/fit；不要先重写组件；
- settled frame 文字溢出/遮挡：先调整 form 或 content density，再改字号；不要用更多 keyframe 掩盖布局问题；
- 多个实例样式漂移：检查本片既定的风格方向、brief/inputs 和是否误复用了不同 viewer job 的组件；
- 只有中间帧异常：批量比较 start/mid/settled/end，确认是否只是动画中间态；以 settled frame 判定，不把正常动画当破版。

## 完成标准

一个 motion graphic 只有同时满足以下条件才算完成：viewer job 明确、design system 已读取、组件 job verified、正确 `assetId` 已落轨、目标 frame 中主体/字幕/文字均安全可读、`timeline.validate` 无违规。组件生成成功本身不等于 motion graphic 完成。
