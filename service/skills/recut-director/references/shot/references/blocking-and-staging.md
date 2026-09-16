> 来源: DirectorSKILL-full (MIT)

# Blocking and Staging

Load this file when you reach Step 6 (Blocking & staging), when a scene puts two or more bodies in one space, when a shot row needs start/end positions, or when a generated clip contains correct-looking people doing nothing that means anything.

Owns: staging geometry, proxemics, power blocking, entrances and exits, eyeline as an instruction to the audience, blocking notation, blocking-to-prompt translation. Shot size, angle, lens psychology, composition, and coverage geometry — the axis of action (180-degree rule), the 30-degree rule, screen direction, eyeline match — belong to [cinematic-language.md](cinematic-language.md).

All focal lengths here are 35 mm full-frame equivalent, matching [cinematic-language.md](cinematic-language.md), and each is paired with the camera distance it assumes: a focal length without a distance is not a frame.

## Thesis

1. Blocking（走位）is the first directorial decision. Camera is the second. You cannot fix bad staging with a good lens.
2. Camera follows bodies. Pick the geometry first, then pick the position that reads it.
3. A scene blocked well can be shot flat — one locked wide, no move — and still read.
4. A scene blocked badly needs six shots to explain what one arrangement should have said in silence.
5. For AI video this stops being taste and becomes economics: staging is the direction that survives generation best, because it lives in the keyframe rather than in the verbs of the text prompt.

## Proxemics: distance is dialogue

Proxemics（人际距离）is the cheapest subtext generator on a set. Measure it in metres and write the number down.

| Zone | Distance | Reads as | Camera consequence |
|---|---|---|---|
| Intimate | 0–0.45 m | Love, threat, medicine, violence. There is no neutral version — the eyeline decides which. | The frontal two-shot stops working: the heads overlap and the near one masks the far one. Go 90° to the axis for a profile two-shot (50–65 mm from ~1.2 m), or take a tight over-the-shoulder and give up on showing both faces. |
| Personal | 0.45–1.2 m | Confession, friendship, negotiation between equals, conspiracy. | The natural two-shot distance. 40–50 mm from ~1.8 m holds both heads at medium with air between them. |
| Social | 1.2–3.6 m | Transaction, work, strangers, formality, interview. | Holding both needs about 3 m of frame width — 28–35 mm from ~3 m — and nobody is bigger than a medium-long. Use the two-shot for the gap, cover the faces in singles. This is where a barrier object belongs. |
| Public | 3.6 m+ | Address, performance, authority, abandonment. | Both bodies in one frame means both are small. That is geometry; no focal length fixes it. The real choice is where you stand: wide and close to one body converts the separation into a size differential (the ladder, below); long and far equalizes them and flattens the gap into a graphic. |

Changing zone mid-scene is the loudest event in a blocked scene. Rules:

- Closing one zone = escalation. Whether it reads as desire or as threat is set entirely by eyeline and pace, not by distance.
- Opening one zone = withdrawal, refusal, fear, or a decision already made in private.
- Crossing two zone boundaries in one move (public to personal, 4 m to 0.8 m) is a violence-level event. At most once per scene.
- Whoever initiates the change is whoever wants something. Whoever refuses to restore the distance — does not step back, does not lean away — holds the power.
- Always write the change as `2.4 m → 0.6 m over 4 s`, never as "moves closer". "Closer" is unfilmable and unpromptable.

Worked: a nurse tells a patient's brother the outcome. Blocked as `nurse 3.2 m → 1.0 m over 5 s, brother does not move`, the scene is a professional taking responsibility. Blocked as `nurse holds 3.2 m, brother closes to 1.0 m`, the same words become a man demanding an answer. One number moved from one column to the other, and the scene changed sides.

## Power geometry

Nine devices. Each produces a read whether you intended it or not, so choose deliberately.

