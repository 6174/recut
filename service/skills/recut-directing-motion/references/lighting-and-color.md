> 来源: DirectorSKILL-full — .executor-tasks/sources/DirectorSKILL-full/references/lighting-and-color.md (MIT)

# Lighting and Color

Load this file when a scene needs a lighting design, a time-of-day decision, a palette or color script, grading direction, or when generated shots disagree about where the light is coming from.

Framing, lens, angle and move belong to [cinematic-language.md](cinematic-language.md). Exact word choices and their 中文 equivalents belong to [prompt-lexicon.md](prompt-lexicon.md). This file owns the reasoning: which light, why, and how to keep it.

## The core rule: name the source, not the mood

Mood words are the model's problem to interpret. Source words are physics the model has seen a million examples of. A named source implies direction, quality, color, falloff and era in four words; "moody" implies nothing and gets you the training-set average.

```text
BEFORE (mood): Dramatic moody lighting, intense atmosphere, a man at a desk at night, cinematic.
AFTER (source): A man at a desk at night. Single green-shaded desk lamp camera-left at
head height, hard, shadow side of his face about two stops under, tungsten warm. The room
behind him falls to black within a metre. No other light source.
```

The AFTER version also survives being repeated in the next eleven prompts of the scene. The BEFORE version does not, because "moody" resolves differently every generation.

## Setup vocabulary

| Role | What it does | Drop it and you get |
|---|---|---|
| Key | Sets direction, ratio and the shape of the face. The only light that must be motivated | No scene. Ambient only; subject flattens into the background |
| Fill | Controls the ratio, i.e. how much detail lives in the shadow | Ratio jumps to the practical maximum. Shadow side goes black. Reads noir whether or not you wanted noir |
| Back / rim | Separates subject from background; edge on hair and shoulder | Subject merges into a dark background. Models rarely add this unprompted — this is the single most common cause of "muddy" AI frames |
| Kicker (three-quarter back, opposite the key, hard) | Sculpted edge along jaw and cheek on the shadow side | Shadow side reads soft and unformed; face loses structure |
| Eye light | Small source near the lens axis; puts a catchlight in the eye | Dead eyes. The most common reason an AI face reads lifeless even when everything else is right |
| Background / separation | Sets background value relative to subject | Background sits at the same value as the subject; the frame reads flat and depthless |

Three working approaches, in order of usefulness for AI generation:

- Single-source naturalism — one motivated source plus whatever bounces. Everything else is falloff. Best default for AI: there is exactly one direction to keep constant across a scene, so continuity has one job instead of three.
- Available light — take what the location gives; control exposure and where the actor stands, not fixtures. Right for documentary, handheld, contemporary realism. Hardest to hold in AI because the "source" is the whole environment and the model reinvents it every clip.
- Three-point (key + fill + back) — a teaching diagram, not a location plan. Use it for interview, product, and any face that must stay identical across dozens of generations. Reads slightly artificial by design. The back light is the element most often dropped when it is not named, so write it into every prompt rather than assuming it.

## Lighting ratios

Ratios below are lit side : shadow side measured on the subject's face — the same convention the `lighting.key_ratio` field in the director style modules uses. Some departments quote key : fill instead, which gives a smaller number for the same face: a 4:1 lit-to-shadow face is 3:1 key-to-fill. The number alone is therefore ambiguous, so always write the ratio in words as well.

| Ratio | Stop difference | Emotional read | Home genre | Say it in words |
|---|---|---|---|---|
| 1:1 | 0 | Nothing hidden; also nothing interior. Exposure without revelation | Comedy, sitcom, news, corporate, clinical horror | "Even light on both sides of the face, no shadow side" |
| 2:1 | 1 | Ordinary, warm, unremarkable. The everyday setting | Daytime drama, romance, most TV | "Shadow side one stop under; the shadow reads as tone, not darkness" |
| 4:1 | 2 | The character has an interior you are not being shown all of | Feature drama, thriller, period | "Shadow side clearly darker but still holds detail" |
| 8:1 | 3 | The character is withholding something | Noir, horror, interrogation, crime | "Shadow side nearly black, only the edge of the cheek catches light" |
| 16:1 | 4 | The character is barely present; the frame is a shape, not a person | Expressionist, horror climax, myth | "Only a sliver of the face is lit; everything else falls to black" |

