# Edit & Assembly Template (Mode I)

Load this file when you are at Step 12 (edit and assembly plan) or the user asked for Mode I —
the cut written as timecodes rather than intentions. Why a cut works, pacing theory, ASL
reasoning, and transition *choice* are owned by
[editing and assembly](../references/editing-and-assembly.md). Shot function and screen direction
are owned by [cinematic language](../references/cinematic-language.md). Asset naming is owned by
[continuity bible](../references/continuity-bible.md). This file owns the timeline document: the
table, the notation, and the arithmetic.

The worked example inherits its cut points and transition policy from
[director book](director-book-template.md) and [shot plan](shot-plan-template.md): project
`Under the Door` (`UTD`), scene 7, 24 fps, 16:9, five shots, delivered at 22.0s as
`UTD_SC07_v04_cut.fcpxml`.

## Timeline table

Timecodes are `HH:MM:SS:FF` at the project frame rate; state the rate at the top of the document
or every number in it is ambiguous. Source in/out refer to the generated file, record in to the
program. Durations are written `SS:FF`.

| Clip | Source asset | Shot | Src in | Src out | Dur | Rec in | Transition in | Audio layers | Note |
|---|---|---|---|---|---|---|---|---|---|
| C01 | `PROJ_SCnn_SHnn_vNN_clip.mp4` |  |  |  |  |  |  |  |  |

Filled — `UTD_SC07` at 24 fps. The book permits hard cuts only *between shots* and lets the
programme open up from black, and it names the cut frame for every shot, so the `Transition in`
column is doing less work here than in most scenes — which is what a firm book buys you. A
programme fade is not an inter-shot transition; if your book's `never` line does not draw that
distinction, go and draw it there rather than arguing with it here.

| Clip | Source asset | Shot | Src in | Src out | Dur | Rec in | Transition in | Audio layers | Note |
|---|---|---|---|---|---|---|---|---|---|
| C01 | `UTD_SC07_SH01_v03_clip.mp4` | `01` | 00:00:00:10 | 00:00:04:10 | 4:00 | 00:00:00:00 | Up from black 12f | Bed in with 1s pre-roll, bulb hum carried inside the room tone; foley 3 crossing steps | Head trimmed 10f: the model drifts before the walk settles. Cut the frame he stops moving |
| C02 | `UTD_SC07_SH02_v05_clip.mp4` | `02` | 00:00:00:08 | 00:00:05:08 | 5:00 | 00:00:04:00 | Hard cut | Bed; radio up to −18; foley jacket rustle, one swallow | Cut as the hand reaches his thigh, not on the recovery breath after it |
| C03 | `UTD_SC07_SH03_v02_clip.mp4` | `03` | 00:00:01:00 | 00:00:04:00 | 3:00 | 00:00:09:00 | Hard cut | Bed; 1.5s near-silence from 00:00:09:00; FX chair scrape at 00:00:10:12 | Generated first and used as the palette reference for the scene, and as the seed reference where the tool exposes one |
| C04 | `UTD_SC07_SH04_v06_clip.mp4` | `04` | 00:00:00:00 | 00:00:06:00 | 6:00 | 00:00:12:00 | Hard cut | Bed; foley knees on tile; FX paper on tile 00:00:14:00–00:00:16:14 at −6, the loudest cue in the scene | The one clip with no handles, and the only kind allowed to be: a first/last-frame generation has both ends pinned by approved stills, which is the single licensed exception to the handle rule in [editing and assembly](../references/editing-and-assembly.md). Generated at cut length and used whole — its ends are inspected, never blind-trimmed. The scene's only camera move, 25cm dolly-in. Cut the frame the fingertips touch wood |
| C05 | `UTD_SC07_SH05_v02_clip.mp4` | `05` | 00:00:00:12 | 00:00:04:12 | 4:00 | 00:00:18:00 | Hard cut | Bed; foley two backing steps then four descending; tone tail runs 1s past picture | Held to 4:00 so the empty landing survives him. Cut on the shadow crossing the light line |

Program duration `00:00:22:00`, 528 frames. Nothing follows C05; the tone tail runs 24f past
picture, so the next scene must open on a bed and not on silence.

## Transition notation

What to write in the `Transition in` column. Choose *which* transition using
[editing and assembly](../references/editing-and-assembly.md); write it here in this form so the
arithmetic below stays computable.

