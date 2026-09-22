# Storyboard Sheet Template

Load this file when分镜以**一张 N 宫格分镜表**压缩生成，默认整张直接驱动视频，仅按需按坐标展开（见 `SKILL.md` 的「一图分镜表（宫格压缩法）」）。

A sheet is a *contact sheet of intent*: one image holding the whole sequence so character, costume, set and light stay in one generation context. **Default: submit the whole sheet as the `storyboard` reference that drives video generation** — the reference budget is limited, so one sheet occupies one slot, not one per cell. Only expand a cell into a real keyframe when the escalation conditions apply (weak storyboard support or resolution, a precise first/last-frame endpoint, or a failed proof).

## 1. Grid contract

- Default **5 rows × 5 cols = 25** cells;降格依次为 `4×6=24` / `4×4=16` / `3×3=9`（按模型对多格的稳定性选）。
- Strictly equal cells with a thin black gutter; each cell tagged top-left `R{r}C{c}` and shot `#nn`, where `nn = (r-1)*cols + c`. Rows top→bottom, cols left→right.
- Every cell shares one STYLE LOCK, one cast, one costume, one set structure, one key-light direction.
- No text in the image beyond the coordinate/shot tag; no merged cells, no extra blank cells, no duplicated frames, no watermarks or title bars.

## 2. Sheet prompt skeleton

```text
[STYLE LOCK]
<冻结的视觉风格全文，逐字复用>

参考锚定表
<reference id kind role label /> 作为 <role 中文名> 锚定

分镜表（storyboard sheet）：
<一句话故事/脚本概要>
一张图内 5×5=25 格，严格等分、细黑缝；每格左上角标注坐标与镜号（R1C1 #01 … R5C5 #25）。
逐格内容按下列格清单执行，一格一个动作，相邻格人物/服装/道具/场景/光源一致，首尾状态衔接。
第 1 格为开场钩子，第 25 格为收束落点。

[负面约束]
无文字/字幕/水印/UI，无合并格，无多余空格，无重复画面，无格线外标题。
```

Notes:
- Put the **per-cell content in the manifest, not the prompt image description** — image text rendering is unreliable.
- The sheet is generated once as a single image; do not ask for "a grid" and then separate images.

## 3. Panel manifest schema (text, out-of-image)

Produce alongside the sheet; it is the machine-readable half the sheet cannot carry.

```json
[
  { "panel": 1, "coord": "R1C1", "shot": "#01",
    "size": "全景", "angle": "平视", "move": "固定",
    "action": "主角推门走进雨夜电台", "durationSec": 3,
    "beat": "开场钩子", "refs": ["character:<id>", "environment:<id>", "style-ref:<id>"] }
]
```

Field dictionary:

| Field | Must contain | Good | Bad |
|---|---|---|---|
| `panel` / `shot` | 1-based cell index / zero-padded shot id | `7` / `#07` | `seven` |
| `coord` | Grid coordinate `R{r}C{c}` | `R2C2` | `middle-left` |
| `size` / `angle` | One size off the ladder + a named height/angle | `近景, 平视` | `close-ish, dramatic` |
| `move` | Exactly one named move or `固定` | `slow dolly-in, 25cm over 3s` | `slight push` |
| `action` | One subject action per cell, with direction | `右手抬至门板 3cm 处停住` | `he hesitates` |
| `durationSec` | Seconds for this cell/shot | `3` | `a few seconds` |
| `beat` | Beat id/function from the beat sheet | `B2 · 揭示` | `emotional` |
| `refs` | Bound reference ids + roles | `["character:c1","environment:l1"]` | `main character` |

`∑ durationSec` must match the script's `durationSec`; each beat owns 3–5 cells.

## 4. Use: sheet → video (default), expand cells on demand

**Default — use the sheet directly.** Submit the whole sheet as `role="storyboard"` alongside cast (`character`), set (`environment`), style (`style-ref`) and voice references; the model expands the sequence from it. The reference budget is limited, so the sheet occupies **one** slot — never one slot per cell. Do not regenerate per-cell keyframes unless the escalation conditions below apply.

**Escalate to per-cell keyframes only when** the model handles storyboard references poorly or resolution is clearly insufficient, a shot needs a precise first/last-frame endpoint, or a representative-shot proof fails. Then:

1. Read the grid rows/cols and the `R{r}C{c}` tags with vision; confirm the grid is regular and equal.
2. Slice by deterministic pixel math `[c·W/cols, r·H/rows, W/cols, H/rows]` (platform `recut.media.gridSlice` when available, else ffmpeg crop). Pair every slice with its manifest entry by `coord`.
3. Per cell, regenerate a real keyframe: references = that slice (`role="storyboard"`) + cast (`character`) + set (`environment`) + style (`style-ref`); prompt it to remove the gutter/coordinate tag, raise resolution, and keep identity/costume/prop/light consistent with neighbours.
4. Feed the keyframe into the shot/video step; the cell's start→end state is that shot's first/last-frame contract.

## 5. Self-check before submitting

- [ ] Grid is equal, tagged `R{r}C{c}`, and matches the manifest count
- [ ] One STYLE LOCK, one cast/costume/set/light across all cells
- [ ] Manifest covers every cell; `∑ durationSec` = script duration; every beat covered
- [ ] Each cell is one action with a start→end state; last state = next cell's start
- [ ] Default is the whole sheet as the `storyboard` reference; any per-cell keyframe is regenerated (never upscaled) and only after an escalation condition
