# 口播与访谈剪辑（recut.editor · 薄适配层）

> 决策规则权威来源：`service/skills/recut-directing-a-roll`；本文件仅保留 `recut.editor` 介质映射（`script.*` 与 `timeline.command` 的 App 实现及与全局判断的对应表）。
> 语义决策（留哪些/删哪些、口癖/重拍/停顿/高光/重构等）以全局 `recut-directing-a-roll` 为准，本文件不重复定义。

## 定位与边界

本文件是 `recut.editor` 对 `recut-directing-a-roll` 的薄适配层，只回答“口播剪辑如何用文稿面与时间线 op 实现”。
是否删除、保留或重排某句话由全局 a-roll 决策；本文件仅说明在 `recut.editor` 中如何经 `script.attach/read/clean/apply/find/fix-transcript` 物化文稿、翻译为 `timeline.command` op 批，并处理下游 stale。交叉引用：B-roll 摆放见 `subject-protection.md`，音乐/duck 见 `music-beat-sync.md`，字幕见 `captions.md`，Motion Graphic 见 `motion-graphics.md`。

## 决策路由表

| 决策问题 | 权威来源 | 全局文件 |
|---|---|---|
| 依赖顺序：先结构后时序后润色 | `recut-directing-a-roll` | `SKILL.md` 一 |
| 语义单元原则、连接组织保护 | `recut-directing-a-roll` | `SKILL.md` 二/七 |
| 口癖三分类（无语义/语境相关/功能性） | `recut-directing-a-roll` | `SKILL.md` 三 |
| 重拍与重复、False Start 与残句 | `recut-directing-a-roll` | `SKILL.md` 四/五 |
| 停顿压缩 | `recut-directing-a-roll` | `SKILL.md` 六 |
| 高光/重构/hook/目标稿对齐、确认门槛 | `recut-directing-a-roll` | `SKILL.md` 八/十 |
| 可编辑文稿工作流（介质中性） | `recut-directing-a-roll` | `SKILL.md` 九 |

## 介质映射（App 特有，保留）

### 一、文稿剪辑工作流（`script.*` 面）

说话音频在 video/audio 元素（speech-track，`timeline.read` 的 `hasTranscript` 标识）。剪辑口播先走文稿面：

1. **绑定转写**：`script.attach { trackId, elementId, assetId }` 给说话元素绑转写素材（`assetId` 来自 audio-studio 转写产物或平台 transcript 素材；`timeline.read`/`element.get` 暴露 `hasTranscript`）。
2. **物化文稿**：`script.read` → 输出可编辑 markdown 到项目文件根 `scripts/timeline.md`，返回绝对 `path`，用原生编辑工具改；`showSilence:true` 时输出 `[gap=Xs]` 段间停顿标记。
3. **机械清理**：`script.clean { fillers:true, silence:"compress:300" }` 清固定口癖（呃/额/um/uh/er/ah）+ 批量压段间停顿。
4. **语义编辑**（原生 Edit 改 markdown）：
   - 行内 `~~x~~` = 只删 x 的音频（字符按比例映射到源区间）
   - 整行删除 = 删整段；行移动 = 改顺序
   - `[gap=Xs→Ys]` = 压缩段间停顿
5. **落地**：`script.apply`（传 `content` 或读 `scripts/timeline.md`）→ 翻译成 op 批逐条落 `timeline.command`，全部可 `history.undo`。
6. **定位/修复**：`script.find` 带时间戳找词；`script.fix-transcript { trackId, elementId, segmentIndex, text }` 只修 ASR 错词/说话人归属（不改音频，与 `script.apply` 边界不互换）。

**约束**：删词/压停顿后“变多 clip”是保留区间被切成新 clip 的正常结果；重建碎片内嵌 transcript 快照，`script.read` 可继续编辑同一段；停顿压缩仅作用于段间源停顿；行内删除的字符→时间映射按比例近似，需词级精确时先拆细段。

### 二、时间线 op 落地（手工路径，不用文稿面时）

| 编辑 | `timeline.command` 序列（带 `baseVersion`） |
|---|---|
| 删句中词/删停顿区间 | `split` 在边界 → `delete`(区间) → 剩余两段 `trim` 靠拢 |
| 删整段 | `delete`（后续 `trim` 收口） |
| 重排 | 拆成碎片后按序重设 `startSec`（`trim`） |
| 压停顿 | `trim` 缩短/闭合停顿区间 |

每步可 `history.undo`；完成后 `timeline.validate` 零违反 → `preview.frame` 验收。

### 三、Audio Studio 与转写前置（App 实现）

先 `workflow.context` 检查 `integrations.audioStudio` 与 source asset 的 transcript readiness：`ready`→`script.attach/read`；`running`→等待 job 不 busy-loop；`no-speech`/`failed`→报告结果不伪造 A-roll；`not-installed`→引导安装，仅用户同意才重路由到 voice-led/media-led/motion-graphics（`voice-assets.md`）。

### 四、操作 ↔ 全局判断对应表

| App 操作 | 对应全局判断 | 说明 |
|---|---|---|
| `script.clean { fillers:true }` | a-roll 三 类别1 | 仅固定清单（呃/额/um/uh/er/ah）安全删 |
| `script.clean { silence:"compress:300" }` | a-roll 六 | 仅压段间长停顿，句内呼吸不动 |
| 行内 `~~x~~` / 整行删除 / 行移动 | a-roll 二/四/五/七/八 | 必须按完整语义单元，保留连接组织，不拼碎片 |
| `script.fix-transcript` | a-roll 九-4 | 只改文本不改音频边界 |
| `script.find` + `script.read` 重读 | a-roll 九 | 定位与回读，下游标 stale 后修正 |

### 五、变更后的回读与下游失效（App 步骤）

每次 `script.clean`/`apply`/`fix-transcript` 或任何影响 speech timing 的 op 后：1) 重 `script.read`；2) 重 `timeline.read` 确认 clip 数与 `start/duration`；3) 检查逻辑断裂/过度删除/顺序错误/停顿过紧过松；4) 将旧 motion graphic/B-roll/字幕/音乐依赖标为 stale 先修正再继续。`A-roll` 定稿前不落下游层（见 `motion-graphics.md`/`subject-protection.md`/`music-beat-sync.md`/`captions.md`）。
