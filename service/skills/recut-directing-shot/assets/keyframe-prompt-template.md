> 来源: DirectorSKILL-full (MIT)

# Keyframe Prompt Template (Mode E)

Load this file when you are at Step 8 (keyframe strategy) or the user asked for Mode E — first
frames, last frames, storyboard panels, character sheets, or location plates. The nine-slot order
and the reasoning behind it are owned by
[image model adapters](../references/image-model-adapters.md) §3, together with model control
surfaces and consistency tooling. Word choice, banned words, and the negative library are owned by
the [prompt lexicon](../references/prompt-lexicon.md). Asset ids and seed tracking are owned by
[continuity bible](../references/continuity-bible.md). This file owns the fill-in forms.

Build keyframes only after the rules exist. Every worked example below inherits from
[director book](director-book-template.md) and [shot plan](shot-plan-template.md): project
`Under the Door` (`UTD`), scene 7, 22s, 16:9, five shots — a courier hesitates outside a
Republican-era Shanghai apartment door, slides an envelope under it, and leaves.

## Slot dictionary

Nine slots, then a constraints tail. Fill in this order; image-model-adapters §3 explains why the
order is not cosmetic.

| # | Slot | Must contain | Must never contain |
|---|---|---|---|
| 1 | Shot id | `PROJ_SCnn_SHnn` plus the frame role: `kf-first`, `kf-last`, `panel`, `sheet`, `plate` | Beat name, emotion, story explanation |
| 2 | Size, angle, lens | Shot size, camera height in cm or m, angle in degrees, focal length in mm | Camera *movement* — a still does not move; a height written in mm, which reads as a second focal length |
| 3 | Identity string | The book's frozen invariant, verbatim, word for word | A paraphrase, an emotion, an attractiveness word, "same as before" |
| 4 | Pose implying action | Limb positions, hand shape, eyeline target, distances in cm | Intent verbs: hesitating, wondering, deciding |
| 5 | Wardrobe & props | Every garment and carried object with material, closure, and which side | Style labels: "period clothing", "vintage look" |
| 6 | Location & era | The book's location invariant, verbatim, then which setup within it and where the door plane and the window fall for *this* camera | Genre words: "noir", "period drama" |
| 7 | Light source & direction | The book's light invariant, verbatim — it is world space: source, height, ratio, what stays under — then one sentence giving this setup's camera-relative key direction, copied from the shot plan's `Light dir` cell | Mood words: "moody", "dramatic lighting"; a camera-relative direction rewritten *into* the invariant |
| 8 | Composition | Placement in frame, headroom, which plane sits under, depth layers. At 9:16 or 1:1, also the band of frame height the story-critical content occupies — see the vertical safe zones in [cinematic language](../references/cinematic-language.md), which are per-platform and must be checked, not remembered | A rule name with no placement attached; a safe-zone percentage quoted from memory |
| 9 | Texture / medium | Stock or medium, grain, halation, palette in plain color words | "8K", "masterpiece", "hyperrealistic"; a bare millimetre number slot 2 could read as a second lens — write `35mm film stock`, never `35mm` alone |
| — | Constraints | Aspect ratio, then the book's `NEG_BASE` plus this frame's own risks | A boilerplate wall carried over from a different shot |

## Working with the book's invariant strings

The director's book publishes four strings. Three of them — `ID_COURIER`, `LOCK_LANDING`,
`LIGHT_INVARIANT` — fill slots 3, 6 and 7 verbatim. Copy them; do not improve them. One re-worded
adjective is a different person, a different room, or a different lamp. `NEG_BASE` fills the
constraints tail and is the one string you select from rather than paste whole, for the reason
given under it.

