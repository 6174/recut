> 来源: DirectorSKILL-full (MIT)
> 原路径: references/failure-modes.md
> 搬运日期: 2026-08-29 — 全文原样搬运，保留英文原文，未做有损删改

# Failure Modes: Diagnosis and Repair

Load this file when a generated clip is wrong and you need to name the cause, pick the cheapest fix, and decide whether to re-prompt or re-plan the shot.

[../assets/qc-checklist.md](../assets/qc-checklist.md) is the pass/fail gate you run before delivery. This file is the manual behind it: triage tree, failure codes F1–F19, cost ladder L1–L7, prevention. It is the sole owner of the F-code taxonomy — every other file cites a code and links here rather than restating it. Always quote the code in a repair note so the fix is traceable and so repeated codes surface as process problems.

## Order of operations

1. Run the triage tree. Collect one code per reported symptom — not one code per clip. Two or more codes in the same clip means the shot is over-scoped; go straight to L5. At three, the shot is not over-scoped, it is three shots.
2. Read each code's Fixes and start at the lowest L number listed. Never skip a level upward without a reason from the skip rule.
3. Log every generation against the shot. At three failures, stop editing the prompt and apply the three-strike rule.
4. After the shot is delivered, push the code through the prevention map so it does not recur on shot 12.

Repair-note format, one per failed shot:

```markdown
Shot 07 — F5 (no end state), 2nd generation
Cause: prompt ends on "walks toward the door", no terminal pose; clip ran 8 s for a 3 s action.
Fix applied: L1 add end state + L2 duration 8 s -> 4 s.
Prevention: Step 6 blocking row lacked an end position.
```

When one clip carries more than one code, use the multi-failure form instead. The ordering rule is: diagnose the codes independently, then find the single upstream decision that produced them all — usually duration, shot size, or an over-scoped action — and fix that before you touch any symptom. Fixing symptoms one at a time re-spends the same generation on the same root.

```markdown
Shot 07 — three codes, 2nd generation
  F2  no motion ............... from 0:00
  F1  identity drift .......... onset 0:04.8
  F19 object permanence ....... envelope gone at 0:06.2
Shared root: 8 s on one face-carrying, hand-heavy, occlusion-heavy shot. One decision, three symptoms.
Ladder: L5 — skip rule (b), triage returned more than one code.
Fix applied: split into three shots of 3–4 s, one prompt each (see below); no prompt edit alone reaches the root.
  07a face, 3 s, no envelope in frame
  07b insert on the envelope, 3 s, unoccluded, no face
  07c reaction, 4 s
Parameters: motion strength one step down on 07b; seed locked across all three.
Cut notes: the occlusion falls between 07b and 07c, so the disappearance becomes an edit.
Prevention: Step 7 let one row carry a face, a hand action, and an occlusion at 8 s.
```

## 60-second triage tree

Step 0 counts the symptoms. Step A converts a feeling into an observation. Step B converts an observation into a code.

```text
STEP 0 — how many things did the user say were wrong?

  One symptom ......... run A then B once. Take the first branch that matches.
  More than one ....... run A then B once PER SYMPTOM, to exhaustion, and collect
                        EVERY code before you read a single Fixes list. The tree
                        returns one code per pass, so a clip with three failures
                        needs three passes; one pass hides the other two.
                        Two codes  -> skip to L5 (skip rule b).
                        Three or more -> the shot is not over-scoped, it is three
                        shots. Re-plan it as three, then re-triage what survives.
  Symptoms that are one symptom: "the face changed AND her coat changed" is one
  code (F1). Count mechanisms, not sentences.

STEP A — the complaint is a mood, not a symptom. Translate it first.

  "it feels fake"          -> weight, contact, gravity ............ F14
                              then speed / floatiness ............. F13
                              then light that drifts .............. F12
                              then "only the face moves" .......... F2
  "it looks like AI"       -> melting geometry .................... F3
                              then hands, eyes, teeth ............. F10
                              then rubbery speed .................. F13
  "it looks cheap"         -> speed and motion strength ........... F13
                              then flat or shifting light ......... F12
  "it isn't my film"       -> palette, grain, lens feel ........... F16
  "it's boring"            -> NOT a generation failure.
                              Re-plan the shot (L5) or cut it (L6/L7).

STEP B — play once at 1x, once at 0.25x. Take the first branch that matches the
symptom you are on, then return to Step 0 for the next symptom.

Does anything actually move?
├─ Nothing moves, or only a slow zoom / parallax over a still ......... F2
└─ Something moves
   │
   ├─ Is the moving thing the thing you asked to move?
   │  ├─ Subject ignores the action entirely ......................... F4
   │  ├─ Action begins but the clip ends before its end state ........ F5
   │  ├─ Action happens but cheats gravity, weight, or contact ....... F14
   │  ├─ Action happens at the wrong speed, or ramps mid-clip ........ F13
   │  └─ Camera moves you did not ask for, or never settles .......... F6
   │
   ├─ Does the subject stay the same subject the whole clip?
   │  ├─ Face, body, or costume becomes a different person .......... F1
   │  ├─ Geometry melts, limbs fuse, background breathes ............ F3
   │  ├─ Only hands, fingers, eyes, or teeth are wrong .............. F10
   │  └─ Person holds but palette, grain, or lens feel changes ...... F16
   │
   ├─ Is anything in frame that should not be there?
   │  ├─ New person, animal, duplicate, or object appears ........... F9
   │  ├─ Letters, captions, logos, watermarks, UI ................... F11
   │  ├─ An object that does not belong to the era or place ......... F8
   │  └─ Light source, direction, or color changes mid-clip ......... F12
   │
   ├─ Did something in frame stop existing?
   │  ├─ A prop is gone, or comes back different after an occlusion . F19
   │  └─ A garment or a wardrobe detail is gone ..................... F1
   │
   ├─ Is the framing what you specified?
   │  └─ Heads cropped, subject outside safe area, wrong aspect ..... F17
   │
   ├─ Does it fail only in relation to the shots around it?
   │  ├─ Start state contradicts the previous shot's end state ...... F7
   │  └─ Visible seam, pose reset, or pulse at an extend point ...... F18
   │
   └─ Is the picture acceptable and only the sound wrong?
      └─ Mouth and words disagree, or room tone fights the space .... F15
```

Two user phrasings need splitting by hand:

