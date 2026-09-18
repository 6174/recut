# Editor 文本资源库：文本样式预设 + 组合型文本组件

状态：Draft / 待评审（本 RFC 含 P0 实施）

## 目标

把编辑器「文本」Tab 从单一「默认文本」卡片升级为**有二级分类的文本资源库**，覆盖真实剪辑里高频的文本场景：标题、正文/描述、引用、标签、列表、标注（带箭头）、数据、人物条与组合排版。

实现手段两种，按复杂度择优：

1. **文本样式预设（原生 text 元素）**：一个预设 = 一个原生文本元素，携带完整样式参数与示例文案。廉价、清晰、可用现成字体系统 / 样式面板 / 文字动画，且拖拽定位与编辑体验与默认文本完全一致。
2. **组合型文本组件（builtin component，surface=react）**：一个组件 = 一个对象，内部承载多段不同字号的文字与装饰（引号、箭头、色条、圆角卡片、编号圆点、步骤箭头），并**自带确定性入场动画**（对齐剪映文本组件的动效直觉）。这是「多段样式 / 非文字装饰 / 自带节奏」场景的主路径。

前者是「单个文本元素」路径，后者对应「组合多个文本元素」的等价物，且是组合场景的主路径。

## 背景与现状

- 文本 Tab：`text/components/assets-view.tsx` 只渲染一张「默认文本」卡片，调用 `buildTextElement` + `editor.timeline.insertElement`。
- 文本能力已很完整：`params/registry.ts` 的 text 元素参数支持 content / fontFamily / fontSize / color / textAlign / fontWeight / fontStyle / textDecoration / letterSpacing / lineHeight / stroke.* / background.*，`\n` 多行与 `boxWidth` 自动换行都可用；`text-style-presets.tsx` 已在属性面板提供 10 个样式缩略卡。
- 组件系统已支持 `surface: "react"`（DOM 离屏捕获为纹理）：`html-object.tsx` + `html-surface.ts`，已有 `react-pulse-card` 等示例；内置组件封面由 `recut/builtin-cover.ts` 生成并缓存到 IndexedDB。
- 特效 / 组件 Tab 已经有成熟的「左侧二级分类 rail + 右侧可滚动网格」模式（`component-library.tsx` 的 `EffectLibraryView` / `ComponentLibraryView`），文本 Tab 直接对齐。
- `ComponentDefinition` 目前用 `category`（effect/3d）与 `group`（bg/scene/demo）决定归属，缺少「只在文本面板出现」的标记。

## 设计总览

```text
文本框
├─ 原生文本样式预设（TEXT_PRESETS）        ← 单元素，可拖拽/编辑/加文字动画
│    └─ group: title | body | quote | label | list | annotation
└─ 组合型文本组件（TEXT_COMPONENTS）        ← react surface，单对象多段排版
     └─ textGroup: title | combo | quote | annotation | list | stat | person | label
```

两类条目在同一个二级分类网格里呈现，共用一套分类词表。

## 数据模型 A：文本样式预设

新增 `text/presets.ts`：

```ts
export type TextGroupId =
  | "title" | "body" | "quote" | "label" | "list" | "annotation"
  | "stat" | "person" | "combo";

export interface TextPresetDef {
  id: string;
  nameKey: I18nKey;
  group: TextGroupId;
  keywords?: string[];
  /** 插入时的示例文案（可含 \n）。 */
  content: string;
  /** 覆盖 DEFAULTS.text.element.params 的样式参数（含 fontSize / boxWidth）。 */
  params: ParamValues;
}
```

插入路径复用 `buildTextElement`：

```ts
const element = buildTextElement({
  raw: { name: t(locale, nameKey), params: { ...DEFAULTS.text.element.params, ...preset.params, content: preset.content } },
  startTime: currentTime,
});
editor.timeline.insertElement({ element, placement: { mode: "auto" } });
```

拖拽：`TextDragData` 扩展可选 `params` 字段（当前只带 content，拖拽会丢样式），`executeTextDrop` 合并 `dragData.params`。卡片预览用 `preset.params` 生成 CSS 缩略（颜色 / 字重 / 描边 / 背景 / 行高），与 `text-style-presets.tsx` 的 `sampleStyle` 同思路。

### P0 预设清单（17）

