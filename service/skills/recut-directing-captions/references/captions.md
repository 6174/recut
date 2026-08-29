> 来源: Recut 自有存量 apps/editor/skills/recut-editor/references/captions.md + apps/remotion-studio/skills/remotion-studio/references/captions.md（内部复用，已作介质中性合并，仅去除宿主工具专属实现细节，保留导演判断原文）

# 字幕实践（Recut 自有存量合并版）

本文件合并自两份自有存量 captions.md，保持原文语言（中文）与导演判断的权威表述，仅去除宿主工具专属的 CLI/op 调用细节中与导演决策无关的实现噪音，保留介质无关的样式与层级纪律。两份原文的行文与表格均原样保留，按“编辑器视角的字幕轨纪律”与“Remotion 视角的主题选型”两节呈现。

---

## 第一部分：编辑器视角的字幕轨纪律（源自 apps/editor/skills/recut-editor/references/captions.md）

# 字幕实践（recut.editor）

> 字幕 = 字幕轨（text 轨 + `captionStyle`）上的 text 元素（带 `subtitle` 标记），与画面独立，永远最高层。剪映式：全轨共享样式（含位置），时间线上每条 cue 是独立一段。

## 结构

- 字幕轨：`type:"text"` 的轨道，带有 `captionStyle`（全轨共享样式 params，不含 `content`）。轨道有 `captionStyle` 即被 UI 视为"字幕轨"。
- 每条 cue：`type:"text"` 元素 + `subtitle: { source, cueIndex }` 标记，落在字幕轨。独立拖拽/裁剪/移动，但样式全轨统一。
- **共享样式**：编辑任一 cue 的文字外观/位置 → 自动广播到全轨（`content` 与时间除外）；新增 cue 自动继承字幕轨 `captionStyle`。
- 位置：按字幕轨锚点（`captionPlacement`）逐 cue 重算，多条 cue 底部对齐、居中。

## 推荐流程（介质中性表述）

0. **生成字幕**：先确认转写能力就绪，再对时间线上的有声素材生成字幕，轮询至完成即得到全局 transcript 资产与 SRT/分段，登记进项目后字幕轨上的 cue 由此资产派生、可自由编辑。
1. 在当前编辑会话没有新鲜项目快照时，先读取项目与现有轨道的快照，识别字幕轨（以 `captionStyle` 为标识）；已有快照直接复用。
2. **批量导入**：把 SRT/ASS 文本一次性铺成字幕轨，返回轨道与每个 cue 的引用；导入后改样式即全轨同步。
3. **读回字幕**：导出整条字幕轨的 SRT 文本（含 cue 计数与轨道标识）。
4. **精细编辑**：插入单条 cue 时落在字幕轨并自动继承共享样式；改全轨样式通过轨道级样式操作完成，任一 cue 的外观改动都会全轨同步。

## 参数（字幕 = text 元素 + 共享样式）

| 参数 | 说明 | 铁律 |
|---|---|---|
| `content` | 字幕文本（唯一不共享的参数） | 一条一个信息，不塞长句 |
| `fontSize` | 字号（app 单位；1080p 下有效字高 ≈ fontSize×12） | 字幕默认 5（≈60px 有效字高）；主标题 ≥8、辅助 ≥5 |
| `color` | 颜色 | 高对比（浅色文字 + 深底或反之），**无底框** |
| `textAlign` | 对齐 | 默认 `center` |
| `letterSpacing` / `lineHeight` | 字距/行高 | 长句开行高 ≥1.2 |
| `background.*` | 底框 | 默认关闭；开启时 `background.color` 高对比 |
| `transform.positionX/Y` | 位置 | 全轨统一，自动下三分之一；不手动写 |
| `transform.scaleX/Y`、`transform.rotate`、`opacity`、`blendMode` | 变换/混合 | 全轨统一 |

导入时的样式只写文字外观类键（fontSize/color/background.*/textAlign/letterSpacing/lineHeight/opacity/blendMode）；位置由后台按画布自动算（下三分之一）。

## 铁律