- "She never falls" is three bugs. Nothing starts: F4. She starts to go and the clip ends mid-fall: F5. She goes down but floats or lands without impact: F14. Watch the last six frames to tell them apart.
- "It doesn't match the last shot" splits by *what* mismatches. Position, prop, or hand state: F7. Only the light: F12. Only the look or grade: F16. Only the person: F1. A hard pulse at the join: F18.

## The cost ladder

Try in order. The ladder is ordered by how much of your work each level throws away, not only by money: L1–L4 all cost at least one generation, but L1 discards a sentence, L4 discards a keyframe, and L5 discards the plan. Most people jump to L3 (regenerate and hope) when L1 would have fixed it, and stay at L3 when L5 was the only real answer.

| Level | Move | Real cost | Usually fixes |
|---|---|---|---|
| L1 | Prompt edit | ~2 min of writing, then 1 generation | F2, F4, F5, F6, F9, F11, F13, F19 |
| L2 | Parameter change, where the tool exposes them: duration down, motion strength down, prompt-adherence up, seed locked, frame rate | ~1 min, then 1 generation | F1, F3, F6, F13, F19 |
| L3 | Regenerate unchanged (seed roulette) | 1 generation per pull, budget 2 | F10, F9, F3 when intermittent |
| L4 | Rebuild the keyframe | 1 image generation + 1 video generation | F1, F8, F11, F12, F16, F17 |
| L5 | Re-plan the shot: shorter, closer, simpler, split | ~10 min of planning, then 1–2 generations; saves 5+ | F14, F15, F19, sustained F10, anything irreducible |
| L6 | Fix in the edit: trim, cutaway, dissolve, retime, mask | no generation, costs 0.3–1.0 s of screen time | F13, F18, F5, late-onset F3 |
| L7 | Cut the shot | no generation, costs a beat — verify the beat survives elsewhere | Any code, once this one shot has eaten more than roughly 8% of the project's planned generation budget |

Rules that make the ladder work:

- L3 economics: if two consecutive unchanged pulls fail the *same* way, the failure is deterministic. Stop pulling. A third pull is superstition. If they fail *differently*, one more pull is rational. That budget of two applies to serial re-rolls after a diagnosis, where each pull is buying information. A parallel batch of four identical takes on a Green shot is sampling rather than roulette, and is governed by the band budgets in [production-workflow.md](production-workflow.md), which owns retry economics; the only rule it must obey is that you do not batch a shot whose keyframe or prompt you already suspect.
- Skip straight to L5 when any of these is true: (a) the shot needs something on the irreducible list; (b) triage returns two or more codes; (c) the action requires more than ~1.5 s of continuous precise contact between hands and an object, or between two people; (d) the clip is longer than 8 s and the failure onset is after second 5; (e) you have already spent three generations.
- L6 is not defeat. A 0.5 s trim that lands the cut before the melt is a better use of the clip than a fourth generation. See [editing-and-assembly.md](editing-and-assembly.md) for what the cut can absorb. The ladder governs the decision to spend *another generation*; once a clip is in hand and its defect is localized — inside the trim handles, under 8 frames, or a grade mismatch against its neighbour — go straight to L6. That triage is owned by editing-and-assembly.md and outranks the ladder's ordering.
- Every number on this ladder — the two pulls at L3, the three generations in the skip rule, the 8% at L7 — is a threshold you set in advance so the decision is not made while you are frustrated. They are planning guidance, not measured success rates.

## The three-strike rule

After three failed generations of the same shot *design*, **change the shot, not the prompt**. The fourth prompt edit is almost always a re-wording of the second. Pick one of these seven moves — pick exactly one, and regenerate once. The count resets when the design changes; the per-shot ceilings across all designs are the band budgets in [production-workflow.md](production-workflow.md).

| Move | Do this | Use when |
|---|---|---|
| Shorten | Cut duration by 40–50% (8 s → 4 s). Keep the same action, drop its tail. | Failure onset is late in the clip: F1, F3, F18 |
| Push in | Go one size closer, or two if the failure is anatomical: a full-figure wide becomes a medium, a medium becomes an MCU. Less body, fewer joints, fewer background objects to hallucinate. | F3, F9, F10, F17 |
| Simplify | Delete every motion except one. One body action, camera locked, environment still. | F4, F6, F13 |
| Split | Two clips joined on a cut instead of one clip containing a transition. | F5, F14, F19, any multi-code shot |
| First/last frame | Build both endpoints as stills and let the tool interpolate, where the tool exposes the slot. | F5, F7, F19, controlled transformation |
| Substitute | Replace the action shot with a reaction shot or an insert that implies it. | F10, F14, F15 |
| Off-screen | Let the action leave frame and show only its consequence. | F14, F10, anything violent or contact-heavy |

Worked example of Off-screen. The shot "she knocks the stool over as she stands" failed three times (F14: the stool tips without weight, then re-rights itself). Replaced with two clips: (1) locked frame on her hip and thigh with the stool beside her, floor visible at the bottom of frame — she pushes up and her body clears frame top, the stool leg scrapes and slides out of frame bottom-left, 1.5 s; (2) locked wide of the empty room, the stool already on its side, dust drifting in the window light, 2 s. The audience builds the fall. Nothing had to be simulated. See [blocking-and-staging.md](blocking-and-staging.md) for staging actions to exit frame cleanly.

## The root-cause checklist — what to infer, in descending order of yield

**These are things to work out from what the user already gave you, not questions to put to them.** A user who says "it came out bad" wants a fix, not an intake form. Read the six items against the prompt, the clip, the timecode, the named tool, and the brief; stop when you have the code; then deliver.

Where the cost ladder for that code is three rungs or fewer, give the ladder and ask nothing — it is cheaper for the user to try three rungs than to answer three questions. F2 needs no question at all: L1, L2 and L4 between them cover all three of its causes. Where an inference is load-bearing, state it as an assumption and mark what it would change: "assuming this was image-to-video from a still you already like — if it was text-to-video the code is F8/F17 instead, and the first fix moves to L4."

Only one question is ever permitted, it goes last, after the cause-agnostic fix is already on the page, and it is the one whose answer changes the **deliverable** — never the one that only changes the diagnosis. Ordered by yield, that is almost always the first item below, and failing that the second.

