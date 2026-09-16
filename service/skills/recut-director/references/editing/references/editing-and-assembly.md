> 来源: DirectorSKILL-full (MIT) — 原文件 `.executor-tasks/sources/DirectorSKILL-full/references/editing-and-assembly.md`

# Editing and Assembly

Load this file when the deliverable is a cut plan, a shot count derived from a target duration, a transition design between separately generated clips, or a timeline/assembly spec (Step 12, Mode I). Fillable template: [edit-timeline-template.md](../assets/edit-timeline-template.md). Audio layers, pre-laps and music tempo live in [sound-and-dialogue.md](sound-and-dialogue.md); shot sizes, angles and screen-direction geometry live in [cinematic-language.md](cinematic-language.md).

Frame-rate assumption throughout: 24 fps. Timecodes written `m:ss.d`; frame counts written `f`.

## Pacing math

### Average shot length by cutting register

ASL is the mean, not the metronome. Use it to size the job, then distribute unevenly.

Per-genre ASL defaults are owned by [genre-playbooks.md](genre-playbooks.md), which gives a number for each of nineteen genres. **Where a genre lens is loaded, its number wins.** The table below is for when no lens is loaded, or when a sequence inside a scene runs at its own tempo — a chase inside a drama, a montage inside a documentary.

| Register | ASL | Shots per 30 s | Longest hold |
|---|---|---|---|
| Long-take / contemplative | 15–40 s | 1–2 | the whole scene |
| Observational | 8–15 s | 2–4 | 30 s |
| Conventional scene | 5–12 s | 3–6 | 20 s |
| Tightening / suspense build | 3–6 s | 5–10 | 14 s (the hold is the device) |
| Dialogue comedy | 2–5 s | 6–15 | 8 s, plus the reaction hold |
| Rapid action | 0.8–2.5 s | 12–38 | 5 s |
| Sell / product | 0.8–2.0 s | 15–38 | 6 s (the product hold) |
| Montage, mid-intensity | 1.2–2.5 s | 12–25 | 4 s |
| Montage, terminal | 0.4–1.0 s | 30–75 | 1.5 s |
| Feed / vertical | 0.7–2.0 s | 15–43 | 3 s |
| Tempo-locked | 1–2 bars per shot | set by the BPM table in [sound-and-dialogue.md](sound-and-dialogue.md) | 1 bar past the ASL |

### Procedure: target duration to shot count

1. `N = duration / ASL`, rounded to a whole number.
2. Reserve one anchor shot at 2–3× ASL. Every sequence needs one place the audience can rest or dread. Take the low end when N is small and the target is tight.
3. Reserve one shortest shot at 0.25–0.5× ASL. Contrast is what makes the anchor read as long.
4. Distribute the rest so the **median lands below the ASL**. Real shot-length distributions are right-skewed: a few long shots pull the mean up, and most shots sit under it. About 15% long (1.5–3× ASL), 40% near ASL (0.9–1.2×), 45% short (0.4–0.8×). That mix averages back to roughly 1.0× ASL; an even spread around ASL does not, because the anchor drags the mean above target and you end up trimming the wrong shots.
5. Sum, reconcile to target ±1 s by trimming the shots near ASL, never the anchor.

Worked: 30 seconds, tightening register, ASL 3.5 s. `N = 30 / 3.5 = 8.6 → 9 shots`. Anchor 9.0 s (2.6× ASL), shortest 1.2 s (0.34× ASL), remaining seven sum to 19.8 s — 4.6 / 3.5 / 3.4 / 3.0 / 2.2 / 1.7 / 1.4.

Total 30.0 s across 9 shots. Mean 3.33 s, median 3.0 s — the median sits below the mean, which is the check that step 4 was applied. The plan now has a shape rather than an average.

### Adjust for handles: AI clips are longer than their cuts

Every generated clip loses its head and its tail (see the trim rule below). Budget **cut length + 1.5 s minimum** per clip, and cut length + 2.5 s for character performance or complex motion. Dialogue is character performance and pays the full 2.5 s.