Ratio is a continuous dial and the interesting work is moving it inside a scene: open a scene at 2:1 and close it at 8:1 as one character stops telling the truth. Generators tend to drift back toward a mild 2:1 as the shot tightens and the source leaves frame, so restate the ratio in words on every close-up.

## Key direction

Direction is stated relative to camera, never relative to the room — the model has no model of the room. The same rule governs faces: write "the camera-left cheek", never "his left cheek". For a subject facing camera, anatomical left is screen right, and generators split on which one you meant, so naming the camera side removes a coin flip that costs you a re-roll.

| Direction | What it does to a face | What it does to a lie |
|---|---|---|
| Frontal (on axis) | Erases texture, age, and modeling. Open, flat, unguarded | Undetectable. There is no shadow for the audience to project doubt into. Use when you want the audience deceived alongside the scene partner |
| 45° three-quarter front | Nose shadow, both eyes lit, a lit triangle on the shadow cheek. The narrative default | Legible. Enough shadow to suggest reserve, enough light to read intent |
| 90° side | Splits the face into a lit half and a dark half; one eye lit | Divided. Reads as a decision not yet made, or a person being two things |
| Three-quarter back | Face mostly in shadow with a rim on the far cheek and hair | Withheld. The audience knows something is being kept and cannot see what |
| Full back (silhouette) | Identity removed, shape retained | Irrelevant — this is no longer a person, it is an arrival or a threat |
| Top | Eye sockets go to pits, cheekbones catch, mouth in shadow | Judged. Institutional, hollowed, no interiority granted |
| Under | Inverts the shadow pattern of every face the audience has ever seen | Wrong on sight |

The under-light rule: for a lifetime, every face a person has looked at has been lit from above — sun, sky, ceiling, streetlight. Under-lighting flips every shadow, so the audience reads *wrong* before they can say why. That is why it is the campfire-ghost-story light, the monster light, the dashboard light, and the phone-screen light. It is a strong effect and it is one note; use it once per project, on the beat that earns it.

## Quality and falloff

Hard versus soft is not a fixture type, it is the apparent size of the source seen from the subject. The sun is enormous and casts hard shadows because from here it is half a degree wide. A one-metre frame at half a metre is soft; the same frame at ten metres is hard. Working rule: apparent source width comparable to or larger than the subject reads soft; much smaller reads hard.

- To get hard, describe the shadow rather than the light: "single small source", "a sharp shadow line across the wall behind him", "direct unfiltered sun", "bare bulb", "hard-edged shadow of the window frame on the floor". Models render shadows more reliably than they render the abstract phrase "hard light".
- To get soft, remove the shadow: "overcast", "north-facing window", "light bounced off a white wall", "shadow edges indistinct", "no visible shadow line".

Falloff follows the inverse-square law for anything small enough to act as a point source, and the practical consequence is about distance *ratios*, not absolute distance. A face half a metre from a candle loses two stops by stepping back to one metre — doubled distance, quarter the light. A face five metres from a window loses about half a stop stepping back to six. Very large sources (a wall of window, an overcast sky) fall off far more slowly than inverse-square at close range. So:

- Near a small source: movement is exposure. A character can hide by taking one step back. The background stays black no matter what.
- Far from the source, or under a large one (overcast, a wall of window): movement changes nothing. There is no refuge in the frame.

Choose falloff by whether the scene should offer somewhere to hide. Then say so: "one candle on the table; her face is bright and the wall two metres behind her is black" produces steep falloff. "Candlelit room" produces an evenly amber room with no falloff at all, because that is the average of everything labeled candlelit.

