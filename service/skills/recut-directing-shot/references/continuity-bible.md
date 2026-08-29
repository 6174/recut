> 来源: DirectorSKILL-full (MIT)

# Continuity Bible

Load this file when the project has a recurring character, location, or prop across more than one generated clip, or when a new shot must cut against footage that already exists. This is the Mode G deliverable and the state store that pipeline steps 6–13 read from.

A continuity bible is not documentation. It is (a) the strings you paste verbatim into prompts and (b) the questions you ask before approving a take. If a field is never pasted and never checked, delete it.

## The continuity axes

Fifteen things drift. Walk this list twice per shot: once when writing the prompt, once when reviewing the return. This list owns the question you ask. The repair manual — symptom, ranked causes, ranked fixes — is [failure-modes.md](failure-modes.md); the last section here maps each axis onto its code there.

| # | Axis | Ask before approving | Highest risk when |
|---|---|---|---|
| 1 | Face | Same person or a sibling? Check mole/scar side, jaw width, eye spacing, hairline | Clips over ~6 s, head turns past 45°, size jumps bigger than one step |
| 2 | Hair | Same length, same parting side, same tie-up state, same wetness | Wind, wet transitions, hats on/off |
| 3 | Wardrobe (per layer) | Same layers present, same closure state, same sleeve/collar position | Outer layer added or removed; models silently re-button and un-roll |
| 4 | Props | Same object, same hand, same orientation, same fill level | Handoffs, eating/drinking, anything held for more than one shot |
| 5 | Wet / dirt / blood | Same coverage area and same darkness of soak | Rain and mud scenes; these states are monotonic and models reset them |
| 6 | Injury / makeup | Same side, same size, same age of the wound | Any progressive scene; a bruise cannot un-bruise |
| 7 | Light direction | Key on which side, from what height, how hard | Reverse angles; models default to flattering frontal light |
| 8 | Time of day | Same sun height, same lamp on/off state, same shadow length | Scenes over 6 shots; exteriors |
| 9 | Weather | Same intensity, same wind direction, same puddle state | Rain/snow progressions |
| 10 | Geography | Is the door still on the same wall relative to the window? | Wide → close → wide sandwiches |
| 11 | Screen direction | Does the subject still face and travel the same way? | Crossing the line; see [cinematic-language.md](cinematic-language.md) for the 180°/30° rules |
| 12 | Eyeline | Is the look aimed where the other subject actually is, at the right height? | Height differences between characters; over-the-shoulder pairs |
| 13 | Camera height | Same height as the last coverage of this subject, unless the change was a decision you wrote down? | Model reinterpreting "low angle" as "floor level" |
| 14 | Color palette | Same dominant and accent, same saturation | Multi-session generation; see [lighting-and-color.md](lighting-and-color.md) |
| 15 | Lens feel | Same compression, same edge distortion | Mixing a wide keyframe with a long-lens keyframe inside one scene |

## The identity string contract

This section owns the identity string for the whole skill. Every other file links here rather than restating the budget or the rules, so if you meet a second word count anywhere, this one wins.

The identity string is one noun phrase, 30–50 words, that fully re-specifies a character to a model that has no memory. It is **pasted verbatim** into every keyframe prompt and every video prompt for that character. It is never paraphrased, never shortened for a close-up, never "improved" between shots. Write it once, at pipeline step 5, store it in the character record below, and from then on copy it — do not retype it, because retyping is how paraphrase gets in.

Divide the two drifts. *Inside* a clip, identity is lost mainly to length and head rotation — see F1 in [failure-modes.md](failure-modes.md). *Between* clips, it is lost mainly to paraphrase, because each rewording moves the model to a different point in identity space. The identity string is the fix for the second kind, and it is the one you control completely.

### Why the budget is 30–50 words

Both bounds are load-bearing, and for different reasons.

- **Under 30 words it stops being reproducible.** Fewer than three independent face-structure facts plus one checkable landmark leaves enough slack for the same words to resolve to a different person on every generation, and leaves you nothing to audit the return against. A short string is not a safer string; it is an underspecified one.
- **Over 50 words the tail starts losing attention** in most models, so the last clause is the one that quietly stops arriving. That is why the wardrobe anchor goes last on purpose — it is the part a reference image or a dedicated wardrobe slot can carry if the words are dropped, whereas a dropped jawline cannot be recovered from anywhere.

Count the words when you write it, once. A string that is 28 or 56 is a defect, not a style choice.

