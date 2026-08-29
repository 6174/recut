> 来源: DirectorSKILL-full (MIT)

# Cinematic Language Reference

Load this file when the task requires shot design, lens choice, camera geometry, coverage
planning, composition, aspect-ratio decisions, or any director-level visual reasoning —
Steps 5–8 of the pipeline, and every Mode D shot row or Mode E keyframe that needs a
defensible size/lens/angle/move. It owns shot grammar only: light lives in
[lighting-and-color.md](lighting-and-color.md), actor movement in
[blocking-and-staging.md](blocking-and-staging.md), cut logic in
[editing-and-assembly.md](editing-and-assembly.md).

All focal lengths here — and in every `lens_kit_mm` field in the style modules — are **35mm
full-frame equivalent**. To convert a real camera's marked focal length, multiply by its crop
factor: Super-35 ≈ ×1.4, APS-C ≈ ×1.5, MFT ×2, phone main cameras roughly ×4–7 depending on
sensor size. Write the full-frame number in prompts whatever camera you have in mind: caption
data is overwhelmingly full-frame, so models appear to read "85mm" as a look rather than as
optics, and a Super-35 number will be taken literally.

## Shot functions

Function first, size second. If you cannot name the function, you do not have a shot.

| Function | Typical use | Good for | Fails when |
|---|---|---|---|
| Establishing | Define location, scale, atmosphere | Opening, act transition, isolation | Geography is already clear — it becomes a postcard and kills pace |
| Relation | Show power/relationship between bodies | Dialogue, conflict, social pressure | You need interiority; a two-shot cannot show a private thought |
| Close-up | Show a decision, fear, realization | Emotional turns, the beat before a choice | Used on every line — the currency devalues and the turn lands flat |
| Insert/detail | Make an object or clue carry story | Suspense, memory, irony, cause-and-effect | The object is not story-relevant; then it reads as B-roll |
| Reaction | Show the consequence of an action or line | Comedy timing, horror, social tension | The reaction repeats the emotion we just saw — dead air |
| Transition | Move time, place, or emotional register | Dream logic, memory, montage | It is only pretty; a transition with no vector is a stall |
| Aftermath | Let the audience process | Horror, tragedy, satire | The scene needs urgency; the hold reads as the film losing its nerve |
| Point-of-view | Bind us to one character's knowledge | Suspense, subjectivity, unreliability | No preceding look-shot establishes whose eyes these are |
| Reveal | Change what the audience knows | Turn, punchline, threat exposure | The information was already visible earlier in the frame |

## Shot sizes

Sizes are a ladder of psychological distance. Moving two rungs at a cut is a statement. Moving
one rung with the camera still on the same axis reads as a stutter rather than a cut: if the
angle does not change, change size by two rungs; if the angle changes by 30 degrees or more,
one rung is fine (see the 30-degree rule below).

| Size | Frame content | Reads as | Fails when |
|---|---|---|---|
| EWS / extreme wide | Figure ≤ 1/8 frame height | Geography, fate, human smallness | The audience cannot find the subject in 1 second |
| WS / wide | Full body plus environment | Body-to-space relationship, blocking | Faces must carry the beat — no performance survives here |
| MS / medium | Waist up | Readable action and dialogue | You need either the room or the thought; MS gives neither fully |
| MCU / medium close | Chest up | Performance with situational context | Overused as a lazy default; the scene flattens into television |
| CU / close-up | Head and shoulders | Thought, judgment, fear, decision | Cut to before the character has decided — you show a blank |
| ECU / extreme close | Eyes, mouth, hands, object | Obsession, clue, bodily pressure | Geography is unestablished; the audience loses where they are |

AI note: current image and video models are most reliable in the MS–CU band. EWS invites mangled distant faces and
invented extra people; ECU invites melted teeth, eyes, and finger counts. Budget your
hardest shots away from both extremes, or generate them as stills and animate minimally.

## Camera angles

| Angle | Reads as | Fails when |
|---|---|---|
| Eye level | Realism, neutrality, observation | The scene needs a stated attitude and you gave it none |
| Low angle | Threat, authority, myth | The subject is not actually powerful — it reads as parody |
| High angle | Weakness, vulnerability, judgment | Used on a character we should identify with in their strong beat |
| Overhead / top-down | System, fate, layout, ritual, surveillance | Faces matter; from above nobody has a face |
| Dutch / canted | Instability, dream, moral distortion | Used more than twice in a sequence — it stops meaning anything |
| Over-the-shoulder | Confrontation, subjectivity, social pressure | The foreground shoulder is so large it blocks the beat |
| Profile | Withholding, formality, a person mid-decision | You need eye contact with the audience |

## Camera height and the objective/subjective ladder

Height changes meaning more cheaply than angle. A tilted-up low angle announces itself as a
directorial gesture; the same camera at 0.9 m with a level lens axis reads as truth about
status and the audience never notices a shot was made. Set height first, angle second, and
most of the time leave the axis level.

