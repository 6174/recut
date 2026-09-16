> 来源: DirectorSKILL-full (MIT)

# One scene, eight lenses

Every style module in this directory directs the **same** control scene, so the twenty files can be read as twenty answers to one question. This file lines eight of them up side by side.

Read it to feel what a style overlay actually changes — blocking, shot count, lens, light, palette, sound, and the prompt that comes out the other end — and what it does not: the dramatic situation, the continuity discipline, and the requirement that every shot earn its place.

Load it at Step 4 (style lens selection) when the user names two directors and one has to be chosen, or when someone asks what "in the style of X" concretely buys. Every number below is quoted from the named module's `风格参数` block or its worked example; when the two disagree, the module wins and this file is stale.

> Usage rule: these treatments describe high-level methods only. None copies specific shots, dialogue, characters, or plots from any real film. Use them as lenses for original work.

## The control scene

> A person stands at a closed apartment door holding something they intend to give away, hesitates, and leaves without knocking.

Shared across all eight treatments:

- Same character, same object, same door, same corridor.
- Same dramatic question: what is it about this door that they cannot face?
- Same continuity anchors: face, coat, the wrapped object, the door, the corridor geometry.
- Same target: a generatable AI video sequence, not a live-action shoot.

Everything else is the lens.

## The same beat, eight ways

The scene's pivot is one gesture: **the hand rises toward the door and comes back down.** Here is only that beat, under each lens.

| Lens | What the beat becomes | Where the camera is |
|---|---|---|
| [Spielberg](01_spielberg.md) | The light under the door goes out while the hand is still rising. He loses a stop on his face before he decides. | 135mm reaction single, locked, 3 m in front — face first, cause second |
| [Kubrick](03_kubrick.md) | The gesture is performed twice, identically, at the same lock height for the same 4 seconds. Only his shoulder is lower the second time. | 18mm locked wide, vanishing point on the door seam, 14 m of symmetrical corridor |
| [Bergman](07_bergman.md) | The hand rises below frame and his reflection in the door's glass rises with it. What we watch is his own face watching him decide. | 100mm locked 1.3 m out, 25° off his eyeline — his profile frame left, his frontal reflection frame right, edges touching |
| [Wong Kar-wai](09_wong_kar_wai.md) | He never faces the door. He shifts the object between hands three times; the third is step-printed, 1.4 seconds stretched to 5. | Chest height through a stairwell railing that crops his face, 30° off |
| [Bi Gan](14_bi_gan.md) | There is no hesitation at the door. He walks past it, stands at the window for 4 seconds, and comes back. | One drifting gimbal take, 1.5 seconds behind him, never catching up |
| [Zhang Yimou](15_zhang_yimou.md) | The hand stops 15 cm from the door and holds for 4 seconds. Nothing else in the frame moves, so the whole corridor reads it. | 35mm locked wide down twenty identical red doors; he is the only non-red object |
| [Michael Mann](19_michael_mann.md) | He does not hesitate. He checks his watch, finishes the calculation, and does not knock. | 25mm locked, 22 m away on a 14th-floor open walkway; he is 8% of frame height |
| [Coen Brothers](20_coen_brothers.md) | He completes the gesture, sets the parcel down squarely — and it falls over. He rights it. It falls again. | Dead-frontal locked, one-point perspective, door exactly centred, ceiling and floor both in frame |

Eight readings of one gesture: withheld information, ritual repetition, interior weather, deflection, geography, mass and color, professional calculation, and physical comedy. None of them is "add cinematic motion."

## The treatments

Each block gives the defining decision, the resulting structure, and the clause that makes the finished prompt unmistakably that lens. Full worked examples, shot specs, and complete prompts live in each module.

### Spielberg — reaction before revelation

The defining decision is **order**. We see his face lose light before we see why. The corridor is staged three layers deep (warm light leaking under the door in foreground, his approaching shoes in midground, a lit exit at the far end) so the audience always knows the geography. Music enters 1.5 seconds before the hand rises and stops on the frame the light dies. Four shots, ASL 5–9 seconds in the emotional register.