| Notation | Means | Frames consumed | Use when |
|---|---|---|---|
| `Hard cut` | Butt splice | 0 | Default. If you cannot justify anything else, this |
| `Match on <element>` | Hard cut aligned on a shared shape, motion, or screen position | 0 | Two shots share a graphic or a moving limb — hides small identity wobble |
| `Dissolve Nf` | Cross-fade over N frames, centered on the splice | N | Time passes, or a scene ends. At 24 fps a 12-frame dissolve is half a second and passes as grammar; double it and the audience registers the device itself |
| `Dip to black Nf` | Out to black and back, N total | N as an overlap transition; **+N** if you fade out, hold black, then fade in | A hard scene break, or a beat the audience must be denied. Write which of the two you mean — they push the running time in opposite directions |
| `Up from black Nf` | Fade in at the head of the program | 0 (inside C01) | Program open |
| `J-cut Nf` | Audio of the incoming shot starts N frames early | 0 (picture unchanged) | Dialogue and reveals; the ear leads the eye |
| `L-cut Nf` | Audio of the outgoing shot runs N frames past its picture | 0 | Room tone or a line bleeding forward |
| `Whip Nf` | Blurred pan transition | N | Rarely in AI work — the blur must exist in both clips or it seams |
| `Seam blend Nf` | Very short dissolve, 4–8f, used only to hide a generation seam | N | Repair, not style. Log it as a defect (F18), not a choice |

Two AI-specific habits. Where the book allows it, prefer `Match on <element>` over a plain hard
cut wherever two clips share a moving element: a match hides the small identity and lighting drift
that a static cut puts side by side for comparison. And never reach for `Seam blend` to fix a
wrong action — it hides a texture pop and nothing else.

## Duration arithmetic

Frames are the unit; seconds are a display format. Convert once, at the top.

```text
frames        = seconds × fps
duration      = src_out − src_in                    (frames, out-point exclusive)
rec_in(1)     = 00:00:00:00
rec_in(n)     = rec_in(n−1) + duration(n−1) − overlap(n)
overlap(n)    = N for Dissolve / Whip / Seam blend
              = N for Dip to black applied as an overlap transition
              = −N for Dip to black built as fade-out, hold, fade-in   (it ADDS time)
              = 0 for hard cuts, matches, J-cuts, L-cuts
program total = Σ duration − Σ overlap
```

Worked for `UTD_SC07` at 24 fps:

```text
durations : 96 + 120 + 72 + 144 + 96 = 528f
overlaps  : hard cuts only            =   0f
program   : 528 − 0                   = 528f = 22.0s = 00:00:22:00
check     : rec_in(C05) 432f + 96f    = 528f   agrees
counterfactual: had a 12f dissolve been allowed into C05, the program would run
                516f = 21.5s, and the beat sheet's 22s budget would need re-timing
```

That counterfactual is the reason the overlap term exists in the formula: a transition is not
decoration, it is a subtraction from the running time, and four dissolves in a 22s scene quietly
cost you two seconds of story.

If the NLE reports a different total, the disagreement is almost always one of three things: a
mixed frame rate on one imported clip, an out-point counted inclusively, or a dissolve specified
as centered that the NLE applied as trailing. Check in that order.

Sanity check on this cut: five shots in 22.0s is an ASL of 4.4s, inside the book's 4–5s target,
with the longest shot on the commitment beat (C04, 6:00) and the shortest on the beat that is
built out of absence (C03, 3:00). If your ASL and your scene's subject disagree and you cannot say
why in one sentence, the cut is wrong, not the number.

## Assembly order

1. Lay the bed first: one continuous room tone and ambience pair for the whole scene, per
   [sound plan template](sound-plan-template.md). Mute every clip's generated audio at import.
2. Drop all clips as hard cuts at their planned durations. No transitions yet.
3. Watch once at speed. Note only where you looked away or lost the geography.
4. Trim heads and tails before you judge any clip. The default discard, the handle budget that
   pays for it, and the one first/last-frame exception to both are owned by
   [editing and assembly](../references/editing-and-assembly.md); apply its trim rule first and
   only then look at content.
5. Move each cut to the frame the shot plan names — usually the frame the action completes, never
   the recovery after it.
6. Add dissolves and dips only where a hard cut demonstrably failed, and only if the book allows
   them. Re-run the arithmetic afterwards, because the total has changed.
7. Cut foley and spot FX to frame; place J- and L-cuts for dialogue.
8. Place music, if the scene has any, against named beats.
9. One grade pass across all clips, applied after assembly, never per clip.
10. Run the SEQUENCE gate in [qc checklist](qc-checklist.md) before export.

## Export block

```yaml
sequence_id: UTD_SC07_v04_cut
fps: 24
resolution: 1920x1080
aspect: "16:9"
program_duration_tc: "00:00:22:00"
program_duration_frames: 528
shot_count: 5
average_shot_length_s: 4.4
transitions_used: hard cut only, per the director's book
color: one grade pass across all clips, applied after assembly
audio_bed: continuous, scene length plus 1s handles
loudness_target: "-14 LUFS integrated (online delivery), true peak at or below -1 dBTP"
handoff_notes: "room tone tails 24f past picture; the next scene must open on a bed, not silence"
```

Three of those fields are not decided here. `aspect`, `loudness_target`, and anything about
captions or safe area are copied out of the director's book `Delivery` block — this file records
them so the export is auditable, and if the two disagree the book is right and the timeline is
stale. Program loudness is declared in this block and nowhere else, which is why every sound level
upstream is written relative to dialogue rather than in dBFS.