| Device | The geometry | The read |
|---|---|---|
| Height differential | One standing, one lower. Real eye-height gaps: standing to seated in a chair ≈ 0.35–0.45 m; standing to upright kneeling ≈ 0.45–0.55 m; standing to sitting on the floor ≈ 0.7–0.9 m; standing to prone ≈ 1.4 m | The higher body owns the scene, and the read scales with the gap. A chair is a mild concession; the floor is a surrender. |
| Level break | A body deliberately changes height mid-scene — sits, kneels, stands up | The move *is* the beat. Cheapest visible status change there is. |
| Foreground dominance | The near body is 2–3× the far body's frame height | Whoever is nearer the lens is louder, even silent, even out of focus. |
| Who moves vs who holds | One crosses; the other does not adjust position or posture | Stillness is power. The one who has to move is the one who needs something. |
| Crossing into space | Closing from social into personal without invitation | Invasion. If the other backs off, the invader wins the beat outright. |
| Back to camera | One body turned away, usually holding a frame edge | Information withheld. The audience is aligned with the visible face; the turned back reads as threat or authority. |
| Boxed by architecture | Doorframe, window mullion, or column edge within 0.2 m of the body's silhouette | The space is judging them. They are already caught. |
| Who controls the exit | Which body stands between the other and the door | The one nearer the exit can end the scene. The one further away is asking permission. |
| Turning away mid-line | A body rotates 90–180° while the other is still speaking | Refusal. Louder than any line you could write. |

Worked, one line — "You should have told me." Speaker seated, listener standing, listener between the speaker and the door: the line is an appeal, and it will be refused. Speaker standing, listener seated, speaker between the listener and the door: the same line is a sentence being handed down. Nothing changed but height differential and who controls the exit, and one of the two is now begging.

## Staging pattern library

Plan-view diagrams. Legend, used by every diagram below:

```text
[CAM]^ [CAM]v [CAM]< [CAM]>   camera position and the cardinal direction it looks
[CAM]*                        camera on a diagonal axis; the note gives the angle
A B C                         characters at their floor position
A^ Av A< A>                   which way that character faces
A(45) A(135)                  facing in degrees off the lens axis: 0 = into the lens, 180 = full back
A'                            that character's END position after the move
====                          wall        #  doorway/gap        [==]  table/desk/bed/counter
==>                           movement path; the label gives distance and duration
```

### 1. The table opposition

```text
        Bv
   [============]
        A^
       [CAM]^
```

- Reads: two fixed positions, a sanctioned distance, a negotiation with rules. Nobody can invade; the furniture forbids it.
- Camera: over the near shoulder, 25–35° off the table axis, 40–50 mm, at seated eye height (~1.2 m). Squaring off at 90° to the axis instead flattens it into a hearing between equals.
- AI: high. Two seated bodies, zero translation. Animate breath, one hand on the table, a 30° head turn. This is the most reliable dialogue geometry available.

### 2. The approach

```text
              Bv
              A'          A' = end position, 0.6 m from B
   [CAM]>     A^          A: 2.4 m ==> 0.6 m over 4 s; B does not step back
```

- Reads: want. The mover is the one who needs something. If B holds ground, B wins; if B retreats, A wins.
- Camera: 90° to the axis of approach so the shrinking gap is the subject. 35 mm. Shoot down the axis instead and the distance change disappears entirely.
- AI: medium. One mover, one direction, roughly one step per second. The 1.8 m drawn here is over the reliable ceiling for a single translation, so either start A at 1.5 m and close to 0.6 m, or split the approach across two clips; write B's hold as an explicit instruction either way.

### 3. The retreat

```text
              Bv          B holds, still facing A
              A^          A: 0.6 m start
   [CAM]>     A'          A' = 2.0 m, still facing B, backing away over 3 s
```

- Reads: the decision has already been made off-screen. Retreat while still facing forward is refusal; retreat while turning is fear.
- Camera: 90° to the axis, same as the approach. Or hold on the one who stays and let the retreater shrink in the background — that version reads as loss rather than refusal.
- AI: medium-high, and the cheaper of the two. The bodies end further apart than they started, so nothing merges and nothing occludes; the approach ends with two silhouettes converging, which is exactly where limbs fuse. In the background version the retreater also loses pixels as it goes, which is less identity to hold, not more.

### 4. The parallel walk

```text
       [CAM]v            camera leads, retreating up-page at the walkers' pace
       A^  B^            A and B walk up-page toward the lens, 0.8-1.0 m apart, matched pace
```

- Reads: alliance under motion. Two people who agree walk in step; disagreement shows as one drifting half a pace ahead.
- Camera: leading frontal at 35–50 mm; or lock off 90° to the path and let them cross it; or follow from behind at 85 mm so they never seem to arrive.
- AI: low in the leading version — two bodies and the camera all moving. Substitute the locked 90° cross, or the static behind-shot. Both keep the meaning and cost one reliable clip.