## Motivation: the practicals catalogue

Every entry locks an era. Choosing a practical is a production-design decision disguised as a lighting decision — a sodium lamp puts you between roughly 1960 and 2015 in most Western cities whether you meant to go there or not.

| Practical | Color character | Quality | Falloff | Era / place it locks | Prompt phrasing |
|---|---|---|---|---|---|
| Oil lamp | Deep amber, unstable | Small source, steadier and slightly larger than a candle; a frosted globe softens it | Extreme; usable to about a metre | Pre-electric, rural, power-out | "a single oil lamp on the table, warm amber pool falling to black within a metre" |
| Candle | Orange, flickering | Small source; crisp on skin up close, soft overall | Steepest of all | Pre-electric, ritual, blackout | "one candle at chest height; the light dies just past her face" |
| Gas lamp | Warm with a green cast, steadier than open flame | Soft globe with a halo | Moderate, pooled | Roughly 1810s–1930s streets and halls | "gas street lamps, pale warm globes with soft halos in the damp air" |
| Tungsten bulb | Warm orange, steady | Bare bulb hard; shaded soft | Steep when bare | Any electrified interior, 1900s on | "a bare tungsten bulb overhead, warm and slightly orange, hard shadows below the brow" |
| Fluorescent tube | Green-cyan, faint flicker | Very soft, wraparound, near-shadowless | Almost flat across a room | Institutional, roughly 1940s on | "overhead fluorescent tubes, even green-tinged light, no visible shadow direction" |
| Sodium street lamp | Low-pressure sodium is genuinely monochrome and kills every other hue; high-pressure sodium is amber but still renders some color | Soft pool, hard-edged on the ground | Strong pools with black gaps between | Roughly 1960–2015 streets; absent in LED-retrofit cities | "low-pressure sodium street lamps, monochrome amber pools with black gaps between them" |
| Mercury vapor | Cold blue-green | Hard-ish, from height | Even at distance | Mid-century to 1990s yards, lots, industry | "mercury-vapour yard lights on high poles, cold blue-green, hard shadows" |
| Neon | One saturated hue per tube; magenta, cyan, red | Weak on faces, strong in reflections | Very steep; decorative, not functional | 1920s on; city night | "red and cyan neon signage across wet asphalt; the light is weak on his face and strong in the puddles" |
| CRT screen | Blue-white, hue and level jumping with picture content; often pushed cyan-green in the grade | Soft, from low-front; a rolling bar if the shutter is not synced | Steep | Roughly 1950–2005 | "a CRT television lighting his face from below, cool blue-white, the level jumping as the picture cuts" |
| LCD / phone screen | Blue-white, hue shifts with content | Very soft, small, close | Extremely steep | Contemporary only | "phone screen underlighting her face, cool blue-white; only the face is lit" |
| Headlight | Warm yellow-white for tungsten and sealed-beam lamps; blue-white only for HID and LED | Hard, near-parallel, long shadows | Moderate, but sweeps | Electric headlights 1910s on; the blue-white read only from roughly 2000 on, so it dates a shot instantly | "car headlights sweeping across, hard warm yellow-white beams throwing long moving shadows on the wall" (swap to "blue-white HID beams" for present day) |
| Firelight | Orange-red, irregular | Soft-ish, from low, flickering | Steep | Any era | "a low fire lighting them from below, warm orange, irregular flicker" |
| Lightning | Near-daylight blue-white, instantaneous | Hard, through whatever opening exists | None; fills the room | Any era | "lightning flashes through the window, brief hard blue-white from camera-left" |
| Moonlight (convention) | Cool blue-grey — a convention, not a measurement; real moonlight is neutral and simply too dim to see color by | Hard and single (the moon is about half a degree wide, like the sun); height varies with the hour, so pick one and hold it across the scene | None | Any era | "moonlight convention: cool blue-grey key from high camera-left, hard shadows, shadows still hold detail" |