### What goes in it

3–6 fixed physical facts that survive any lighting, plus exactly one wardrobe anchor with a colour and a material, as a present-tense noun phrase so it drops into any sentence. Build it as a recipe you can audit by counting, in this order:

1. One or two demographic anchors — one age as a number, and ethnicity where it is a fact about the face.
2. Two or three face-structure facts — jaw, eye set, brow, nose, hairline. These are what the model actually reconstructs.
3. Exactly one unique checkable landmark — a mole with a side, a scar with a length, a chipped tooth, a cowlick. This clause earns its words twice: it is the QC handle, the one item that proves drift in half a second rather than merely suggesting it.
4. One hair spec — length, cut, and parting or tie-up side.
5. One wardrobe anchor, last — garment, colour, material, and one detail that can be checked at a distance.

Where a tool splits wardrobe into its own prompt slot — the keyframe slot anatomy in [image-model-adapters.md](image-model-adapters.md) does — the face-only portion is the first 15–25 words of this same string and the wardrobe anchor moves to its slot. That is a split of one string, not a second string; do not rewrite either half.

If the target tool takes a Chinese prompt, write one Chinese identity string and freeze it the same way. Translating the English string ad hoc per shot is paraphrase by another route, and it drifts exactly as fast. Craft terms in [prompt-lexicon.md](prompt-lexicon.md).

### What must never go in it

| Never | The way it usually appears | Why it fails |
|---|---|---|
| Mood or judgment adjectives | beautiful, mysterious, intense, striking eyes | Not geometry. The model averages them, and the average lands somewhere new each generation |
| Camera, lens or lighting words | close-up, 85mm, backlit, moody, cinematic | Those slots are owned elsewhere in the prompt; two sources for one slot is drift, and the string is pasted into shots at every size |
| Celebrity or lookalike comparisons | looks like a young Tony Leung | Resolves to a different blend in every model, every version, and every tool. The fastest way to lose a face when you change platforms |
| An age range | 30s, mid-40s, around fifty | A range is a free parameter. Pick one number |
| Era or setting words doing wardrobe's work | period clothing, traditional dress, workwear | A research task, not a garment. Name the garment, its colour and its material |
| Negative or memory instructions | do not change her face, same as the reference image | Addresses a memory the model does not have — see the second bad example below |
| Anything that changes during the story | wet hair, muddy sleeve, the cut on his lip, the parcel | Progressive state belongs in the state-change ledger; a string that must never change cannot carry a value that must |
| A second character | …standing beside her husband | One string, one person. Blocking and relationships are the shot plan's job |

Good — 46, 41 and 37 words:

```text
MEI, 24, a Chinese woman with an oval face, thin straight eyebrows, a small mole below the left corner of her mouth, black hair cut blunt at the jaw and tucked behind her right ear, in an army-green cotton postal jacket with a red collar tab
```

```text
LU, 58, a heavy-set Chinese man with a broad flat nose, deep vertical lines between the brows, grey stubble on a square jaw, close-cropped grey hair receding at the temples, in a navy quilted work coat with a torn right cuff
```

```text
The BOY, 9, thin, protruding ears, a chipped upper front tooth, straight black hair cut short with a cowlick at the crown, wearing a mustard wool sweater two sizes too large with the cuffs turned back twice
```

Each one audits the same way: an age as a number, two or three structure facts, exactly one landmark you can look for (the mole and its side, the brow lines between the eyes, the chipped upper tooth), a hair spec with a side or a shape, and a garment carrying a colour, a material and one checkable detail. Note that the BOY's string carries no ethnicity clause and is still inside budget — that anchor is optional where it is not a fact about the face, and the words it frees up went into the sweater's fit, which is what actually identifies him at a distance.

Bad:

```text
a beautiful mysterious young woman with striking eyes, wearing period clothing, cinematic look
```

Nothing here is reproducible. "Striking eyes" is a judgment, not geometry; "period clothing" is a research task, not a garment; "cinematic" is noise. There is no landmark, so nothing to check on return. Two generations from this string are two different people.

```text
MEI (same as the reference image, keep her consistent, do not change her face)
```

This addresses a memory the model does not have. Reference-image binding is a control surface, not a sentence — see [image-model-adapters.md](image-model-adapters.md). Negative instructions about identity do not preserve identity; the positive description does.

## Character schema

Filled, not a skeleton. Every field below carries a real value so you can see what "specific enough" looks like.