### 5. The orbit

```text
    B starts at A's 9 o'clock, ends at A's 1 o'clock, radius 1.2 m
         (12)
    (9)  A    (3)        A pivots in place; the eyeline never breaks
         (6)
    [CAM]^ at (6), 1.5 m out
```

- Reads: assessment, seduction, or interrogation. The orbiter is deciding something about the pivot.
- Camera: beside A at the centre of the arc, panning with B; or locked at 6 o'clock so B crosses frame while A rotates in place. A locked camera goes blind at whichever clock position sits opposite it, and from 6 o'clock that is 12 — B passes dead behind A. Moving to 4 o'clock only shifts the blind spot to 10, still on B's path; for a 9-to-1 arc the positions that never occlude are 10 and 11 o'clock.
- AI: low. Orbit is the highest-drift camera move and a pivoting body compounds it. Substitute two static setups shot from the arc's start angle and end angle; the cut does the orbit.

### 6. The wedge

```text
      Av        Bv       start: A and B 1.0 m apart, both facing camera
      Av   C'v  Bv       end: C has taken the gap, 0.5 m each side
      [CAM]^
```

- Reads: a pair becomes a triangle. Whoever takes the gap has ended the private thing that was happening in it.
- Camera: frontal, symmetric, 35 mm from ~3 m, wide enough that the gap is visible *before* C claims it. The composition must have a hole in it for the beat to land.
- AI: medium. C's arrival is an entrance — start with C's shoulder already at frame edge (see Entrances below) rather than conjuring a whole body.

### 7. The barrier

```text
    B>  ||  A<           barrier on the axis: fence, glass, counter, car, bed
        ||
      [CAM]^             square-on, so the barrier bisects the frame
```

- Reads: the object is the third character and it is winning. Differs from the table opposition in asymmetry — one side has access, the other does not.
- Camera: square-on so the barrier splits the frame; 50 mm from ~3 m holds about 2.2 m of frame width, which is both bodies plus the barrier. Go longer only if you can back off in proportion, or one of them leaves the frame.
- AI: high for an opaque barrier — counter, fence rail, car door, headboard. Nobody passes through anything and the object is static geometry. Drop to medium for glass: reflections and what is visible through the pane are the least stable things in the frame, so either keep the glass dark and non-reflective or accept that the reflection will change between clips.

### 8. The threshold

```text
        Bv               B inside the room, 1.5 m past the sill, facing the door
   =====#=====           wall and doorway; the sill is the line
        A^               A outside, toes at the sill, never crosses
       [CAM]^            camera outside behind A; the doorway frames B
```

- Reads: permission. Whoever has not crossed has not committed. The sill is the scene's question, made out of wood.
- Camera: behind and past A's shoulder at 28–35 mm, A's eye height, so the doorframe frames B — frame-within-frame, see [cinematic-language.md](cinematic-language.md).
- AI: high while nobody crosses; low the instant a body walks through the opening, because occlusion plus a lighting change is where identity dies. Cut at the sill.

### 9. The wall

```text
   ================      wall, window, or sink
        A^               A turned away: back to B and to camera
        B^               B 2.0 m behind, addressing A's back
       [CAM]^            default: straight up the axis, from behind B
```

- Reads: refusal to be looked at. The audience wants the face and cannot have it; that wanting is the tension.
- Camera: two honest choices. From behind B at 50 mm you get two backs and no faces at all — that is the point of the device. If you need B's face in the same frame, move round to about 90° off the axis and stand level with A, 40–50 mm: A becomes a three-quarter back in the near ground and B reads three-quarter front beyond. Do not go past A to the wall itself — from there you are in front of A and you get the face you were withholding. You cannot have A's back and B's face from behind B; the camera has to pick a side. Do not cut to A's face until A turns — the turn is your payoff.
- AI: high in the behind-B version, structurally the most forgiving framing in this library, because there is no face anywhere in frame to hold consistent. Spend your longest clip here. The 90° version drops to medium: B's face is now on the hook for the whole duration.

### 10. The shrinking two-shot

```text
    A>       1.2 m      B<    start: personal distance, balanced two-shot, air between them
              A'>  0.4  B<    end: B has not moved; A has closed 0.8 m; the air is gone
             [CAM]^           camera does not move and does not reframe
```