1. **The intended last frame.** If neither the user nor the prompt can name it in one sentence, the diagnosis is F5 and the prompt never had an end state to miss. This finds the cause more often than anything else on this list, which is why it is also the one question worth spending when the deliverable turns on it.
2. **Which input mode, and what the input image is like.** Image-to-video from a good input means a prompt or duration failure (F2, F4, F5, F13). Image-to-video from a soft, small, low-contrast, or already-warped input is an asset failure (F1, F3, F16) — no prompt fixes those, go to L4. Text-to-video widens the suspect list to F8, F9, F12, F17. Infer it from the request: an attached still, a mention of a keyframe, or a tool named in image-to-video mode settles it.
3. **Clip length, and the second at which it goes wrong.** Wrong from frame 1: keyframe or framing (F1, F16, F17). Wrong after roughly 60–70% of the duration: the model ran out of identity or geometry budget (F1, F3, F19). Wrong exactly at a join: F18. A user who says "about halfway" has already given you this.
4. **What the prompt actually says.** If it was supplied, count the primary verbs and the camera verbs. More than one primary verb predicts F4 or F5. More than one camera verb predicts F6. Adjectives outnumbering concrete nouns predicts F2. See [prompt-lexicon.md](prompt-lexicon.md) for the word-level rewrite. If it was not supplied, do not invent one — diagnose from the symptom and hand back the prompt *shape* to rewrite into.
5. **How many generations this shot design has already had.** Three or more: stop diagnosing the prompt. The answer is the three-strike rule, regardless of the code. "I've tried this a bunch of times" is the answer.
6. **Whether it fails the same way every time.** Same way: deterministic — the prompt, the keyframe, or the plan is wrong (L1, L4, L5). Differently: stochastic — the shot is at the edge of the model's competence; two more pulls at L3 are reasonable, then L5. If unstated, assume deterministic; it is the cheaper mistake.

## Symptom-to-code quick index

| What the user says | Code |
|---|---|
| "It looks like a slideshow / PPT / a photo with a zoom" | F2 |
| "Nothing happens" | F2 or F4 |
| "The face changed", "it stops being her" | F1 |
| "Her clothes changed color halfway" | F1 |
| "The shade is not our red", "the logo changed shape" | F1 |
| "Everything melts", "it turns to soup" | F3 |
| "The background is breathing" | F3 |
| "She never falls / never opens it / never turns" | F4, F5, or F14 |
| "It just stops in the middle" | F5 |
| "The camera goes crazy", "it won't hold still" | F6 |
| "I said locked and it pushes in anyway" | F6 |
| "It doesn't match the last shot" | F7 (also F1, F12, F16, F18) |
| "The cup jumped to her other hand" | F7 |
| "There's a car in my 1930s street" | F8 |
| "A second person walked in" | F9 |
| "There are three hands" | F10 or F3 |
| "The fingers are wrong" | F10 |
| "There's gibberish text on the sign" | F11 |
| "A watermark appeared" | F11 |
| "The light flips to the other side" | F12 |
| "It got warmer/greener as it went" | F12 |
| "It's in slow motion and I didn't ask" | F13 |
| "It speeds up at the end" | F13 |
| "It feels weightless / floaty" | F14 |
| "The glass falls but doesn't break" | F14 |
| "The mouth doesn't match the words" | F15 |
| "It doesn't look like the rest of my film" | F16 |
| "His head is cut off" | F17 |
| "The extension has a visible jump" | F18 |
| "The envelope vanished", 「信封也消失了」 | F19 |
| "The cup was gone after he turned" | F19 |
| "It disappeared once his hand went over it" | F19 |
| "It came back but it's a different bottle" | F19 |

## Failure taxonomy F1–F19

Each entry: the symptom in user language, causes ranked by likelihood with the mechanism, fixes ranked by cost, and a before/after prompt pair on the same intent.

### F1 — Identity drift（人物漂移）

Identity here covers anything the audience is asked to recognise as the same thing twice: a face, a garment, a product's colour, a brand mark.

- Symptom: "the face changed", "around second five it stops being the same person", "her coat went from grey to brown", "the shade is not our red", "the logo changed shape".
- Cause 1: clip length. The face holds early and degrades with frame index — nothing in the clip pulls a late frame back toward the anchor image, so error that appears at second three is still there, plus more, at second seven. Note that this is a function of frame index, not of motion: a clip that looks static still spends its full identity budget, which is why F1 and F2 co-occur routinely and why the shared fix is duration rather than motion strength.
- Cause 2: too much rotation or occlusion. Every degree of head turn past ~45° and every pass behind an object asks for geometry the anchor image never showed, and what comes back in those regions is invented.
- Cause 3: weak anchor image — subject small in frame, soft focus, low contrast, or a face under roughly 15% of frame height.
- Cause 4: the subject carries a brand-defined colour or mark — a specified hue, a logotype, a bottle silhouette. That is a discrete constraint handed to a continuous generator: what comes back is a plausible neighbour of the value, and a neighbour of the brand red is not the brand red. Under grade and compression it drifts again.
- Fix L1: restate the identity anchors as nouns, not adjectives — "same braid, same grey wool coat with the torn left cuff", not "same beautiful woman".
- Fix L2: cut duration to 3–5 s and lower motion strength.
- Fix L4: rebuild the keyframe closer (MCU or tighter) so the face occupies more pixels. See [image-model-adapters.md](image-model-adapters.md).
- Fix L5: split into two shots and let the cut absorb the drift.
- Fix L5, Cause 4 only: stop generating the product. Past a tolerance no prompt closes, composite the real pack shot or the real mark over a generated surround, or shoot it practically and generate the environment around it. Judge the hue against the swatch, never against the previous take, and never sign off a generated hue as the brand hue. A hand operating that product in the same clip is on the irreducible list at the end of this file.

```text
BEFORE  A woman walks through the market and looks around. 10 seconds, camera follows her.
AFTER   From the first frame, she turns her head left over 2 seconds and stops, eyes fixed off-screen left. Camera locked, medium close-up. Same face, same braid, same grey wool coat with the torn left cuff, same stall behind her. 4 seconds.
```

### F2 — No motion / slideshow（PPT感）

- Symptom: "it looks like a slideshow", "it's just a photo with a zoom", "nothing happens".
- Cause 1: the prompt describes a picture, not an event. Adjectives and atmosphere give the model nothing to animate, so it defaults to a camera push over a static plate.
- Cause 2: the keyframe is a pose with no implied next instant — subject at rest, symmetrical, weight evenly distributed, nothing mid-gesture.
- Cause 3: the tool's motion control is turned down, or it is in a mode that preserves the input still. Check the control surface before rewriting the prompt.
- Fix L1: write three motion layers — body, cloth or hair, environment. Every clip needs at least two of the three.
- Fix L1: give the body a weight shift. A shift of weight reads as life even when nothing else happens.
- Fix L2: raise motion strength one step.
- Fix L4: rebuild the keyframe mid-gesture — hand already lifting, foot already off the ground, fabric already displaced.

