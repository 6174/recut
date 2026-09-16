> 来源: DirectorSKILL-full (MIT)

# Shot Plan Template

Load this file when you are at Step 7 (shot list and coverage) or the user asked for Mode D — a shot list, 分镜表, storyboard table, or "give me the shots".

Build rows only after the beats exist ([beat sheet](beat-sheet-template.md)) and the rules exist ([director book](director-book-template.md)). A shot plan written before those two is a list of pictures.

## Shot table

| # | Sec | Beat / function | Loc | Frame content | Blocking start → move → end | Size / Angle | Lens | Move | Light dir | Light / atmos | Continuity anchors | Risk | Transition | Gen note |
|---:|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 02 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

## Field dictionary

| Column | Must contain | Good | Bad |
|---|---|---|---|
| `#` | Story-order number, zero-padded, stable for the life of the project | `04`, later split into `04a` / `04b` | `Shot 4 (was 3)` |
| `Sec` | In and out inside the scene, plus duration | `0:12–0:18 (6s)` | `about six seconds` |
| `Beat / function` | The beat id from the beat sheet, plus the job this shot does for it | `B4 · irreversible delivery` | `emotional moment` |
| `Loc` | The continuity-bible location id, plus which setup within it | `loc_landing / door side, low` | `hallway` |
| `Frame content` | What a storyboard artist would draw: subject placement plus the two or three set and prop elements that must be in frame | `head and near shoulder frame-left, dark door plane fills frame-right, envelope edge low-left` | `he stands at the door` |
| `Blocking start → move → end` | Three states, the last one named explicitly | `starts squared to the door → right hand rises, knuckles stop 3cm short → ends hand down at his thigh, still facing the door` | `he hesitates to knock` |
| `Size / Angle` | One size off the ladder plus an angle in degrees or a named height. Give camera heights in cm so nothing here can be misread as a focal length | `MCU, eye level` / `MS, low, camera 40cm off the floor, tilted up 10°` | `medium-ish, dramatic angle` |
| `Lens` | Focal length in mm (full-frame equivalent) and, when not obvious, the reason | `85mm — compresses the gap and keeps the corridor out of the background` | `telephoto` |
| `Move` | Exactly one named move with distance and duration, or `locked` | `slow dolly-in, 25cm over 6s` | `slight push with a bit of drift` |
| `Light dir` | Key direction relative to *this* camera, height, the named practical motivating it, the ratio written lit side : shadow side as the book records it, and what the fill actually is. Call a source behind the subject a rim, not a fill — a fill opens the shadow side and must sit near the lens axis to do it | `key: bulb, high camera-left 45°, 5:1, fill is plaster bounce only; window is a cold rim from upstage` | `moody side light` |
| `Light / atmos` | What the light does in this frame that it did not do in the last one — contrast, atmosphere, which plane is held under | `door face 1.5 stops under; dust in the window shaft; breath visible` | `dark and cold` |
| `Continuity anchors` | The named items that must match adjacent shots: identity, costume, prop state, light state | `cap pushed back, satchel on left shoulder, envelope white face out, knuckle scrape right hand, warm line under door unbroken` | `same character and setting` |
| `Risk` | The band — `Green` / `Amber` / `Red` — read off the difficulty rubric in [production workflow](../references/production-workflow.md), plus the score and the one dimension that drove it | `Red 12 — interaction 3, and it trips the contact override` | `might be tricky` |
| `Transition` | How you leave the shot, and on which frame | `hard cut the frame the fingertips touch wood` | `cut to next` |
| `Gen note` | The one thing the generator will get wrong, the instruction that prevents it, and the split plan if it still fails | `say "his knuckles stop short and never touch the door"; negative: knocking, hand on door. If it knocks anyway, drop to 3s.` | `use a good prompt, high quality` |

## Risk legend

Risk is a generation budget, not commentary. Score the six dimensions and read the band — Green, Amber, Red — off the difficulty rubric in [production workflow](../references/production-workflow.md), which also owns the retry budgets and the stop rules. Copy the band and the score into this column with the dimension that drove it, and do not invent a second scale here; a plan that grades on its own private words cannot be budgeted against the retry table.

In the worked example below the bands read 01 Green, 02 Amber, 03 Green, 04 Red, 05 Green. Shot 04 scores 12 — action 3, people 1, camera 1, duration 2, interaction 3, continuity 2 — and it also trips the contact override, because the envelope passes between his hand and the door and the rubric counts a prop passing between a subject and a fixed feature as contact. The override is the useful half of that reading: a 3-on-interaction plus 3-on-anything pair does not come down with a better prompt, only with the split already written into its Gen note.

One Red in five is a plan. Three Reds in five is a wish — go back to Step 5 and lower the ambition, or split those shots on paper now rather than after a day of failed generations.

## Worked example

