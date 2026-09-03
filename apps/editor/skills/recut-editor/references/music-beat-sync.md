# music-beat-sync — 卡点方法论（recut.editor · 薄适配层）

> 决策规则权威来源：`service/skills/recut-directing-editing`；本文件仅保留 `recut.editor` 介质映射（拍号获取的 App 实现与 `timeline.command` 落拍语法）。
> 纪律规则（节拍密度、落拍阈值、转场选型、渲后回测门禁）以全局 `recut-directing-editing` 为准，本文件不重复定义。

## 定位与边界

本文件是 `recut.editor` 对 `recut-directing-editing` 的薄适配层，只回答“卡点如何用时间线 op 实现”。
是否卡点、卡多密、用什么转场由全局 editing 决策；本文件仅说明在 `recut.editor` 中如何测定拍号、产出 `beatT(n)` 秒表并用 `split`/`trim`/`keyframe-upsert` 精确落拍，以及 `track.role`/`audio.smooth` 的 App 混音实现。

## 决策路由表

| 决策问题 | 权威来源 | 全局文件 |
|---|---|---|
| 5 秒节拍、段落结构、切点密度分层、动机检验 | `recut-directing-editing` | `SKILL.md` 一/二、`references/editing-and-assembly.md` |
| 卡点纪律（何时启用、网格测定、音乐结构表、最强 hit、渲后回测门禁） | `recut-directing-editing` | `SKILL.md` 三、`references/music-beat-sync.md` |
| 转场选型与硬切成立清单 | `recut-directing-editing` | `SKILL.md` 四、`references/editing-and-assembly.md` |
| 竖幅节奏密度与版式进出 | `recut-directing-editing` | `references/pacing-zh.md` |
| 镜头配方与卡点硬切的衔接 | `recut-directing-shot` | `references/shot-library.md`、`references/shot-recipes/rhythm/*` |

## 介质映射（App 特有，保留）

### 0. BGM 自动混音（`track.role` → auto-duck）

- 口播/旁白轨 → `track.role { role:"anchor" }`（其它轨 duck 到它，不设则无 duck）。
- BGM/氛围/B-roll 底 → `track.role { role:"follower" }`（自动 duck；`duckDepthDb` 缺省由 anchor 响度自动初始化）。
- 短 SFX/垫底/stinger → 不设 role（保持独立，不受 duck 影响）。
- `audio.smooth` 作为结构定稿后的最后一个音频步骤：对每个硬切边界做 ~120ms 微淡入/淡出、淡掉暴露边缘（`volume` 关键帧，幂等）；A-roll 结构再动需重跑。包络确定性 Preview==Export 共用同一 `buildDuckEnvelope`。

### 1. 节拍网格测定（拍号获取的 App 实现）

对 BGM 跑一次性脚本（`librosa` 不在系统 python 时用 `uv run --with librosa --with scipy --python 3.11`）：

```python
import numpy as np, librosa
y, sr = librosa.load("bgm.mp3", sr=None, mono=True)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, tightness=400, units="time")
i = np.arange(len(beats))
A = np.vstack([i, np.ones_like(i)]).T
(T, t0), *_ = np.linalg.lstsq(A, beats, rcond=None)
bpm = 60.0 / T
residual = beats - (t0 + i * T)
print(f"BPM={bpm:.2f}  t0={t0:.4f}s  T={T:.5f}s  残差±{np.abs(residual).max()*1000:.0f}ms")
```

产出 `beatT(n) = t0 + n*T`（拍号→秒，编辑器一律用秒）；残差是否可信、是否分段拟合、音乐结构表与最强 hit 的判据见全局 `references/music-beat-sync.md`。

### 2. 用拍号排时间线（`timeline.command` 落拍）

```text
# 120 BPM → T=0.5s，4 拍一镜 = 2s
timeline.command { op: { type:"insert", payload:{ element:{ type:"image", mediaId:"<assetId>", startSec:beatT(0), durationSec:2 } } } }
timeline.command { op: { type:"insert", payload:{ element:{ type:"image", mediaId:"<assetId>", startSec:beatT(4), durationSec:2 } } } }
# 精确切点：先放整段再 split { ref, atSec:beatT(n) }，删多余侧
timeline.command { op: { type:"split", payload:{ ref, atSec:beatT(n), retainSide:"both" } } }
# 卡点关键帧
timeline.command { op: { type:"keyframe-upsert", payload:{ ref, path:"opacity", atSec:beatT(n), value:0 } } }
```

镜头时长以拍为单位（4/8 拍一镜），加速段可用半拍/四分之一拍阶梯；切点是否落整数拍、误差阈值与动机检验见全局。

### 3. 渲后回测（App 实现的取证步骤）

```bash
ffmpeg -i export.mp4 -vn -acodec pcm_s16le /tmp/render-audio.wav
```

对渲出音轨重跑第 1 步拟合（从视频里量，连编码/对齐偏移一起验），合格/理想/必修阈值与回改流程见全局 `recut-directing-editing` SKILL.md 三。

> 何时启用：用户已指定强节奏 BGM → 测定网格并让每个切点/动效锚到拍号；未指定 BGM → 按内容节奏排，不强行卡点。工具备忘（`librosa.effects.hpss` 分离打击成分、变速曲分段拟合）与完整纪律见全局 `references/music-beat-sync.md`。
