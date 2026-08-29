> 来源: DirectorSKILL-full (MIT)
> 原路径: assets/qc-checklist.md
> 搬运日期: 2026-08-29 — 模板/资产类文件，原样搬运，未做有损删改

# QC & Repair Checklist (Mode J)

Load this file when you are at Step 13 (QC and repair loop) or the user says a generation is
wrong. Diagnosis depth — the symptom, cause, and fix behind every F-code below — is owned by
[failure modes](../references/failure-modes.md). Retry budgets, version naming, and the approval
log are owned by [production workflow](../references/production-workflow.md). This file owns the
three gates, the score, and the report format.

Three gates, in order. PRE runs on the plan and keyframes before you spend credits, POST runs per
clip, SEQUENCE runs on the assembled cut. Only the PRE gate's failures are free to fix: a planning
error caught there costs an edit, and the same error caught after generation costs every clip built
on it.

Worked examples use project `Under the Door` (`UTD`), scene 7, the five-shot scene planned in
[beat sheet](beat-sheet-template.md), [director book](director-book-template.md), and
[shot plan](shot-plan-template.md).

## Gate 1 — PRE-GENERATION

| # | Weight | Category | Check |
|---|---|---|---|
| P1 | 20 | Story function | Every shot names a beat id and the job it does for that beat. A shot whose function is "it looks good" is deleted, not scored |
| P2 | 15 | Blocking & camera logic | Start, motion, end written for each shot; one dominant move at most; the move is inside the book's move budget and is motivated by what the audience must newly see |
| P3 | 25 | Keyframe integrity | The tick-box gate at the end of [keyframe prompt template](keyframe-prompt-template.md) passes: invariant strings verbatim, `kf-first` and `kf-last` sharing slots 2, 3, 5, 6, 7, 9, the checkable anchor visible at this shot size, hands visible or deliberately cropped, no rendered text |
| P4 | 20 | Prompt hygiene | The five-question self-check in [video prompt template](video-prompt-template.md) passes on every prompt: one action, one camera move, explicit end state, invariants present, negatives matched to real risk. Clip length sits inside the duration strategy owned by [ai video tool adapters](../references/ai-video-tool-adapters.md) — 3–5s for a face-carrying shot, 3–4s for fine hand work, 8–12s only where no legible face is in frame |
| P5 | 20 | Continuity setup | End state of shot N equals start state of shot N+1; era, props, and light state declared and consistent; seeds and reference assets recorded in the registry |

Score each 0–5, then `weighted = Σ (score ÷ 5 × weight)`.

- Threshold to generate: **80 / 100**. Below that you are buying rework.
- 90 and above: generate the whole scene. 80–89: generate, and expect one retry on the weakest
  shot. 70–79: fix the failing row first — it is cheaper than a retry. Below 70: the problem is
  the plan, and no number of generations will find it for you.

## Gate 2 — POST-GENERATION, per clip

Watch each clip four times: once at speed for the whole, once at 0.25× for hands and face, once
with the sound off, once with the sound only. The last two are not padding — picture errors hide
under plausible audio, and audio errors hide under picture you have already accepted.

| # | Weight | Category | Check | F-codes |
|---|---|---|---|---|
| G1 | 25 | Identity & wardrobe | Face, build, hair, the checkable anchor, and every garment hold from the first frame to the last | F1, F16 |
| G2 | 20 | Action & end state | The requested action happened, once, and the clip ends on the pose you specified | F4, F5 |
| G3 | 20 | Motion, anatomy, physics | Limbs and fingers stay countable; weight, contact, and gravity read correctly; speed matches life | F3, F10, F13, F14 |
| G4 | 10 | Camera behavior | One move, the one you asked for, at the distance you asked for; no unrequested drift or zoom | F6, F17 |
| G5 | 15 | Frame integrity | No extra people or objects; nothing that was in frame at the head of the clip has gone missing or come back changed at the tail; no rendered text or watermark; no morphing background | F9, F11, F19 |
| G6 | 10 | Look consistency | Lighting direction, level, color temperature, and grain hold across the clip | F12, F16 |

- **80–100**: use as-is.
- **65–79**: usable if an edit-side fix exists — trim the bad frames, crop in, regrade, or cover
  the moment with a cut. Log the fix in the timeline note, not just in your head.
- **Below 65**: regenerate. Change exactly one thing per retry, or you will not learn which change
  worked.

Worked example — `UTD_SC07_SH04_v05_clip.mp4`, the irreversible delivery, generated as plain
image-to-video from the first frame alone:

```text
G1 identity   5/5 × 25 = 25.0   cap, jacket, satchel side, chapped knuckles all hold
G2 action     4/5 × 20 = 16.0   envelope goes under, but the two-finger push starts before
                                the feed completes, so the end state arrives 14f early
G3 motion     2/5 × 20 =  8.0   right hand shows a sixth finger from 0:03.6 to 0:04.1
G4 camera     5/5 × 10 = 10.0   25cm dolly-in, one direction, no reverse
G5 frame      5/5 × 15 = 15.0   clean; door chip present throughout
G6 look       4/5 × 10 =  8.0   gap line brightens about 1/3 stop over the clip
                        -------
                          82.0   -> but G3 is a blocker (F10, visible hand). Regenerate.
```

