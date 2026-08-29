> 来源: DirectorSKILL-full (MIT)

# Beat Sheet Template

Load this file when you are at Step 3 (beat map) or the user asked for Mode B — a beat sheet（节拍表）, "break this into beats", or "what actually happens in this scene".

## What makes a beat a beat

A beat is a change in the balance of pressure between what a character wants and what the scene is doing to them. It is not a change of camera, not a change of location, and not a new piece of stage business.

Seven rules. A row that breaks any of them is not a beat.

1. **State in must differ from state out.** If you cannot write two genuinely different phrases, merge the row into its neighbour.
2. **Every delta names its agent.** Something applied the pressure: the character's own body, another person, an object, an off-screen sound, or a deadline. "The mood shifts" names no agent and is not a beat.
3. **Camera is not a beat.** "Push in on his face" is a Step 7 decision. A real beat survives being shot three different ways. If the visual-action cell contains a shot size or a camera move, you have written a shot.
4. **Location change is not a beat.** Walking to the door is a beat only if arriving changes the pressure. Otherwise it is travel and belongs inside a neighbouring beat.
5. **One beat, one turn.** Two turns in one row means two rows.
6. **Escalation, not business, is what earns a row.** Beats run in story order — you do not reorder them. But if the running tension is flat across three consecutive rows, those three rows are one beat and you have listed activity.
7. **The last beat is what the audience walks out holding.** It is the only beat allowed to release the character while tightening the audience.

Weak row, then the same material as a beat:

| Version | Story function | State in | Δ pressure (agent) | Visual action | State out |
|---|---|---|---|---|---|
| Not a beat | A tense moment at the door | Nervous | +2 (the atmosphere) | Push in on his face as he hesitates | Still nervous |
| A beat | Reveal that delivering has a cost | Still believes he is only a messenger | +2 (his own hand — it will not finish the knock) | Right hand rises, knuckles stop 3cm from the wood, hold, then the hand lowers to his thigh | Exposed to himself; the errand has become a decision |

The weak row breaks rules 1, 2 and 3 at once — state in equals state out, the agent is "atmosphere", the visual action is a camera move — and on top of that "a tense moment at the door" names a mood rather than a job. Nothing downstream can be built on it: there is no coverage to plan and no end state to hold a generator to.

## Pressure notation

Score tension on a 0–10 scale for the point-of-view character. The Δ column is the signed change plus the agent in parentheses. Write one number while the character and the audience move together; split it — `−6 him / +1 us` — the moment they diverge, which happens whenever the audience knows something he does not, and always on a beat that releases him while tightening them. A Δ of 0 is not permitted — delete the row.

The numbers are only worth writing if they are arithmetic: the running curve must be the state-in of beat 1 plus each successive Δ. A curve that does not sum is a mood board with digits on it.

## Beat table

| # | Story function | State in | Δ pressure (agent) | Visual action | State out | Shot family | Sec |
|---:|---|---|---|---|---|---|---:|
| 1 |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |

Column rules:

- **Story function** — the job this beat does for the scene, in verb form. Not "sad moment"; "reveal that delivering the letter has a cost".
- **Visual action** — externally visible behaviour only. No verbs the camera cannot photograph (`realizes`, `remembers`, `feels`). See the verb list in [prompt lexicon](../references/prompt-lexicon.md).
- **Shot family** — one of the shot-function names owned by [cinematic language](../references/cinematic-language.md): establishing, relation, close-up, insert/detail, reaction, transition, aftermath, point-of-view, reveal. This is a *family*, not a shot; it tells Step 7 what kind of coverage the beat wants. Do not coin names outside that list — Step 7 has to be able to look the word up.
- **Sec** — estimated screen time. These sum to the scene's target duration and become the time budget for the shot plan.

## Worked example

Project `Under the Door`, scene 7. Target 22s, 16:9, no style lens. A courier delivers a letter to a 1937 Shanghai lilong（里弄）apartment and chooses not to be present when it is read.

Visual thesis: the door grows and the courier shrinks until the only thing in frame still holding light is the gap underneath it.

