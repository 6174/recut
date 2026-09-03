# 画面安全区与 B-roll / motion graphic 摆放（recut.editor · 薄适配层）

> 决策规则权威来源：`service/skills/recut-directing-b-roll`；本文件仅保留 `recut.editor` 介质映射（`timeline.command` 的 `param`/`preview.frame` 实现细节与验证步骤）。
> 主体保护、安全区、cover vs contain、人脸裁切、stacked split 等决策以全局 `recut-directing-b-roll` 为准，本文件不重复定义。

## 定位与边界

本文件是 `recut.editor` 对 `recut-directing-b-roll` 的薄适配层，只回答“摆放如何用时间线 op 与预览实现”。
放什么素材、是否需要 B-roll、选哪一段由全局 b-roll 决策；本文件仅说明在 `recut.editor` 中如何用 `param`（`transform.positionX/Y`、`scaleX/Y`、`borderRadius`）、`preview.frame` 审阅与验证落位。

## 决策路由表

| 决策问题 | 权威来源 | 全局文件 |
|---|---|---|
| 先看懂素材再剪（抽帧/主体/受保护信息/选段） | `recut-directing-b-roll` | `SKILL.md` 一 |
| 何时加 B-roll（可选 treatment）、开场/结尾留白、密集跳切合并 | `recut-directing-b-roll` | `SKILL.md` 二/八 |
| 主体与安全区保护、叠加位置与可读尺寸 | `recut-directing-b-roll` | `SKILL.md` 三 |
| PiP / 小窗 overlay 决策流程 | `recut-directing-b-roll` | `SKILL.md` 四 |
| cover vs contain 全幅适配策略 | `recut-directing-b-roll` | `SKILL.md` 五 |
| 人脸安全裁切（眼睛上三分之一、偏置、运镜全程保护） | `recut-directing-b-roll` | `SKILL.md` 六 |
| stacked split 工作版式与缝线字幕 | `recut-directing-b-roll` | `SKILL.md` 七 |

## 介质映射（App 特有，保留）

### 一、与时间线 op 的对应

- **PiP / overlay**：`timeline.command { type:"param", payload:{ ref, params:{ "transform.positionX":…, "transform.positionY":…, "transform.scaleX":…, "transform.scaleY":…, "borderRadius":24 } } }`；`opacity` 同理；圆角优先元素原生 `borderRadius` 24–36，特殊形状才用 mask/effect。
- **full-screen**：元素铺满画布，用 `transform` 缩放实现 cover/contain 语义；背景层用独立 graphic/图片元素垫底（与当前 design system 一致，不用临时纯色块）。
- **fit 策略逐源决定**：不批量默认 cover；画幅接近（同向差 <30%）可先 `cover`，差异大时先 `preview.frame` 审视源再定；受保护信息会丢时用 `contain` + 有意背景层。

### 二、预览与验证（App 步骤，必须）

1. **审视目标帧**：`preview.frame { timeSec }` 检查目标 A-roll frame，排除盖脸/口部/字幕/既有元素的区域；在剩余候选中选最大低信息区（不默认右下角）。
2. **审视源**：`preview.frame` 或 `recut.media.list_assets` 对源抽帧，识别主主体与受保护信息（文字/UI、姓名条、logo、产品边缘、卡片边界等）。
3. **落位**：在安全矩形内放到可读尺寸；源与目标双方受保护内容都要完整可见。
4. **验收**：摆放后 `timeline.read` + 必要时 `element.get` 检查 `start/duration/transform/fit`；再对受影响 frame 做 `preview.frame`（或 `preview.batch`/`contact-sheet`）像素验收——元素进库≠已落轨，落轨≠摆放正确。
5. **裁切对比**：cover/contain 前后截图对比，确认前景保护信息仍存活；人物面板的推拉/平移需保证面部在运动全程位于可见区域上三分之一（见全局六）。

### 三、Talking-head B-roll 决策入口（App 流程）

- B-roll 为可选 treatment，仅在全局二的触发条件满足时启用；默认不覆盖开场/结尾约 3s；密集跳切（间隔 < 约 3s）优先用一段连续 cutaway 覆盖整段而非闪切多素材。
- 先决定模式再选素材：**full-screen cutaway**（替代 talking head）vs **PiP / small-window overlay**（保留 talking head）；用户只说“加 B-roll”且风格无法推断时先问一次，不静默猜测。
- A-roll timing 变化后，所有 B-roll 引用窗口标 stale，需按当前 speech timeline 重新对齐与 `preview.frame` 复核。