```yaml
characters:
  - id: char_boy                 # stable slug, used in every filename and prompt log
    name: BOY
    # the verbatim clause from the section above; the ONLY identity text ever used
    identity_string: "The BOY, 9, thin, protruding ears, a chipped upper front tooth, straight black hair cut short with a cowlick at the crown, wearing a mustard wool sweater two sizes too large with the cuffs turned back twice"
    age: 9                       # one number, not a range
    height_build: "132 cm, thin, narrow shoulders, eye height 122 cm"   # eye height drives eyeline math
    face: "chipped upper front tooth, right of centre; ears protrude, both sides; round chin; no freckles"
    hair:
      cut: "short back and sides, no parting, cowlick at the crown"     # fixed; copy-paste
      state: dry                 # dry | damp | soaked | windblown | pinned — CHANGES, track per shot
    wardrobe:                    # by layer, outermost first; each layer named with color + material
      outer: null                # no coat in this scene; write null, never an empty string
      mid: "mustard wool sweater, crew neck, two sizes large, cuffs turned back twice"
      base: "white cotton undershirt, visible at the neck"
      lower: "grey school shorts, ending above the knee"
      feet: "white canvas lace-ups, grey at the toe, laces knotted not bowed"
      accessories: []
    wardrobe_state: dusty        # clean | dusty | wet-shoulders | soaked-front | soaked-through | muddy-hem | torn-<where>
    props_carried: []            # prop ids + which hand
    injury_makeup: "scab on the LEFT knee, about a week old, edges lifting"   # what, which side, how old
    performance_baseline: "fast unfinished movements; looks at his hands when spoken to; stands with weight on one hip"
    reference_assets: [RAIN_CHAR-boy_v01_ref-face, RAIN_CHAR-boy_v01_ref-body]
    seed: 771204                 # integer if the image model exposes one; null if not
    must_keep: ["chipped front tooth", "cowlick at the crown", "cuffs turned back twice", "scab on the LEFT knee"]
    must_avoid: ["adult proportions", "new clothes", "coat", "open smile showing a full set of teeth"]
```

`must_avoid` is the negative-prompt feed; word it from the library in [prompt-lexicon.md](prompt-lexicon.md) rather than inventing phrasing per character.

The split between `wardrobe` (permanent, describes the garment) and `wardrobe_state` (transient, describes its condition) is the whole point. The garment lines are copy-paste; the state line is rewritten every shot from the state-change ledger.

## Wardrobe schema

Use a separate wardrobe entry when a costume is shared across characters, changes between scenes, or has a state progression worth tracking on its own.

```yaml
wardrobe:
  - id: fit_mei_postal
    worn_by: char_mei
    scenes: [SC01, SC02, SC03]
    layers:
      outer: "army-green heavy cotton canvas postal jacket, red collar tab, brass buttons, hip length"
      mid: "grey wool knit sweater, crew neck, visible at collar and cuffs"
      lower: "dark blue cotton work trousers, straight leg, no crease"
      feet: "black canvas lace-up shoes, thin rubber sole"
    closure_state: "top two buttons open, collar folded down"
    state_track: [clean, wet-shoulders, soaked-front, soaked-through]
    fit_notes: "one size large; sleeves reach the second knuckle"
    forbidden: ["zippers", "synthetic sheen", "logos", "modern athletic cut"]
    reference_assets: [RAIN_FIT-mei-postal_v01_ref-fit]
```

## Prop schema

```yaml
props:
  - id: prop_parcel
    name: "oilcloth parcel"
    description: "shoebox-sized brown paper parcel wrapped in dark green oilcloth, tied crosswise with hemp twine, knot on top"
    scale_ref: "roughly two hand-widths long"
    # ordered; adjacent shots step one band, never skip. Oilcloth beads and never soaks
    # through — the hemp twine is what darkens, and that is the visible progression
    state_track: [dry, spotted, beaded, twine-dark]
    held_by: char_mei             # UPDATE on every handoff; this field is the bug source
    hand: right
    orientation: "knot up, long side across the body"
    story_function: "the thing being given away"
    continuity_risk: "changes hands in SH05; models tend to duplicate it into both pairs of hands"
    reference_assets: [RAIN_PROP-parcel_v01_ref-detail]
    must_avoid: ["plastic wrap", "printed labels", "tape", "second parcel"]
```

## Location schema