| Height (lens axis) | Reads as | Use for | Fails when |
|---|---|---|---|
| Floor, 0–0.3 m | The world looms; ceilings exist | Dread, child/animal POV, objects as threat | Held long — it becomes a gimmick and the floor eats the frame |
| Knee/waist, 0.6–1.0 m | Monumental without cartoon | Authority, arrivals, the heroic register | The character is meant to be ordinary; it inflates them falsely |
| Chest, 1.2–1.4 m | Slight elevation of the subject's status | A quiet power gain inside a dialogue scene | You cut to it mid-scene without a story reason for the shift |
| Eye, 1.5–1.7 m | Peer relationship, neutral | Default for two people of equal standing | Every shot sits here — the scene has no status geometry |
| Above eye, 1.8–2.2 m | Observed, slightly diminished | Institutional pressure, being assessed | Confused with a "high angle"; keep the axis level or you overstate |
| Overhead, ceiling | Diagram, system, fate | Ritual, plans, bodies as pattern | The beat is interior; nobody has an interior from above |

These metres read against a standing adult, eyes around 1.6 m. What the audience registers is
the camera relative to the **subject's** eyes, never the absolute number: 1.2 m is a mild low
angle on someone standing and dead eye level on the same person seated, and every figure in
this table drops by roughly 0.4 m for a seated scene and more for a child.

In shot-reverse-shot the camera stands in for the character who is off screen, so set its
height at **that** character's eye height, not at the height of the person being photographed:
shoot the seated character from the standing one's eyes, and the standing one from the seated
one's. Parking both singles at a neutral 1.6 m is the error that makes an eyeline technically
correct and emotionally dead.

AI note: models rarely honor a numeric height. State the consequence instead: "camera low,
near floor level, the table edge cuts across the bottom of frame, we see the ceiling behind
him". Geometry described as visible content survives generation; measurements do not.

## Camera movement

| Move | Reads as | Fails when |
|---|---|---|
| Locked / static | Control, dread, ritual, awkwardness, satire | The frame has no internal motion — it reads as a still, not a choice |
| Slow push-in (推镜) | Pressure, realization, truth emerging | Nothing changes in the performance during the push — the move promises a turn that never arrives |
| Slow pull-back (拉镜) | Abandonment, isolation, aftermath | Started before the beat resolves; you leave early and lose the point |
| Pan (摇镜) | Reveal, scan, link two ideas | A full frame-width of movement in under about 5 s at 24 fps strobes, and a high-contrast, hard-edged background strobes sooner than that |
| Tilt | Vertical scale, authority, threat above/below | Used to reveal something the wide already showed |
| Tracking / follow (跟镜) | Journey, pursuit, embodied movement | Camera speed does not match the subject's speed; the framing breathes badly |
| Handheld | Instability, panic, documentary immediacy | Applied to a scene about control — it contradicts the meaning |
| Orbit / arc (环绕) | Transformation, seduction, disorientation | Used on a static conversation; it makes stillness look nervous |
| Crane / boom | Scale, release, fate, transcendence | Used to end a scene that has not earned release |
| Whip pan | Violent link, compression of time | Both ends are not designed; a whip needs a departure and an arrival |
| Dolly zoom | Perceptual rupture, ground giving way | More than once per film — it becomes a party trick |

AI video rule: **one dominant camera move per generated clip**, unless the tool exposes an
explicit camera-control UI for combined moves. See
[ai-video-tool-adapters.md](ai-video-tool-adapters.md) for per-tool control surfaces.

## Lens psychology

### The focal-length table