`generated_seconds = finished_seconds + 1.5 × T`, where `T` is the number of **kept takes** you will cut from — not the number of shots, and not the number of attempts. Handle is paid per take, so harvesting several shots from one clip pays it once. Attempts are a different quantity with a different budget, counted and priced in [production-workflow.md](production-workflow.md); do not feed a retry count into this formula or you will over-order footage by the whole retry multiplier.

| ASL | T for 30 s, one take per shot | Generated seconds | Generation cost per finished second |
|---|---|---|---|
| 15 s | 2 | 33.0 | 1.10× |
| 8 s | 4 | 36.0 | 1.20× |
| 5 s | 6 | 39.0 | 1.30× |
| 3 s | 10 | 45.0 | 1.50× |
| 2 s | 15 | 52.5 | 1.75× |
| 1.2 s | 25 | 67.5 | 2.25× |
| 0.7 s | 43 | 94.5 | 3.15× |

The consequence is not obvious and it drives budgets: **fast cutting is expensive in AI film**, because the fixed handle is paid per take, not per second.

It gets worse below about 3 seconds. Tools generally impose a minimum generation length — commonly a few seconds, and typically offered as fixed length options rather than a free duration field; check the current docs for the tool you are on. Below that threshold, cost is set by the tool minimum, not by your cut. A 43-shot montage at 0.7 s each, generated one clip per cut against a 5 s minimum, costs 215 s of generation for 30 s of film: 7.2×.

Mitigation — **harvest**. Generate one 8–10 s clip containing a continuous move or action and take three or four non-adjacent fragments from it. The fragments share identity, light and grade automatically, which is exactly what a fast montage needs. Retry economics and per-shot budgeting are in [production-workflow.md](production-workflow.md).

## Cut motivation taxonomy

If you cannot name the motivation, the cut is arbitrary and the audience feels it as a slideshow.

| Motivation | Trigger frame | Correct when | Cliché it invites | AI-specific note |
|---|---|---|---|---|
| Cut on action | Roughly one third into a movement in A; resume roughly halfway through it in B | Continuous physical business; the default for invisible cutting | Cutting on every door, every sit, every handshake | Hides drift best. Motion masks difference between two generations — use it wherever the two clips disagree |
| Cut on look | The frame after the eyeline settles off-screen | Establishing what a character knows or wants | The mechanical look / POV / look-back triplet on every beat | Cheapest coverage in the pipeline: the POV clip needs no character in it, so no identity risk |
| Cut on sound | The picture cuts 4–12 f after the sound arrives | Redirecting attention; motivating a location change | A whoosh on every transition | Lets you cut between clips that share nothing visually. See pre-lap in [sound-and-dialogue.md](sound-and-dialogue.md) |
| Cut on idea | Wherever the thought completes, regardless of motion | Essayistic, montage, irony, thematic rhyme | Hourglass-to-crowd "time passes" matches | The only motivation that survives a total visual mismatch, so it rescues incompatible generations |
| Cut on emptiness | When the frame has nothing left to give | The shot has been exhausted and holding longer would be about the director, not the scene | The meaningful stare held 4 s past its meaning | Watch for it in reverse: AI clips run out of content early because the model stops inventing. Cut there |
| Cut on impact | Exactly on the hit, land, or slam — or 1–2 f before it | Violence, comedy falls, doors, decisions | Cutting on every punch to conceal that nothing connects | In AI film, concealing that nothing connects is a legitimate primary use, not a cheat |

Five of the six appear in the worked assembly at the end of this file. Cut on impact is the absent one, because nothing in that scene lands — which is itself the design.

## Transition engineering for separately generated clips

This is where AI film is actually different from live action. In live action, continuity is a property of the shoot. Here a clean hard cut is a property of the design: you get one only if you built A's last frame and B's first frame **as a pair**, before generating either. Everything else in this section is what you do when you did not.

### The hard-cut agreement checklist

A hard cut holds when A's last frame and B's first frame **match on five things and deliberately break the sixth**:

1. **Subject screen position** — within about 15% of frame width of where the eye expects it, or deliberately opposed across the frame.
2. **Screen direction of travel** — same direction, or a designed reversal with a neutral shot between. Geometry owned by [cinematic-language.md](cinematic-language.md).
3. **Light direction and level** — key from the same side; overall exposure within roughly half a stop.
4. **State** — costume, prop position, hair, wetness, what is in which hand. The fifteen tracked axes are in [continuity-bible.md](continuity-bible.md).
5. **Eyeline side** — the character looks off the same edge of frame in both.
6. **Shot size — this is the one you break.** Two rungs on the size ladder if the camera stays on the same axis; one rung is enough if the angle also moves 30° or more around the subject. Ladder and the 30-degree rule are owned by [cinematic-language.md](cinematic-language.md).