```text
ID_COURIER: a thin 19-year-old male courier, shaved neck, wool cap pushed back off his
forehead, grey padded cotton jacket buttoned to the throat, canvas satchel strap across his
chest on the left shoulder, chapped knuckles on the right hand

LOCK_LANDING: third-floor landing of a 1937 Shanghai lilong apartment block, peeling dark-green
wainscot to waist height, cracked cream plaster above, worn red floor tile, dark-stained door
with a brass knob and a chipped lower-left corner, a stairwell window at the head of the stairs
opposite the door

LIGHT_INVARIANT: a single bare filament bulb hanging over the stairhead, warm, hard, above head
height, 5:1 lit side to shadow side with no fill but plaster bounce; cold daylight from the
stairwell window behind him, rimming his back and cap and never reaching his shadow side; the
door face stays well under; the only light on the door is a thin warm line spilling from the 4cm
gap beneath it

NEG_BASE: no rendered text, signage or numerals; no watermark; no lever handles, plastic, rubber
soles, wristwatch or printed logos; no extra people; no face or costume change; the door never
opens
```

`NEG_BASE` names instances and never categories: "no modern objects" is a category no generator
can resolve into things, and it is the mechanism behind F8. The era class therefore lists the
objects the book's `must avoid` line already named. Six classes is the working size — small
enough to paste whole into a tool's negative field, and small enough that a prompt carrying it
inline plus this frame's own risks still lands near the lexicon's budget rather than at a wall.

None of them contains `camera-left` or `frame-right`, and that is deliberate: one string is pasted
into a setup and into its reverse, where those words flip. Camera-relative direction is per-setup
and comes from the shot plan's `Light dir` and `Frame content` cells — paste the invariant, then
add one sentence for this camera. In this scene every setup sits on one side of the line, so the
bulb reads high camera-left 45°, the door plane sits camera-right, and the window is behind him at
camera-left rear; write that sentence in each prompt, never back into the string.

Note what `ID_COURIER` does: it bundles slot 3 (face and build) with slot 5 (wardrobe). That is
fine for a scene where the costume never changes, and it saves tokens. Split it the moment the
project has a second fitting or a costume change — otherwise a wardrobe edit in reel two silently
rewrites the face. When you split, keep the face half under the same name and add a fitting
string (`FIT_COURIER`), and record both in the continuity bible.

The scene's checkable anchor is not on the actor. The book bans rendered numerals, so the door
number cannot be the identifier: use the **chip in the door's lower-left corner** and the
**unbroken warm line under the door**. Both survive at every shot size in this scene, and either
one missing is provable drift.

## Template — first frame

```text
[PROJ_SCnn_SHnn kf-first]. [Size, angle, camera height, ##mm].
[ID string verbatim]. [Static pose: limbs, hand shape, distances in cm], eyes on [target].
[Prop and its state]. [LOCK string verbatim]; [which setup within it, and where the key planes
fall for this camera]. [LIGHT string verbatim]. In this setup [camera-relative key direction].
[Placement, headroom, which plane sits under, depth layers].
[Stock, grain, palette]. The pose must read as [action] about to begin.
[Aspect]. [NEG_BASE + this frame's own risks].
```

The first frame of a shot is the previous shot's end state, not a moment plucked from the middle of
the gesture. Shot 01 ends squared to the door with the envelope at chest and both arms down, so
that is where `SH02` starts; the raised knuckles are something the video prompt has to produce.

Filled — `UTD_SC07_SH02_v03_kf-first`, the hand that cannot knock:

```text
UTD_SC07_SH02 kf-first. Medium close-up, eye level, camera at 1.6m, 50mm. A thin 19-year-old male
courier, shaved neck, wool cap pushed back off his forehead, grey padded cotton jacket buttoned to
the throat, canvas satchel strap across his chest on the left shoulder, chapped knuckles on the
right hand. He stands squared to the door 60cm out, both arms down, the right hand at his thigh
with the fingers half closed, his weight settled forward toward the door; eyes level on the door
face. A cream envelope, white face out, held up at chest height in his left hand. Third-floor
landing of a 1937 Shanghai lilong apartment block, peeling dark-green wainscot to waist height,
cracked cream plaster above, worn red floor tile, dark-stained door with a brass knob and a chipped
lower-left corner, a stairwell window at the head of the stairs opposite the door; door-side setup,
the door plane camera-right, the window behind him at camera-left rear. A single bare filament bulb
hanging over the stairhead, warm, hard, above head height, 5:1 lit side to shadow side with no fill
but plaster bounce; cold daylight from the stairwell window behind him, rimming his back and cap
and never reaching his shadow side; the door face stays well under; the only light on the door is a
thin warm line spilling from the 4cm gap beneath it. In this setup the bulb reads high camera-left
at 45 degrees and rakes the side of his face. His head and near shoulder occupy frame-left, the
dark door plane fills frame-right, envelope edge low-left, the cold rim along the back of his cap.
35mm film stock, fine grain, low saturation, high contrast in the lower third, dull green and
cracked cream against worn red, the envelope the only pure white. The pose must read as a knock
about to begin. 16:9. No rendered text, signage or numerals; no watermark; no wristwatch, no rubber
soles, no printed logos; no face or costume change; the brass number plate defocused or out of
frame; the right hand still down and not touching the wood.
```