Prompt signature: `A thin warm light under the door goes out; his face loses one stop of light on that beat.`

### Kubrick — the geometry outranks the person

The defining decision is **symmetry as pressure**. A 14 m corridor, the door dead centre, the vanishing point on the door seam, the camera locked for 24 seconds. The gesture is performed twice with identical timing — the audience finds the difference themselves. A single saturated block of red on the floor is the only high-saturation object. ASL 12–40 seconds; one composition carries the whole beat.

Prompt signature: `constant speed, no ease-in, no ease-out, no reframing.`

### Bergman — the corridor stops existing

The defining decision is **elimination, then a second face**. Cut the geography, cut the object below frame, cut everything of the door except the small glass panel — which carries his own frontal reflection looking back at him, so the scrutiny needs no second actor. A single hard key at 90° camera-left, 6:1, background near-black. The register is 5–8 shots for a four-minute scene at 20–90 seconds each; here it is one 22-second hold, cut in generation at the frame his hand stops. The hesitation is not staged, it is waited out.

Prompt signature: `Focus shifts once from the real face to the reflection over 1.5 seconds and stays there.`

### Wong Kar-wai — he stops at the wrong door

The defining decision is **1.2 metres**. He never stands in front of the door he came for; he stops at the one next to it, and that gap is the subject. Shot through a stairwell railing whose two vertical bars crop his face, tungsten on one cheek and green neon on the back of his neck at 8:1, with cooking smoke making the beams visible. Four shots in 12 seconds, ASL 3 seconds — and exactly one step-printed hold.

Prompt signature: `the exchange is step-printed — long-shutter trails and a repeated-frame stutter, not smooth slow motion — while the background stays at normal speed.`

### Bi Gan — hesitation becomes a route

The defining decision is **replacing the pause with a path**. He walks past the door, stands at the window, comes back, hangs the bag on the handle, and goes down the stairs. The camera never follows him out; it drifts on to the window and holds on the rain. One 48-second take, generated as three chained clips whose seams sit on a corner and a stillness, so the joins read as passages rather than cuts.

Prompt signature: `the camera does not follow him — it keeps drifting forward past the door toward the window.`

### Zhang Yimou — the corridor becomes a pattern

The defining decision is **turning the set into countable units**. Twenty identical doors, identical red frames, evenly spaced to the vanishing point; red occupies about 70% of the image and he is the only thing in it that is not red. Low afternoon sun runs down the gallery axis, 3:1, shadows dark red rather than black. It ends on a 90° overhead: a red grid with one white point in it.

Prompt signature: `the red occupies about 70% of the image; a person in a dark grey coat — the only non-red element.`

### Michael Mann — the city is the other character

The defining decision is **moving the corridor outdoors and 14 floors up**, which buys a horizon, municipal light, and distance in one move. He is 8% of frame height at 22 m on a 25mm lens. Three light sources at three colour temperatures share the frame uncorrected — mercury-vapour overhead, sodium from below, office LED hundreds of metres out — and none of them is fixed in the grade. His face is two stops under the city and unreadable, which is the point: we read posture, not expression.

Prompt signature: `no unified white balance… his face is about two stops under the city and largely unreadable.`

### Coen Brothers — the parcel wins

The defining decision is **letting an object overrule the character**. He makes his moral decision, sets the parcel down, and physics reverses it. He rights it. It falls again. No sound effect, no reaction shot, no cut — the joke is the symmetry holding while the parcel refuses to. Overhead fluorescent as the only source, unflattering top light with shadow in both eye sockets, and a neutral face throughout.

Prompt signature: `His expression is completely neutral throughout — no smile, no eyebrow movement, no reaction.`

## What changed