If a practical is visible in frame, the model has an anchor and the light behaves. If it is off-screen, you must name it anyway plus one visible consequence — see the continuity section.

## Time of day

| Window | Direction | Quality | Color | Contrast | Real duration | Register | AI note |
|---|---|---|---|---|---|---|---|
| Pre-dawn | None; sky dome | Flat, soft | Blue-grey, desaturated | Very low | 30–45 min | Sleeplessness, vigil, aftermath | Say "before sunrise, no sun, sky glow only, no visible source" or you get night-with-blue-filter |
| Dawn | Very low, from the horizon | Soft with haze | Pale gold into pink; cool shadows | Mid | 20–40 min | Beginning, or exhaustion after a night | State which way the sun is relative to camera; generators default to backlight |
| Golden hour | 0–10° elevation | Warm, long hard shadows | Amber key, blue sky fill | Mid-high | 30–60 min mid-latitude; ~20 min near the equator; hours near the poles | Romance, memory, endings | The most over-fitted look in current image and video models. Constrain it: "low sun, long hard shadows, warm key and cool sky fill, no orange atmospheric haze" |
| Mid-morning | 30–50° | Moderately hard | Neutral-warm | Mid | 2–3 h | Work, procedure, the ordinary | The most continuity-safe sunlit condition. Still state a direction |
| Midday | Steepest of the day: 70–90° in the tropics and at mid-latitude summer, but as low as 20–25° at mid-latitude midwinter — check your story's latitude and month before writing "overhead" | Hard, top | Neutral white | High and unflattering | 1–2 h | Heat, exposure, nowhere to hide | Generators drift back toward golden. Say "sun directly overhead, short hard shadows, dark eye sockets" |
| Late afternoon | 20–35° | Hard, warm | Warm neutral | Mid-high | 1.5–2 h | Decline, waiting, the day slipping | Good compromise between shape and continuity safety |
| Dusk (just after sunset) | Warm band low on one horizon, no direct sun | Soft | Orange band, blue everywhere else | Mid | 10–20 min | Parting, curfew, last chance | Name the band's side relative to camera or it lands everywhere |
| Blue hour (civil twilight) | None; the sky is the source | Very soft, omnidirectional | Deep blue sky; practicals read strong against it | Low in the sky, high between sky and practicals | 15–30 min, immediately after dusk | Threshold, transition, melancholy | Best way to shoot night and keep detail. "After sunset, sky still deep blue, street lights on". Avoid the word "magic hour" in prompts — the trade uses it for both this window and golden hour, so it resolves either way |
| Night-for-night | Practicals only | Pools with black between | Whatever the practical is | Very high | All night | The real world after dark | Generators tend to lift this into blue daylight. Add "no ambient fill; black between the light pools" |
| Moonlight | Single, hard; elevation varies with the hour — choose one and hold it | Hard, low level, cool | Blue-grey | High in shape, low in level | All night | Fable, exposure, exteriors without electricity | Always call it a convention in the prompt, or you get daylight with a blue grade laid over it |
| Overcast | None; the sky is one softbox | Extremely soft, shadowless | Cool neutral blue-grey | Very low, 1:1 to 2:1 | Hours | Grief, realism, procedural bleakness | The safest exterior in AI: direction cannot flip between shots because there is no direction |
| Storm | Flat base plus hard spikes | Soft base, hard intermittent | Dark blue-grey, white flashes | Momentarily extreme | Variable | Crisis | Write it as two elements: the base condition, and the flash as a discrete event with a direction |

## Contrast schemes