- Reads: intensification with no help from the camera. The frame stays optically identical; what changes is that the negative space separating them has been spent.
- Camera: locked, 40–50 mm, framed for the START distance. Do not reframe. At the end the pair sits as one mass in a frame built for two, and the leftover air at the edges is the device, not a mistake.
- AI: medium. One mover, lateral, short distance, and B needs an explicit hold. Keep at least 0.3 m of visible gap at the end or the two silhouettes fuse into one body.

### 11. The reveal-by-turn

```text
        A(135)           start: three-quarter away, face withheld
        A'(45)           end: three-quarter toward — a 90° turn over 2-3 s
       [CAM]^
```

- Reads: the moment we are allowed to know. Cheap, ancient, and still works if the withholding was earned first.
- Camera: locked, 50–85 mm, tight enough that the turn fills the frame. Never move the camera during a body rotation — the two rotations fight and the result reads as a mistake.
- AI: medium at the 90° drawn here. A true 180°, back-of-head to full face, means the model invents a face it has never seen, and the invented face will not be your character. Where the tool exposes a first/last-frame slot, pin both ends and the problem goes away — see [ai-video-tool-adapters.md](ai-video-tool-adapters.md).

### 12. The ladder

```text
        C^   BG  6.0 m   smallest, softest, least power
        B<   MG  3.0 m
        Av   FG  1.2 m   largest, sharpest, most power
      [CAM]^             24-35 mm, chest height, 1.2 m from the FG body
```

- Reads: a hierarchy stated in one frame with no dialogue, and the arithmetic states it — at 1.2 m and 6.0 m the FG body is five times the BG body's frame height.
- Camera: 24–35 mm at chest height, stopped down if you want all three planes legible. To invert the hierarchy — soft foreground head, sharp figure far away, saying the one who matters is the one who is distant — you have to give up deep focus: open up or go longer. You cannot have the inversion and deep focus in the same frame.
- Long lenses collapse the ladder. An 85 mm forces you back to about 2.9 m to hold the same foreground framing, which takes the size ratio from 5:1 to under 3:1. Lens mechanics live in [cinematic-language.md](cinematic-language.md).
- AI: high. Every body can be static; depth does all the work. Best story-value-per-clip geometry in the library. One caveat: the background face degrades first, so cast that position as a back, a silhouette, or someone whose likeness you do not need to hold.

### 13. The pin

```text
   ================      wall
        Av               A's back 0.2 m off the wall, no lateral exit
        B^               B at 0.5 m, squared up, closing A's only open line
   [CAM]*                axis 60-70° off the wall plane, off B's near shoulder
```

- Reads: no options. Distinguish it from the approach: the approach is about want, the pin is about geometry that has already decided the outcome.
- Camera: 60–70° off the wall plane at A's chin height, so the wall runs back into frame, A's three-quarter face sits against it, and B's back three-quarter fills the near ground. Square-on to the wall turns it into a plain backdrop and you lose the 0.2 m that makes it a pin. Parallel to the wall gives you both bodies in clean profile — legible, but it is a diagram of a pin rather than the experience of one, because neither face is available and nothing compresses toward the lens.
- AI: medium-high. Static bodies in a tight space. The failure is limbs merging into the wall — keep 0.15–0.2 m of visible gap behind A in the keyframe.

### 14. The pass-through

```text
        Bv               B holds in MG, facing camera
    A>  ==>  A'>         A crosses FG left to right, 0.8 m from the lens, 1.5 s
       [CAM]^            camera never follows A
```

- Reads: an interruption that changes nothing, or a hidden edit point. Functions as a natural wipe.
- Camera: locked medium or wide on B; let A's body do the wiping. Following A throws away the device.
- AI: medium. A single FG body crossing is easy motion, but it occludes B, and occlusion is where identity dies. Clear frame in ≤1.5 s and re-pin B's face in the next clip's keyframe — see [continuity-bible.md](continuity-bible.md).

## Depth staging

- Default read: nearer = larger = louder. FG dominates MG dominates BG. Every departure from this is a statement, so make sure you meant it.
- The foreground filter. Shoot through a doorway, a curtain edge, a shoulder, a bottle, wire mesh. The FG object names the audience's relationship to the scene: eavesdropping, barred, complicit, protected. Keep it 0.3–0.8 m from the lens and let it fall soft; a sharp FG object becomes a subject instead of a filter.
- Working distances on a 35 mm lens: FG at 0.8–1.2 m, MG at 2.5–3.5 m, BG at 6 m+. Deep staging wants 24–40 mm; see the ladder above for what a long lens costs you.
- Depth substitutes for coverage. Inside one AI clip you cannot cut, but you can restage. Put A in FG and B in BG; have A lower their head 20°, and B — suddenly unobstructed — becomes the subject with no cut and nothing new invented. Depth change is the only editing available inside a single generation, and it survives generation far better than any camera move, because the model never has to render a body it has not already seen.
- One clip, three beats, no cut: FG head fills the right third → FG head drops → BG figure stands. That is a shot-reverse-shot's worth of information for one generation.