Items 1–3 and 6 you control by writing the shot. Item 4 you control from the continuity bible. Item 5 is the one people forget, and it is the one that reads as an error rather than as a style.

### Constructing a match cut

Pick exactly **one** carrier — shape, motion vector, sound, or colour. Two carriers at once cancel out and the cut reads as a coincidence.

| Carrier | Design rule | How to build it |
|---|---|---|
| Shape | The dominant contour occupies the same 20–40% of frame area at the same screen position in both frames | Build the two stills first as a diptych, overlay them at 50% opacity, adjust until the contours sit on each other |
| Motion vector | Same direction and comparable speed across the cut. A reversed vector reads as a mistake, never as a match | Specify the direction in both prompts ("moves left to right across frame") and check the last and first frames, not the middle |
| Sound | Same transient, different source — a slam and a gunshot, a scream and a kettle | Purely a timeline operation, costs no generation. See [sound-and-dialogue.md](sound-and-dialogue.md) |
| Colour | Same dominant hue at the same luminance, different scene | Set it at the keyframe stage; palette systems are owned by [lighting-and-color.md](lighting-and-color.md) |

Worked, single carrier — shape. A is to end on a ceiling light: a white disc filling roughly 30% of frame area, centred, on a dark ground. B is to open on a coin on a table: white disc, roughly 30%, centred, dark ground. Build both stills first, overlay them at 50%, and move the coin until the two discs sit on each other; only then generate. Do not also try to match the motion — the second carrier would split the audience's attention and neither would land.

Execution: design the pair of stills at Step 8 (keyframes), then generate A **toward** its last frame and B **away from** its first frame, using first-frame/last-frame slots where the tool exposes them — see [ai-video-tool-adapters.md](ai-video-tool-adapters.md) and [image-model-adapters.md](image-model-adapters.md).

### Faking a whip or blur transition

Two ways, in order of preference:

1. Generate it. Ask A for a fast camera whip in its final half second ("in the last half second the camera whips hard to the right and the frame smears") and B for the same whip decelerating into its opening. Then cut in the middle of the two smears. Expect to re-roll: models routinely return the whip in the wrong direction, or start it too early and eat the frames you needed. Check A's last frame and B's first frame for the smear axis before you commit to the pair.
2. Fake it in post. Ramp a directional blur **up** across A's last 6–10 f and back **down** across B's first 6–10 f, streaking along the same axis and in the same direction in both. Opposed directions read as two unrelated whips and are worse than a plain cut. That gives 12–20 f in which nothing resolves, straddling an ordinary hard cut — no clip overlap is required. Add a 2–4 f dissolve at the splice only if a clean frame still shows through.

Either way the whip's real job is licence: for those 12–20 frames the audience cannot resolve detail, so A and B are free to disagree about everything.

### The dissolve as an honest repair

A dissolve half-shows both images at the seam, so neither is auditable. That makes it the correct tool for a continuity gap you cannot fix — a light level that will not match, a wall texture that shifted, hair that moved.

| Length | Reads as |
|---|---|
| 6–10 f | Softening. Nearly subliminal; hides a small mismatch without implying anything |
| 12–24 f | A beat of time passing, or interiority |
| 24–48 f | A real transition between scenes |
| 48 f and up | Sequence break, memory, dream |

Two costs. Meaning: a dissolve asserts time passage or interiority whether you want it to or not, so never dissolve two shots that are continuous in time — the audience will read a gap the story does not have. And duration: a dissolve consumes frames from the program, so four of them in a short scene quietly shorten it. The arithmetic is in [edit-timeline-template.md](../assets/edit-timeline-template.md).

### The cutaway and the insert as continuity patches

The cheapest continuity repair in AI film. Drop a 0.8–1.5 s insert of a detail between two clips that do not match, and the requirement that they match disappears — the audience's memory of A's exact frame is gone in under a second.