Project `Under the Door`, scene 7 — 22s, 16:9, 5 shots, ASL 4.4s. Beats `B1`–`B5` from [beat sheet](beat-sheet-template.md); lens kit, key direction and invariant strings from [director book](director-book-template.md).

| # | Sec | Beat / function | Loc | Frame content | Blocking start → move → end | Size / Angle | Lens | Move | Light dir | Light / atmos | Continuity anchors | Risk | Transition | Gen note |
|---:|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 | 0:00–0:04 (4s) | B1 · locate the errand | loc_landing / stairhead side | stair rail foreground frame-left, empty landing, cracked plaster filling the top third, door at frame-right, cold window shaft raking in from the back | starts off-frame below on the stairs → climbs into frame, three steps across the landing → ends squared to the door 60cm out, envelope up at chest, motionless | WS, high +15° from the half-landing | 35mm — holds him and the whole door in one frame | locked | key: stairhead bulb, high camera-left 45°, 5:1, fill is plaster bounce only; the window is a cold rim from upstage, not a fill | door face 1.5 stops under; dust in the window shaft; breath faintly visible | cap pushed back, grey padded jacket, satchel on left shoulder, envelope white face out, chipped lower-left door corner, warm line under door unbroken | Green 5 — one walking figure carrying a prop, locked camera | hard cut the frame he stops | I2V from keyframe, 4s. State the end state ("he stops walking and stands still facing the door") or he is as likely to be walked straight past it. One motion only — do not also animate the window light. |
| 02 | 0:04–0:09 (5s) | B2 · the hand that cannot knock | loc_landing / door side | his head and near shoulder frame-left, dark door plane fills frame-right, envelope edge low-left | starts squared to the door, envelope in his left hand → right hand rises, knuckles stop 3cm short of the wood, held 1s → ends hand down at his thigh, still facing the door, envelope still up | MCU, eye level | 50mm — his single coverage, keeps the door plane readable behind him | locked | key: bulb, high camera-left 45°, rakes the side of his face; the window is behind him, so it rims his back and cap from camera-left rear and never opens the shadow side | door stays dark, nothing on it; 5:1; breath visible against the cold rim | same cap, jacket, satchel and envelope; knuckle scrape on the right hand | Amber 7 — a hand approaching a surface without contact is a classic completion error | hard cut as the hand reaches his thigh | Say "his knuckles stop short of the door and never touch it"; negative: knocking, hand touching door. Keep a hold-and-abort gesture near 5s: past that the clip has runway left over and tends to fill it with a second, unwanted gesture. |
| 03 | 0:09–0:12 (3s) | B3 · the person inside becomes real | loc_landing / floor level at the door | the 4cm gap under the door, the warm light line, worn red tile, his boot toe at the bottom frame edge | starts on an unbroken warm line → a shadow crosses it from inside, right to left, as the radio comes up → ends with the line unbroken again but the room now audibly occupied | ECU, head-on, camera 15cm off the floor — the scene's one frontal frame | 85mm — compresses the gap and keeps the corridor out of the background | locked | only source in frame is the spill from inside, behind the door; his side of frame is 3 stops down | highest contrast in the scene; the light line is the sole highlight | tile pattern and grout direction, gap height, worn welt on the boot | Green 2 — no face, no hands, one moving shadow | hard cut as the shadow clears frame | Simplest shot here: generate it first and, where the tool exposes a reference-image or seed slot, use it as the palette reference for the rest. Animate the shadow only; state "the camera does not move and the door does not open." |
| 04 | 0:12–0:18 (6s) | B4 · irreversible delivery | loc_landing / door side, low | low three-quarter on him crouched frame-left, door plane filling the right two-thirds, envelope entering the gap | starts crouched on his heels, envelope pinched in both hands at the gap → he feeds it under, then pushes with two fingers until his fingertips touch the wood → ends fingertips on the door, hands empty, still crouched | MS, low, camera 40cm off the floor, tilted up 10° | 35mm — the only lens that fits the crouch and the door plane together | slow dolly-in, 25cm over 6s — the scene's one moving shot | key: bulb still on his back and cap from camera-left; the gap line underlights his hands from 20cm; his face 2 stops down | warmest and lowest frame of the scene; the light line is briefly blocked by the envelope, then unbroken | envelope white face out until it disappears, two fingers of the right hand, knuckle scrape, door chip visible frame-right | Red 12 — action 3 and interaction 3: the envelope passes between his hand and the door, which is contact with a fixed feature, so the contact override fires whatever the total says | hard cut the frame the fingertips touch wood | Highest-failure shot in the scene. Where the tool exposes a first/last-frame pair, use it, with the last frame showing empty hands and fingertips on wood. The split is already decided: 04a MS crouch and feed (4s) and 04b ECU two fingers pushing (3s), then re-time the scene. |

Shot 05 (B5, aftermath, 4s) is left out of the table for length and reads: EWS, 35mm, high +15°, locked — shot 01's setup with the camera backed up the flight to the half-landing, since the lens does not change and the size has to come from distance. He backs two steps, turns and drops out of frame down the stairs; hold on the empty landing until a shadow crosses the light line from inside. Risk `Green 4`. Cut on the shadow.