| Scheme | Definition | When it is the right answer | The cliché it invites |
|---|---|---|---|
| High-key | Fill close to key, 1:1–2:1, bright background | Comedy, romance, corporate, and clinical horror where brightness itself is the threat | Reads as advertising by default. Break it with one deliberately dark object in frame |
| Low-key | 8:1 or steeper, most of the frame below middle grey | Noir, thriller, interrogation, secrecy | "Generic moody." The cure is naming one specific practical and letting the rest be falloff |
| Chiaroscuro | High ratio with a hard-edged pool and shadows that still hold detail | Period, moral weight, painterly interiors | Baroque candle pastiche. Avoid by keeping the source modern or industrial |
| Flat / uniform | Even ambient across the whole frame, no modeling | Bureaucracy, institutions, surveillance, deadpan comedy | Reads as accidental unless the space itself is designed to be looked at |
| Silhouette | Subject four or more stops under a bright background | Arrival, anonymity, myth, reveal-by-withholding | Sunset-with-arms-raised. Use an ugly background — a doorway, a screen, a fog bank |
| Notan | Two-value graphic design, midtones removed | Animation, graphic thrillers, title sequences | Image models tend to collapse it into flat vector art. Anchor it with a real material and real grain |

Worked, taking the hardest one to do without cliché — a silhouette that is not a sunset:

```text
Wide. She stands in an open freight-elevator doorway. The corridor behind her is lit by
overhead fluorescent tubes and sits about four stops over her; her face and coat carry no
detail at all, only the outline of her shoulders and the bag hanging at her camera-right side.
Foreground floor unlit. No rim, no fill, no sky.
```

The scheme is specified by its stop difference and its background material, not by the word "silhouette" — which on its own returns a person on a hill against an orange sky.

## Color

Palette systems, each with a usable example:

| System | Structure | Concrete example |
|---|---|---|
| Monochrome | One hue across values and saturations | A submarine interior in graduated greens; skin is the only other hue in frame, which is exactly the point |
| Analogous | Two or three adjacent hues | Amber, orange and red in a firelit tavern; the shadows carry the red end, the flame the amber |
| Complementary | Two opposed hues | Sodium-amber street pools against a blue-black sky and blue-black windows |
| Split-complementary | A base plus the two neighbors of its opposite | Warm skin key against cyan and violet neon; softer than a straight complementary and harder to make look automatic |
| Triadic | Three evenly spaced hues | A red exit sign, a green fluorescent corridor, a blue monitor, all present in one wide; only works with strong value separation |

The teal-and-orange trap: it is a complementary scheme where the warm side is exactly skin tone and the cool side is exactly everything else, so it can be applied to any footage without anyone making a design decision. That is why it is everywhere and why it costs nothing and buys nothing. It also destroys color as an information channel — if every scene is warm-skin-against-cool-world, color can no longer tell the audience where they are or how the character is doing. Four alternatives that keep the warm/cool separation but say something:

1. Amber against deep green — sodium light on foliage or painted plaster. Same split, era-locked, and the green side has texture the teal side never has.
2. Warm-neutral skin against desaturated blue-grey — get it by pulling saturation out of the cool side rather than pushing orange into the warm side. Restrained, contemporary, and it leaves headroom to introduce a saturated color later as an event.
3. Magenta against cyan — the neon split. Reads as contemporary night rather than as "a film".
4. Monochrome plus a single reserved accent hue that belongs to one story object. The most information-efficient scheme available: the moment the accent appears, the audience knows what the scene is about.

A color script moves the palette with the emotional arc instead of applying one look to everything. Worked five-beat script for a short about someone losing a place they belong:

| Beat | Palette | Saturation | Contrast | What the shift says |
|---|---|---|---|---|
| 1. Setup — home interior, evening | Tungsten warm, wood browns, one soft blue window | Mid | 2:1 | This is the baseline the audience will measure everything against |
| 2. Disruption — a caller at the door | Same tungsten, plus one cold blue-white source entering from the doorway | Mid | 4:1 | The outside has a color and it is not this room's color |
| 3. Escalation — the street at night | Sodium amber, saturation pushed | High | 6:1 | The warm from beat 1 has returned corrupted: same hue family, wrong source, no shelter |
| 4. Crisis — a lot, a corridor, an office | Mercury-vapour green; skin desaturated; no warm anywhere in frame | Low on skin, mid on environment | 8:1 | The character's own color has been taken out of the palette |
| 5. Resolution — dawn, outdoors | Overcast blue-grey; one small warm window far in frame | Low overall, one saturated accent | 2:1 | The warm exists again, but small, and at a distance |