Insert candidates, in order of generation reliability: a static object (hands, a cup, a keyring, a sign), a slow environmental motion (rain on glass, steam, a curtain), a moving detail without a face (a foot, a wheel, a page). No face means no identity axis to drift, which is why these clear on the first pass where a character shot needs several.

Rule: the insert must belong to this scene's world, ideally generated from the same location keyframe, or it becomes a second continuity problem.

### The empty-frame bridge

The strongest cheat available. End A by letting the subject exit frame; start B on an empty frame that the subject then enters. Across an empty frame the audience will accept a change of costume, of light, of location, of time.

Cost: 0.5–1.0 s of screen time at each end, and the shots must be planned for it — you cannot add an exit to an existing clip. Use it deliberately at the one or two seams in a sequence you already know will not hold.

## Handles and trimming

Generate 1.5–2.5 s longer than the cut you need. This is not optional; it is the single most common reason a sequence cannot be assembled.

**One exception, and only one.** A first/last-frame generation has both of its ends pinned by approved stills, so the model is interpolating toward a known frame rather than drifting away from one: that clip may be generated at cut length and used whole. Everything else pays the handle, including every dialogue take — dialogue is character performance, so it pays the 2.5 s rate, not the 1.5 s one. If you find yourself writing a second exception, what you actually have is a shot you have not budgeted.

What is wrong with the ends of a generated clip:

- **Head (ramp-in)**: the first 4–10 f typically show the model resolving from its conditioning image — motion accelerating from an unnatural zero, a brief morph as texture settles, occasionally a one-frame flash.
- **Tail (drift-out)**: the last 8–20 f are where identity slides, hands deform, physics decays, and motion either loops or stops dead.

Practical trim rule: **discard the first 8 f and the last 12 f of every generated clip before you even look at it** (0.33 s head, 0.50 s tail at 24 fps). Then trim for content. If the clip becomes unusable after that discard, it was going to be unusable anyway. The one clip you do not blind-trim is the first/last-frame generation above: its first and last frames are the approved stills, so discarding them throws away the thing you paid for. Inspect that clip's ends instead of trimming them, and if either end has drifted off its still, the interpolation failed and the fix is a regeneration, not a trim.

Cut mid-motion, not at rest. A cut on a static frame invites the eye to compare A's last frame with B's first frame in detail, and it will find every mismatch. A cut during movement gives the eye a vector to follow instead of an inventory to audit. Place the cut point where subject velocity is at or near its peak.

When cutting on action, remove 2–4 f of the movement across the cut. The eye fills them in and the cut feels tighter; leaving the action complete on both sides makes it feel duplicated.

## Rhythm patterns as reusable devices

| Pattern | Beat structure | Durations | Use |
|---|---|---|---|
| Accelerating sequence | Each shot roughly 0.7× the previous, then one long release | 4.0 / 2.8 / 2.0 / 1.4 / 1.0 / 0.7, then 5–8 s | Pressure toward a decision or a collision. The release shot is mandatory or the sequence has no landing |
| Long hold, sudden cut | One held shot, then one very short one | 8–14 s, then 0.5–1.0 s | The disproportion is the whole effect. Do not precede it with any other long shot |
| Three-beat comedy | Setup, reinforcement, turn, then the hold | 3.0 / 2.5 / 1.2, then a hard cut to a 2.0–2.5 s reaction with no music | The laugh lives in the hold, not the turn. Cutting away from the reaction kills it |
| Horror delay | Hold a reveal-worthy frame past comfort, then either nothing or the event | Hold 3–5 s longer than feels right; if the event comes, land it at an unpredictable point inside a 2–6 s window | The audience must not be able to count to it. Alternate delivering and withholding across the film |
| The breath | One held near-empty shot immediately after a shock | 2.5–4.0 s, ambience only, no music, no cut inside it | Without it the shock is not remembered. This is the shot everyone cuts for time and should not |
| Rule-of-three escalation | Three shots at the same size, same angle, same length, one element escalating; break on the fourth | 3 × 1.5–2.5 s, then a shot of different size and different length | Works identically for comedy and dread. The break is the payload; the repetition is the setup |

## Anti-slideshow rules at the edit stage