- **字幕无底框**：不用卡片/气泡/描边容器/投影块包住字幕；干净高对比文字叠在下三分之一。只有用户明确要求才例外。
- 字幕是叙事层，不与主标题争夺画面；主标题 ≥56px、字幕 ≥40px、辅助 ≥32px。
- 缩到约 480px 宽验收：字幕仍一眼读清。
- 一条字幕只承载一个新信息；信息太多先拆 cue，再放大字号，不缩小字号硬塞。
- 字幕永远最高层（独立字幕轨）；不与普通 text 混用一轨。
- 改全轨样式会全轨同步。

---

## 第二部分：Remotion 视角的字幕主题选型（源自 apps/remotion-studio/skills/remotion-studio/references/captions.md）

# 字幕主题目录（复用自 vshukla7/remotion-captions-themes，MIT）

> 用户选择主题后，把它写进 `palette.captionTheme`。组件源码以冻结副本形式存在 `workspace/remotion-kit/src/captions/`（新项目；旧项目为 `workspace/src/captions/`），直接复用 `CaptionTheme` 与 `buildCaptionsData`；目录与版本读 catalog，最新规范源用文件工具读源码目录。

## 用法

`ProjectVideo` 已经用 `<CaptionTheme data theme primaryColor secondaryColor fontSize />` 渲染全片逐词字幕，你只需设置：

- `palette.captionTheme` —— 主题 id（下表）；
- `palette.captionPrimary` / `palette.captionSecondary` —— 字幕主色 / 高亮色；
- 旁白文案放在 content scene 的 `narration`，`buildCaptionsData(narration, sceneStart, sceneDuration)` 自动生成逐词时间轴（确定性，由 frame 派生）。

也可以绕过模板直接用：

```tsx
import { CaptionTheme, buildCaptionsData } from "../captions";
const data = buildCaptionsData("这句话会成为字幕。", sceneStartSec, sceneDurationSec);
<CaptionTheme data={data} theme="pop" primaryColor="#ffffff" secondaryColor="#ffd700" fontSize={64} />
```

## 主题表

| id | 风格 | 说明 |
|---|---|---|
| `pop` | Pop 弹入 | 缩放弹入，清爽通用 |
| `karaoke` | Karaoke 扫光 | 逐词高亮扫过，适合歌词式字幕 |
| `kinetic-01` | Kinetic 动能排版 | 主词放大、侧词对齐的动能排版 |
| `kinetic-02` | Kinetic 变体 | 动能排版第二套 |
| `hustle` | Hustle 快节奏 | 快速进入，活力十足 |
| `grape` | Grape 倾斜强调 | 无底框的倾斜强调字幕 |
| `beast` | Beast 粗体高对比 | 粗体加高对比阴影 |
| `poppin` | Poppin 大写字幕 | 全大写 Poppins 字体 |
| `aarit` | Aarit 逐字缩放 | 电影感逐字缩放与渐变扫光 |
| `soft-ai` | Soft AI 柔焦 | 无底框的柔焦浮现 |
| `gaming-stream` | Gaming 霓虹 | 霓虹发光游戏风格 |
| `simple-one-word` | 单字聚焦 | 每次只高亮一个词 |
| `podcast` | Podcast 播客 | 播客风格的段落字幕 |

## 选择建议

- 信息型解说：`pop`、`simple-one-word`、`kinetic-01`
- 歌词 / 金句：`karaoke`、`aarit`
- 娱乐 / 游戏 / 社交媒体：`hustle`、`poppin`、`gaming-stream`、`grape`
- 高端 / 冷静：`beast`、`soft-ai`、`podcast`

主题内置字体（Outfit/Poppins 等）未随工程打包，离线时回退系统无衬线；如需固定观感，可在 `palette.fontFamily` 指定可用字体。字幕主题与整片色板要自洽——克制的模板不要混入不相干的亮色。

---

## 合并说明

- 两份原文合计 112 行（editor 66 行 + remotion-studio 46 行），本合并文件保留全部导演判断与表格，仅对宿主工具的 op 语法示例作介质中性转述（不删判断）。
- 字幕轨的“共享样式”“最高层”“无底框”“480px 验收”四条铁律为两份存量的交集，已在 SKILL.md 的层级与平台速查表中收敛为决策规则；主题表为 remotion 侧的独有增量，保留原表供选型时按需加载。