| Dimension | Spielberg | Kubrick | Bergman | Wong Kar-wai | Bi Gan | Zhang Yimou | Mann | Coen |
|---|---|---|---|---|---|---|---|---|
| Shots for the beat | 4 | 1 | 1 | 4 | 1 | 1 + overhead | 3 + hold | 1 |
| ASL (s) | 5–9 | 12–40 | 20–90 | 1.5–4 | 45–600 | 4–10 | 3–8 | 4–9 |
| Lens | 21 + 135 | 18 | 100 | 25 | 25 | 35 | 25 | 27 |
| Camera | locked, cuts to reaction | locked, symmetric | locked on face | handheld through railing | continuous drift | locked, one-point | locked, distant | locked, dead-frontal |
| Key light | warm tungsten leak | even hard array, 2:1 | single window, 6:1 | tungsten + neon, 8:1 | three uncorrected practicals, 3:1 | low hard sun, 3:1 | mercury + sodium + LED, 8:1 | overhead fluorescent, 3:1 |
| Palette | amber, warm | cold white + one red block | grey, near-monochrome | green + amber | humid teal + purple | one saturated red, 70% | cold blue-green + sodium | institutional beige + fluorescent |
| Subject size in frame | MCU | full figure, small | two faces, edges touching | cropped by foreground | medium follow | small, single unit | 8% of frame height | full figure, centred |
| Sound lead | melodic motif | one continuous piece | breath and a distant clock | pop song + VO | rain, tape, dialect | cloth and massed footsteps | traffic and transformer hum | fluorescent ballast hum |
| Where the meaning sits | in the reveal order | in the repetition | in the duration | in the 1.2 m gap | in the route | in the color mass | in the distance | in the object |
| Clip budget (s) | 4–8 | 8–12 | 8–15 | 4–8 | 10–20 | 3–6 | 3–6 | 3–6 |

The continuity anchors — face, coat, object, door, corridor — are identical in all eight. So is the discipline: one primary action per clip, one dominant camera behaviour, an explicit end state, invariants repeated verbatim, negatives matched to that shot's real risk. The lens decides everything else.

## Choosing a lens

Work backwards from what the scene is actually about, not from which director you like.

| If the scene is about… | Reach for |
|---|---|
| A person's interior weather, nothing else | Bergman, Tarkovsky |
| A system or institution acting through a person | Kubrick, Fincher, Villeneuve |
| Missed connection, deferral, the thing not said | Wong Kar-wai, Hou Hsiao-hsien |
| Memory that will not resolve into a timeline | Bi Gan, Malick, Fellini |
| Competence and isolation in a modern city | Michael Mann, Fincher |
| Emotional legibility for a broad audience | Spielberg, Kurosawa |
| A moral idea rendered as color and mass | Zhang Yimou, Refn |
| Fate as an unfunny joke landing on a competent person | Coen Brothers |
| Suspense built from what the audience knows | Hitchcock |
| Ornate cruelty that the frame refuses to condemn | Park Chan-wook |
| A social ladder climbed by talking, and the fall at the top | Scorsese |
| A structure the audience has to solve while it runs | Nolan |

Two rules. **One lens at a time** — mixing produces incoherence, not fusion. And a lens is a starting position, not a cage: the module gives you the defaults, the scene tells you which one to break.

## Try it yourself

Take any two treatments above, open the matching modules, copy their finished prompts, and generate both from the same neutral keyframe. Use [`../ai-video-tool-adapters.md`](../ai-video-tool-adapters.md) to reshape the prompt for your tool's control surface. The difference should be visible in the first second.

If it is not, the cause is usually one of these:

- **The keyframe already carries a lens.** A still generated with a style baked in will fight every motion prompt. Start from a neutral frame — see [`../image-model-adapters.md`](../image-model-adapters.md).
- **The tool ignores camera instructions.** Check whether it exposes camera control at all before blaming the prompt; route by control surface, not by hope.
- **Two lenses in one prompt.** Pick one.
- **The lens was named but not applied.** If the output does not violate the other seven modules' parameter blocks, no overlay actually took effect.