Six classes in the tail, and note that it is not `NEG_BASE` pasted whole. Two base classes were
dropped because this framing cannot produce them — an MCU on one man has no room for an extra
person, and "the door never opens" is a motion constraint that means nothing to a still — and the
era class was pruned to the three instances that could actually appear at this size. Two of the
frame's own risks took the space. Where the model exposes a negative field, put all six `NEG_BASE`
classes in it and keep only those two frame-specific lines inline.

## Template — last frame

The last frame is the first frame plus one completed change. Reuse slots 2, 3, 5, 6, 7, 9 word
for word; edit only slot 4 and, if the body moved, slot 8. Derive it from the approved first
frame rather than generating it fresh — see image-model-adapters §6.

Not every shot earns a pair. `SH02` starts with the hand down and ends with the hand down, so its
two frames would be near-identical and the tool would have nothing to travel through; that shot is
image-to-video from one frame. Build a pair when the end state is a different photograph.

```text
[PROJ_SCnn_SHnn kf-last]. [Slot 2 line, identical]. [ID string verbatim].
He has completed [action]; now [new static pose]. [Prop in its new state].
[LOCK string, identical]. [LIGHT string, identical]. [New placement if the body moved].
[Slot 9 line, identical]. Same face, same wardrobe, same room, same lamp, same lens as kf-first.
[Aspect]. [Constraints].
```

Filled — `UTD_SC07_SH04_v06_kf-last`, the irreversible delivery:

```text
UTD_SC07_SH04 kf-last. Medium shot, low, camera 40cm off the floor, tilted up 10 degrees, 35mm.
A thin 19-year-old male courier, shaved neck, wool cap pushed back off his forehead, grey padded
cotton jacket buttoned to the throat, canvas satchel strap across his chest on the left shoulder,
chapped knuckles on the right hand. He has completed feeding the envelope under the door; now he
is still crouched on his heels with the first two fingers of his right hand flat against the wood
just above the gap, both hands otherwise empty and open, forearms resting on his knees. No
envelope is visible anywhere in frame. Third-floor landing of a 1937 Shanghai lilong apartment
block, peeling dark-green wainscot to waist height, cracked cream plaster above, worn red floor
tile, dark-stained door with a brass knob and a chipped lower-left corner, a stairwell window at
the head of the stairs opposite the door; door-side low setup, the door plane camera-right. A
single bare filament bulb hanging over the stairhead, warm, hard, above head height, 5:1 lit side
to shadow side with no fill but plaster bounce; cold daylight from the stairwell window behind him,
rimming his back and cap and never reaching his shadow side; the door face stays well under; the
only light on the door is a thin warm line spilling from the 4cm gap beneath it. In this setup the
bulb reads high camera-left and sits on his back and cap; the gap line underlights his hands from
20cm; his face two stops down. He is crouched frame-left, the door plane fills the right two-thirds
with the chipped lower-left corner visible in it, the warm line under the door unbroken again and
running the full width. 35mm film stock, fine
grain, low saturation, warmest and lowest frame of the scene, dull green and cracked cream against
worn red. Same face, same wardrobe, same room, same lamp, same lens as kf-first. 16:9. No rendered
text, signage or numerals; no watermark; no wristwatch, no rubber soles, no printed logos; no face
or costume change; no envelope still visible; no third hand.
```