Two techniques that make color scripts survive AI generation:

- Color as character state. Assign each principal one hue and one material (rust-red wool, bottle-green enamel). Track both in the [continuity bible](continuity-bible.md). When the character changes, change what surrounds their hue — do not change the hue itself, because in image and video models a costume color change reads as an identity change and will break face consistency along with it.
- Saturation strategy. Pick one of three and hold it: global desaturation with a single saturated object per frame; saturation tracking emotional temperature scene by scene; or saturation as a period marker (older stock reads lower-saturation in the cools and higher in the warms). Mixing two of these looks like a grading accident.

## Naming color for models

Do not use hex. Do not use bare adjectives like "warm" or "cool" alone. Use light-source names and material names — the model has seen labeled photographs of both, and neither drifts between generations the way "moody blue" does.

| Phrase | The read it gives | Locks you into |
|---|---|---|
| sodium-vapour amber | Monochrome pooled street night, everything else desaturated | Roughly 1960–2015 exteriors |
| mercury-vapour green | Cold institutional exterior at 2 a.m. | Mid-century to 1990s lots and yards |
| tungsten warm | Domestic, lived-in, safe | Any electrified interior |
| candle-orange | Ritual, intimacy, extreme falloff | Pre-electric or blackout |
| firelight orange, irregular | Camp, hearth, disaster, faces lit from below | Any era |
| overcast blue-grey | Shadowless realism, grief, procedure | Any era, outdoors |
| moonlight blue-grey | Hard-shadow night convention | Any era, exteriors without power |
| CRT cyan-green | Screen-lit room, unstable, slightly sick. This is the graded convention, not the measured color — real CRT light is blue-white | Roughly 1950–2005 |
| phone-screen blue-white | Isolation, underlit face, present tense | Contemporary only |
| fluorescent green-white | Office, hospital, waiting, no shadow to hide in | Institutional, 1940s on |
| neon magenta and cyan | City night, wet reflections, artificial glamour | 1920s on, urban |
| daylight through a north window | Soft neutral painterly interior, no direct sun | Any era, daytime |
| golden-hour amber with blue sky fill | Warmth that still has a cool shadow; memory | Any era, exteriors |
| midday white | Heat, exposure, short hard shadows | Any era, exteriors |
| bleach-bypass silver | Desaturated with heavy black contrast; industrial, war | Contemporary or period-as-brutal |
| sepia-brown | Archival past — but flags as "old-timey filter" fast; use once | Period, or a deliberate document |
| deep teal shadow | A cool shadow without committing the whole frame to a teal grade | Any |
| warm grey concrete | Neutral environment that leaves skin as the only warm thing | Brutalist, institutional, modern |
| darkroom safelight red | Enclosure, alarm state, engine room, developing image | Any era with electricity |
| arc-lamp blue-white | Searchlight, projector, hard theatrical shaft | Carbon arc from roughly the 1870s; xenon arc from the 1950s |

## Grading language

Lift, gamma and gain are shadows, midtones and highlights. In plain terms: lift moves the black point, gamma moves the middle without moving either end, gain moves the white point. What that buys you:

- Lifted (milky) blacks — the darkest part of the frame is grey, not black. Reads photochemical, aged, or nostalgic. Also reduces perceived contrast, so pair with a strong ratio or the image goes limp.
- Crushed blacks — shadow detail clipped to pure black. Reads contemporary and hard. Costs you everything happening in the shadows, which is often the point.
- Rolled-off highlights — bright areas compress instead of clipping. Reads photographic; hard clipping reads video.
- Split tone — the standard is warm highlights with cool shadows. Reverse it (cool highlights, warm shadows) for a look the audience cannot name but reads as unwell.