| group | id | 名称 | 关键参数 |
|---|---|---|---|
| title | `title-hero` | 大标题 | 44px bold 白，细黑描边 |
| title | `title-outline` | 描边标题 | 40px bold 白，黑描边 0.8 |
| title | `title-boxed` | 色块标题 | 30px bold 白，黑底圆角块 |
| title | `title-neon` | 霓虹标题 | 40px 青 #00e5ff，深描边 + 字距 |
| body | `body-clean` | 正文 | 16px 白，行高 1.4 |
| body | `body-strong` | 强调正文 | 18px bold 白，描边 |
| body | `body-caption` | 字幕条 | 18px 白，黑底圆角 24 + 内边距 |
| body | `body-mono` | 等宽说明 | Courier New，深底浅字 |
| quote | `quote-line` | 引号引言 | 22px 斜体，多行 + 署名 |
| quote | `quote-serif` | 衬线引言 | Georgia 24px 米色 |
| label | `label-solid` | 实心标签 | 16px bold 白，红底胶囊 |
| label | `label-outline` | 描边标签 | 16px 青字，深底胶囊 |
| label | `label-hashtag` | 话题标签 | 18px bold 蓝 |
| list | `list-numbered` | 数字列表 | 多行 01/02/03 |
| list | `list-bullet` | 圆点列表 | 多行 • 要点 |
| annotation | `annotation-arrow` | 箭头注释 | 20px bold 黄，`→ 文案` |
| annotation | `annotation-note` | 提示说明 | 15px 浅字深底左对齐 |

## 数据模型 B：组合型文本组件

在 `ComponentDefinition` 增加：

```ts
/** 文本面板二级分类；设置后该内置组件只出现在文本面板，不进入组件面板。 */
textGroup?: TextGroupId;
```

新增 `runtime/components/text-shared.ts`（公共基座：动画原语 / SVG 几何 / 参数工厂）、`text-library.tsx`（9 个结构型组件）与 `text-effects.tsx`（12 个 SVG 视觉型组件），后者并入 `TEXT_COMPONENTS`，在 `registerBuiltinComponents` 注册。约定：

- **必须显式声明 `surface: "react"`**：缺省为 `r3f`，会让 `<div>` 直接进 R3F 树并触发错误兜底（红方块）。
- `origin` 缺省 builtin，`selectable: true`。
- `inputs` 使用现有参数类型：`text` / `number` / `color` / `select` / `font`；文案类不可关键帧（`text` 类型天然如此）。
- `getBaseSize` 返回固定设计尺寸；`getContentBounds` 返回整个内容区（避免逐像素 alpha 扫描，选择框稳定）。
- 渲染只用内联样式；字体用输入值 + 系统 fallback；静态无墙钟，动效交给元素 transform 关键帧 / 动画预设。
- **内置动画**：组件内部按 `localTime` 的确定性纯函数做入场（错峰 `reveal`/`pop`）与轻量环境脉冲（`pulse`），
  不读墙钟、不随机，Preview == Export 逐帧一致；元素级可再叠加运动预设与关键帧动画。
- 文案默认值给出真实示例；面板缩略图取入场结束后的 settled 时刻渲染，避免停在初始隐藏态。
- **渐变描边**：`-webkit-text-stroke` 会盖住 `background-clip:text` 的渐变填充，渐变字统一走 `text-fill.tsx` 的 `GradientFillText`（描边作独立底层，前景只负责渐变），避免厚描边把字吃黑。

### P0 组件清单（34 = 9 结构型 + 13 视觉型 + 12 风格型）

**结构型（`text-library.tsx`，多段字号/装饰的版式）**

| textGroup | id | 名称 | 结构 |
|---|---|---|---|
| combo | `text-title-stack` | 标题组合 | 强调条 + 主标题 + 副标题（三段不同字号） |
| title | `text-highlight-title` | 高亮标题 | 标题 + 强调色底高亮词 |
| quote | `text-quote-card` | 引用卡片 | 大引号 + 引用正文 + 署名 + 圆角卡 |
| annotation | `text-arrow-callout` | 箭头标注 | 标签胶囊 + 指向箭头 |
| list | `text-numbered-list` | 序号列表 | 编号徽标 + 多行条目 |
| list | `text-steps-flow` | 流程步骤 | 圆号 + 横向箭头链 |
| stat | `text-stat-figure` | 数据大字 | 大数字 + 说明 + 趋势 |
| person | `text-lower-third` | 人物条 | 色条 + 姓名 + 头衔 |
| label | `text-badge-label` | 标签徽章 | 圆点 + 文字胶囊 |