| # | Story function | State in | Δ pressure (agent) | Visual action | State out | Shot family | Sec |
|---:|---|---|---|---|---|---|---:|
| 1 | Turn an address into one specific door | Rehearsed, on-task, has not thought past the delivery | +1 (arrival — the abstract errand becomes one specific door) | Climbs the last flight, checks the door against the envelope, takes three steps and stops 60cm short | Located and squared to the door, envelope up at chest | establishing | 4 |
| 2 | Reveal that delivering has a cost | Located; still believes he is only a messenger | +2 (his own hand — it will not finish the knock) | Right hand rises, knuckles stop 3cm from the wood, hold, then the hand lowers to his thigh | Exposed to himself; the errand has become a decision | reaction | 5 |
| 3 | Make the person behind the door real | Hesitating in what he assumed was privacy | +2 (off-screen — a chair scrapes, a radio comes up) | A shadow crosses the warm line under the door; his eyes drop from the door face to the gap | Cornered; being present is now the risk | insert/detail | 3 |
| 4 | He chooses the cowardly delivery | Cornered, out of time | +3 him / +2 us (his own act, and it cannot be undone) | Crouches, feeds the envelope under the door, pushes with two fingers until his fingertips touch wood and the envelope is gone | Committed; hands empty, nothing retrievable | reveal | 6 |
| 5 | Leave the audience holding what he refused to hold | Released, ashamed | −6 him / +1 us (he is gone; the letter is not) | Stands, backs two steps, turns and drops down the stairs; the empty landing holds until a shadow crosses the light line from inside | Absent | aftermath | 4 |

Running tension — courier: `2 → 3 → 5 → 7 → 10 → 4`. Audience: `2 → 3 → 5 → 7 → 9 → 10`. Both curves are the state-in of B1 followed by each state-out, so every step is the row's Δ; if they do not add up, one of the two is a wish. The largest rise (+3, B4) completes at 82% of scene time, and only the courier comes down. That is the shape you want.

This beat sheet feeds [director book](director-book-template.md) at Step 5 and [shot plan](shot-plan-template.md) at Step 7. Beat numbers (`B1`…`B5`) are the join key — do not renumber them once shots reference them.

## How many beats

| Target duration | Beats | Typical shots | Shape |
|---|---:|---:|---|
| 8–15s (single clip, social) | 2–3 | 2–4 | One turn, no aftermath |
| 20–40s (a scene) | 4–6 | 4–8 | Setup, escalation, turn, aftermath |
| 40–60s (a long scene / social short) | 6–8 | 8–14 | Setup, two escalations, turn, aftermath |
| 60–90s (a sequence) | 7–10 | 12–20 | Two escalations before the turn |
| 3–5 min (short film) | 18–30 | 40–90 | Act shape; split into 3–5 scenes and beat each separately |

Working rule for a single scene: `beats ≈ target_seconds / 5`, floor of 2. It holds to about 40s, then the divisor widens toward 7 seconds a beat across the 40–60s band — a 45s piece is 6–7 beats, not the 9 that `/5` predicts — and past 60s it stops entirely: a 90s sequence is not 18 beats. Past 60s, split into scenes of 20–40s and apply the rule per scene, which is why the lower rows of the table run 9–10 seconds a beat rather than 5. Above 12 beats in one table you are beating a sequence, not a scene; split before continuing.

The 40–60s row is not a rounding of its neighbours; it is the band most social shorts land in, and it is one scene, not two. A 45s single-location, single-character piece built on a continuous procedure has one setup and one turn — splitting it into two 22s scenes to satisfy the arithmetic destroys the continuity that is doing the work. Split at 60s, and only where the location, the cast or the time actually changes.

Boundaries:

- A beat estimated under 2s is a shot, not a beat. Fold it into a neighbour.
- A beat estimated over 10s is two beats, or one beat plus dead air. Re-read it for the second turn you did not notice.
- One shot per beat is the default at scene scale, with two or three spent only on the turn beat. The ratio drifts to 2–3 shots per beat at sequence and film scale because the beats themselves get longer, not because the beats need more angles. If every beat in a 30s scene gets three shots you have produced a coverage list, not a plan.

## Self-check

Run all seven before handing the sheet on. Any failure is a rewrite, not a note.

1. Does every row have `state in ≠ state out` and a non-zero Δ?
2. Can you name the agent for every Δ without using the words mood, tone, or atmosphere?
3. Is any row merely a camera idea? Strike any visual action containing a shot size or a camera move.
4. Is any row merely a location change with no pressure change?
5. Does the running tension actually rise, and do the plotted curves equal the running sum of the Δ column? Flat or sawtoothing without net rise means the scene has no shape yet; curves that do not sum mean the Δs are decoration.
6. Does the largest single *rise* land at or after the 60% mark? If the biggest jump is beat 1, everything after it is downhill.
7. Do the seconds sum to the target duration within ±15%? If not, cut a beat rather than shaving every row.
