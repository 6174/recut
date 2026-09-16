> 来源: Recut 自有存量 — `apps/editor/skills/recut-editor/references/music-beat-sync.md` 与 `apps/remotion-studio/skills/remotion-studio/references/music-beat-sync.md` 合并（内部复用，搬运日期 2026-08-29）。冲突处按场景分层收编，原文语言与代码示例保留。

# music-beat-sync — 卡点方法论（合并版）

> 本文档为两份同源文档的合并版。**场景分层**：时间线介质（editor）与代码组合介质（remotion-studio）的表达差异已分层保留——时间线侧用秒与轨道操作描述，代码侧用帧与常量描述，卡点纪律本身一致：成片切点误差 ≤3 帧（感知阈值）。

---

## 0. BGM 的自动混音（track role → auto-duck）

> 来源：`apps/editor/skills/recut-editor/references/music-beat-sync.md` §0

- **一条 `track.role` 声明驱动整条混音**，不用手调音量：
  - 口播/旁白轨 → `track.role { role: "anchor" }`（其它轨 duck 到它，不设则无 duck）。
  - BGM/氛围/B-roll 底 → `track.role { role: "follower" }`（自动 duck；`duckDepthDb` 缺省由 anchor 响度自动初始化，想更贴或更冲才显式给 dB）。
  - 短 SFX/垫底/stinger → **不设 role**（保持独立，不受 duck 影响）。
- **`audio.smooth` 作为结构定稿后的最后一个音频步骤**：对每个硬切边界做 ~120ms 微淡入/淡出、淡掉暴露边缘（volume 关键帧，幂等）。A-roll 结构再动需重跑一次。
- 混音包络确定性：Preview==Export 共用同一 `buildDuckEnvelope` 计算，逐帧一致。

> 全局介质中性转述：混音以「锚点轨（人声）—跟随轨（音乐/氛围）—独立轨（短 SFX）」三类角色声明驱动，跟随轨自动避让锚点，结构定稿后以微淡入淡出收边。

---

## 0. 何时启用

- 用户已指定强节奏 BGM → 先分析节奏，再让每个切点/动效锚到拍号。
- 未指定 BGM → 时间线按内容节奏排，不强行卡点。

> remotion 版补充：阶段 0 先检查用户是否已指定音乐。已选好走本文档；未选则 BGM 选型放到后期阶段，此时动效时间线按内容节奏排。

---

## 1. 节拍网格测定（不信 tempo 标量，拟合 beat 序列）

对 BGM 跑一次性脚本（librosa 不在系统 python 时用 `uv run --with librosa --with scipy --python 3.11`）：

```python
import numpy as np, librosa
y, sr = librosa.load("bgm.mp3", sr=None, mono=True)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, tightness=400, units="time")
# 对 beat 序列最小二乘等距网格拟合：t_i = t0 + i*T
i = np.arange(len(beats))
A = np.vstack([i, np.ones_like(i)]).T
(T, t0), *_ = np.linalg.lstsq(A, beats, rcond=None)
bpm = 60.0 / T
residual = beats - (t0 + i * T)
print(f"BPM={bpm:.2f}  t0={t0:.4f}s  T={T:.5f}s  残差±{np.abs(residual).max()*1000:.0f}ms")
```

验收：残差 ≤ ±15ms（半帧内）→ 网格可信；残差大 → 变速段分段拟合。

> remotion 版实测注记：`beat_track` 返回的 tempo 标量可能偏差 2%+（实测 129.2 vs 真值 131.97），但其输出的 beat 时刻序列本身是好的——用整个序列拟合直线 `t_i = t0 + i*T` 求真值。

---

## 2. 鼓点与重音定位（决定大 slam 钉在哪一拍）

> 来源：`apps/remotion-studio/skills/remotion-studio/references/music-beat-sync.md` §2（editor 版无此节，合并保留）

```python
from scipy.signal import butter, sosfilt
sos = butter(4, [40, 160], btype="band", fs=sr, output="sos")  # kick 频段
kick = sosfilt(sos, y)
env = librosa.onset.onset_strength(y=kick, sr=sr)
times = librosa.times_like(env, sr=sr)
# 把每个整数拍位置的 env 能量列出来，排序找最强 hit：
for n in range(int((times[-1]-t0)/T)):
    t = t0 + n*T
    e = env[np.argmin(np.abs(times - t))]
    # 记录 (拍号 n, 能量 e)，取 top 若干作为"大 slam 候选拍"
```

产出两样东西进设计：

- **音乐结构表**：能量从第几拍起满、breakdown/静默在第几拍——分镜能量曲线贴着它排（breakdown 处放品牌呼吸位是天然结构）。
- **最强 hit 拍号**：全片 2–3 个最大 slam（开题/高潮/收尾）钉在整数拍上。