| mm | On a face | On a space | Distance between planes | Edge behavior | Typical use | The failure it invites |
|---|---|---|---|---|---|---|
| 12–14 | Unusable close: nose balloons, ears vanish, forehead stretches | Whole room from one corner; walls race away | Wildly expanded — a 1 m gap between two people reads several times deeper than it would at 50mm | Severe stretch; corner heads go egg-shaped | Dislocation POV, cramped interiors made vast, in-car action, grotesque comedy | The subject shrinks to nothing and the frame becomes an empty architectural photo |
| 18 | Distorted at CU, acceptable from chest down | Aggressive space; ceilings and floors both present | Strongly expanded | Visible stretch in the outer 20% | Wide with attitude; a room that presses on people | Actors freeze because the camera is 40 cm from their face |
| 24 | Slight nose enlargement at MCU; fine at MS | The "walk into the room with them" wide | Expanded | Mild edge stretch; keep faces off the corners | Handheld interiors, moving masters, environment-as-character | Everything looks bigger than the scene deserves; intimacy is impossible |
| 28 | Reportage face — honest but broad | Room plus person, both readable | Moderately expanded | Slight; usable for faces near center | News/verité register, kitchen-sink drama | Reads as unstyled by default; you get "footage", not a shot |
| 35 | Truthful, unflattering-in-a-good-way | Person and place in equal weight | Near-neutral, mildly expanded | Clean | The workhorse for "we are in the scene with them" | Chosen by default rather than by decision; the film has no lens opinion |
| 40 | Closest to how one eye reads a face | The space you would actually notice standing there | Neutral | Clean | Invisible, honest coverage; scenes that must not feel authored | Nothing goes wrong — which means nothing is stated either |
| 50 | Neutral to mildly intimate | Fragment of the room, not the room | Neutral | Clean | Dialogue singles, the default "no comment" lens | It flatters nobody and separates nothing; scenes go inert |
| 85 | Flattering; jaw and nose settle; skin smooths | Background becomes texture, not geography | Compressed | Clean | Portrait CU, the lens of sympathy | Space disappears; the audience forgets where the scene is happening |
| 100 | Flattened, clinical, slightly cold | Background is a color field | Strongly compressed | Clean | Inserts, hands, objects, macro detail | Focus falls off so fast that a 3 cm sway ruins the take |
| 135 | Observed; the subject does not know we are here | Layers stack like cut-out cards | Strongly compressed | Clean | Surveillance register, isolation-in-a-crowd, the follow at distance | Reads as sports coverage if the camera hunts for the subject |
| 200 | Pinned to the background, unable to escape it | Depth collapses; crowds become a wall | Extremely compressed | Clean | Fate, entrapment, heat shimmer, the long approach that never arrives | Any camera or subject movement becomes unreadable jitter |

### Why compression and expansion happen

Focal length does not change perspective. **Distance does.** Long lenses force you to stand
far away, and from far away the difference between "30 m from me" and "40 m from me" is small,
so the planes stack up and the background looms in close behind the subject: compression. Wide
lenses let you stand close, and from close the difference between 1 m and 3 m is enormous, so
planes fly apart, the background retreats, and anything approaching camera accelerates
violently: expansion. Practical consequences, in the order you should reach for them: to trap a
character in their environment, go long and put something solid a few metres behind them — the
compression pastes it onto their back. To give the same character room to act, go wide, stand
close, and keep them large in frame; the space opens behind them and they own it. To let the
room swallow them instead, keep the wide lens but back off so they are small in frame and the
architecture is the biggest thing in it. Wide plus large equals agency; wide plus small equals
insignificance — the lens alone decides neither. And if you cannot change your camera position,
changing the lens only changes crop, not psychology.

### Lens decision table

| Story intent | Focal length | Why |
|---|---|---|
| We are inside this person's panic | 18–24, close, handheld | Expansion makes every gesture huge and the room unstable |
| We are with them, not judging them | 35–40 | Near-human perspective; the frame stops editorializing |
| Sympathy, private thought, confession | 85 | Face renders kindly, background melts, the world stops mattering |
| They are trapped by their situation | 100–200 | Compression pastes the background onto their back |
| They are being watched, or watching | 135–200, from a hiding place | The distance itself is the point of view |
| The room has power over the person | 14–24, subject small in frame, ceiling or upper structure visible above them | Expanded planes make architecture the largest thing in frame. Do not also drop the camera low — a low lens axis re-inflates the person you are trying to shrink |
| Two people are irreconcilably apart | 85–135 on singles, no two-shot | Compressed singles refuse to put them in the same space |
| Two people are actually together | 28–40 two-shot, shared focus | Both faces in one plane, one lens, one truth |
| Ritual, order, institutional weight | 24–35 symmetrical, centered | Straight lines stay straight; the geometry does the talking |
| Comic grotesque | 12–18, very close, low | The distortion is the joke; commit or do not do it |

Prompt use:

- Weak: "close-up, shallow depth of field, cinematic lens".
- Strong: "85mm close-up, camera 1.5 m from her face, the corridor behind her compressed into
  soft vertical bands, her eyes sharp and the far wall unreadable."

## Focus as direction

### Deep vs shallow

Deep focus (small aperture, wider lens, subject farther) keeps foreground, mid, and background
all legible. It hands the audience a choice about where to look, and it lets you stage a scene
in depth instead of cutting it — see [blocking-and-staging.md](blocking-and-staging.md). It
fails when the background is unshaped: everything sharp and nothing composed is just clutter.

Shallow focus (wide aperture, longer lens, subject closer) makes the choice for the audience.
It fails when it becomes automatic — a whole film at f/1.4 has no way to escalate, and the
moment you actually need isolation, you have already spent it.

### The depth-of-field arithmetic a director needs

Total depth of field scales roughly as `(distance² × f-number) / focal-length²`. Three usable
consequences:

- Double the subject distance → about **4×** more depth of field.
- Double the focal length → about **1/4** the depth of field.
- Open up one stop (f/2.8 → f/2) → about **0.7×** the depth of field.