That is the point of keeping blockers separate from the score. At 82 the rubric alone would pass
this clip; the hand disqualifies it regardless. `v06` fixed both flagged rows with one change —
re-generating as first/last-frame, with the last frame showing empty hands and two fingertips on
wood, which is what the shot plan's generation note asked for in the first place. It scored 91.
Had `v06` also failed, the next step was the shot plan's stated contingency: split into `04a`
crouch-and-feed and `04b` two-fingers-pushing, and re-time the scene.

## Gate 3 — SEQUENCE

Only meaningful on the assembled cut. These failures are invisible clip by clip. Rows are `Q`-prefixed
because `S` belongs to the four prompt shapes in
[ai video tool adapters](../references/ai-video-tool-adapters.md); a `Q` in a QC note is always a
sequence row.

| # | Weight | Category | Check | F-codes |
|---|---|---|---|---|
| Q1 | 25 | Cross-cut continuity | Identity, wardrobe, prop state, and light state hold across every splice; end state of shot N matches start state of N+1 | F1, F7, F19 |
| Q2 | 20 | Rhythm | ASL matches the scene's subject; no shot outstays its information; the cut has a shape rather than a constant pulse | — |
| Q3 | 15 | Geography & direction | The 180° line is respected or deliberately broken; eyelines match; direction of travel is consistent | F7, F17 |
| Q4 | 15 | Look uniformity | One grade pass across all clips; no clip is brighter, warmer, or grainier than its neighbours | F12, F16 |
| Q5 | 15 | Sound | One continuous bed under the whole scene; no tone change at any picture cut; lip movement matches any spoken line | F15, F18 |
| Q6 | 10 | Story delivered | A viewer who has not read the script understands what happened and what it cost | — |

Threshold to deliver: **85 / 100**. The sequence gate is stricter than the clip gate because
sequence errors are the ones an audience actually notices — nobody watches a clip in isolation.

## Blockers — must fix regardless of score

A clip or cut carrying any of these does not ship, even at 95.

- An identity break a viewer can name: a different face, a vanished anchor, a changed garment (F1).
- The requested action did not happen, or a different action happened (F4).
- An extra person, hand, or animal in frame (F9).
- A prop the story depends on vanishes mid-clip, or reappears as a different object (F19).
- Rendered text, signage, subtitles, or a watermark (F11).
- Anachronism in a period scene, against the book's `must avoid` list (F8).
- An anatomy failure on a visible hand or face: extra fingers, fused limbs, a face that liquefies
  mid-shot (F10).
- A continuity contradiction across a cut that a second viewing exposes (F7).
- Audio contradicting picture: lips that do not match the line, room tone that changes at a
  splice (F15, F18).
- Anything the user or the book listed explicitly under `must avoid` or `never`.

Everything else is negotiable against schedule. These are not.

## From a failed row to a repair

This file scores; it does not diagnose. Take the F-codes attached to whichever row failed and go to
[failure modes](../references/failure-modes.md), which is the sole owner of the F1–F19 taxonomy — the
symptom in the user's own words, the ranked causes with their mechanism, the cost-ordered fixes, and a
before/after prompt pair for every code. If the user described a symptom rather than a failed row,
start at that file's symptom-to-code quick index and read only the one code it returns; if they
described several, run its triage tree once per symptom and collect every code before reading any fix.

Do not restate the taxonomy here. A second copy drifts within a version or two, and a repair note that
quotes a drifted row is exactly the untraceable diagnosis the codes exist to prevent.

## How to report a failure

Paste this block. Filled, it gets a diagnosis in one pass. Unfilled, it still gets one — the
diagnosis is simply given against stated assumptions, with the branches that would change it marked,
because the skill answers on inference rather than interrogating you. The block is the shortcut, not
the toll gate.

```text
CLIP: <asset filename with version, e.g. UTD_SC07_SH04_v05_clip.mp4>
SHOT: <shot id, size, angle, lens, intended duration>
TOOL: <model or platform, and mode: text-to-video / image-to-video / first+last frame / extend>
INPUTS: <which keyframes, references, and seeds were used>
PROMPT: <the exact prompt text, unedited>
NEGATIVES: <exactly what you passed>
EXPECTED: <one sentence>
HAPPENED: <one sentence, plus the timecode of the first bad frame, e.g. "sixth finger at 0:03.6">
GATE 2 SCORE: <per-category scores, if you ran them>
ALREADY TRIED: <each retry, and the single thing changed in it>
CONSTRAINTS: <credits left, deadline, whether the keyframe may be regenerated>
```

Two fields do most of the work. The timecode of the first bad frame separates a prompt problem
from a duration problem: a failure at 0:00 is the prompt or the reference, a failure at 0:03 of a
4s clip is almost always length. And `ALREADY TRIED` stops a diagnosis from proposing a retry that
has already failed — which is, in practice, the most common way credits get spent twice.