The slideshow feeling is created at the cut, not in the prompt. Enforce all eight:

1. **Overlap motion across the cut.** Something must be moving in A's last 12 f and something moving in B's first 12 f, in the same general direction.
2. **Break the size, the angle, or both — and break them big.** On the same camera axis, change size by at least two rungs (WS to MCU, not WS to MS). If the angle also moves 30° or more around the subject, one rung is enough. Ladder and the 30-degree rule are owned by [cinematic-language.md](cinematic-language.md).
3. **Never place two same-size, same-angle shots adjacent**, unless the repetition is the device (rule-of-three).
4. **One continuous audio bed under the whole sequence**, never re-triggered at a cut. See the continuity-glue rule in [sound-and-dialogue.md](sound-and-dialogue.md). This does more for the sequence than any picture fix.
5. **Let a movement start in A and finish in B.** A hand reaches in A; the object is already held in B. The audience stitches the two clips into one event.
6. **Vary shot length.** If three consecutive cuts land within 0.3 s of each other, the sequence starts to tick like a metronome and reads as a template.
7. **Change the axis or the direction of travel at least once every four shots**, within the geometry rules.
8. **Never open two consecutive shots on a static frame.** If B has to start still, give A a moving exit.

## The assembly spec

The timeline document itself — the exact columns, the transition notation, and the frame arithmetic that makes the totals check — is owned by [edit-timeline-template.md](../assets/edit-timeline-template.md). What this file owns is what goes in the `Note` column: why each cut happens, and what it repairs.

The example below uses the template's column names, drops its `Shot` column for width, and displays times as `m:ss.d` rather than the `HH:MM:SS:FF` the template's arithmetic assumes — convert before handing it over.

Worked example — "Unlocked", 8 clips, 35.0 s finished, tightening register, ASL 4.4 s. A woman returns to her flat at night and finds the door already open.

| Clip | Source asset | Src in | Src out | Dur | Rec in | Transition in | Audio layers | Note |
|---|---|---|---|---|---|---|---|---|
| C01 | `UNL_SC01_SH01_v04_clip.mp4` (8.0 s) | 0:00.8 | 0:06.3 | 5.5 | 0:00.0 | Up from black 24f | Bed in — RT street + AMB rain, runs to the end of the scene | EWS street, she crosses L→R to the entrance, rain. Head discard 19 f (ramp-in), tail discard 41 f (drift) |
| C02 | `UNL_SC01_SH02_v02_clip.mp4` (6.0 s) | 0:00.5 | 0:03.5 | 3.0 | 0:05.5 | Hard cut | Bed crossfades street→interior over 16 f; FOL steps | MS stairwell, her back, climbing away from camera. Cut on action, on her passing the doorframe. The ambience change carries the location cut, so no interior establishing clip was generated at all |
| C03 | `UNL_SC01_SH03_v01_clip.mp4` (9.0 s) | 0:01.4 | 0:03.6 | 2.2 | 0:08.5 | J-cut 8f | Bed; SFX keyring at 0:08.2, 8 f ahead of the picture | ECU keyring turning in her hand. Cut on sound. Harvest 1 of 2 from this generation |
| C04 | `UNL_SC01_SH04_v06_clip.mp4` (10.0 s) | 0:01.2 | 0:07.7 | 6.5 | 0:10.7 | Hard cut | Bed; FOL cloth; M1 in at 0:14.0 | MCU her face at the door, she stops, looks down. Cut on action — her hand rises out of frame in C03. 1.5× ASL, the second-longest shot |
| C05 | `UNL_SC01_SH05_v01_clip.mp4` (5.0 s) | 0:02.0 | 0:03.2 | 1.2 | 0:17.2 | Hard cut | 6 f of hard silence at the cut, then bed only | ECU door edge, a 2 cm gap, black inside. Cut on look. Shortest shot, 0.27× ASL. The silence does the work the picture cannot |
| C06 | `UNL_SC01_SH06_v03_clip.mp4` (8.0 s) | 0:02.6 | 0:07.0 | 4.4 | 0:18.4 | Hard cut | Bed; one breath; M1 rising | MCU her face, one breath, then her eyes go down. Cut on idea. Same size as C04, but C05 sits between them, so the repeat reads as a return rather than a stutter |
| C07 | `UNL_SC01_SH03_v01_clip.mp4` (9.0 s) | 0:04.6 | 0:08.2 | 3.6 | 0:22.8 | Match on the down-move | Bed; FOL key rattle stops mid-move | ECU keys lowering out of frame, slow. Cut on action, started in C06. One carrier only — her eyes go down, the keys go down; nothing else is matched. Harvest 2 of 2, so identity and grade match for free |
| C08 | `UNL_SC01_SH08_v02_clip.mp4` (12.0 s) | 0:01.5 | 0:10.5 | 9.0 | 0:26.0 | Dissolve 10f | Bed; M1 out at 0:33.4, cut dead; last 1.6 s bed only | WS from behind, static, she stands facing the dark gap. Cut on emptiness. Anchor, 2.1× ASL. The dissolve is a repair, not a choice: v02 sits half a stop brighter than C06 and would not hold on a hard cut |