## Entrances and exits

- This section covers what an entrance or exit *means* inside a scene. What an exit obliges the next shot to do — matching exit-right to enter-left, the neutral reset of a toward/away exit — is continuity geometry and lives in [cinematic-language.md](cinematic-language.md).
- Frame-left entry moves the body rightward; frame-right entry moves it leftward. In left-to-right reading cultures, rightward reads as forward/continuation and leftward as return/resistance. This is a soft convention: its power comes almost entirely from staying consistent within one film, not from any inherent meaning.
- Entering toward camera: the body grows, we are the destination, power accrues. Entering away from camera: the body shrinks, we are being left behind. Same physical action, opposite scene.
- Exiting past camera — the body passes the lens and clears frame — is the strongest exit available: it breaks the plane and puts the character on our side of the world. For AI it is a trade, not a free win. The body scales up to fill the frame just before it clears, which is the most face it will ever ask a model to hold; but it also blurs and occludes as it goes, which makes the join into the next clip nearly free. Angle the exit path a few degrees off the lens axis so the face never arrives dead-centre at maximum size, and grade this exit medium, not high.
- Ranked for AI reliability, safest first: out of frame laterally at constant scale; away from camera into depth; past the lens.
- The empty-frame hold. Let the character clear the frame and hold the empty composition for 1.5–4 s. The frame becomes the subject; the audience keeps looking at where the person was. It is a device, not dead air, and it costs one cheap generation of a static plate with ambient motion (curtain, steam, dust, traffic). Using that same empty frame as a join between two clips is a cut decision and belongs to [editing-and-assembly.md](editing-and-assembly.md).
- AI asymmetry you must plan around: exits are easy, entrances are hard. An entering body does not exist in the start frame, so the model invents it, and invented faces do not match your character. Substitution: begin with a sliver already in frame — a shoulder at the edge, a hand, a shadow across the floor, a reflection — so the "entrance" is a translation of something that already exists. Or make the entrance a new clip whose keyframe already shows the character mid-stride.

Worked: the same woman leaves the same room, three ways. `Exits frame-right at constant scale, 2.0 s, camera holds 2 s on the empty chair` — she is gone and we are left with the room. `Walks upstage through the door and never turns back, 3.0 s` — she is gone and we were never worth turning for. `Crosses to the lens and clears frame-left, 1.5 s` — she is gone and she has taken us with her. Only the third one is expensive to generate, and only the third one gives the next clip a free seam.

## Eyeline and attention

- Where a character looks is an instruction to the audience. They will look there roughly one beat later. An unmotivated eyeline is a lie the audience will try to honour and then resent.
- The look-then-reveal structure: Shot 1 is the look — a face near a frame edge, eyeline pointed off-frame; Shot 2 is the thing, framed from roughly the looker's height and angle. Cost: two clips. Payoff: the audience builds the geography themselves and the model never has to render two subjects in one frame.
- False eyeline as tension: point the look off-frame at nothing and either never pay it off, or pay it off somewhere else. Hold the look 1.5–3 s past comfortable. Use once; twice teaches the audience to stop believing you.
- Height rule: generate the reverse at a camera height matching the looker's eye height, or the two clips will not read as the same room. A seated person's view of a stander is a low angle; render that reverse from standing eye level and the geometry lies — most obviously in interrogation and bedside scenes. Keep the metre value in the shot plan for yourself, but put the *consequence* in the prompt ("the camera sits below his shoulder line and the ceiling is visible behind him"), because models honour visible geometry far more reliably than numbers. Height ladder in [cinematic-language.md](cinematic-language.md).
- For the axis of action (180-degree rule) and eyeline-match continuity across cuts, see [cinematic-language.md](cinematic-language.md).