```yaml
locations:
  - id: loc_shelter
    name: "highway bus shelter"
    era_lock: "autumn 1994, provincial highway, southern China"
    geography: "shelter sits on the north verge; highway runs left-to-right across frame; the town is screen-left, the truck depot screen-right"
    orientation_rule: "camera stays north of the road; the road always runs L-R; anyone heading to the depot exits screen-right"
    architecture: "open-sided concrete shelter, corrugated tin roof, three-slat wooden bench, peeling blue paint on the back wall, hand-painted timetable board"
    light_sources:
      - "sodium-vapour street lamp, head at 4 m on a pole standing clear of the shelter, camera-left — hard, amber; the key on every shot"
      - "the bench is about 7 m from the pole: the key rakes in under the roof edge at about 20 degrees elevation, camera-left"
      - "the roadside position is about 3 m from the pole: same key, about 40 degrees, and about two and a half stops brighter by inverse square"
      - "sky ambient, blue-grey, the only fill; about 8:1 lit-side to shadow-side on the face"
      - "truck headlights raking from screen-right — SH03 only, motivated by LU's arrival, never repeated"
    key_direction: "camera-left on every shot; ~20 degrees elevation at the bench, ~40 degrees at the roadside; never camera-right"
    exposure_rule: "expose for the roadside position; the bench then sits about two and a half stops down, so a character brightens as they step out to commit"
    time_of_day: "21:00–21:20, full dark, no residual sky glow"
    weather_track: [light-rain, moderate-rain, heavy-rain]
    ambient_sound: "rain on tin roof, wet tyre hiss at distance, no birds, no insects, no traffic horns"
    set_dressing: ["cigarette ends by the bench leg", "a cracked enamel basin catching a roof leak", "faded paper notice, half torn"]
    forbidden_anachronisms: ["mobile phones", "LED or white light sources", "plastic wheeled luggage", "reflective road markings", "logo sportswear", "disposable cups", "modern signage fonts"]
    palette: "amber key, blue-grey fill, desaturated except the red collar tab"
    plate_assets: [RAIN_LOC-shelter_v01_plate-wide, RAIN_LOC-shelter_v01_plate-bench]
    must_avoid: ["daylight", "second street lamp", "dry ground", "crowd"]
```

Two fields do most of the work here. `orientation_rule` is the one people skip and then regret — write it as a sentence a stranger could obey.

`key_direction` must survive a geometry check before you paste it into anything. Draw the ray from the source head to the subject's head and ask what is in the way: a roof, a brim, a doorway, an awning. If the obstruction clips the ray, the key you wrote does not exist and the keyframe will come back lit some other way. Then check the distance ratio, because a single practical is a point source and the falloff is brutal — here the bench is 7 m from the pole and the roadside 3 m, so the same lamp is about two and a half stops apart between the two positions. That is not a continuity error to suppress; it is the light event of the scene, and MEI steps into it. Ratio conventions, falloff, and how to word a ratio in a prompt are in [lighting-and-color.md](lighting-and-color.md).

## Shot-to-shot continuity schema

```yaml
shots:
  - shot_id: SC02_SH04
    screen_direction: "MEI frame-left facing screen-right; LU frame-right facing screen-left; no travel across frame"
    # the angle is NOT a property of the height difference alone. 14 cm of eye-height
    # difference at 0.7 m of separation is ~11 degrees up; at 1.0 m it is ~8. Recompute
    # whenever you change the separation, and write the separation next to the angle
    eyeline_target: "MEI looks up to LU's eyes: 14 cm difference at 0.7 m separation, ~11 degrees up"
    camera_height_m: 1.5
    camera_angle: "level on MEI, whose eye height is 1.52 m; slightly low on LU, whose eye height is 1.66 m"
    light_direction: "key camera-left, hard, amber; ~40 degrees on MEI now that she is at the roadside, still ~20 degrees on LU at the bench line, and she is ~2.5 stops up on him"
    subject_state:
      char_mei: { hair: "flattening, wet at the crown", wardrobe_state: wet-shoulders, props: [prop_parcel] }
      char_lu: { hair: dry, wardrobe_state: clean, props: [prop_umbrella] }
    prop_state: { prop_parcel: "dry on the cut in, spotted by the cut out; still in MEI's RIGHT hand, knot up" }
    weather: heavy-rain
    time_of_day: "21:12"
    start_state: "MEI is under the roof, parcel held at her chest; LU's hands are at his sides"
    end_state: "MEI has stepped clear of the roof and holds the parcel out at chest height; LU's left hand is rising into frame-right, not yet touching it"
    must_match_prev: ["MEI dry at SH03 end", "key from camera-left", "parcel knot up in her RIGHT hand", "LU's umbrella in his RIGHT hand"]
    must_match_next: ["parcel still in MEI's RIGHT hand at the cut", "LU's left hand entering from screen-right", "heavy rain", "MEI's shoulders dark, hair not yet flat"]
```