**易错**：强鼓点曲重音几乎总在整数拍；半拍钉点必须有能量数据支持，不凭听感。实测踩过：最大 slam 钉在 b52.5 而最强 kick 在整数拍 b52 上，渲后回测偏差 +5.75f。

---

## 3. 产出拍号秒表 beatT(n) 与结构

把 `t0`（拍 0 秒位）与 `T`（拍长）写进换算表：

```text
beatT(n) = t0 + n * T            # 拍号 → 秒（编辑器一律用秒）
镜头边界 = beatT(整数拍)，如 [0, beatT(8), beatT(16), ...]
```

- **最强 hit 拍号清单**与**音乐结构表**同上，作为分镜能量设计的事实源。
- 易错：强鼓点曲重音几乎总在整数拍；半拍钉点必须有能量数据支持。

---

## 4. 用拍号排时间线

### 场景分层 A — 时间线介质（editor）

```text
# 120 BPM → T=0.5s，4 拍一镜 = 2s
insert image A { startSec: beatT(0),  durationSec: 2 }
insert image B { startSec: beatT(4),  durationSec: 2 }
insert image C { startSec: beatT(8),  durationSec: 2 }
# 需要精确切点时：先放整段，再 split { ref, atSec: beatT(n) }，删多余侧
```

设计规矩：

- 镜头时长以拍为单位（4/8 拍一镜）；加速段可用半拍/四分之一拍阶梯（如收敛逼近 `beatT(48) → beatT(49.5) → beatT(50.5)`）。
- 每拍一动作的步进类镜头（清单逐项、数字滚动）直接把动作时间设为 `beatT(n)`。
- BGM 鼓点已密时动效克制：大 slam 只给 2–3 处，其余让位给鼓。

### 场景分层 B — 代码组合介质（remotion-studio）

把网格常量化，一切镜头边界/动效关键帧用 `beatF()` 表达：

```ts
export const FPS = 30;
export const BEAT0 = 0.2244;   // t0，秒
export const BEAT_INT = 0.45465; // T，秒
export const beatT = (n: number) => BEAT0 + n * BEAT_INT;          // 拍→秒
export const beatF = (n: number) => Math.round(beatT(n) * FPS);    // 拍→帧

export const SHOTS = {
  s0_open:  { from: 0,        to: beatF(8) },
  s1_slam:  { from: beatF(8), to: beatF(16) },
  // …每个镜头边界都是 beatF(整数拍)；镜头内部动效用局部拍：
};
export const localBeat = (shot: {from: number}, n: number) => beatF(n) - shot.from;
```

好处：换曲/换段落时改两个常量全片重排；SFX 钉帧表也写 `beatF(n)`，与画面共用同一事实源，永不错位。

设计规矩（与 A 层一致）：

- 镜头时长以拍为单位（4/8 拍一镜），加速段可用半拍/四分之一拍阶梯（如 `CUT_BEATS = [48, 49.5, 50.5, 51, 51.25]` 的收敛逼近）
- 每拍一动作的步进类镜头直接 map 拍号
- BGM 鼓点已密时 SFX 克制：只钉画面独有动作，大 slam 只给 2–3 处

> 两层纪律一致：**切点必须落整数拍 ±0.03s（约 1 帧），换曲只改 t0/T 两个常量。**

---

## 5. 渲后回测（闭环，必做）

```bash
ffmpeg -i export.mp4 -vn -acodec pcm_s16le /tmp/render-audio.wav
```

对渲出音轨重跑第 1 步拟合（从视频里量，连编码/对齐偏移一起验），逐一对比设计切点秒 vs 最近测得拍的秒。

| 判定 | 误差 |
|---|---|
| 合格 | ≤3 帧（感知阈值） |
| 理想 | ≤1.5 帧 |
| 必修 | >3 帧的任何切点 |

超标的切点回第 4 步改拍号或帧偏移，重渲再测直到全表合格。

> 实测：70s、18 镜、131.97 BPM 的强鼓点宣传片按此法制作，渲后回测全部切点误差 ≤2.2f。

---

## 6. 工具备忘

- 只有人声/复杂编曲会漂：先用 `librosa.effects.hpss` 分离打击成分再测。
- 变速曲（DJ 转场/accelerando）：按能量段分段拟合，各段各自 `t0`/`T`。
- 卡点关键帧：一律用 `beatT(n)` / `beatF(n)` 表达，换曲时只改两常量全片重排。
- librosa 不在系统 python：`uv run --with librosa --with scipy --python 3.11 script.py`
