# 导演语言（recut.editor · 薄适配层）

> 决策规则权威来源：`service/skills/recut-directing-motion`、`service/skills/recut-directing-editing`；本文件仅保留 `recut.editor` 介质映射（`timeline.command` op 语法、素材登记、验证与预览步骤）。
> 镜头配方见 `shot-library.md`，卡点见 `music-beat-sync.md`，字幕见 `captions.md`，口播/访谈剪辑见 `speech-editing.md`，B-roll/motion graphic 摆放见 `subject-protection.md`。文件名保持不变以维持交叉引用链。

## 定位与边界

本文件是 `recut.editor` 对全局导演技能的薄适配层，只回答“动效与节拍如何落到时间线 op”。
动效嗓音、5 秒节拍、呼吸、一镜一动作等**决策规则**以全局技能为准，本文件不重复定义；仅说明在 `recut.editor` 中如何用 `timeline.command` 的 `param`/`keyframe-upsert`、素材登记与 `preview.frame` 兑现这些决策。

- 决策问题（怎么动、何时切、切多快）→ 读全局技能。
- 落地问题（打什么关键帧、怎么登记素材、怎么验证）→ 读本文件。

## 决策路由表（读什么全局文件）

| 决策问题 | 权威来源 | 全局文件 |
|---|---|---|
| 动效嗓音（能量×调性两轴、预设表、过冲/squash） | `recut-directing-motion` | `SKILL.md` 一、`references/motion-graphics.md`、`references/aesthetic-rules.md` |
| 一镜一动作、落定呼吸、确定性 | `recut-directing-motion` | `SKILL.md` 二/三/五 |
| 5 秒节拍、段落结构、切点密度、转场选型 | `recut-directing-editing` | `SKILL.md` 一/二/四、`references/editing-and-assembly.md`、`references/pacing-zh.md` |
| 镜头动词与运镜语法、推/拉/横移等时值与约束 | `recut-directing-shot` | `SKILL.md` 镜头动词表、`references/shot-library.md`、`references/cinematic-language.md` |
| 卡点落拍纪律 | `recut-directing-editing` | `SKILL.md` 三、`references/music-beat-sync.md` |

## 介质映射：动效如何落到时间线

- **表达介质**：每个动效 = 元素 `params` + 关键帧（`timeline.command { type:"param" | "keyframe-upsert" }`），时长一律秒；`ref` 来自 `insert`/`timeline.read`。
- **入场**：对 `transform.scaleX/Y`、`transform.positionX/Y`、`opacity` 打关键帧实现；过冲 = 中段 `keyframe-upsert` 越过目标值再回落，squash = 竖/横向 `scale` 不同步。取值与时长按全局嗓音预设选取，本文件不重复预设表。
- **确定性渲染（硬性）**：动画 = 关键帧的纯函数 `f(t)`，禁止 `Math.random`/`Date.now`/`requestAnimationFrame` 等墙钟或随机源；同一 `ref` + 同一关键帧表在 Preview 与 Export 逐帧一致；只动目标 scene，改完按帧评审。
- **最小骨架示例**：
```text
timeline.command { op: { type:"insert", payload:{ element:{ type:"text", content:"主标题", startSec:0, durationSec:4, params:{ fontSize:96, color:"#FFFFFF", textAlign:"center" } } } } }
keyframe-upsert { ref, path:"opacity", atSec:0, value:0 }
keyframe-upsert { ref, path:"opacity", atSec:0.8, value:1 }
keyframe-upsert { ref, path:"transform.positionY", atSec:0, value:40 }
keyframe-upsert { ref, path:"transform.positionY", atSec:0.8, value:0 }
```

## 流水线与验证（App 特有）

- **依赖顺序**：本次编辑若新建或改变 A-roll，先冻结说话内容，再落 motion graphic/B-roll/音乐/字幕层；纯视觉/音频/资产微调不重做未受影响的下游。
- **素材登记**：所有媒体/组件素材落轨前必须经 `timeline.assets`（或 `asset.list`）登记真实 `assetId`，否则导出空画面；组件经 `component.create` 产出，`recut.job.wait` 到 `verified` 后用 `timeline.placeComponents` 落轨（`componentId` 仅用于 `component.source`/`revise`/`update`）。
- **验证**：结构定稿后跑一次 `timeline.validate`（要求零 `asset/track/overlap/range/component/param` 违规），再对受影响 scene 用 `preview.frame`/`preview.batch`/`preview.contact-sheet` 做 settled-frame 像素验收；验证与导出门禁详见 `verification.md`、`preview-export.md`。
- **字幕层级**：字幕始终最高层（独立 text 轨，下三分之一），参数见 `captions.md`。