**视觉冲击型（`text-effects.tsx`，大量 SVG 装饰，对齐剪映观感）**

| textGroup | id | 名称 | 视觉手法 |
|---|---|---|---|
| title | `text-neon-sign` | 霓虹灯牌 | SVG 霓虹管框 + 多层 text-shadow 辉光 + 闪烁 |
| title | `text-shine-title` | 流光标题 | 渐变文字 + 逐帧扫光（background-position） |
| title | `text-3d-title` | 立体标题 | 多层 text-shadow 挤出 + 高光描边 |
| combo | `text-banner-title` | 横幅标题 | 圆角横幅 + 虚线内框 + chunky 斜体描边字（剪映「记得点赞哦」式） |
| title | `text-brush-title` | 笔刷标题 | SVG 笔刷色块 + 高光笔触 |
| title | `text-underline-title` | 下划线标题 | SVG 手绘下划线 stroke-dashoffset 描出 |
| title | `text-sparkle-title` | 闪亮标题 | 金色渐变字 + SVG 四角星闪烁 |
| combo | `text-sticker-pop` | 贴纸爆炸 | SVG 星芒爆炸底 + 粗白描边贴纸字 |
| combo | `text-corner-frame` | 角框标题 | SVG 四角取景框向外展开 |
| quote | `text-comic-bubble` | 漫画气泡 | SVG 对话气泡路径 + 弹入 |
| label | `text-tape-label` | 胶带标签 | SVG 胶带（撕口）斜贴 |
| annotation | `text-speed-lines` | 速度线 | SVG 速度线错峰滑入 + 斜切标题 |
| body | `text-highlight-marker` | 荧光笔 | SVG 荧光笔色块从左划出 |

**风格多样型（`text-variants.tsx`，对齐剪映多风格，形成多样性）**

| textGroup | id | 名称 | 视觉手法 |
|---|---|---|---|
| annotation | `text-news-bar` | 资讯条 | 深色条 + 左侧强调块 + 脉冲点 |
| title | `text-glow-title` | 辉光标题 | 白色字 + 多层彩色辉光呼吸 |
| title | `text-heart-title` | 心动标题 | 粉色渐变字 + SVG 心跳爱心 |
| title | `text-check-title` | 对勾标题 | SVG 对勾徽标（描出）+ 粗描边字 |
| label | `text-pill-label` | 胶囊标签 | 光泽胶囊 + 扫光 |
| combo | `text-star-burst` | 星芒推荐 | SVG 大四角星 + 红描边白字 |
| stat | `text-number-plus` | 数据 +1 | 标签 + 弹跳数值 |
| body | `text-caption-dots` | 小字花边 | 小字 + SVG 侧边点线 |
| combo | `text-ribbon` | 缎带横幅 | SVG 折角缎带展开 |
| title | `text-outline-title` | 空心描边 | 透明填充 + 粗彩色描边 + 上下细线描出 |
| combo | `text-corner-marks` | 对角标 | 四角短线向外展开 |
| label | `text-tab-label` | 目录标签 | SVG 文件夹标签形 + 虚线内框 |

全部 34 个组件均自带入场动画（色条/箭头展开、文字错峰上滑、卡片缩放、徽标弹入、扫光/闪烁/闪星/心跳/脉冲），并为 `localTime` 纯函数。视觉型组件统一使用 `chunkyText`（厚描边 + 挤出投影 + 900 字重斜体），保证在任意画面上都清晰突出。

## 分类与面板 UX

- 二级分类词表（两类条目共享）：`all / title / body / quote / label / list / annotation / stat / person / combo`，只展示当前有内容的分类。
- 布局对齐特效 / 组件面板：左侧 `w-16` 竖排分类 rail + 右侧 `overflow-y-auto` 网格。
- 卡片：统一 `DraggableItem`（16:9，`RESOURCE_CARD_ASPECT_RATIO`）。
  - 预设卡：CSS 文本缩略，可拖拽（`dragData.type = "text"`，带 `params`）+ 悬浮加号点击插入。
  - 组件卡：**直接渲染组件自身 `render`（默认参数、t=0）按卡片尺寸等比缩放的实时缩略**，不可拖拽，点击加号插入（与组件面板一致）。不用离屏 PNG 封面——组件 base size 常大于封面 harness 的 640×360 世界，PNG 会被裁切；文本组件也因此不参与 `builtinLibraryComponents()` 的封面生成。