Worked, two clips: (1) MCU, a woman at the right edge of frame, eyes pointed off frame-left and slightly down, held 2 s past comfortable, one blink; (2) locked wide from her eye height, angled frame-left, of a kitchen table with two mugs on it and only one of them steaming. Neither clip contains two people, neither asks the model to invent anything, and between them the audience has built a room, a relationship, and an absence.

## Blocking notation

This is the director's working layer, not an output format. Use it while you design the beat, then write the *result* into the Blocking column of the Mode D shot plan in plain start → move → end prose, which is what [shot-plan-template.md](../assets/shot-plan-template.md) expects. Every line below is paired with exactly that translation.

```text
POSITION   <lateral>/<depth>          FL | CL | FR   over   FG | MG | BG
                                      FL = frame-left, FR = frame-right
                                      CL = CENTRE lateral, NOT camera-left
                                      @off-FL / @off-FR = out of frame on that side
FACING     :tC   toward camera        :aC   away from camera
           :pL   profile, facing frame-left      :pR   profile, facing frame-right
           :3qL  three-quarter toward frame-left :3qR  three-quarter toward frame-right
GRAMMAR    <NAME> @<start> --[verb, distance, duration]--> @<end>
           chain arrows for a two-verb move; each arrow is one clip's worth of risk
HOLD       <NAME> @<pos> (hold)       does not move, does not turn
           (hold at <anchor>)         pins the hold to a named anchor
JOIN       characters and objects separated by |
EYELINE    eye: A>B, B>floor, A>off-FR, A>lens        changes tagged @t=<seconds>
ANCHOR     door @CL/BG, table @CL/MG                  static geometry that matters
```

Five worked lines:

```text
1  A @CL/FG:aC (hold) | B @CL/BG:tC --[stands, 1 step, 2.0s]--> @CL/MG:tC | eye: A>B, B>A
2  A @FL/FG:pR --[crosses right, 1.4m, 1.5s]--> @off-FR | B @CL/MG:tC (hold) | eye: B>lens
3  A @CL/MG:aC (hold at sill) | door @CL/MG | B @CL/BG:tC (hold) | eye: A>B, B>floor
4  A @FL/MG:pR (hold) | B @FR/MG:pL --[steps in, 0.8m, 3.0s]--> @CL/MG:pL | eye: B>A, A>B, then A>floor @t=2.5
5  A @FL/MG:tC (hold) | B @FR/MG:tC (hold) | C @CL/BG:tC --[walks in, 1.6m, 2.5s]--> @CL/MG:tC | eye: A>C, B>C, C>lens
```

Plain English, which is what goes in the shot plan:

1. A stands in the foreground with their back to us and never moves; deep in the shot, facing us, B rises and takes one step forward into midground. They hold each other's gaze. A's back stays the same size while B grows — power transferring across a static frame.
2. A crosses the foreground left to right in profile and clears frame; B stays put in midground, looking straight down the lens. A wipe that pretends to be an event.
3. A stands at a doorway with their back to us and does not cross; B waits deep in the room, facing us, looking at the floor. Nobody moves. Everything is in who has not crossed.
4. Both start in profile at personal distance; B closes 0.8 m over three seconds. A never moves a foot, holds the gaze for 2.5 s, then drops it to the floor. B paid for the beat with a step, but A lost it with the eyeline, not with the feet — stillness only holds power while the look holds too.
5. Two people face us from opposite thirds; a third walks in from the background and takes the gap between them, looking at the lens. The wedge. The pair's shared thing is over.

## Blocking for AI video

Reliable — write these directly, no hedging:

| Motion | Grade | How to write it |
|---|---|---|
| Breathing, chest and shoulder rise | High | "his chest rises and falls slowly" — always include; it is what stops a clip reading as a still |
| Garment settle, hair drift, ambient cloth | High | Name the fabric and the cause: "the coat hem lifts in the doorway draught" |
| Head turn ≤ 45° | High | State degrees and duration: "turns her head 30° to the left over 1.5 seconds" |
| Head lower / lift | High | Best single-beat emotional move in AI video. Pair it with an eyeline change. |
| Arm raise to chest or head height, no contact | High | Stop the verb before contact: "raises her hand toward the glass" |
| Single translation, one direction, ≤ 0.9 m | High | One verb, one vector, ≤ 1 step per second |
| Slow walk toward camera, 2–3 steps, frontal | High | Frontal keeps the face anchored; do not combine with a camera push |
| Slow pivot in place, ≤ 90° | Medium | Beyond 90° the model starts inventing the unseen side |
| Seated to standing, unassisted, hands off furniture | Medium | Hands touching the chair is the failure point; keep them on knees |
| Reaching toward a static object | Medium | Cut before contact. Possession is a job for the next clip. |