```text
BEFORE  A man stands on a rooftop at dusk, moody atmosphere, wind, cinematic.
AFTER   His coat hem and collar lift and drop in gusts. He shifts his weight onto his right foot and lowers his chin. Steam from the vent behind him drifts right and thins. Camera locked. End with his chin down and shoulders dropped.
```

### F3 — Warping and morph mush

- Symptom: "everything melts", "it turns to soup", "the background is breathing", "her arm passes through her body".
- Cause 1: too many simultaneous motions. Subject motion plus camera motion plus environment motion demands a parallax that stays consistent from three moving sources at once; what comes back instead is a smear that splits the difference.
- Cause 2: fast or rotational motion. Rotation is the single most reliable way to produce mush: every degree of turn reveals surfaces the input never showed, and those regions come back invented rather than remembered.
- Cause 3: too many discrete objects in frame — a wide shot with 20 background elements gives 20 things to smear.
- Fix L1: remove the camera move, or remove the subject move. Keep one.
- Fix L2: lower motion strength, shorten to 3–4 s.
- Fix L5: push in one shot size. Fewer objects, fewer joints, fewer failures.
- Fix L6: if the melt starts at second 6 of an 8 s clip, use the first 5 s and cut.

```text
BEFORE  She spins around fast and throws her arms out, camera orbits her.
AFTER   Medium close-up, chest up. She turns 45 degrees to her left over 2 seconds, arms staying close to her body. Camera locked. End facing the window.
```

### F4 — Wrong or absent action

- Symptom: "she doesn't do it", "he just stands there", "it ignored my prompt".
- Cause 1: the action is a mental state, not a body mechanic. "Realizes", "remembers", "decides", "feels betrayed" have no pixels. The model animates nothing because nothing was described.
- Cause 2: two or more primary verbs competing. The model picks one, usually the first, or blends them into neither.
- Cause 3: the action contradicts the keyframe — the prompt says she sits down but the image already has her seated.
- Fix L1: rewrite the interior state as an observable mechanic. Ask "what would a camera see?"
- Fix L1: delete every verb but one.
- Fix L4: rebuild the keyframe so the action has somewhere to go.

```text
BEFORE  He realizes he has been betrayed and reacts emotionally.
AFTER   He stops chewing. He sets the glass down on the table without letting go of it. His jaw tightens. End with his hand still on the glass, eyes down.
```

### F5 — No end state

- Symptom: "it just stops in the middle", "she never finishes", "it ends nowhere".
- Cause 1: the prompt has no terminal pose. Without a specified last frame the model spends the whole duration on the middle of the action and the clip expires mid-gesture.
- Cause 2: duration too long for the action, so the model stretches the same motion and never resolves it.
- Cause 3: the action genuinely takes longer than the clip — a 6 s walk across a room in a 4 s slot.
- Fix L1: append an explicit terminal sentence. "End with [body part] in [position], [what has stopped moving]."
- Fix L2: match duration to the action, then add the hold you want at the end. A head turn is 1.5–2 s, three deliberate steps to a stop are about 3 s, a sit-down is 2.5 s; a held final pose is another 0.5–1 s.
- Fix L5: switch to first/last frame（首尾帧）where the tool exposes it — the end state stops being a request and becomes a constraint.
- Fix L6: trim to the last coherent frame and let the cut imply completion.

```text
BEFORE  She walks toward the door. 8 seconds.
AFTER   She takes three steps to the door and stops with her palm flat against it, not turning the handle. End on her palm on the wood, shoulders still, breath visible. 4 seconds: about 3 for the walk and the stop, the last second held.
```

### F6 — Camera chaos or unrequested move

- Symptom: "the camera goes crazy", "I said locked and it pushes in anyway", "it drifts the whole time".
- Cause 1: multiple camera verbs in one prompt. Pan, orbit, and push cannot be resolved together and the model improvises.
- Cause 2: no camera instruction at all. Where a tool has no explicit lock control, silence is commonly read as licence to drift or push rather than as a request to hold.
- Cause 3: the tool's camera-control widget is set separately from the text and contradicts it. Check the control surface in [ai-video-tool-adapters.md](ai-video-tool-adapters.md).
- Fix L1: one camera behavior per clip, named, with a magnitude. Add explicit negatives for the moves you do not want.
- Fix L2: set motion strength low; where a numeric camera-motion value exists, set it near zero for a lock.
- Fix L5: if the shot needs two moves, it needs two clips.

```text
BEFORE  Dynamic sweeping camera, dolly zoom, epic reveal, drone move.
AFTER   One camera behavior only: a continuous slow push-in（推镜）on the lens axis, roughly 20 cm over the full 4 seconds, starting at the first frame and ending at the last. No pan, no tilt, no roll, no zoom, no orbit, no handheld shake, no pause and restart.
```

Note that the AFTER holds to one behavior for the whole clip. "Locked for two seconds, then push in" is two behaviors and reproduces Cause 1; if you want a lock followed by a move, that is two clips joined on a cut.

### F7 — Continuity break across shots

- Symptom: "it doesn't match the last shot", "the cup jumped to her other hand", "she's suddenly on the wrong side".
- Cause 1: shot B was generated from a fresh keyframe rather than from shot A's last frame, so nothing carried over.
- Cause 2: the shots were generated in different sessions with different seeds, references, or prompt phrasing.
- Cause 3: a screen-direction or eyeline error in planning, not in generation — see coverage geometry in [cinematic-language.md](cinematic-language.md).
- Fix L1: state the inherited state explicitly at the top of shot B's prompt — position, hand state, prop, light direction, gaze.
- Fix L4: export shot A's last frame and use it as shot B's first frame.
- Fix L5: re-plan the pair with an intentional cut point — an eyeline match, an insert between them, or a match cut.
- Fix L6: place a 1 s cutaway between them; a mismatch the audience does not see side by side is not a mismatch.

