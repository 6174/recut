---
name: recut-motion-graphic
appId: recut.platform
description: 全局 Motion Graphic 创作技能（App 无关）：把一个 viewer job 变成可复用、可验证的图形素材——先定视觉语法与 surface，用 @recut/runtime 写确定性组件，经 motion-graphic.create/revise 构建为 verified 素材，再交给时间线放置。不决定导演取舍（归 recut-director/references/motion），不执行时间线 op（归 recut-editor）。
---

<!--
 [INPUT]: 依赖 recut-design-system 的视觉契约、组件工具（motion-graphic.create/revise/update/source/list）、@recut/runtime surface 与任意消费方（时间线 / World 画布 / clone / AI 短片）的放置能力。
 [OUTPUT]: 全局 Motion Graphic 创作契约：viewer job → 视觉语法 → surface → 组件源码 → verified 素材 → 放置与目标帧验证的完整链，以及复用、批量、失败分类与确定性纪律。
 [POS]: 平台级「动效图形创作」技能（appId=recut.platform）；只负责把概念做成素材。导演取舍在 recut-director/references/motion，时间线落轨在 recut-editor，设计语言在 recut-design-system。
 [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# Motion Graphic 创作（recut-motion-graphic）

Motion graphic 是帮助观众更快理解信息、关系或章节的视觉层，不是把字幕包进卡片，也不是给每个 scene 加一条装饰条。每个 motion graphic 必须有明确的 viewer job，并且同时满足视觉语言、画面构图和时间线证据。**组件（motion graphic）只是实现载体，不是创作语义。**

本技能是**全局、App 无关**的创作技能：同一份 motion graphic 素材可以被时间线编辑器、World 画布、clone、AI 短片复用，因此创作知识不私有于任何 App。

## 边界声明

- **导演取舍**（viewer job、动效嗓音、一镜一动作、落定呼吸）→ `recut-director（references/motion）`。
- **本技能** → 把已定的 concept 做成一份可复用代码素材：视觉语法、surface、inputs、确定性动画、构建/验证、复用与批量。
- **时间线落轨**（`timeline.placeComponents`、轨道、start/duration、params）→ `recut-editor`。
- **设计语言**（配色、字体、间距、风格包）→ `recut-design-system`。

## 适用与前置条件

适用于标题卡、章节标记、关键引语、统计数字、列表、比较、流程、关系图、抽象概念和程序化视觉。开始前必须知道：

- motion graphic 服务的内容事实、目标观众和出现的 speech/visual beat；
- 目标画布尺寸与 fps（`fullscreen` 组件要按画布设计；`local` 组件按自身设计尺寸）；
- 目标 scene 的实际 settled frame（不是只凭时间戳猜位置）；
- motion graphic 是覆盖 A-roll 的透明 overlay，还是故意替代底片的 opaque/full-screen beat；
- 可变文字、颜色、数字、图片/视频来源哪些要做成 motion graphic inputs。

## 从 concept 到视觉语法

Motion Graphic 的目标是让观众看见关系、节奏和视觉隐喻，而不是把内容排成一个可操作的 UX 面板。先画 primitive plan，再探索最能承载它的 surface：

| 概念需要 | 可以探索的表达 | 何时换方案 |
|---|---|---|
| 二维文字、图表、流程、标注、图形转场 | React + SVG（`path`、`mask`、`clipPath`、`stroke/fill`） | 自然换行、复杂文本流或真实 HTML 语义更贴合 concept 时用 DOM |
| 平面/2.5D 图形、路径、空间关系、粒子或光线 | R3F + `THREE.Shape`/ShapeGeometry/曲线 Path | 体积、材质或光照本身成为 concept 时再用 mesh |
| 纯静态简单形状且低层 op 已能表达 | 时间线 graphic op | 需要逐元素动画、数据驱动或复用时升级为组件 |

避免把视频里的信息惯性实现为重复 rounded card、chip、表格或“网页截图”。它们可以成为一种视觉隐喻，但 brief 应说明它们为何服务于 viewer job。

如果请求是对已有 motion graphic 的调整，先把它当作局部视觉修订：读取目标 frame 和现有 motion graphic/source，沿用原有视觉语言与 placement，只修改用户点名的内容、参数或动效。只有现有形式无法承载新 viewer job 时，才创建新 motion graphic；不要因为一个局部改动重做整组 motion graphics。

没有 active style 时：用户已给出具体风格就照用；用户说“直接做/不要问”则从内容和素材选择一套明确但可更换的 Recut design system，并把它标为 provisional；否则先读取 recut-design-system 的 `design-systems/catalog.json`，选 2–4 个合理方向，说明差异后再开始批量制作。generic 的“高级、现代、干净、专业”不是视觉语言，不能直接拿来生成组件。

## 统一的 motion graphic 生产链

```text
style list/get
  → 确认本片视觉语言
  → 选择一个 viewer job 做 representative motion graphic
  → motion-graphic.create（只生成素材，不落时间线）
  → recut.job.wait 到 verified
  → 交消费方放置（时间线 timeline.placeComponents / 画布 / clone）并 preview.frame
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

只有以下条件都相同才复用同一组件 asset：viewer job、信息结构、视觉 form、画布角色。只要 job 不同，就创建新的 motion graphic asset，但共享同一套 palette、type、spacing、material 和 motion language。相同颜色不等于可以复用同一组件。

## 目标帧与保护区

创建前先对目标时刻取实际 settled frame（时间线用 `preview.frame`），必要时用 `element.get` 查看现有 overlay。把 A-roll 的 face/head/mouth、关键手势、产品或 logo、字幕带和已有图层视为 protected regions；在剩余的最大低信息区放置 motion graphic，优先保证阅读尺寸，而不是固定“右下角”。

- transparent overlay 默认避开脸、嘴和字幕带；必须在目标帧完整可读；
- opaque/full-screen motion graphic 是有意的视觉节拍，可以覆盖人物，但必须有明确的章节、结论或信息承载理由；
- overlay 使用自然尺寸的 `mode:"local"` 组件，最终画布位置由消费方决定；只有确实铺满整幅画面时才用 `mode:"fullscreen"`；
- 文字、图表和视觉主体在 1080p 画面中必须达到可读尺寸：主信息约 ≥56px、字幕 ≥40px、辅助信息 ≥32px；
- 任何 crop/contain/position 争议都要在实际 composed frame 中回看，不能只检查 asset 已进入素材库。

## 组件实现约束

组件的 SDK、surface、inputs、`getBaseSize`、`getContentBounds`、确定性动画和构建错误见 `references/material.md` / `references/authoring.md` / `references/gsap.md`。motion graphic 工作流额外要求：

- 所有可变文字、primary/accent colors、关键数字、image/video source 都是 inputs，并和消费方的 `params` 同名；
- `brief` 最好同时写 `viewer job`、`visual metaphor`、`primitive plan` 和 `surface rationale`；不要只写“做一个高级卡片/现代组件”。
- 背景默认透明；需要 opaque surface 时由组件自己拥有 `background`/`bgColor` input，不另放一张 solid fallback；
- 动画统一走 GSAP Timeline（react/r3f）：先设计 settled frame，再设计入场；一镜只让一个层级主角承担主要动作，落定后留 hold；入场约 0.8–1.2s，禁止无意义的无限循环（`mode:"loop"` 只用于氛围元素，且需 brief 支持）；
- 用 flex/grid/gap/自然换行布局文本，给可变长文案预留空间；不要用散落的 absolute top 值把可读文本堆在一起；
- 不把 motion graphic 写成 UI 截图、重复 chip 或万能 rounded card；表面材质、渐变、glow、grain 只有在 design system 或 viewer job 要求时使用；
- 不把最终画布坐标写进 motion graphic source，也不把 `project.load/project.save` 当作组件交付路径。

## 创建与批量更新

1. `motion-graphic.create({ items, design, references })` 一次创建同一批候选；把统一风格和 viewer job 的简短说明写进每项 `brief`，`design` 只传当前支持的 canvas/locale，参考组件或素材放在 `references`，然后等待统一 job 终态。
2. 从完成结果读取每个 `components[].assetId` 和 `componentId`；失败项不要用文字或 raw rectangle 静默替代。
3. 入片时交消费方放置：时间线调用一次 `timeline.placeComponents({ baseVersion, items })`，每项至少包含真实 `assetId`、`startSec`、`durationSec`，必要时带 `params`。
4. 放置成功后回读消费方结构（时间线用 `timeline.read`），再对代表性 start/settled/end 时刻取 frame 复核。
5. 只有同一视觉 form 的重复实例通过目标帧检查后，才批量扩展；不同 job 使用不同 motion graphic asset，并共享 design system，而不是复制源码后逐个微调。

## 失败分类与修复顺序

- build/shape/determinism 失败：读 job 错误，修 motion graphic source 或 inputs；不要重复提交相同坏 payload；
- asset ready 但构图失败：先改放置的位置/尺寸/fit；不要先重写组件；
- settled frame 文字溢出/遮挡：先调整 form 或 content density，再改字号；不要用更多 keyframe 掩盖布局问题；
- 多个实例样式漂移：检查既定的风格方向、brief/inputs 和是否误复用了不同 viewer job 的组件；
- 只有中间帧异常：批量比较 start/mid/settled/end，确认是否只是动画中间态；以 settled frame 判定，不把正常动画当破版。

## References 路由表

| 文件 | 何时读 | 覆盖问题 |
|---|---|---|
| `references/authoring.md` | 需要写组件源码、选 surface、设计 inputs、处理类型与验证时 | 组件创作指南、surface 形状、参数设计、动画与常见坑 |
| `references/material.md` | 需要 motion graphic 工具契约、mode 语义、放置与验证闭环时 | SDK `@recut/runtime`、`motion-graphic.*` 工具、`mode`、`timeline.placeComponents` |
| `references/gsap.md` | react/r3f 需要 GSAP 确定性编排时 | 五条铁律、timeline/useTimeline、缓动、白名单插件、性能与禁项 |

## 完成标准

一个 motion graphic 只有同时满足以下条件才算完成：viewer job 明确、design system 已读取、组件 job verified、正确 `assetId` 已放置、目标 frame 中主体/字幕/文字均安全可读、消费方结构校验（时间线 `timeline.validate`）无违规。组件生成成功本身不等于 motion graphic 完成。