Unreliable — plan the substitution before you write the prompt:

| Motion | Grade | Substitution that keeps the story value |
|---|---|---|
| Two-person choreography (both bodies on separate paths) | Low | Elect one mover and give the other an explicit hold, or split into two clips and let the cut carry the second move |
| Object handoff | Low | Generate the reach and, separately, the possessed object. The cut performs the transfer — oldest trick in editing, see [editing-and-assembly.md](editing-and-assembly.md) |
| Stairs | Low | Two locked clips, top of flight and bottom of flight; or one locked frame through which only head and shoulders rise |
| Running with camera follow | Low | Locked wide with the subject crossing frame, or tight on the face with body bounce and streaking background |
| Fine hand manipulation (keys, buttons, writing, pouring, lighting) | Low | Static insert of the finished state; or frame hands out of shot and let sound plus the reaction tell it — see [sound-and-dialogue.md](sound-and-dialogue.md) |
| Leave frame and re-enter | Low | Exit only. Re-entry is a new clip with a new keyframe. |
| Full 180° turn revealing a face | Low | Turn 90° (three-quarter-away to three-quarter-toward), or pin both ends with a first/last-frame pair |
| Two characters speaking with visible lip-sync in one clip | Low | Single-speaker clips, cut on line ends; dialogue handling lives in [sound-and-dialogue.md](sound-and-dialogue.md) |
| Sitting down into furniture | Low | Keyframe them already seated and animate the settle: weight dropping, shoulders releasing |
| Falling or collapsing to the floor | Low | Keyframe at the tipping point and end near impact, or skip to the aftermath and hold |
| Precise gaze at a specific off-screen point | Low | Fix the eyeline in the keyframe, or put a practical light or object in that direction for the eye to follow |
| Passing between FG and BG behind another body | Low | Use the pass-through instead: the FG body wipes, the BG body holds and is re-pinned next clip |

Symptom-level repairs for clips that already failed live in [failure-modes.md](failure-modes.md).

## Worked example: one beat, three films

The beat: a person delivers bad news to someone sitting down. MAYA stands. RAY is seated. The words are identical in all three versions; only the geometry changes.

Version A — The Verdict. Maya keeps her height and her distance, so the only body that moves is the one receiving.

```text
MAYA @FL/FG:aC (hold) | RAY @CL/MG:tC --[lowers head 25°, 1.5s]--> @CL/MG:tC | eye: MAYA>RAY, RAY>MAYA, then RAY>floor @t=2.0
```

- Camera: locked, 35 mm, at Ray's seated eye height (~1.2 m), so Maya's shoulder towers in the near left third. Height differential and foreground dominance stacked, with nobody crossing the floor.
- Prompt: `Locked camera at the seated man's eye height, so the standing woman is seen from below her shoulder line. Her back and shoulder fill the near left third of the frame, dark and unmoving; the seated man is centred in the midground facing the lens, hands on his knees. She does not move and does not turn. He holds her gaze for two seconds, then lowers his head about twenty-five degrees over a second and a half and his eyes drop to the floor. Dust drifts in the window light behind him. End on the same composition, her shoulder still filling the left third, his head lowered. Same faces, same clothes, same room, same light. No hand contact, no camera move, nobody standing up, nobody leaving frame.`

Version B — The Level. Maya crosses and surrenders her height; the news becomes shared grief.

```text
RAY @CL/MG:tC (hold) | MAYA @FR/MG:pL --[crosses left, 1.0m, 2.0s]--> @CL/MG:pL --[kneels, 1.5s]--> @CL/MG:3qL | eye: MAYA>RAY, RAY>MAYA
```

- Camera: locked, 50 mm from ~3 m, at Ray's seated eye height. Starts as a gap and ends as a pair — a shrinking two-shot performed by the actors, not the lens.
- Prompt: `Locked camera at the seated man's eye height, both people in frame throughout. He is centred and still, facing the lens, hands on his knees. The standing woman is at the right of frame; she crosses about a metre toward him over two seconds, then lowers herself onto one knee beside his chair over another second and a half, until their heads are level. He does not move; his gaze follows her down. Her coat settles as she kneels. End with both heads at the same height, about twenty centimetres apart, still looking at each other. Same faces, same clothes, same room, same light. No hand contact, no camera move, nobody standing up again.`
- Reliability: this is the expensive one — a cross and a level change chained inside one clip, and the notation shows it as two arrows. If it drifts, split at the moment her knee touches the floor and let the cut do the descent.