Arithmetic, per the template's formula. Σ durations 35.4 s; Σ overlaps 0.4 s (the 10 f dissolve into C08 — the fade-up and the J-cut consume nothing); program 35.4 − 0.4 = **35.0 s**, which agrees with `rec_in(C08) 26.0 + 9.0`.

Totals: 35.0 s of program from **58.0 s across 7 kept takes — 1.66×** — because C03 and C07 are two harvests from one take. Against the handle formula (`35.0 + 1.5 × 7 = 45.5 s`) that is 12.5 s of overshoot, spread across all seven takes at 1.0–2.3 s each — every clip was ordered longer than its handle minimum so the shots carrying the scene could be trimmed to taste. The formula is a floor, not a forecast.

Rule checks: every adjacent pair differs by at least two rungs on the size ladder, so the angle dial was never needed; no three consecutive durations fall within 0.3 s of each other; one bed runs under all eight clips; anchor 9.0 s (2.1× ASL), shortest 1.2 s (0.27× ASL).

## Fix in the edit, regenerate, or cover it

Three options, and the third is the one people forget.

Cost model, honestly stated. A regeneration costs one more clip generation at whatever your tool charges, some minutes of wall time, and — the part that hurts — a fresh roll of the dice on identity, which can turn one defect into a different continuity problem in a shot that was otherwise fine. An edit fix costs 2–10 minutes of your time, is deterministic, and cannot break a neighbouring shot. A cover shot costs one cheap generation with a much higher first-pass rate than any character-performance re-roll, because it has no face in it.

| Symptom | Fix in edit | Regenerate | Cover |
|---|---|---|---|
| Defect in the first 8 f or last 12 f | Trim. Always | — | — |
| Defect off the centre of interest | Punch in up to 20% (on 1080p that leaves 864 effective lines — fine for web, not for a 4K master) | If the master matters | — |
| Defect under 8 f anywhere | Cut around it, or freeze 2 f | — | 1 s insert over it |
| Colour or exposure mismatch with the neighbour | Grade it. Always cheaper than a re-roll | — | — |
| Motion too fast or too slow | Retime 90–110%, which most viewers will not see. Beyond roughly ±15% it reads as slow-motion or under-cranking, which is a style choice rather than a repair; optical-flow retiming also smears hands and edges on generated footage | Yes, if the pace is wrong by more than that | — |
| Wrong face, wrong costume, wrong prop | — | Yes | — |
| Anatomy or physics break the eye will lock onto | — | Yes | Only if the break is brief and peripheral |
| Defect present through more than half the clip | — | Yes | — |
| Two adjacent clips simply do not match | Dissolve 10–24 f | Only after cover fails | Insert or empty-frame bridge first |
| Action does not read | — | Yes, with a changed shot design | — |

Decision rule: **regenerate only when the defect is in identity, is present through more than half the clip, or is a physics break the viewer will fixate on.** Everything else is a trim, a grade, a retime, or a cover.

Retry ceiling: how many generations a shot gets before you stop — the per-band stop rules, the retry budget, and version naming — is owned by [production-workflow.md](production-workflow.md). The edit-side rule is narrower and it is the one people ignore: when you hit that stop, change the size, the move, or the action. Do not change the adjectives. Symptom-to-cause diagnosis is in [failure-modes.md](failure-modes.md).