Concrete, full-frame, subject at 2 m: a 24mm at f/2 gives roughly 0.85 m of depth; a 50mm at
f/2 gives roughly 0.19 m; an 85mm at f/2 gives roughly 0.07 m — less than the depth of a human
head, which is why a portrait at f/2 has sharp eyes and a soft ear. At 85mm f/2, a 3 cm sway
loses the eye. If the performance needs freedom to move, either stop down to f/4 or move back.

The proportionality only holds while the subject sits well inside the hyperfocal distance
(roughly `focal-length² / (f-number × 0.03mm)` on full frame — about 9.6 m for a 24mm at f/2).
Past that the far limit runs to infinity and no amount of extra distance buys you anything, so
do not use the doubling rule to reason about wide lenses on exteriors.

### Rack focus as a story beat

A rack focus is a cut you did not make. Use it when the two planes belong to one continuous
thought — a face and the hand behind it, a listener and the door they have just noticed. It
must land **on a beat**: start the rack on a line or a sound, finish before the reaction. It
fails when it is decorative (racking to a plane that carries no information), when it is too
slow (the audience solves it before you arrive), or when both planes were already sharp enough
to read, in which case nothing happened.

The split-diopter look — a half lens that holds a very near and a very far plane sharp at once,
with a visible soft seam between them — buys you a rack-free two-plane frame. It fails if the
seam is not hidden along a vertical edge (a door frame, a pillar, a wall join), and it breaks
outright if either subject moves across the seam.

### AI note: asking a model for depth of field

"Bokeh" alone tends to fail: in caption data the word sits mostly on photography stills full of
round out-of-focus highlight balls, so you get spurious glowing circles and a subject that looks
pasted on. Describe the **optical cause and the visible result** instead:

- Weak: "shallow depth of field, beautiful bokeh, blurred background".
- Strong: "shot on an 85mm at f/1.8 from 1.5 m; her eyelashes and the rim of the cup are
  sharp; the bookshelf 4 m behind her dissolves into unreadable soft vertical shapes; no
  circular highlights."