Version C — The Threshold. Maya never crosses the sill; the news is a delivery, and Ray is left holding it.

```text
MAYA @FL/FG:3qR (hold at sill) | door @FL/FG | RAY @CL/BG:tC --[turns head 40° toward frame-left, 1.5s]--> @CL/BG:3qL | eye: RAY>MAYA, MAYA>floor
```

- Camera: locked, 28 mm, standing eye height, deep focus from inside the room, so Maya is a near silhouette in the doorway and Ray is small and deep. The ladder used straight — nearest is largest is loudest — and the irony is the payload: the loudest position in the frame belongs to the person who is leaving.
- Prompt: `Locked wide camera inside a room, deep focus, standing eye height. A woman stands in the open doorway at the left edge of frame, close to the lens, backlit from the hallway and mostly dark, three-quarters turned toward the room; she does not step in. A man sits far back in the centre of the room, small in frame, facing the lens. He turns his head about forty degrees toward the doorway on the left of frame over a second and a half and holds it there. She keeps her eyes down. Curtain fabric moves slightly in the draught from the open door. End with him looking at her and her looking at the floor, the doorway still between them. Same faces, same clothes, same room, same light. Nobody crosses the doorway, no camera move, no extra people.`

The read, side by side: A is a verdict and assigns blame; B is shared grief and forgives; C is abandonment and confesses cowardice. Same words, three films, one variable — geometry.

## Blocking-to-prompt translation

A video model wants a trio: start state, action, end state. The notation line already contains all three; this procedure extracts them.

1. Split the line into three still images you could actually draw: start, the midpoint that proves the motion happened, and end. If you cannot draw the midpoint, the motion is too large for one clip — split it.
2. Elect exactly one mover. Everyone else gets an explicit hold verb. Unwritten bodies drift.
3. Write the start state as a composition, never as a feeling: who is at FL/CL/FR, who is at FG/MG/BG, which way each faces, how far apart in metres, what object sits between them.
4. Convert the arrow into one verb + direction + magnitude + duration. "Steps toward him, about half a metre, over two seconds" — not "approaches", not "moves closer emotionally".
5. Write the holds as sentences: "he does not rise and does not turn; his hands stay on his knees."
6. State the eyeline at start, at end, and any change with its timing.
7. Add exactly one environmental motion, motivated by something visible in the frame — draught, dust in a shaft, steam, traffic outside a window.
8. Write the end state as a composition again. This is the frame you want frozen. If a next shot exists, make this end state equal that shot's start state and log it in [continuity-bible.md](continuity-bible.md).
9. Lock identity: face, hair, costume, room, light quality.
10. Build the negative list from the low-reliability motions you deliberately avoided in this clip — not a generic block. Word-level choices live in [prompt-lexicon.md](prompt-lexicon.md).

The shape that comes out, ready for [video-prompt-template.md](../assets/video-prompt-template.md):

```text
START:  [camera height and lens] [who is where, facing where, how far apart, what is between them]
ACTION: [one mover: verb + direction + distance + duration] [explicit holds] [eyeline and its change]
        [one environmental motion]
END:    [composition to freeze on] [identity locks] [negatives drawn from what you avoided]
```

Before and after, same blocking (Version A above):

```text
Weak:   A woman tells a seated man bad news. She approaches him emotionally.
        Dramatic lighting, cinematic mood.
Strong: Locked camera at the seated man's eye height, so the standing woman is seen from below
        her shoulder line. Her back and shoulder fill the near left third, dark and unmoving;
        he is centred in midground facing the lens, hands on his knees. She does not move and
        does not turn. He holds her gaze two seconds, then lowers his head about twenty-five
        degrees over a second and a half and his eyes drop to the floor. Dust drifts in the
        window light behind him. End on the same composition, his head lowered. Same faces,
        clothes, room, light. No hand contact, no camera move, nobody standing up, nobody
        leaving frame.
```

The weak version has no geometry, so the model chooses the geometry, and a model's default geometry is two people standing at conversational distance doing nothing — which is the shot you did not want.
