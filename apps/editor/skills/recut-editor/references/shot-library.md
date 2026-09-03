# 镜头配方库（recut.editor · 薄适配层）

> 决策规则权威来源：`service/skills/recut-directing-shot`；本文件仅保留 `recut.editor` 介质映射（`timeline.command` op 语法骨架与秒级参数落位）。
> 与全局 `shot-library.md` 同源但本文件不重复决策；配方清单指向全局，`directing.md` 的嗓音预设决定时长/幅度微调。
> 强鼓点段落的拍号秒表 `beatT(n)` 见 `music-beat-sync.md`。

## 定位与边界

本文件是 `recut.editor` 对 `recut-directing-shot` 的薄适配层，只回答“镜头配方如何用时间线 op 表达”。
每个配方的**动作语法、时值、构图约束与风险**以全局技能为准；本文件仅保留 1–2 个 op 语法骨架示例，展示 `insert` / `param` / `keyframe-upsert` / `trim` / `split` 的落位方式，其余配方以路由表指向全局。

## 决策路由表

| 决策问题 | 权威来源 | 全局文件 |
|---|---|---|
| 镜头功能→景别/角度/焦段/运动的叙事选择 | `recut-directing-shot` | `SKILL.md` 决策规则、`references/cinematic-language.md` |
| 调度几何与走位 | `recut-directing-shot` | `references/blocking-and-staging.md` |
| 跨镜连续性与资产台账 | `recut-directing-shot` | `references/continuity-bible.md` |
| 选词与落 prompt 的措辞 | `recut-directing-shot` | `references/prompt-lexicon.md` |
| 完整配方卡（10 基础配方 + 八类 100+ 细分配方） | `recut-directing-shot` | `references/shot-library.md` + `references/shot-recipes/**`（camera/data/effects/interaction/opening/outro/rhythm/transition/typography/ui-entrance） |
| 导演风格覆盖 | `recut-directing-shot` | `references/director_styles/*.md` |
| 分镜表/首尾帧/节拍模板 | `recut-directing-shot` | `assets/shot-plan-template.md`、`assets/keyframe-prompt-template.md`、`assets/beat-sheet-template.md` |

## 介质映射：op 语法骨架（保留 2 个示例）

- 关键帧路径：`opacity`、`transform.scaleX/Y`、`transform.positionX/Y`、`transform.rotate`；文字额外 `content/fontSize/color/letterSpacing`。
- `ref` 来自 `insert`/`timeline.read` 返回值；时长单位秒；复杂需求（粒子、字形描画、shader 感）→ `component.create` 再按用户明确要求 `timeline.placeComponents`。

### 示例 1：标题淡入浮起 fade-up-title（开场/章节标题）

```text
timeline.command { op: { type:"insert", payload:{ element:{ type:"text", content:"主标题", startSec:0, durationSec:4, params:{ fontSize:96, color:"#FFFFFF", textAlign:"center" } } } } }
keyframe-upsert { ref, path:"opacity", atSec:0, value:0 }
keyframe-upsert { ref, path:"opacity", atSec:0.8, value:1 }
keyframe-upsert { ref, path:"transform.positionY", atSec:0, value:40 }
keyframe-upsert { ref, path:"transform.positionY", atSec:0.8, value:0 }
# 落定后 hold ≥1s（见全局 motion 落定呼吸），2s 后可退场
keyframe-upsert { ref, path:"opacity", atSec:2.5, value:1 }
keyframe-upsert { ref, path:"opacity", atSec:3.2, value:0 }
```

### 示例 2：推近 push-in（主体强调，静态图/长镜头）

```text
timeline.command { op: { type:"insert", payload:{ element:{ type:"image", mediaId:"<assetId>", startSec:0, durationSec:4 } } } }
keyframe-upsert { ref, path:"transform.scaleX", atSec:0, value:1 }
keyframe-upsert { ref, path:"transform.scaleY", atSec:0, value:1 }
keyframe-upsert { ref, path:"transform.scaleX", atSec:4, value:1.15 }
keyframe-upsert { ref, path:"transform.scaleY", atSec:4, value:1.15 }
# 需向主体偏移时 positionX/Y 同向补（全局「只推 scale 不调 position → 中心感」）
```

## 配方清单 → 全局对照（本文件不重复配方细节）

| 需求 | 配方名 | 全局位置 |
|---|---|---|
| 片头/标题登场 | fade-up-title / scale-reveal | `recut-directing-shot` `references/shot-library.md` + `references/shot-recipes/opening/*`、`typography/*` |
| 段落切换·舒缓 | crossfade | `references/shot-recipes/transition/shot-transitions.md` |
| 段落切换·对比 | slide-wipe | `references/shot-recipes/transition/*` |
| 高潮/强拍 | zoom-burst / beat-cut | `references/shot-recipes/rhythm/*`、`camera/*` |
| 静态素材呼吸 | push-in / pan-reveal | `references/shot-library.md` + `references/shot-recipes/camera/*` |
| 数字/证据强调 | spotlight | `references/shot-recipes/effects/*`、`data/*` |
| 收束 | breathing-hold | `recut-directing-motion` 落定呼吸 + `references/shot-library.md` |
| 数据/图表/粒子/文字/UI 等细分配方 | — | `references/shot-recipes/data/*`、`effects/*`、`typography/*`、`ui-entrance/*`、`interaction/*` 等八类按场景按需加载 |

> 一个镜头只用一个配方；相邻 scene 不重复同一种语法。幅度/时长按 `directing.md` 全局嗓音预设与素材尺寸微调；卡点硬切的切点必须落在 `music-beat-sync.md` 的 `beatT(n)` 整数拍 ±0.03s。