```text
BEFORE  Interior of the same room, she sits at the table and lifts her cup.
AFTER   First frame is the last frame of the previous clip. She is already seated, both hands flat on the table, the green enamel cup at her right elbow, window light from camera-left. She lifts the cup 10 cm and stops. Camera locked, same MCU as before.
```

### F8 — Anachronism and era leak

- Symptom: "there's a car in my 1930s street", "modern signage in a period scene", "his shoes are wrong".
- Cause 1: the default dressing for a named location type is contemporary. Naming a decade shifts the output without clearing those defaults, so modern fixtures and materials keep arriving in frames whose costume and architecture are otherwise right.
- Cause 2: the era lived only in the prompt, not in the keyframe. Text-level era instructions are weak; pixel-level era instructions are strong.
- Cause 3: the negative list names categories ("no modern objects") the model cannot resolve into instances.
- Fix L1: replace category negatives with nameable ones — a material, a process, or a specific object. "No modern objects" is unresolvable; "no moulded plastic" is not. Keep it to the four-to-six-item budget in [prompt-lexicon.md](prompt-lexicon.md) and check that each item is actually anachronistic. Wristwatches and eyeglasses are wrong to exclude from a 1930s scene; moulded plastic frames and digital displays are right.
- Fix L1: specify light sources by period technology; lighting technology dates a frame faster than costume does.
- Fix L4: build the era into the keyframe with an image model, then animate. Text-level era instructions are the cheap attempt; this is the reliable one, so do not spend more than one prompt edit before coming here.

```text
BEFORE  1930s Shanghai street at night, crowded, period accurate.
AFTER   Night street, 1930s Shanghai. Light comes only from gas lamps, paper lanterns, and bare filament bulbs. Cars are pre-war: upright grilles, spoked wheels, painted steel. Signage is hand-lettered on wood and hanging cloth; the road is unmarked stone; shoes are leather or cloth. Negatives, five: no LED or fluorescent light, no moulded plastic, no printed or backlit signage, no nylon or synthetic fabric, no aluminium.
```

### F9 — Extra people or objects appearing

- Symptom: "a second person walked in", "there are two of her", "objects appear out of nothing".
- Cause 1: the background has open, walkable depth — a corridor, a concourse, a street receding — so there is somewhere for a body to be, and the model fills it. Depth plus ambiguity is the invitation; a flat surface close behind the subject is not, which is why the L4 fix below works.
- Cause 2: the prompt implies population — "busy station", "crowded market" — and the model keeps adding until the description is satisfied.
- Cause 3: camera motion reveals off-screen space, and off-screen space is generated fresh each time.
- Fix L1: state the count explicitly — "exactly one person in frame, no one enters frame".
- Fix L3: intermittent duplication often clears on one more pull.
- Fix L4: rebuild the keyframe with a near, occluding background — a wall, a curtain, a shallow-focus wash — so there is no readable depth to populate.
- Fix L5: tighten the frame so there is no room for a second body.

```text
BEFORE  In the busy station hall she waits for the train.
AFTER   Medium close-up. She occupies the left third of frame; behind her, a blank tiled wall and one out-of-focus pillar. Exactly one person in frame. No one enters or crosses frame. Camera locked.
```

### F10 — Anatomy failure (hands, limbs, eyes, teeth)

- Symptom: "the fingers are wrong", "three hands", "her eyes go dead", "the teeth merge when he smiles".
- Cause 1: hands and teeth are small, high-frequency, self-occluding structures, and nothing holds their shape from one frame to the next. A hand that is correct in frame 1 has usually drifted by frame 40, and it drifts further every time it closes or crosses itself.
- Cause 2: the failing part is small in frame. Below roughly 8% of frame height, a hand has too few pixels to stay coherent.
- Cause 3: the hand is doing precision work (see the irreducible list).
- Fix L1: keep hands together, closed, in contact with the body, or out of frame. "Hands stay clasped at his waist" prevents more failures than any negative prompt.
- Fix L3: intermittent anatomy failure is the one case where seed roulette is genuinely efficient, because the defect is stochastic rather than baked into the prompt. Two pulls.
- Fix L5: substitute an insert — cut to the object, not the hand operating it.
- Fix L6: trim before the smile, mask, or cut on the reaction.

```text
BEFORE  He counts the coins in his palm and pushes them across the counter.
AFTER   Extreme close-up on the counter surface. His hand enters frame from the right already closed around the coins, sets the fist down, opens flat. Fingers stay together. 2 seconds, camera locked.
```

### F11 — Text and watermark artifacts

- Symptom: "gibberish text on the sign", "a watermark appeared", "there are captions burned in".
- Cause 1: the keyframe contained text or a logo, so the video model perpetuates and degrades it.
- Cause 2: the scene type arrives with lettering attached whether or not you asked — storefronts, newspapers, screens, packaging.
- Cause 3: stock-like compositions — a centred subject, a clean gradient background, an obvious commercial framing — come back with stock furniture attached. Corner watermarks and logo blocks arrive with the look, not with anything you asked for.
- Fix L1: add explicit negatives for text, captions, subtitles, logos, watermarks, and UI overlays.
- Fix L4: rebuild the keyframe with text out of focus, occluded, at a raking angle, or removed entirely.
- Fix L5: if the story needs the words, deliver them by voice, by a designed title card in the edit, or by a composited still — not by generation.

```text
BEFORE  A newspaper headline announces the factory closure.
AFTER   Close-up of a folded newspaper on the table, headline block out of focus behind a coffee cup. Only the block shape of the type and the rhythm of the columns read; no individual letterform is legible. No captions, no watermark, no logo.
```

### F12 — Lighting or color drift

- Symptom: "the light flips to the other side", "it gets warmer as it goes", "the shadows swap".
- Cause 1: no named light source. With nothing in the prompt to hold it to, the lighting is free, and it comes back different between generations and drifts inside a single clip.
- Cause 2: subject rotation. As the head turns, the light turns with it — the key stays on the same side of the *face* instead of the same side of the *room*, which is the one thing a real lamp cannot do.
- Cause 3: nothing in the frame anchors exposure. With no visible source, no clipped highlight, and no true black in shot, overall level and colour wander across a long clip, because each frame matches its neighbour more closely than it matches frame 1.
- Fix L1: name the source, its side, its quality, and forbid change — "direct sun through the window camera-left, hard-edged shadows, right side of the face stays in shadow throughout". Name the quality that the source actually produces: an undressed window is a large soft source, so "hard window light" only makes sense as direct sun or a narrow slot. Ratios and motivation live in [lighting-and-color.md](lighting-and-color.md).
- Fix L2: shorten; drift is cumulative.
- Fix L4: rebuild the keyframe with unmistakable directional light — a visible practical in frame anchors the model far better than a described one.
- Fix L6: stabilize small drift with a grade in the edit before regenerating.