Two things in that block are decisions, not bookkeeping. The contact is deliberately withheld: the shot ends on the offer and the next shot completes the transfer, so no single clip has to render two hands meeting around an object. That split is scored in [production-workflow.md](production-workflow.md). And the near-hand check — MEI faces screen-right so her right hand is the camera-side hand, LU faces screen-left so his left is — is what keeps the transfer in front of both bodies instead of hidden behind them. Run that check before you write the hands into a prompt; if both giving hands come out far-side, restage or flip the coverage. The line rules that constrain the flip are in [cinematic-language.md](cinematic-language.md).

## Asset naming convention

One grammar, applied to every file. The name must be readable in a directory listing and sortable into shot order. Version always sits immediately before the role, so a sort groups a shot's versions together.

```text
PROJ_SCnn_SHnn_vNN_role.ext        shot assets
PROJ_SCnn_vNN_role.ext             scene-level assets (ambience bed, edit timeline, scene grade)
PROJ_SUBJ-slug_vNN_role.ext        non-scene assets (character, location, prop, costume refs)
PROJ_SCnn_SHnn_log.md              the prompt log — the only file with no version, because it holds all of them
```

| Token | Grammar | Example | Rule |
|---|---|---|---|
| `PROJ` | 3–6 uppercase chars, no internal separator | `RAIN` | Chosen once per project, never changed |
| `SCnn` | `SC` + 2 digits | `SC02` | Scene numbers come from the shot plan, zero-padded |
| `SHnn` | `SH` + 2 digits | `SH05` | Shot within scene; a late insert gets `SH05a`, never a renumber |
| `SUBJ-slug` | `CHAR-`, `LOC-`, `PROP-`, `FIT-` + lowercase slug | `CHAR-mei` | Matches the `id` in the schema above |
| `vNN` | `v` + 2 digits | `v03` | Starts at `v01`, monotonic, never reused, never overwritten. Two sibling options generated from the same decision point take a letter suffix (`v03a`, `v03b`); iterations never do |
| `role` | lowercase kebab from the fixed vocabulary | `kf-first` | See list below |
| `ext` | lowercase | `.png` | Stills `.png/.jpg`, clips `.mp4`, audio `.wav`, edit `.fcpxml/.edl` |

Role vocabulary: `ref-face`, `ref-body`, `ref-fit`, `ref-detail`, `plate-wide`, `plate-detail`, `kf-first`, `kf-last`, `kf-alt`, `clip`, `clip-FAIL-<axis>`, `vo-<char>`, `amb`, `sfx-<name>`, `mus`, `cut`, `log`.

```text
RAIN_SC02_SH04_v03_kf-first.png       approved first frame
RAIN_SC02_SH04_v03_kf-last.png        matching last frame for a first/last-frame tool
RAIN_SC02_SH04_v05_clip.mp4           the take that got approved
RAIN_SC02_SH04_v04_clip-FAIL-face.mp4 kept on purpose; the axis is in the name
RAIN_SC02_SH04_v03a_kf-first.png      sibling option, not an iteration; v03b is its pair
RAIN_CHAR-mei_v02_ref-face.png        character reference
RAIN_FIT-mei-postal_v01_ref-fit.png   costume reference
RAIN_LOC-shelter_v01_plate-wide.png   location plate
RAIN_SC02_SH04_v01_vo-mei.wav         dialogue take
RAIN_SC02_v01_amb.wav                 scene ambience bed
RAIN_SC02_v04_cut.fcpxml              edit timeline
RAIN_SC02_SH04_log.md                 every prompt sent for this shot, in order
```

Do not encode approval in the filename. Approval lives in the log — see [production-workflow.md](production-workflow.md). Renaming a file to mark it approved breaks every reference already written.

## Seed and reference registry

One table per project. This is what you consult when a shot generated three weeks ago must be matched today.