- 「全部」分组：先预设后组件。
- 组件面板过滤：`ComponentLibraryView` 排除 `definition.textGroup` 的组件，避免与文本面板重复。

## 与既有系统的边界

- **字幕 Tab**：字幕是「按时间轴切分的 cue」，文本 Tab 是「独立文本对象」；二者不合并。
- **组件 Tab**：文本组件进文本面板；组件面板只保留 3D/背景/示例与用户组件素材。
- **属性面板**：预设元素走原生 text 样式面板（含 10 个样式预设与文字动画）；组件元素走 `ComponentParamsTab` 的 inputs 表单（含字体选择）。
- **时间线片段色**：组件片段按 `ComponentDefinition.color` 着色（`timeline-element.tsx` 内联覆盖 graphic 轨主题色），不再所有组件统一落成品红色；结构型组件的主力文字统一改用 `chunkyText`（厚描边 + 挤出投影），与视觉型组件观感一致。
- **动画**：预设元素天然支持文字分段动画；组件元素支持 transform/opacity 关键帧与元素级动画预设。

## 目录与文件

```text
web/timeline-editor/src/
  text/presets.ts                              # 新增：TextGroupId / TEXT_GROUPS / TEXT_PRESETS / 缩略样式
  text/components/assets-view.tsx              # 重写：二级分类面板，合并预设与组件
  runtime/components/text-shared.ts            # 新增：文本组件公共基座（动画原语 / SVG 几何 / 参数工厂）
  runtime/components/text-fill.tsx             # 新增：渐变填充 + 独立描边底层展示字（描边不盖渐变）
  runtime/components/text-library.tsx          # 新增：9 个结构型组合文本组件
  runtime/components/text-effects.tsx          # 新增：13 个 SVG 装饰的视觉冲击型文本组件
  runtime/components/text-variants.tsx         # 新增：12 个风格多样型文本组件
  runtime/components/index.ts                  # 注册 TEXT_COMPONENTS
  runtime/types.ts                             # ComponentDefinition.textGroup
  timeline/drag.ts                             # TextDragData.params
  timeline/controllers/drag-drop-controller.ts # executeTextDrop 合并 params
  components/editor/panels/assets/views/component-library.tsx # 组件面板排除 textGroup
  i18n.ts                                      # textLib.* 中英词条
```

## 分期

- **P0（本 RFC 实施）**：类型 + 拖拽参数 + 17 预设 + 9 组件 + 注册与面板分类 + i18n + README。
- **P1**：预设分组内搜索、悬停实时预览（组件）、更多组合（对比 / 时间线 / 对话气泡）、文字组件与字幕样式互通。
- **P2**：文本预设允许用户「另存为」；AI 生成文本组件入素材库后归入文本面板；预设 favorites / 最近使用。

## 风险与取舍

- **组件字体**：离屏封面 harness 的 iframe 未必加载平台字体，封面可能回退系统字体；正文渲染在编辑器主文档内正常。P0 用系统字体栈兜底。
- **DOM 捕获成本**：组合组件每实例一张离屏 DOM 纹理；文本量大时优先推荐原生预设。面板文案已按「组合才用组件」引导。
- **一致性**：组件文案不可用原生样式面板编辑（走 inputs），这是「组件 vs 原生元素」的既有取舍；通过暴露 font/color 输入缓解。
- **拖拽**：只给原生预设开放拖拽；组件保持点击插入（与组件面板一致，避免 graphic/component 拖拽语义错配）。

## 验收

- 文本 Tab 出现二级分类，至少 6 个分类有内容；「全部」下预设 + 组件同格。
- 预设点击 / 拖拽均插入带样式的文本元素；属性面板可继续编辑全部样式与动画。
- 34 个文本组件点击插入为 component 元素，可在属性面板改文案与颜色，不依赖 PNG 封面且不会出现在组件 Tab。
- `npx tsc --noEmit`（web）通过，`next build` 通过。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