```text
BEFORE  She sits by the window and turns toward camera.
AFTER   Direct sun through the window camera-left as the only key, hard-edged, roughly 4:1 lit side to shadow side measured on her face — two stops down on the shadow side; the right side of her face stays in shadow the whole clip. She turns 30 degrees toward camera and the shadow edge crosses her nose. Do not change light direction, color temperature, or exposure.
```

### F13 — Speed wrong (too fast, too slow, ramping)

- Symptom: "it's in slow motion and I didn't ask", "it speeds up at the end", "everything is rubbery".
- Cause 1: action-to-duration mismatch. A 2 s action in an 8 s clip comes back either as slow motion or as an action that finishes early and then coasts or ramps to fill the tail; a 6 s action in a 4 s clip comes back as a blur.
- Cause 2: no pace instruction. Left unstated, human motion returns slow and floaty far more often than brisk — the unspoken default is nearer a drift than a walk.
- Cause 3: the delivered frame rate was reached by interpolation rather than by generating every frame, which reads as glide — contact softens, footfalls stop landing, the whole clip feels retimed. Where the tool says what it generates versus what it delivers, check it before blaming the prompt.
- Fix L1: give the pace a number or a physical referent — "walking pace, one footfall roughly every 0.55 seconds", "constant speed, no ramp".
- Fix L2: adjust duration to the action, not the other way around.
- Fix L6: retime in the edit. A clip at 115% with a cut before the ramp usually beats a regeneration.

```text
BEFORE  He runs down the corridor.
AFTER   He runs down the corridor at a steady jog: one footfall roughly every 0.35 seconds, four footfalls, so the run lands inside 1.5 seconds. Camera tracking beside him, matching his speed. Constant speed. No slow motion, no speed ramp, no time-lapse. 2 seconds total.
```

### F14 — Physics violation (gravity, weight, collision, liquid)

- Symptom: "it feels weightless", "the glass falls but doesn't break", "he pushes the door and it opens by itself", "the water is jelly".
- Cause 1: nothing in the pipeline simulates physics. Motion comes back by resemblance to motion that looked right, and free fall, impact, fracture, splashing, and sustained load are exactly the cases where resemblance is not enough.
- Cause 2: the moment of contact is the failure point. Objects interpenetrate or re-separate at the instant they touch.
- Cause 3: the shot asks for a full event (approach, contact, consequence) inside one clip.
- Fix L1: describe the *anticipation* rather than the event — the tip past balance, the weight transfer, the flinch before impact.
- Fix L5: split at the moment of contact. Contact happens on the cut.
- Fix L5: move the event off-screen and show the consequence. This is the widest-applicability move in this file — it appears in the fix list for F10, F14, and F15 — because it removes the thing being simulated instead of asking for it more precisely.
- Fix L6: sound sells the impact the picture failed to render. See [sound-and-dialogue.md](sound-and-dialogue.md).

```text
BEFORE         The vase falls off the table and shatters on the floor.
AFTER clip A   Locked on the table edge. The vase tips past its balance point and leaves frame at the bottom. 1.5 seconds.
AFTER clip B   Locked wide of the floor. Shards already scattered, dust settling in the light, one shard still rocking to a stop. 2 seconds.
```

### F15 — Audio and lip-sync mismatch

- Symptom: "the mouth doesn't match the words", "her lips move but there's no sound", "the room sounds wrong".
- Cause 1: mouth shapes and the audio track come back only loosely tied to each other. Sync that looks right on the first two words has usually slipped by the sixth, and the gap widens with line length. Where lip-sync is offered at all, plan for it to hold over short lines only.
- Cause 2: two speakers in one clip, or pronouns instead of labels, so the model cannot attribute lines.
- Cause 3: generated ambience does not match the visible space — an interior with exterior reverb.
- Fix L1: one speaker, one line, six words or fewer, mouth clearly visible, MCU or tighter, clip ≤ 4 s. Six words is the ceiling for a line you intend to lip-sync on camera, not the general dialogue limit — that lives in [sound-and-dialogue.md](sound-and-dialogue.md).
- Fix L5: hide the mouth. Three-quarters away, over-the-shoulder, hand at the face, or a cutaway to the listener — then the line is VO in the edit and always syncs.
- Fix L5: design the scene so the important lines land on listener shots. Reaction coverage is free insurance.
- Fix L6: replace generated ambience entirely in the edit; treat generated audio as a scratch track.

```text
BEFORE  He says "you were never really here, and we both know it" angrily.
AFTER   Medium close-up, he is turned three-quarters away, mouth not visible. His jaw tightens and he exhales once through the nose. Line delivered as voice-over in the edit; on-screen mouth movement is not required.
```

### F16 — Style drift

- Symptom: "it doesn't look like the rest of my film", "shot 6 is glossier than shot 5", "the grade changed".
- Cause 1: the style lives in adjectives ("moody", "arthouse") which every generation interprets differently.
- Cause 2: shots generated from keyframes made in different sessions, models, or aspect settings.
- Cause 3: a style lens was applied in planning but never translated into prompt-level mechanics.
- Fix L1: convert the style into measurable mechanics — focal length, depth of field, palette by name, contrast level, grain, key quality. Mechanics reproduce; moods do not.
- Fix L4: regenerate keyframes from one seed and one reference image so the film shares a source look.
- Fix L6: unify in the grade. A consistent LUT across shots hides more drift than any prompt.

```text
BEFORE  In the style of a moody arthouse film, beautiful cinematography, atmospheric.
AFTER   40 mm lens look at a wide stop: the subject sharp, the background soft but still readable as a place. Muted green and grey palette, soft overcast key, mid contrast, visible grain in the shadows. Exactly one saturated element in frame — a warm practical bulb; nothing else in frame is saturated.
```

### F17 — Framing and crop error