| asset_id | subject | model class | seed | reference inputs | prompt file | locked | notes |
|---|---|---|---|---|---|---|---|
| `RAIN_CHAR-mei_v02_ref-face` | char_mei | image, ref-image binding | 4417823 | none (origin asset) | `RAIN_CHAR-mei_log.md` | yes | canonical face; all later shots reference this |
| `RAIN_FIT-mei-postal_v01_ref-fit` | fit_mei_postal | image, ref-image binding | 4417823 | `CHAR-mei_v02_ref-face` | `RAIN_FIT-mei-postal_log.md` | yes | full-length, neutral light, arms clear of the body |
| `RAIN_LOC-shelter_v01_plate-wide` | loc_shelter | image, text-to-image | 903112 | none | `RAIN_LOC-shelter_log.md` | yes | night, light rain; all coverage derives from this |
| `RAIN_SC02_SH04_v03_kf-first` | SC02_SH04 | image, 2 ref inputs | 4417823 | `CHAR-mei_v02_ref-face`, `LOC-shelter_v01_plate-wide` | `RAIN_SC02_SH04_log.md` | yes | approved 3rd attempt |

Seed rules, in order of how much they buy you. Change the seed only when you have decided the identity itself is wrong, never as a way to fix a framing or a light. Reuse the character's seed on keyframes that differ little from the origin asset — same size, same angle, same light — where it removes one source of variance. Expect it to buy almost nothing when the framing changes a lot, because a fresh composition puts the sampler somewhere else regardless. If the tool exposes no seed field, write `null` and lean harder on reference-image binding, which is the stronger control anyway; the control surfaces are in [image-model-adapters.md](image-model-adapters.md). A seed is not a guarantee of identity across prompt changes, and treating it as one is why people stop checking the face.

## State-change ledger

The ledger is the working half of the bible. One row per shot, written *before* generation, corrected after approval. The discipline it enforces: every tracked state moves at most one band between adjacent shots. A progression that jumps two bands reads as a missing shot, and a progression that runs backwards reads as a different day.

| Shot | What changed inside this shot | Carries into next as | Verify in next shot |
|---|---|---|---|
| SC02_SH01 | Nothing changes; this row exists to fix the baseline | rain light, ground already wet, MEI dry under the roof | puddle coverage and rain density match |
| SC02_SH02 | Rain light → moderate; MEI still under the roof | MEI dry including shoulders, parcel dry, moderate rain | MEI's shoulders still dry |
| SC02_SH03 | LU arrives from screen-right, umbrella up in his RIGHT hand; rain moderate → heavy | LU dry under the umbrella, heavy rain | zero water on LU's coat or hair |
| SC02_SH04 | MEI steps clear of the roof: key 20° → 40° and ~2.5 stops up on her, wardrobe clean → wet-shoulders, hair flattening; parcel dry → spotted. The parcel is offered, not taken | MEI wet-shoulders, parcel still in her RIGHT hand | the parcel has NOT changed hands yet |
| SC02_SH05 | Transfer completes into LU's LEFT hand; oilcloth spotted → beaded, hemp twine darkening | parcel with LU, MEI's hands empty | exactly one parcel, knot still on top |
| SC02_SH06 | MEI does not go back under the roof: wet-shoulders → soaked-front; LU exits screen-right | into SC03: MEI soaked-front, parcel offscreen with LU | SC03 opens at soaked-front, never at clean |

The last row is the one people forget to write. A scene's exit state is the next scene's entry state, and `soaked-through` — the fourth band on MEI's track — is not reached in SC02 at all. Do not let SC03 open there just because it feels like the end of the story.

## Worked example: RAIN / SC02, the bus shelter handoff

Two characters, one location, three progressions running at once: rain light → heavy, MEI clean → soaked-front, parcel from MEI's right hand to LU's left. This is the scene the rest of the skill scores and budgets against — [production-workflow.md](production-workflow.md) uses these same six shots.