Descriptors that generators generally respond to as of writing — verify against your own tool before committing a scene to one: fine grain, heavy grain, halation around highlights (red bloom at bright edges — reads photochemical), milky lifted blacks, crushed blacks, bleach-bypass, cross-process (shifted hues, cyan shadows, yellow highlights), low-contrast flat log look.

The stacking warning: use at most two. Three or more grading descriptors get averaged into an undefined haze — the "filter collapse" where every shot in the batch looks like the same beige soup. Grading words also compete with lighting words for the model's attention. If the shot's key decision is light direction, drop the grading words from that prompt entirely and put them in the scene-level style line instead. Never ship "low-contrast flat log look" in a final-render prompt: generators read it as a washed-out finished image rather than as a starting point for a grade you will apply later.

## Lighting continuity for AI video

Lighting is lost between shots far more often than inside them. Symptom-first repairs live in [failure-modes.md](failure-modes.md); the preventive discipline is here.

Write one lighting invariant clause per scene and paste it verbatim into every prompt in that scene. Do not paraphrase it between shots — paraphrase is how the key drifts. The one field you may deliberately move is the stop difference, and only on the shots where the ratio change is itself the beat; source, direction, height, quality and color stay word for word. Shape:

```text
Lighting: [source] from [direction relative to camera] at [height], [hard|soft],
shadow side about [N] stops under, [color phrase], background [level].
```

```text
Lighting: single green-shaded desk lamp from camera-left at head height, hard,
shadow side about two stops under, tungsten warm, background falling to black.
```

Reverse angles are the exception that must be handled by hand. Camera-relative direction inverts when you cut around the axis: if the lamp is camera-left on the A-side coverage, it is camera-right in the reverse. Store the world-anchored fact in the continuity bible ("lamp is on the north wall"), and write the camera-relative phrase per shot. Get this backwards and the two angles will not intercut — see the axis and screen-direction rules in [cinematic-language.md](cinematic-language.md).

Shot size is the other silent breaker. On a wide, the source is usually in frame and the falloff is visible, so the model gets it right for free. Tighten to a close-up and the source leaves frame, and the model reverts to its default: soft frontal key, 2:1, no rim. Fix by naming the off-screen source plus one visible consequence inside the frame — "the lamp is out of frame camera-left; the shadow of his nose falls across his camera-right cheek, and the camera-right side of his face is nearly black." The consequence is what the model can actually draw; the source alone is an instruction it can ignore.

When a shot's key has flipped, in order of cost:

1. Restate direction with a visible consequence — which cheek is lit (named camera-left or camera-right, never anatomically), which way the nose shadow falls, which wall carries the shadow. Re-roll. Cheapest and usually sufficient.
2. Mirror the source image (image-to-video only). Instant, but check for text, signage, hair partings, scars, watches, wedding rings, and which hand the character uses. Any of those makes the mirror unusable.
3. Fix the light in the keyframe rather than the motion prompt, then feed it to the first-frame slot where the tool exposes one. The motion prompt inherits the light instead of arguing with it.
4. Accept the flip and flip the whole scene. Only viable early, and only after re-checking screen direction across every shot.

Flicker deserves its own rule. Prompts containing "flicker", "flashing", "pulsing" typically produce whole-frame exposure pumping rather than a local source flicker. Localize it: "the candle flame wavers and the light on the wall behind her moves slightly; overall exposure stays constant."

## Worked example: the doorway scene

The control scene the director style modules and [genre-playbooks.md](genre-playbooks.md) share, lit end to end: *a person stands at a closed apartment door holding something they intend to give away, hesitates, and leaves without knocking.*