- Symptom: "his head is cut off", "she's too small", "it came out square", "the subject sits dead center and I asked for the left third".
- Cause 1: aspect mismatch between the keyframe and the video output — the tool crops or pads to fit, and neither preserves your composition.
- Cause 2: composition given as a feeling rather than as frame geography.
- Cause 3: camera motion reframes over the clip and ends outside the intended composition.
- Fix L1: state framing in frame-relative terms — "eyes on the upper third line, headroom about 10% of frame height, subject on the left third, hands inside frame". Headroom scales with size: roughly 10% of frame height on a medium or MCU, closer to 5% on a full-figure wide, near zero on a close-up where you are cropping the top of the head deliberately.
- Fix L2: set the output aspect to the delivery aspect where the tool exposes it, before spending a generation.
- Fix L4: rebuild the keyframe at the delivery aspect and the intended size, and let the video model inherit it. Never crop a 16:9 keyframe into 9:16 and expect the composition to survive.
- Fix L6: reframe in the edit only if you have resolution to spare.

```text
BEFORE  Wide shot of the two of them talking at the table.
AFTER   16:9. Full-figure wide, both inside frame, headroom about 5% of frame height above the taller one, both sets of feet visible, table edge on the lower third line. Camera does not zoom or reframe; the composition at the last frame is the composition at the first.
```

### F18 — Seam or loop artifact on extend

- Symptom: "the extension has a visible jump", "there's a pulse where the clips join", "she resets to the starting pose".
- Cause 1: the extension behaves as though the last frame were a fresh still — motion restarts from rest instead of continuing, which reads as a stop-start pulse at the join.
- Cause 2: color or exposure differs slightly between segments, so the join flashes.
- Cause 3: the extend prompt repeats the original prompt, so the model replays the same action from the top.
- Fix L1: write the extension prompt as a *continuation* of a motion already in progress, naming the exact in-progress state.
- Fix L2: shorten each segment; short extends drift less.
- Fix L5: stop extending. Two designed shots joined on a cut beat one extended shot with a scar.
- Fix L6: hide the seam — cut away for 0.5 s, place a whip or an object wipe on the join, or lay a 4–6 frame dissolve across it. See [editing-and-assembly.md](editing-and-assembly.md) for which of these the cut can carry.

```text
BEFORE  Continue the scene, she keeps walking down the hall.
AFTER   The extension begins exactly where the previous clip ends: she is mid-step, right foot forward, weight still transferring, hand halfway to the rail. Complete that same step and take one more. Do not reset her pose. Do not restart the camera move. Same exposure and color.
```

### F19 — Object permanence break（对象消失）

- Symptom: "the envelope vanished", "the cup was gone after he turned", "it disappeared once his sleeve went over it", "it comes back but it's a different bottle", 「信封也消失了」.
- Cause 1: occlusion and re-reveal. Nothing in the pipeline carries a persistent object memory. A prop that passes behind a hand, a body, a doorframe, or the frame edge is not stored and restored — the covered region is regenerated when it uncovers, and the cheapest thing to regenerate there is the surface behind it. This is the dominant cause by a wide margin, and it fires even on short clips.
- Cause 2: the prop is small or low-contrast in frame. Below roughly 5% of frame height, or sitting on a surface of the same value, a prop has too few pixels to survive the frames in which nothing else in the description references it.
- Cause 3: clip length. Object identity decays with frame index the same way face identity does. Past about 5 s a prop that is handled, small, or repeatedly re-framed softens, shifts colour, changes its count of edges, or merges into what it rests on. A large, static, continuously visible object holds far longer — which is why the environmental and product band in [ai-video-tool-adapters.md](ai-video-tool-adapters.md), which owns duration strategy, still runs to 8–12 s.
- Cause 4: the prop leaves frame. Off-screen space is generated fresh every frame, so anything that exits and re-enters re-enters as a new object — usually a different size, a different colour, or a different orientation.
- Fix L1: keep the prop continuously in frame and unoccluded, and say so as a fact of the whole clip, not as a wish: "the cream envelope stays flat in the lower right of frame for the entire shot, never covered by his hand, never leaving frame".
- Fix L1: name the prop with the two or three nouns the keyframe gave it — colour, material, one edge condition — every time you mention it. A generator can hold "cream paper envelope, one corner creased"; it cannot hold "the envelope".
- Fix L2: cut duration to 4 s or less wherever the prop is handled, occluded, or small in frame. Every second past that is budget spent holding something nothing is anchoring.
- Fix L5: put the occlusion on a cut. The hand covers the prop at the end of clip A; clip B opens with the prop uncovered in the state you want. The transition the model cannot survive becomes an edit the audience never questions.
- Fix L5: switch to first/last frame（首尾帧）where the tool exposes it, with the prop specified and visible in both stills, so its final state is a constraint rather than a request.
- If the prop must be occluded, re-revealed, and legible inside one continuous clip, that shot is on the irreducible list at the end of this file. Re-stage it; do not buy more generations.

```text
BEFORE  He slips the envelope under his coat, then pulls it out again and holds it up. 8 seconds.
AFTER   Locked medium close-up on the tabletop. The cream paper envelope, one corner creased, lies flat in the lower right of frame and stays there for the whole clip — never covered, never leaving frame, never changing colour. His hand enters from frame left, presses two fingers onto its near edge, and stops. End with the fingers still on the paper and the envelope in the same place it started. 4 seconds.
```

## Prevention map: failure to pipeline step

A code that appears once is a generation problem. The same code three times in a project is a process problem at the step below. Fix the step, not the prompt.

| Code | Owning step | The check that should have caught it |
|---|---|---|
| F1 | 8 Keyframe strategy | Face occupies enough of the keyframe; clip length inside the identity budget |
| F1, brand colour or mark | 1 Intake & scope | Hero product, brand hue and logotype identified as composite-only before any generation is budgeted |
| F2 | 6 Blocking & staging | Every shot row has start → motion → end, and names a cloth or environment layer |
| F3 | 7 Shot list & coverage | One motion source per shot; shot size tight enough for the action |
| F4 | 6 Blocking & staging | Action written as a body mechanic, not an interior state |
| F5 | 6 Blocking & staging | Every shot row states an end position, not just a start position and an action |
| F6 | 7 Shot list & coverage | Exactly one named camera move with a magnitude, per shot |
| F7 | 8 Keyframe strategy | End state of shot N is recorded as start state of shot N+1 |
| F8 | 1 Intake & scope | Era and forbidden-object list captured before any keyframe is generated |
| F9 | 6 Blocking & staging | Frame population count declared per shot |
| F10 | 7 Shot list & coverage | Precision hand work reassigned to an insert before generation |
| F11 | 8 Keyframe strategy | Keyframes audited for text and logos before animation |
| F12 | 5 Director's book | Named key source and side per location, carried into every prompt |
| F13 | 7 Shot list & coverage | Duration budgeted from the action's real length, not from the tool default; pace stated in the shot row |
| F14 | 6 Blocking & staging | Contact and impact moments scheduled to fall on cuts |
| F15 | 11 Sound & dialogue | Lines assigned to VO or to listener coverage at plan time |
| F16 | 4 Style lens | Style translated into mechanics before shot 1 |
| F17 | 1 Intake & scope | Delivery aspect fixed before keyframes are generated |
| F18 | 12 Edit & assembly | Long beats planned as cut sequences, not as extends |
| F19 | 8 Keyframe strategy | Every prop that must persist is registered in the continuity bible and either held unoccluded in frame for the whole clip, or handed to a cut — no occlusion-and-reveal inside one generation |