```yaml
project: RAIN
scene: SC02
characters:
  - id: char_mei
    name: MEI
    identity_string: "MEI, 24, a Chinese woman with an oval face, thin straight eyebrows, a small mole below the left corner of her mouth, black hair cut blunt at the jaw and tucked behind her right ear, in an army-green cotton postal jacket with a red collar tab"
    age: 24
    height_build: "162 cm, slight, narrow shoulders, stands with weight on the left foot"
    face: "oval; mole below LEFT mouth corner; thin straight brows; no makeup; wide-set dark eyes"
    hair: { cut: "blunt bob at the jaw, no fringe, parted slightly right", state: "dry SH01-SH03; flattening at SH04; flat and dripping SH05-SH06" }
    wardrobe:
      outer: "army-green heavy cotton postal jacket, red collar tab, brass buttons, top two open"
      mid: "grey wool crew-neck sweater, visible at collar and cuffs"
      lower: "dark blue cotton work trousers, straight leg"
      feet: "black canvas lace-up shoes"
      accessories: ["canvas satchel, worn cross-body, hanging at her left hip"]
    wardrobe_state: clean          # walks clean → wet-shoulders → soaked-front across SH04-SH06
    props_carried: [prop_parcel]
    injury_makeup: ""
    performance_baseline: "still, minimal gesture; looks at the road, not at people; speaks after a half-second delay"
    reference_assets: [RAIN_CHAR-mei_v02_ref-face, RAIN_FIT-mei-postal_v01_ref-fit]
    seed: 4417823
    must_keep: ["mole on the LEFT", "blunt jaw-length bob", "red collar tab", "cross-body satchel on the left hip"]
    must_avoid: ["makeup", "smile", "jewellery", "long hair", "modern jacket cut"]
  - id: char_lu
    name: LU
    identity_string: "LU, 58, a heavy-set Chinese man with a broad flat nose, deep vertical lines between the brows, grey stubble on a square jaw, close-cropped grey hair receding at the temples, in a navy quilted work coat with a torn right cuff"
    age: 58
    height_build: "176 cm, heavy through the chest, stands square"
    face: "square jaw; broad flat nose; deep glabellar lines; grey stubble; heavy upper lids"
    hair: { cut: "close-cropped grey, receding at the temples", state: "dry throughout" }
    wardrobe:
      outer: "navy quilted work coat, oil-stained at the right hip, right cuff torn open"
      lower: "brown corduroy trousers"
      feet: "black rubber boots, mud to the ankle"
      accessories: []
    wardrobe_state: clean
    props_carried: [prop_umbrella]
    performance_baseline: "slow, economical; takes objects with the left hand; does not make eye contact while receiving"
    reference_assets: [RAIN_CHAR-lu_v01_ref-face]
    seed: 5560194
    must_keep: ["torn RIGHT cuff", "oil stain at the right hip", "muddy boots", "dry throughout"]
    must_avoid: ["wet coat", "clean boots", "hat", "glasses"]
props:
  - id: prop_parcel
    description: "shoebox-sized brown paper parcel in dark green oilcloth, tied crosswise with hemp twine, knot on top"
    state_track: [dry, spotted, beaded, twine-dark]
    held_by: char_mei
    hand: right
    continuity_risk: "changes hands at SH05; models duplicate it into both pairs of hands"
  - id: prop_umbrella
    description: "black cloth umbrella, one bent rib on the left side, wooden crook handle"
    held_by: char_lu
    hand: right                   # right, so his LEFT is free to receive; this is why the handoff works
    continuity_risk: "the bent rib flips sides; state it as the LEFT-side rib every time"
```

Shot rows for the same scene. The camera stays north of the road on every shot, so the road runs left-right in every frame; MEI is frame-left facing screen-right, LU is frame-right facing screen-left.

| Shot | Size / height | Screen direction | Eyeline | Key | Weather | MEI state | LU state | Parcel | must_match_next |
|---|---|---|---|---|---|---|---|---|---|
| SH01 | EWS, 1.6 m, locked | road L-R; town screen-left, depot screen-right | none | camera-left, lamp in frame | light rain | dry, seated under the roof | absent | dry, on her lap | ground already wet |
| SH02 | MS, 1.5 m, locked | MEI frame-left, faces screen-right | out to the road, level | camera-left, ~20° at the bench | light → moderate | dry, parcel held to her chest | absent | dry, both hands | MEI's shoulders still dry |
| SH03 | WS, 1.6 m, slow push-in（推镜） | LU enters from screen-right | MEI up to LU | camera-left ~20°, plus a headlight rake from screen-right | moderate → heavy | dry, standing | dry, umbrella up in his RIGHT hand | dry, her right hand | LU's coat and hair bone dry |
| SH04 | MCU 2-shot, 1.5 m, locked | MEI screen-right, LU screen-left | MEI ~11° up to LU at 0.7 m | camera-left; ~40° on MEI at the roadside, ~20° on LU, she is ~2.5 stops up | heavy | clean → wet-shoulders, hair flattening | dry under the umbrella | dry → spotted, still her RIGHT hand | parcel NOT yet transferred |
| SH05 | CU insert on hands, 1.25 m, locked | MEI's hand from screen-left, LU's from screen-right | no faces in frame | camera-left, ~40°, hands in the open | heavy | offscreen; wet cuff visible | offscreen; left hand only, umbrella above frame | spotted → beaded, twine darkening; into LU's LEFT hand | one parcel, now with LU |
| SH06 | WS, MEI's shoulder frame-left foreground, camera still north of the road, 1.6 m, locked | LU exits screen-right | MEI after LU | camera-left, ~40° | heavy | wet-shoulders → soaked-front, in the open | dry, receding | with LU, offscreen | SC03 opens at soaked-front |