Its `kf-first` is that block with one substitution, which is what "one action apart" means in
practice: slot 4 becomes *crouched on his heels, the envelope pinched flat between the thumbs and
first fingers of both hands, its leading edge touching the 4cm gap, no part of it yet through*, and
the closing line becomes *the warm line under the door broken by the envelope*. Slots 2, 3, 5, 6,
7, 9 are copied, not retyped.

## Template — storyboard panel

A panel is not a pose. It must carry one of five jobs — a motion about to begin, a motion just
completed, a reveal, a power relation, or a story clue — and if it carries none of them, delete the
shot row rather than draw the panel. The jobs, and the physical devices that make a still imply
motion, are in image-model-adapters §7.

```text
[PROJ_SCnn_SHnn panel]. [Size, angle, ##mm]. [Who and where, one clause each].
The panel shows [about-to / just-completed / reveal / power / clue] — specifically
[the visible evidence]. [Light source and where the shadow falls]. [Placement].
Loose graphite storyboard line drawing, grey wash for shadow, no color. [Aspect]. [Exclusions].
```

Filled — `UTD_SC07_SH05 panel`, the aftermath:

```text
UTD_SC07_SH05 panel. Extreme wide shot, high +15 degrees from the half-landing, 35mm. The empty
landing; the courier already out of frame at the bottom of the stairs; the closed door small at
frame-right. The panel shows a motion just completed — specifically the unbroken warm line under
the door with a shadow entering it from inside, and no one on the landing to see it. The bulb
high camera-left throws a hard rail shadow across the tile toward camera. The door occupies the
right quarter; two-thirds of the frame is empty tile and plaster. Loose graphite storyboard line
drawing, grey wash for shadow, no color. 16:9. No text, no arrows, no panel border, no figure.
```

## Template — character sheet

Generate once, before any shot keyframe. Everything downstream inherits from it. If the model
drifts between panels on one canvas, generate views separately and compose the sheet yourself —
image-model-adapters §4.

```text
[PROJ_CHAR-slug_vNN ref-face | ref-body]. [Views, evenly spaced, named left to right].
[ID string verbatim]. Neutral expression, relaxed shoulders, arms at sides.
Flat frontal light, 5600K, about 1:1 lit side to shadow side so neither side reads as the shadow
side, no rim. Plain mid-grey seamless background.
No lens distortion; subject occupies 80% of frame height. [Aspect]. [Exclusions].
```

The reference sheet is the one image that must carry no lighting opinion. A ratio as steep as 2:1
already picks a shadow side, and every shot generated from the sheet inherits that decision as if
it were bone structure.

Filled — `UTD_CHAR-courier_v01_ref-body`:

```text
UTD_CHAR-courier_v01 ref-body. Four views of the same person, evenly spaced left to right: front,
three-quarter left, full profile left, full body front. A thin 19-year-old male courier, shaved
neck, wool cap pushed back off his forehead, grey padded cotton jacket buttoned to the throat,
canvas satchel strap across his chest on the left shoulder, chapped knuckles on the right hand.
Neutral expression, relaxed shoulders, arms at sides, gaze to camera; right hand turned so the
chapped knuckles are visible. Cloth shoes with worn welts. Flat frontal light, 5600K, about 1:1 lit
side to shadow side so neither side reads as the shadow side, no rim. Plain mid-grey seamless
background. No
lens distortion; subject occupies 80% of frame height. 1:1. No props except the satchel. No text,
no labels, no watermark, no extra people, no wristwatch, no rubber soles.
```

Crop the three-quarter head as the reference for MCU and CU; use the full body for wides — a head
crop makes the model guess the build, and this character is specifically thin.

## Template — location plate

An empty plate with no actor. It fixes architecture, lamp position, and tile direction so every
shot in the location inherits the same room instead of re-inventing it.

```text
[PROJ_LOC-slug_vNN plate-wide]. No people. [Size, camera height, angle, ##mm].
[LOCK string verbatim]. [LIGHT string verbatim, naming which source is dominant].
[Foreground / mid / background layers]. [Texture line]. [Aspect].
Empty room, no figures, no animals, no text. [Era exclusions].
```

Filled — `UTD_LOC-landing_v01_plate-wide`:

```text
UTD_LOC-landing_v01 plate-wide. No people. Wide shot, high +15 degrees from the half-landing,
35mm — the scene's widest permitted lens. Third-floor landing of a 1937 Shanghai lilong apartment
block, peeling dark-green wainscot to waist height, cracked cream plaster above, worn red floor
tile, dark-stained door with a brass knob and a chipped lower-left corner, a stairwell window at
the head of the stairs opposite the door. A single bare filament bulb hanging over the stairhead,
warm, hard, above head height, dominant, 5:1 lit side to shadow side with no fill but plaster
bounce; cold daylight from
the stairwell window, a rim only and never a fill; the door face stays well under; a thin warm line
spills from the 4cm gap beneath the door. In this setup the bulb reads high camera-left at 45
degrees and the window shaft rakes in from the back of frame. Foreground: painted iron stair rail
frame-left. Mid: red tile and the door at frame-right. Background: the window shaft, dust visible
in it. 35mm film stock, fine grain, low saturation, high contrast in the lower third. 16:9.
Empty room, no figures, no animals, no text. No lever handles, no plastic, no conduit wiring, no
glass in the door, no printed logos, no rendered numerals on the door.
```

One clause of `LIGHT_INVARIANT` is edited here and only here: the window is described as a rim
rather than "rimming his back and cap", because on an empty plate that phrase has no referent. That
is the single permitted deviation, it applies to the plate alone, and the full string goes back in
verbatim the moment a figure is in frame.

Generate this plate and shot 03's ECU first: they are the cheapest images in the scene, they settle
the palette, and where the tool exposes a reference-image or seed slot they are what the rest of
the scene binds to.

## Pre-video keyframe QC gate

Run before spending video credits. Every box here is free to fix now and can only be fixed by
regenerating the still later — video never repairs a keyframe error, it animates it. This is the
tick-box form of the reasoned gate in image-model-adapters §9; the scored form is Gate 1 in
[qc-checklist.md](qc-checklist.md).

- [ ] The book's three descriptive invariants — `ID_`, `LOCK_`, `LIGHT_` — appear verbatim, not
      paraphrased, in every frame, the empty location plate's single documented edit aside.
- [ ] No camera-relative direction has been written back into an invariant string; every
      `camera-left` / `frame-right` in the prompt sits in a per-setup sentence of its own.
- [ ] No emotion or attractiveness word sits in slot 3; expression is physical, in slot 4.
- [ ] The scene's checkable anchor (here: the door chip and the unbroken warm line) is visible
      and correct at this shot size.
- [ ] The `kf-first` pose is the previous shot's end state, not a moment from mid-gesture.
- [ ] `kf-first` and `kf-last` of the same shot share slots 2, 3, 5, 6, 7, 9 word for word.
- [ ] The gap between first and last frame is one action, not two.
- [ ] The pose implies a direction of motion; it is not a symmetrical resting pose.
- [ ] Hands are visible and countable, or deliberately cropped out of frame.
- [ ] No numerals, signage, or text appear — the number plate is defocused or out of frame.
- [ ] Era check: nothing in frame post-dates the stated year, against the book's `must avoid`.
- [ ] Focal length is inside the book's kit; nothing wider than 35mm in this scene.
- [ ] The key direction matches this row's `Light dir` cell in the shot plan, and the ratio matches
      the invariant.
- [ ] Aspect matches delivery; you are not planning to crop later.
- [ ] If 9:16 or 1:1 — faces, the hands doing the action, and anything that will be burned in
      sit inside the frame-height band the vertical safe zones leave clear, per
      [cinematic language](../references/cinematic-language.md). Check the current per-platform
      numbers against the platform's spec; do not quote them from memory, and do not assume the
      16:9 headroom habit survived the crop.
- [ ] Exclusions are the `NEG_BASE` classes this framing can actually produce, plus this frame's
      own risks — around six classes total, nothing inherited blindly, and no category among them.
- [ ] Filename follows `PROJ_SCnn_SHnn_vNN_role.ext` and the asset is in the seed and reference
      registry — `seed: null` where the tool exposes none.

Anything that fails maps to an F-code in [failure modes](../references/failure-modes.md); report
it using the block at the end of [qc-checklist.md](qc-checklist.md).