Additional rules: bake the depth cue into the keyframe image, because in practice a video model
will not invent a defocus that was not in the source frame. If you want a rack focus, request it as
a timed **event** with a named start and end target ("focus starts on her hands, then shifts to
the doorway behind her at about the halfway point; her hands go soft"), not as a lens property.
Expect a low hit rate and budget retries — see [failure-modes.md](failure-modes.md).

## Continuity geometry

A video model has no idea where the previous shot put the camera. Every rule below therefore
gets two answers: what the rule is, and how you encode it in a keyframe or a prompt so that a
stateless generator obeys it.

### The axis of action (180-degree rule)

Draw a line through the two people (or along the direction of travel). Keep the camera on one
side of it for the whole sequence. Then A stays screen-left looking right, B stays screen-right
looking left, and the audience never has to rebuild the room.

```text
Plan view, looking down on the room. The axis is the line through A and B;
further down the page means further out from the axis.

                            [X]  a camera here is across the line

     A (*)= = = = = = = = = AXIS = = = = = = = = = (*) B

     A faces camera-right            B faces camera-left

 [1]                        [2]                           [3]

                                                             [4]

     [1] behind A, shooting past her  -> OTS over A; we see B
     [2] centre, square to the axis   -> two-shot
     [3] behind B, shooting past him  -> OTS over B; we see A
     [4] past B and further out       -> clean single of A; B clears frame

     [1]-[4] all sit below the axis, so in every one of them A is
     screen-left looking right and B is screen-right looking left.
     Cut to [X] and they swap sides: A is now screen-right looking
     left, and the audience reads it as the two of them changing seats.
```

The camera does not have to stay in a narrow arc: anywhere below the line is legal, including a
position past B. What matters is the side, not the distance or the angle.

Legitimate ways across the line, in ascending order of how much they interrupt the scene:

1. Let a character move and re-form the axis: when A crosses to the other side of B, the line
   redraws itself and every new position is legal. Costs nothing; the scene does the work.
2. Move the camera across on screen — a dolly or arc that carries the audience over the axis.
   Costs a move, but the audience never loses the room.
3. Cut to a neutral shot on the axis itself — head-on, or straight down the line of travel —
   then land on the new side. Costs one shot.
4. Cut away to something else entirely (an insert, a third party), then re-establish. Costs a
   shot and a beat of attention.
5. Re-establish with a wide. Blunt, always works, costs you a shot and drops the scene's
   temperature back to zero.

Crossing by accident fails loudly: the audience feels seasick without being able to say why,
and in an action beat two people appear to change which way they are running.

AI note: put the axis in the [continuity bible](continuity-bible.md) as a per-scene field —
"axis: corridor runs camera-left to camera-right; ANNA always screen-left facing right; MARCO
always screen-right facing left". Then enforce it in the **keyframes**, because that is the only
memory the pipeline has. Every keyframe prompt should name screen position and gaze direction
explicitly: "Anna occupies the left third of frame, in three-quarter profile, looking off-screen
to the right." Never let a model decide which way a character faces.

### The 30-degree rule

Consecutive shots of the same subject must differ by at least 30 degrees of camera angle around
that subject, or by roughly two size steps, or the cut reads as a stutter. In practice change
both. It fails when neither change is big enough: a punch-in from MS to MCU on the same axis is
one size step and zero degrees, and it looks like a glitch; the identical size from 20 degrees
away looks like the camera hiccupped. Note that the new angle must stay on the same side of the
axis — a 30-degree move is not a licence to cross the line.

AI note: the model cannot compute an angle it never saw. Specify the new angle as visible
content — "now from her other side, the window is behind her left shoulder instead of her
right" — and change the shot size in the same instruction.

### Screen direction

Direction of travel must survive the cut. A character leaving toward screen-right should be
moving screen-right in the next shot, until something on screen turns them. Two characters
travelling toward each other must be moving in **opposing** directions; two travelling together
must move in the same direction. It fails on chases first: reverse a runner's screen direction
and the audience believes they turned around.

AI note: motion direction is one of the most reliable things you can force in a video prompt.
Always write it: "she walks from frame-left toward frame-right, exiting right". Do not write
"she walks away" — the model will pick.

### Eyeline match

An eyeline is a vector, not a glance. Three things must agree: horizontal direction (if A looks
off-screen right, then B is standing off-screen right of A's frame, so in the reverse B must
look off-screen **left** — two characters looking the same way are not looking at each other),
**height** (if B is taller or standing while A sits, A looks up and B looks down — mismatched
eye height is the most common amateur error), and distance (a person 1 m away is looked at
differently from one 8 m away, and the lens should match). It fails when both singles are shot
at the same neutral height, giving two people who are apparently the same height staring past
each other.

Shot-reverse-shot geometry, concretely: to shoot B, put the camera behind A's shoulder, roughly
20–35 degrees off the eyeline, and mirror that position exactly to shoot A. Keep the same lens
and the same distance-to-subject on both sides unless you intend a power imbalance, and keep
the same headroom. The two foreground shoulders should mirror each other: A's shoulder sits in
the lower-left of every shot of B, B's shoulder in the lower-right of every shot of A. If the
shoulder jumps corners between setups, you have crossed the line.

AI note: eyelines get generated wrong constantly. Name the off-screen target's screen side and
height in the prompt — "he looks slightly up and off-screen to the left" — and check the pair
side by side before committing to a sequence. If the pair fights you, generate a two-shot and
crop two singles from it; the geometry is then guaranteed.

### Enter-frame and exit-frame

If a character exits frame-right, they enter the next frame from frame-left, continuing the same
travel. Exiting **toward** or **away from** camera is a neutral reset: you may then enter from
any side. A character can also exit by being wiped past camera in foreground, which both hides a
cut and resets direction. It fails when you match an exit-right with an enter-right; the
character appears to have doubled back. This section covers only what the cut must preserve —
how to stage the entrance or exit itself lives in
[blocking-and-staging.md](blocking-and-staging.md).

AI note: exits and entrances are where AI clips are cheapest to join. Ask for the exit
explicitly as the clip's end state ("she walks fully out of frame right, leaving the empty
doorway") and the entrance as the next clip's opening state ("frame starts empty, she enters
from frame-left"). A body wiping past camera is the most forgiving seam an AI sequence has.

## Coverage patterns

| Pattern | What it costs | What it buys | AI-video adaptation |
|---|---|---|---|
| Master + singles | Most setups, most time; performance must repeat | Total edit freedom; you can find the scene in the cutting room | You cannot re-shoot one performance from another angle. Generate the master, then generate each single from the **same keyframe world state** (same wardrobe, light, props, position), not from a re-description. Extract a frame from the master and re-angle it with an image model where supported |
| Triangle system (three cameras on one side: two singles + one two-shot) | Careful axis discipline; the two-shot constrains blocking | Cuttable dialogue with guaranteed screen direction | Build all three keyframes from one source image so identity holds; keep the axis fixed in the continuity bible; fails if you let the model re-invent the room in each keyframe |
| Oner / continuous take | Rehearsal, one bad beat kills the whole thing | Real time, unbroken pressure, spatial truth | A single generation is short, and shorter still once a face has to stay legible for its whole length — see the duration strategy in [ai-video-tool-adapters.md](ai-video-tool-adapters.md). Build the oner as a chain instead: feed each clip's last frame in as the next one's first frame where the tool exposes that slot, and hide the seam on a whip, a body-wipe, or a dark passage. Fails as soon as the model drifts identity — check the face at every seam |
| Walk-and-talk | Track/steadicam, background continuity, sound | Momentum; exposition that does not feel static | Worst case for AI: sustained gait plus lip movement produces leg-swapping and gait morph. Shorten to 3–4 s, shoot in profile or from the front at MS rather than a long backward dolly on faces, and cut on footfalls |
| Over-shoulder pair | Two matched setups; foreground shoulder eats frame | Confrontation with both parties present | Generate the pair from one two-shot keyframe so the shoulder, wardrobe, and light match. Fails when each OTS is generated independently — the shoulder changes size and the room flips |
| Insert cluster (hands, objects, clues, faces of things) | Cheap to shoot, easy to over-shoot | Rhythm, subtext, and the ability to rescue any edit | The highest-yield AI shots: short, small, no faces, no gait. Generate 3–5 per scene as insurance. Fails only when the object was never planted in a wider shot, so the audience does not know what they are looking at |

Rule of thumb for AI coverage: for a two-person dialogue beat, plan one wide, two singles, one
two-shot, and two inserts — six **setups** — and expect to cut with four. Six setups is not six
generations: each one takes as many attempts as its difficulty score earns it, so cost the beat
in attempts using the retry bands in [production-workflow.md](production-workflow.md).

## Composition

### Frame proportions

- Headroom: at MS, leave roughly 5–10% of frame height above the head. At CU, put the eyes on
  the upper-third line and let the top of the skull leave frame. Fails as too much headroom (the
  subject sinks and looks defeated by accident) or none at all in a shot that is not meant to
  feel cramped.
- Lookroom / noseroom: scale it with how far the head is turned. Frontal or near-frontal — no
  lookroom needed, centre them. Three-quarter — roughly 60/40 in favor of the side they face.
  Full profile — up to two-thirds of the frame width in front of the nose, one-third behind the
  head. Fails when a character is pressed against the edge they are looking toward — reads as an
  error, not as pressure, unless the whole scene has established that grammar.
- Reversing lookroom deliberately (nose to the near edge) is a legitimate tool for suffocation
  and for a character with no future in this room. It fails if used once, out of nowhere.

### Structural patterns

| Pattern | Reads as | Fails when |
|---|---|---|
| Negative space | Absence, threat, loneliness | The empty area is textureless — then it is just underfilled |
| Frame within frame | Confinement, surveillance, social pressure | The inner frame is decorative and does not bound the subject |
| Symmetry / centered | Ritual, authority, absurdity, emotional deadness | The scene is about instability; symmetry contradicts it |
| Rule of thirds | Natural, dynamic, room to move | Applied reflexively — you get "correct" frames with no attitude |
| Off-center subject | Unease, imbalance, something missing | Off-center by so little it reads as a sloppy operator |
| Foreground obstruction | Secrecy, voyeurism, partial knowledge | The obstruction covers the beat we actually need to see |
| Deep staging / layering | Power layers, social hierarchy, memory | Only two planes exist; layering needs foreground, mid, and background |
| Leading lines | Inevitability, direction of attention, fate | The lines lead to nothing — the eye arrives and finds no subject |
| Balance of mass | Stability, or a stated instability | Both sides are equally heavy and equally uninteresting |

When centered is correct: direct address to camera, ritual and institutional order, a single
subject with no off-screen relationship, vertical 9:16 delivery, and any moment where the point
is that the character has no room to move. When it is wrong: two-handers with unequal power,
any shot where the subject should be pulled toward something outside the frame.

Framing encodes power without a line of dialogue. In any two-person frame the audience reads
whoever has: more frame area, greater height in frame, sharper focus, more lookroom, and fewer
obstructions. Change one of those five and the power changes. Change three and it is a scene.

Composition in a prompt:

- Weak: "well-composed two-shot of a manager and an employee, rule of thirds, balanced".
- Strong: "Two-shot. He fills the left half of frame from the waist up and is sharp; she is
  seated behind him on the right, half his height in frame, partly hidden by his shoulder, and
  slightly soft. Empty wall above her head; no room in front of her face."
- Then invert exactly one variable to hand her the scene: "she is sharp and he is soft" — same
  blocking, opposite meaning, one clause changed.

## Aspect ratio and format

| Ratio | What it does to blocking | What it does to the eye | Fails when |
|---|---|---|---|
| 2.39:1 | Lateral staging; two faces can share one CU-distance frame | Eye scans horizontally; landscape and confrontation both come free | Tall subjects, stairwells, standing figures — you get dead headroom and floor |
| 1.85:1 | Slightly more lateral room than 16:9, same instincts | Neutral theatrical; nothing announced | You expected scope's lateral pairing and did not get it |
| 16:9 (1.78) | The safe default; tolerates almost any staging | States nothing; the audience reads "video" | The format itself was supposed to mean something |
| 4:3 (1.33) | Vertical staging; one body fills the frame naturally | Faces and standing figures; the frame presses in from the sides | You need two people abreast, or landscape scale |
| 1:1 | Kills both lateral and vertical staging; forces centering | Object clarity, direct address, feed-native | Any scene with a relationship in it — there is nowhere to put the second person |
| 9:16 | Depth staging only; lateral pairing is impossible | Single subject, huge, close, present | You try to shoot a wide the way you would at 16:9 |
| 2:1 | Compromise; crops acceptably to both scope-ish and 16:9 | Mildly widescreen, delivery-flexible | You needed scope's real lateral extremity |

AI note: as of writing, most video tools expose a short list of output ratios rather than a free
choice, with 16:9 and 9:16 the ones you can count on; check the tool's current options before
you plan a format. Anything outside that list — scope, 4:3, 1:1 — has to be reached by
letterboxing or by cropping a wider generation. Generate native where the ratio is offered, and
crop or letterbox in the edit rather than in the prompt: asking for "anamorphic black bars"
tends to produce bars painted into the image, leaving you a smaller picture inside a fixed
frame.

### Vertical (9:16) direction

Vertical is not 16:9 turned sideways. It is a different grammar and needs a different plan.

- Lateral blocking fails. At 9:16 a medium shot gives you barely more than one body-width of
  usable horizontal space; two people side by side become two slivers with no faces. Stage in
  depth instead: one person near camera occupying the lower half of the frame, the second
  further back and therefore higher in frame. The frame's long axis maps to depth, and vertical
  screen position becomes your distance cue. That cue lives in the ground plane, not in the
  heads: shoot from slightly above eye level and keep the floor visible, because at exact eye
  height both heads sit on the same horizon line and the depth reads only as a size difference.
  Fails when both figures are the same size in frame — then it just looks like a mistake.
- Scale the subject up. Whatever size you would have chosen at 16:9, go one step tighter: a
  wide becomes a medium, a medium becomes an MCU. Fails if you go tighter than CU by reflex —
  ECU in vertical loses all geography.
- Headroom shrinks. Put the eyes at roughly one-third from the top and let the body fill the
  rest. Fails when you keep 16:9 headroom habits — you get a floating head over a lot of torso.
- The wide-shot problem: an EWS in vertical wastes sky and floor and reduces the subject to a
  few pixels. Four fixes, in order of preference: (a) find a genuinely vertical subject —
  stairwell, tower, alley, escalator, elevator, waterfall; (b) fill the bottom third with a
  foreground element so the frame has three layers; (c) make it a tilt reveal rather than a
  static hold; (d) go high-angle so the ground plane, not sky, fills the frame.
- Safe zones (hedge and verify): most social platforms overlay UI across roughly the top
  10–12% and the bottom 18–25% of a 9:16 frame — captions, handles, buttons — and the exact
  numbers change per platform and per release. Keep faces and any burned-in text inside the
  middle ~60% of frame height, and check against the current spec before delivery.
- Native vertical vs shoot-16:9-and-reframe: compose native when the composition carries the
  meaning (depth staging, vertical architecture, headroom-driven power) and when 9:16 is the
  only delivery. Shoot 16:9 and reframe when the same content must ship to both, and when the
  action is single-subject and centrally staged. For AI specifically, generating natively at
  9:16 usually beats cropping a 16:9 generation, because the crop throws away resolution and
  slices through faces — but some models are visibly weaker at 9:16, so test one shot before
  committing a whole sequence.

Vertical framing:

- Weak: "wide shot of a woman standing in a city street, vertical format".
- Strong: "9:16. Low angle, 35mm. She stands centered at mid-frame, head and shoulders in the
  upper third, eyes about one-third down from the top; a wet railing crosses the bottom quarter
  of frame in soft foreground; a lit tower recedes behind her filling the top of the frame.
  Nothing important in the outer 20% at top or bottom."

## Motion rendition

| Frame rate | Directing meaning | Fails when |
|---|---|---|
| 24 fps | Film. Slight strobe is part of the dream layer | Fast lateral pans and hard-edged detail — the strobe becomes a defect |
| 25 fps | Effectively identical to 24; broadcast territories | Mixed with 24 fps material without a plan; motion cadence fights itself |
| 30 fps | More present, more immediate, more "now" | You wanted the dream layer; 30 keeps waking the audience up |
| 48/50 fps | Hyper-real clarity; strips the veil off | Drama — the audience reads it as behind-the-scenes or live coverage |
| 60 fps | Motion-clear; intended to be retimed later | Delivered straight as narrative; it looks like a demo reel |

Shutter angle in plain terms: 180 degrees means the shutter is open for half of each frame's
duration, giving the amount of blur audiences read as normal. Narrow it to 45–90 degrees and
motion becomes crisp, staccato, and anxious — good for impact and combat, exhausting over a
scene. Open it to 270–360 degrees and motion smears — drunk, drugged, feverish, dissolving.
Choose the angle to state a nervous-system condition, not to fix an exposure problem.

Slow motion is an intentional beat, not a default. It should mark a change in whose time we are
in: a character's perception stretching, a physical consequence being examined, or a ritual
being given weight. Test: if you cannot say whose subjectivity the slow motion belongs to, cut
it. It fails when it is applied to everything, at which point the film reads as an advertisement
and the one moment that genuinely needed it has nothing left to escalate to.

AI note on motion: many video models render motion blur badly — either too little, giving a
game-engine crispness on fast movement, or a smeared soup that destroys hands and faces. Phrase
around it rather than into it. Keep motion slow and near frame center; ask for the blur
locally rather than globally ("natural motion blur on her sweeping hand; the background stays
sharp"); avoid fast lateral camera moves entirely, and if you need speed, generate a short whip
and cut on it rather than asking a model to sustain velocity. Few tools expose frame rate as a
control at all, so set it in the UI if it is there and otherwise do not prompt a number:
describe the behavior instead ("she raises the glass very slowly, water arcs hanging in the
air"). For true slow motion, prefer generating at normal speed and
retiming in the edit — cleaner, but budget for optical-flow interpolation, since retiming 24 fps
footage to 40% judders without it. Vocabulary for all of this lives in
[prompt-lexicon.md](prompt-lexicon.md).

## Worked example: the shared control scene

Every director style module directs this same beat, so you can diff a style against this neutral
baseline: *a person stands at a closed apartment door holding something they intend to give
away, hesitates, and leaves without knocking.* Decisions taken in this file's order — function,
size, height, lens, angle, move.

| # | Function | Size / lens | Height / angle | Move | Why |
|---|---|---|---|---|---|
| 1 | Establishing | EWS, 24mm, camera ~14 m back at the far end of the hall | 1.5 m, level | Locked, 4 s | The corridor is the antagonist. A 24mm on full frame sees a frame height roughly equal to the subject distance, so at 14 m she reads about an eighth of frame height and the door and the length of the hall stay legible with her. A level axis refuses to editorialize before she has done anything |
| 2 | Relation (person vs door) | MS, 40mm | Her eye height, level, swung ~40° round to her side | Push-in ~15 cm over 6 s | 40mm at her own eye height takes no side, so the only thing that changes is the push, and the audience reads the change as coming from her rather than from the camera |
| 3 | Insert | CU, 50mm at f/8, camera ~0.5 m out | Just above her hands, tilted slightly down | Locked, 3 s | The object carries the beat, so all of it must be sharp. Even stopped to f/8, 0.5 m away buys only about 5 cm of depth — her fingers and the face of the parcel, nothing behind. The door therefore has to be planted in shot 1; do not expect to hold it here |
| 4 | Aftermath | EWS, 24mm, identical to shot 1 | 1.5 m, level | Locked, 5 s | Repeating the opening frame with her gone is the whole point. Nothing new may enter the frame, or the repeat stops registering as a repeat |

Geometry check on those cuts. Shot 1 to shot 2 moves two size steps and about 40 degrees
around her, so it is comfortably clear of the 30-degree rule; had shot 1 been a WS *and* shot 2
stayed on the corridor axis, it would have been one step and no angle change, and read as a
stutter — either change on its own would have saved it. Shot 4 deliberately returns to shot 1's
exact setup: an identical repeat is not a stutter, because the intervening shots break it and
the content has changed — she is no longer in it.

Axis: the corridor runs camera-left to camera-right; she faces the door screen-right in shots 1
to 3. She turns on screen before leaving, so exiting screen-left in shot 4 is legal — hold on the
empty door for at least two seconds after she clears frame.

Shot 2 as a finished image-to-video prompt:

```text
Medium shot, 40mm, camera at her eye height, level. A woman stands facing a closed apartment
door, her body three-quarters away from us toward the door at the right of frame, holding a
small wrapped parcel against her chest with both hands. The corridor recedes behind her to the
left. The camera pushes in very slowly, about 15 centimetres across the whole shot. She lifts
the parcel about an inch, holds it there, then lowers it and lets her shoulders drop. She does
not knock and does not speak; her feet stay planted. A single ceiling fixture lights her from
above and behind; the door stays in shadow.
```

Why it is written that way: one camera move, one actor action, one light source, and the
hesitation is spelled out as three timed physical events — lift, hold, lower — rather than as
the word "hesitates", which a model has no way to render.

## Adjacent grammar owned elsewhere

These belong to other files. Use them, do not restate them here.

- Light as meaning — low-key, hard sidelight, backlight/silhouette, practicals, soft overcast,
  flicker, ratios, motivation, palette: [lighting-and-color.md](lighting-and-color.md).
- Actor movement, proxemics, power blocking, entrances and exits, blocking notation:
  [blocking-and-staging.md](blocking-and-staging.md).
- Cut logic and rhythm — long holds, hard cuts, match cuts, dissolves, jump cuts, average shot
  length, transition engineering: [editing-and-assembly.md](editing-and-assembly.md).
- Per-genre defaults for all of the above: [genre-playbooks.md](genre-playbooks.md).

## Director's rule

Every camera decision must answer: "What should the audience feel or understand now that they
could not feel or understand before?"