Four traps this scene sets, and the answer in each case.

- The parcel. Name the holder and the hand in every prompt from SH04 on, and put "only one parcel" in the negative list. The transfer is split across the SH04/SH05 cut precisely so that no clip has to render two hands closing on one object.
- LU's dryness. The model wants to wet everyone in heavy rain, so restate "his coat and hair are completely dry, he is under a black umbrella" as a positive fact in SH04–SH06. A negative ("not wet") does not do this job.
- The lamp. At SH04 the reverse-angle instinct is to flip the key to camera-right. Write `key from camera-left` into the keyframe prompt, not just the video prompt, because the still is where the light gets decided. The elevation changes when MEI steps out; the side never does.
- SH06's camera. It is tempting to put the camera behind MEI and shoot down the road after LU. Do not — that rotates the axis roughly 90°, the road stops running left-right, and LU no longer exits screen-right. Keep the camera north of the road and let MEI's shoulder sit in the frame-left foreground instead.

## Drift prevention map

Diagnose the axis, then leave. Repair itself belongs to [failure-modes.md](failure-modes.md) — go there for ranked causes, ranked fixes, and before/after prompt pairs under the code in column three. [../assets/qc-checklist.md](../assets/qc-checklist.md) is the pass you run before any of it. What this table owns is the last column: the field in this file that stops the same drift returning.

| Axis | Drift you see | Code | The field here that prevents a repeat |
|---|---|---|---|
| 1 Face | A sibling rather than the same person, or the face holds and then goes in the last second | F1 | `identity_string` pasted verbatim, one locked `ref-face` in `reference_assets`, `seed` recorded |
| 2 Hair | Length, parting side, or wetness changes between shots | F1, F7 | `hair.cut` (fixed, copy-paste) held separate from `hair.state` (rewritten per shot) |
| 3 Wardrobe | A layer appears, disappears, or silently re-buttons | F1 | `wardrobe` layer stack with color and material per layer, plus `closure_state` and `forbidden` |
| 4 Props | Two of them, or the right object in the wrong hand | F7, F9 | `held_by` and `hand` updated at the handoff *before* the prompt is written; `must_avoid: ["second <prop>"]` |
| 5 Wet / dirt / blood | The state resets to clean | F7 | `state_track` walked one band per shot, with a ledger row carrying the exit state forward |
| 6 Injury / makeup | The wound swaps sides or changes age | F7 | `injury_makeup` naming the side and the age, restated as a positive fact each shot |
| 7 Light direction | The key flips on the reverse angle | F12 | `key_direction` in the location, pasted into the keyframe prompt and not only the video prompt |
| 8 Time of day | "Night" drifts across the scene | F12 | `time_of_day` with a real clock time, plus a locked location plate to match against |
| 9 Weather | Intensity jumps backwards or skips a band | F7 | `weather_track` as an ordered list; adjacent shots never skip |
| 10 Geography | The door changes walls between wide and close | F7, F8 | `plate_assets`: lock a wide before any coverage, then reference it from every angle |
| 11 Screen direction | The subject flips which way they face or travel | F7 | `orientation_rule` as an obeyable sentence, checked at storyboard rather than at QC; the line rules are in [cinematic-language.md](cinematic-language.md) |
| 12 Eyeline | The look passes through or over the other person | F7 | `height_build` for both parties, and `eyeline_target` computed from eye-height difference *and* separation, not from height alone |
| 13 Camera height | Wanders because the angle was written as a mood word | F6, F17 | `camera_height_m` as a number in every shot row, with what sits at frame centre |
| 14 Color palette | Shifts between working sessions | F16 | `palette` line in the location; generate a scene's stills in one session; grading language in [lighting-and-color.md](lighting-and-color.md) |
| 15 Lens feel | A wide keyframe cut against a long-lens one inside a scene | F16 | One focal length fixed per scene in the director's book and restated in every keyframe prompt |