Check the plan against itself: 4+5+3+6+4 = 22s over 5 shots = ASL 4.4s, inside the book's 4–5s target. Size ladder reads WS(2) → MCU(4) → ECU(6) → MS(3) → EWS(1) — every adjacent pair differs by at least two steps, and 01/05 repeat one setup deliberately as a bookend. One moving shot out of five, on the commitment beat, as the book allows.

## Compact variant

Use these three columns when the user wants a short answer, a chat-width table, or a first pass before committing to the full plan. Everything technical collapses into the Frame cell; the story stays legible.

| # | Frame | Action → end state |
|---:|---|---|
| 01 | WS · 35mm · high +15° · locked · 4s | He climbs into the landing, crosses it in three steps — ends squared to the door 60cm out, envelope at chest, motionless. |
| 02 | MCU · 50mm · eye level · locked · 5s | His right hand rises and stops 3cm short of the wood — ends hand down at his thigh, still facing the door. |
| 03 | ECU · 85mm · head-on, 15cm off the floor · locked · 3s | A shadow crosses the warm line under the door — ends on the line unbroken, the room now audibly occupied. |
| 04 | MS · 35mm · low · dolly-in 25cm · 6s | Crouched, he feeds the envelope under and pushes with two fingers — ends fingertips on wood, hands empty. |
| 05 | EWS · 35mm · high +15° · locked · 4s | He backs off, turns and drops down the stairs — ends on the empty landing as a shadow crosses the light line. |

## Coverage check

Read the plan column-wise before you read it row-wise. Each of these catches a different class of error.

- Every beat has at least one shot. The turn beat may have two or three; no other beat may have more shots than the turn beat.
- Every shot has exactly one job. Two jobs means two shots, or one shot re-blocked so the second job disappears.
- Read the Frame content column alone, top to bottom. It should tell the story without the other columns. If it reads as five variations on one picture, you have angles, not coverage.
- Read the Blocking column alone. Each end state should be the next row's start state — or the cut is doing work nobody has accounted for, and you should say what. The example has exactly one gap: 02 ends standing and 04 starts crouched. Shot 03 is what covers the crouch, and that is half of why it exists; if you cut it, you owe the audience the move.
- Count the moving shots against the book's move budget. Over budget means the moves have stopped meaning anything.
- Track screen direction down the page. In the example the courier faces camera-right at the door in every row; the first row that reverses that owes the audience a neutral shot or a cutaway.
- Confirm the scene has an entry the audience can orient in and an exit they can leave on. A scene that starts on an insert and ends on an insert has no geography.

Each row hands Step 8 (keyframes) its Frame content, Size, Lens, Light dir and Continuity anchors, and hands Step 10 (video prompts) its Blocking, Move, end state and Gen note. If a cell is empty, the downstream prompt will invent something in its place.

## Rules

- Shot numbers follow story order, not production order, and stay stable. Splitting a shot yields `04a` / `04b`; it never renumbers `05`.
- Beat and story function must be explicit. If that cell is empty, the shot probably should not exist.
- Blocking must contain a start and an end state, and **every shot must name its end state** in words a generator can be held to. "He hesitates" is not an end state; "hand down at his thigh, still facing the door" is. Staging geometry and blocking notation live in [blocking and staging](../references/blocking-and-staging.md); this column records the result, not the reasoning.
- Every shot needs one dominant camera move or none — never two. If the shot needs a move and then a reframe, it is two shots.
- Size change at a cut is conditional on angle change, and the condition is the one in [cinematic language](../references/cinematic-language.md): stay on the same axis and you owe two size steps, because one step on the same axis reads as a stutter rather than a cut; change the angle by 30° or more and one step is enough. A deliberate match — a true match cut, or a repeated setup used as a bookend — is exempt from both. Ladder for the arithmetic: EWS 1 · WS 2 · MS 3 · MCU 4 · CU 5 · ECU 6.
- Lens stays constant within a coverage set unless the size step justifies the change; a focal-length change inside a matched pair reads as a mistake.
- Light direction may not change between shots of the same moment unless a source in the world changed. That is what the Light dir column is for — scan it down the page and any unexplained flip is a continuity error you can catch before generating.
- Continuity anchors name specific items — face, costume, prop state, light state. Copy them from [continuity bible](../references/continuity-bible.md); do not invent them per row.
- Do not cross the line or break screen direction between rows. Coverage geometry lives in [cinematic language](../references/cinematic-language.md).
- Seconds must reconcile with the beat sheet's estimates and the book's target ASL. If the three disagree, fix the document that is wrong rather than adjusting the arithmetic.
- Grade Risk before writing a single prompt, and split the `Red` rows on paper. Symptom-to-fix repair for shots that fail anyway is in [failure modes](../references/failure-modes.md).