Track the counts in the retry log described in [production-workflow.md](production-workflow.md).

## Irreducible failures

These do not respond to prompt craft. As of writing, models across every family this file covers fail them consistently enough to plan around, and the fourth attempt costs the same as the first. Re-test rather than assume if you are reading this a year later — but plan the shot as if the failure stands. The directorial answer is to get the story value without asking for the thing that fails.

- Sustained precise hand work — tying, threading, writing, buttoning, playing an instrument, knife work.
  - Why: hands self-occlude constantly and nothing holds their shape across frames; coherence collapses past roughly 1.5 s of continuous manipulation.
  - Workaround: intent, then off-screen, then result. Medium shot of the person beginning, cut to an insert of the finished object, cut to their face. Or an ECU under 1.5 s with the hand entering frame already in position.
  - Say it like this: "His hand enters frame already holding the needle. He lowers it toward the cloth. 1.2 seconds." Then cut.
- A hand operating a branded product in one clip — applying the lipstick, twisting the cap, tilting the bottle to camera. The most-requested commercial shot there is, and the one that most reliably fails.
  - Why: three failures compound and each is independently sufficient. Fine manipulation collapses past roughly 1.5 s of continuous contact (the entry above). The brand mark is letterforms or a trademarked silhouette, so it comes back as its own lookalike (F11). And the hue plus the specular roll-off on lacquer, metal or glass is a discrete target a continuous generator only approximates (F1, Cause 4). Multiply three per-clip probabilities and the fourth attempt is no likelier than the first.
  - Workaround: the product stays static and the **light** moves. Put the hero on a fixed mark, hold the camera, and travel a soft highlight across it — the shot reads as motion without asking the model to move the one thing that must not change. Give the hand its own clip: it enters already in position, holds under 1.5 s, and contact happens on the cut. Composite the real product over the generated surround wherever the mark or the hue has to be exact.
  - Say it like this: clip A, "The tube is static at frame centre, upright, label facing camera. A soft highlight travels across it left to right over 2 seconds. Camera locked. No hand in frame." Clip B, "Her fingers enter from frame right already closed around the tube and lift it 3 cm. 1.2 seconds." Cut between them.
- Readable text — signage, letters, newspapers, screens, labels, numbers on a clock face.
  - Why: what comes back is the look of letterforms without the spelling — the right rhythm of strokes, the wrong word.
  - Workaround: text out of focus, at a raking angle, partially occluded, or under three characters. Carry the content by voice, by a cutaway you composite in the edit, or by a title card.
  - Say it like this: "The label is soft and half-covered by his thumb; only the red band is readable."
- Multi-person contact choreography — handshake, hug, fight, dance, passing an object, a kiss.
  - Why: two bodies have to stay coherent at once, and the contact frame is where it breaks — limbs interpenetrate, fuse, or pass through each other at the instant they touch.
  - Workaround: split by person. Two singles joined on the cut, with matched eyelines and matched screen direction. Contact happens between the frames.
  - Say it like this: Clip A, "she extends her hand toward camera-right and stops." Clip B, "his hand closes, already joined, and pulls back." Cut on the contact.
- Exact object permanence over long clips — one specific prop surviving 8+ s, or surviving an occlusion and re-reveal. This is the irreducible tail of **F19**; the coded entry above covers the cases prompt craft and a cut still reach.
  - Why: an object that passes behind a body or the frame edge comes back different when it reappears — nothing carries its identity across the occlusion.
  - Workaround: keep the prop continuously in frame, keep clips ≤ 5 s, or let the reveal be the cut rather than a camera move. Register the prop's state in [continuity-bible.md](continuity-bible.md) so the next keyframe rebuilds it correctly.
  - Say it like this: "The green enamel cup stays in the lower right of frame for the whole shot, never occluded, never leaving frame. 4 seconds." If it has to disappear and come back, the reappearance is a new shot built from a new keyframe.
- Complex reflections — mirrors with a matched subject, water with a full reflected figure, glass showing both interior and exterior.
  - Why: a mirror image is a second view of the same scene that has to agree with the first, and in practice the reflection drifts away from its source instead of tracking it.
  - Workaround: shoot into the reflection only, with the real subject out of frame. Or break the surface — rain, steam, dust, condensation, a cracked or dark mirror that reflects a shape rather than a face.
  - Say it like this: "Only the reflection is in frame; rain breaks the surface every second or so."
- Consistent crowd faces — a background of individuated people who stay themselves.
  - Why: whatever consistency a clip has goes to the foreground; background faces change from second to second.
  - Workaround: crowds as silhouette, backs of heads, out-of-focus bokeh, or motion blur. Keep named faces to two per frame. Crowd wides under 3 s.
  - Say it like this: "Behind her, the crowd is backlit silhouette only — no faces resolved, no eyes, heads and shoulders as dark shapes drifting left. Two people in focus: her, and the man at her right shoulder."
- Exact counts and legible quantities — "seven candles", "three coins", a dial reading a specific value.
  - Why: quantity is unstable frame to frame. Count the candles at the start and again at the end and the numbers differ, whatever the prompt said.
  - Workaround: use one, two, or many. If a number matters to the story, put it in dialogue or in an insert built as a still image, not in generated motion.
  - Say it like this: "A single candle burns at the centre of the table; the rest of the table is dark." If the script needs seven, the line "seven of them, one for each year" carries the number and the picture only has to show flame.

When a shot needs one of these and the story genuinely depends on it, the honest options are: build it as a still image and animate only the camera; shoot it practically; or rewrite the beat. Say so plainly rather than burning the generation budget.