| Decision | Choice | Why this and not the neighbour |
|---|---|---|
| Time window | Night-for-night, no daylight anywhere in frame | Daylight would make the visit an errand; she does not want to be seen doing this |
| Motivation | One caged bulkhead lamp high on the stairwell wall behind her, plus a warm tungsten strip leaking under the door | Two sources with opposed color and opposed meaning: the corridor she is in, and the room she will not enter |
| Ratio | About 6:1 at the door (two and a half stops), opening to 3:1 as she turns to leave | She is withholding, then stops. The ratio move is the beat |
| Direction | Key three-quarter back from camera-right; the door face itself throws nothing | Her face stays mostly shadow while she faces the door and only fills in on the turn |
| Quality and falloff | Small caged source, hard, steep — the stairwell behind her goes black inside two metres | She needs somewhere to disappear to, and the falloff supplies it |
| Grade | Crushed blacks, fine grain. Nothing else | Two descriptors, per the stacking rule above |

Scene lighting invariant, pasted verbatim into every prompt in the scene:

```text
Lighting: single caged bulkhead lamp high on the stairwell wall, three-quarter back from
camera-right, small and hard, cool green-white, shadow side about two and a half stops under,
plus a thin warm tungsten strip spilling under the door onto the concrete. No fill.
Stairwell falls to black within two metres.
```

Shot 2 — MCU, her face at the door — is the invariant plus one visible consequence, because the lamp is out of frame here:

```text
Medium close-up. A woman faces a closed apartment door, a brown paper parcel held against her
chest. Lighting: single caged bulkhead lamp high on the stairwell wall, three-quarter back
from camera-right, small and hard, cool green-white, shadow side about two and a half stops
under, plus a thin warm tungsten strip spilling under the door onto the concrete. No fill.
Stairwell falls to black within two metres. The lamp is out of frame: a hard edge of light
runs down her camera-right cheekbone and jaw, the camera-left half of her face holds no
detail, the wire cage throws a faint grid shadow on the wall beside her, and the warm strip
lights only the toes of her shoes. She does not knock. Crushed blacks, fine grain.
```

The reverse — camera behind her shoulder, looking at the door — is where this scene would normally break. That same lamp is now behind and to the left of camera, so it is no longer a back light at all: it becomes a near-frontal key from camera-left, the back of her coat and the door face carry it, and her body throws a hard shadow across the door toward camera-right. Only the camera-relative half of the clause is rewritten; the height, size, color and stop difference are untouched. The world-anchored fact — "the lamp is on the stairwell wall opposite the door, above head height" — is stored once in the [continuity bible](continuity-bible.md), and every shot's camera-relative phrasing is derived from it rather than remembered.

## Before and after

Each pair isolates exactly one decision. The rest of the prompt is held constant on purpose.

Ratio and key direction on a close-up:

```text
BEFORE: Close-up of the woman, tense, dramatic lighting, she looks up slowly.
AFTER: Close-up. The window is out of frame camera-right; hard daylight strikes the
camera-right side of her face and the camera-left side sits about three stops under, holding
only the edge of her cheek. No fill. She looks up slowly into the light. Background dark and
unlit.
```

Night exterior:

```text
BEFORE: Moody night street, cinematic atmosphere, he walks toward camera in the rain.
AFTER: Night street, night-for-night. Low-pressure sodium street lamps every thirty metres,
monochrome amber pools with black gaps between them. No ambient fill. He walks toward camera,
passing through three pools; his face brightens and goes black three times. Wet asphalt holds
the amber reflections.
```

Grading restraint:

```text
BEFORE: Bleach bypass, heavy grain, halation, crushed blacks, cross-process, teal and orange
grade, film emulation, an interrogation room.
AFTER: Interrogation room. Single fluorescent fixture directly overhead, fluorescent
green-white, near-shadowless, eye sockets dark. Fine grain, crushed blacks. No other grade.
```
