> 来源: DirectorSKILL-full (MIT)

# Prompt Lexicon

Load this file when you are writing the actual words of a keyframe or video prompt — pipeline Steps 8 and 10, output Modes E and F — or when a generation failed and you suspect the wording rather than the plan. For shot grammar itself see [cinematic-language.md](cinematic-language.md); for symptom-to-fix triage see [failure-modes.md](failure-modes.md); for per-tool control surfaces and the canonical prompt-shape templates see [ai-video-tool-adapters.md](ai-video-tool-adapters.md). This file owns words; that file owns shapes.

## Thesis

1. A generative model renders what a camera could photograph. It cannot photograph intention, emotion, or quality.
2. "Struggles", "realizes", "is sad" carry zero pixel information; the model either ignores them or invents a cliché.
3. "Cinematic", "dramatic", "8K", "masterpiece" reliably return a generic, over-lit, over-graded average. Whatever they do internally, what comes back is the middle of everything that gets labelled that way, and the middle is mush.
4. Every abstraction in your head must be converted into a body part, a direction, a magnitude, and a duration before it enters the prompt.
5. If you cannot name what moves, you do not yet have a shot — you have a mood.

### The conversion procedure

Run this on every abstract word before it reaches the prompt. Five steps, in order.

1. Name the abstraction out loud ("she hesitates").
2. Ask: if a camera sat 1 m away with no sound, what would the frame record in 3 seconds?
3. Pick exactly one body part or object that changes state. One. Not the face and the hands and the shoulders.
4. Give it a verb, a direction, and a magnitude ("the raised hand lowers to her side, about 30 cm, over two beats").
5. Delete the abstraction. Do not keep it "for context" — it competes with the description you just wrote.

Test: read the finished line to someone who has not read the script. If they can act it out, the model can render it. If they ask "how?", you are still writing intention.

## Verb banks

Use these as the raw material for Step 4 of the conversion procedure. Every verb here changes pixels.

### Locomotion

walks, strides, paces, shuffles, limps, staggers, stumbles, jogs, sprints, halts mid-stride, pivots on the ball of the foot, backs away, sidesteps, edges forward, crouches, kneels, rises, climbs, descends, wades, crawls, skids to a stop, plants both feet, drifts to a stop.

### Hand and arm

reaches, grips, clenches, unclenches, flexes the fingers, drums the fingers, taps twice, wipes, brushes off, presses the palm flat, pushes, pulls, lifts, sets down, drops, fumbles, turns it over, twists, wrings, points, beckons, folds the arms, lets the arm hang, tightens the grip until the knuckles pale, releases.

### Head and gaze

turns the head, tilts the head, lowers the head, lifts the chin, glances, scans left to right, tracks a moving object, locks eyes, looks away, looks down at the hands, looks past the lens, blinks, blinks hard, squints, widens the eyes, closes the eyes, holds the gaze, flicks the eyes left then back, nods once, shakes the head slowly.

### Torso and posture

straightens, slumps, leans in, leans back, rocks, sways, twists at the waist, hunches, squares the shoulders, drops the shoulders, shifts weight to the other hip, braces a hand against the doorframe, settles, sags, stiffens, arches the back, curls forward over the knees.

### Facial micro-movement

the jaw tightens, the jaw drops slightly, the lips press together, the lips part, one corner of the mouth lifts, the mouth twitches, the nostrils flare, the brow furrows, the brow lifts, the eyelids flutter, the eye twitches, a cheek muscle jumps, swallows, the throat moves, tears well at the lower lid, a tear breaks and runs, the chin dimples, the tongue wets the lower lip.

### Object interaction

picks up, sets down, slides it across, hands it over, snatches, catches, throws, unfolds, folds, opens, closes, unwraps, tears, pours, stirs, spills, balances it on the edge, pockets it, extends it toward the other person, withdraws it, turns the key, presses the button, wipes the surface clear.

### Fall and impact

the knee buckles, the knee gives, collapses, drops to both knees, topples, pitches forward, slams into the wall, glances off, bounces once, skids, lands flat, sprawls, rolls onto the back, slumps against the wall, slides down the wall to the floor, crumples, catches themself on one hand.

### Breath

inhales sharply, exhales slowly, the chest rises, the chest falls, the shoulders lift with the breath, the breath fogs, the breath shudders, holds the breath, gasps, pants, the breathing slows and evens, mist leaves the mouth in one plume.

### Garment and hair

the hem lifts, the coat flares, the sleeve slides back, the fabric ripples, the cloth snaps in the wind, the collar flutters, the scarf trails, the hair lifts, a strand falls across the face, wet hair sticks to the cheek, the hair whips sideways, the skirt sways with each step, the shoulder seam pulls taut, the fabric darkens as it soaks, water beads and runs off the oilcloth, dust puffs out of the cloth.

### Environmental

One dominant element per shot. Add a second only when the first physically causes it — mist and the shafts it makes visible, wind and the hem it lifts. Three unrelated elements average into general shimmer and none of them reads. Pick the row that matches your set.

| Element | Verbs that render |
|---|---|
| Rain | pelts, streaks down the glass, sheets across, spatters, beads, runs, drips off the brim, pools, dimples the puddle, ricochets off the stone, drums on the tin, rolls off the coat |
| Smoke | curls, coils, drifts, plumes, rolls along the floor, thins, banks against the wall, seeps under the door, billows, hangs, disperses, feathers apart |
| Dust | drifts, hangs, swirls, settles, puffs up underfoot, motes turn inside the light shaft, kicks up, sifts down from the beam, streams off the ledge |
| Water | ripples, laps, swells, surges, churns, spills, sluices, trickles, sheets off the roof, breaks, eddies, glasses over as it stills |
| Fire | flickers, gutters, licks up the log, leaps, sputters, throws visible sparks, embers rise, the flame bends in the draught, the coals pulse, the flame ducks and recovers |
| Foliage | sways, shivers, rustles, bends, tosses, drops a leaf, branches dip, the grass lays over in a gust, the canopy shifts |
| Fabric (set) | billows, snaps, sags, flutters, lifts and settles, drapes, twists on the line |
| Liquid (vessel) | swirls, sloshes, settles, films the glass, beads on the rim, a skin forms on the surface, steam curls off |
| Light change | brightens, dims, sweeps across the wall, rakes, flares, stutters, a shadow crosses, a bar of light travels the floor, headlights sweep through, a cloud passes and the key drops |
| Crowd | parts, closes, surges, drifts past, stalls, turns as one, a body crosses the foreground, heads turn in sequence, the queue shuffles forward one place |

## The replacement table

Left column: do not put these in a prompt. Right column: what to write instead. Choose the physical line that matches your beat — these are examples of the right shape, not fixed substitutions.

| Low-yield word or phrase | Observable behaviour that replaces it |
|---|---|
| struggles | the knee gives; the hand slips off the wet ledge; he catches himself on his forearm and stops moving |
| realizes | the eyes stop scanning and fix on one point; the hand holding the cup lowers to the table |
| feels | delete the word entirely and name the body part that changes state |
| is scared | the shoulders lift and stay lifted; the breathing goes shallow and fast; she does not blink |
| is sad | the head lowers about fifteen degrees; the mouth stays closed; a tear breaks at the lower lid and runs |
| is angry | the jaw sets; the fist closes at the side until the knuckles pale; he does not raise his voice or move |
| hesitates | the raised hand stops 5 cm from the door and lowers back to the side without touching it |
| contemplates | the gaze holds on one object for the whole shot while the fingers turn a small object over twice |
| becomes emotional | the throat moves once on a swallow; the lower lid fills; the face otherwise stays still |
| experiences | delete; name the event and the reaction to it separately |
| reacts | name the specific reaction verb: flinches, steps back, freezes mid-reach, turns the head toward the sound |
| moves dramatically | one move only, with speed and direction: steps forward once and stops squarely in front of him |
| gracefully | the motion is continuous with no pause, and decelerates to a stop rather than snapping |
| powerfully | the whole body commits: the rear foot plants, the hip turns, the shoulder drives forward |
| beautifully | delete; describe the light source and the material it lands on |
| cinematic | name the lens, the frame, and the light: 40mm-equivalent, eye level, single hard source from camera-left |
| dramatic | name the contrast: the face is lit on one side only, the other side falls to black |
| epic | name the scale referent: the figure occupies one-twelfth of frame height against the wall behind |
| masterpiece | delete; it maps to nothing photographable |
| high quality | delete; if the format matters, name the format: shot on 35mm film, visible grain, shallow focus wide open |
| 8K | delete; resolution is a render setting, not a prompt token |
| ultra-detailed | name the detail you actually want visible: pores and stubble on the jaw; the weave of the coat |
| atmospheric | name the airborne medium: mist between the trunks; smoke hanging at chest height; dust in the shaft |
| moody | name the source and the ratio: a single practical camera-right, roughly 8:1 lit side to shadow side on the face, everything beyond 2 m falls off to black |
| stunning | delete; nothing in the frame changes because of this word |
| intense | name the pressure: the framing tightens; neither figure moves; the gap between them is 40 cm |
| mysterious | name what is hidden: the face stays in shadow below the brow; the figure never turns fully to camera |
| ethereal | name the physics: backlight through mist; the edges of the hair glow and the body reads as silhouette |
| professional / award-winning | delete; both are metadata words with no image referent |
| hyper-realistic | name the material and the light behaviour: skin with visible pores under soft north light |
| perfect anatomy | delete from the positive prompt; handle it in negatives and by cropping hands out of frame |
| detailed face | frame closer instead; a tighter shot size buys more face detail than any adjective |
| tension builds | the framing tightens on the same subject across the shot — one named move, e.g. a slow push-in — while nobody moves |
| the mood shifts | name the change: the practical behind her switches off and the fill drops to the window only |
| she is nervous | she taps the ring against the table twice, stops, and puts the hand under the table |
| he is exhausted | he leans both forearms on the counter and lets his head hang between his shoulders |
| chaos ensues | name three specific simultaneous events, or split into three shots — chaos does not render |
| dynamic / energetic | give the camera one move with a speed word, and the subject one action with a direction |
| somber | slow every listed motion down and remove all secondary motion from the frame |

## Camera vocabulary

Terminology and story function live in [cinematic-language.md](cinematic-language.md). This section only fixes the wording so a model executes what you meant.

### Canonical moves and unambiguous phrasing

Many models collapse a dolly-in and a zoom-in into the same operation — a centre crop. The two are not the same operation. Perspective is set by camera distance alone: a dolly changes the size relationship between near and far because the camera moves; a zoom changes only how much of the same view you see, so every object magnifies by the same factor and the near/far relationship is untouched. That difference is the difference between "we approach her" and "we look harder at her". Say what changes in the geometry, not just the name of the move.

| Move | What physically changes | Write this | Do not write |
|---|---|---|---|
| Dolly in / push-in（推镜） | Camera translates forward; near objects grow faster than far ones; the background spreads outward past the frame edges | "the camera moves forward through the space toward her; she grows faster than the wall behind her, which spreads out past the frame edges; the focal length does not change" | "zoom in", "push closer" |
| Dolly out / pull-back（拉镜） | Camera translates back; more set enters frame at the edges; near objects shrink faster than far ones | "the camera moves backward, revealing more of the room at the frame edges; focal length unchanged" | "zoom out" |
| Zoom in | Focal length increases; the view narrows; everything magnifies equally and the camera does not move | "the camera stays put and the lens zooms in; every object in frame magnifies by the same amount, so her size relative to the background does not change" | "camera moves in" |
| Truck / crab（横移） | Camera translates laterally; near and far objects shift at different rates | "the camera slides left along a line parallel to the wall; foreground posts pass faster than the far wall" | "pan left" |
| Pan（摇镜） | Camera rotates on a fixed vertical axis; no parallax | "the camera stays in place and rotates left" | "moves left" |
| Tilt（上下摇） | Camera rotates on a fixed horizontal axis | "the camera stays in place and rotates upward from her hands to her face" | "camera goes up" |
| Pedestal（升降） | Camera body rises or lowers, angle unchanged | "the camera rises straight up about one metre, staying level" | "tilt up" |
| Orbit / arc（环绕） | Camera travels around the subject; background sweeps, subject stays framed | "the camera circles her clockwise about 30 degrees while keeping her centered; the background sweeps behind her" | "rotate the camera" |
| Crane / boom（摇臂 / 升降臂） | Large vertical translation with reframe | "the camera booms up and back, ending looking down on the courtyard" | "drone shot" unless you want a drone look |
| Handheld follow（手持跟拍） | A follow move plus continuous low-amplitude positional noise | "handheld, level with his shoulders, drifting right with him; small natural instability, no whips" | "shaky cam" |
| Static / locked（固定镜头） | Nothing | "the camera is locked on a tripod and does not move" | leaving camera unspecified |
| Rack focus（移焦） | Focal plane moves; framing unchanged | "focus shifts from the glass in the foreground to her face behind it; the framing does not change" | "focus on her" |
| Dolly zoom（滑动变焦） | Dolly and counter-zoom together; background scale inverts | "the camera moves forward while the lens zooms out at the same rate, so she stays the same size and the background stretches away" | "vertigo effect" |
| Whip pan（甩镜） | Very fast rotation, motion blur | "a fast whip pan right, blurring through, settling on the doorway" | "quick pan" |

### Speed qualifiers

These are relative, not calibrated. The property you can lean on is ordering: within one tool and one sequence, "very slow" generally renders as less movement than "slow", and "slow" as less than "fast". Use them comparatively across a shot list, never as units. The percentages below are the intent you are aiming at on a roughly 5-second clip — your director's shorthand, not a promise about any model:

| Term | Practical intent | Frame change over 5 s |
|---|---|---|
| almost imperceptible | pressure the audience should not consciously notice | under 5% |
| very slow | dread, realization, held tension | 5-10% |
| slow | the standard narrative push | 10-20% |
| steady / even | movement that reads as deliberate | 20-35% |
| brisk | urgency without chaos | 35-50% |
| fast | pursuit, impact, panic | 50%+ |

Above "brisk", faces and hands commonly degrade — motion blur and interpolation cost fall hardest on small, high-detail, fast-moving regions. If the shot needs speed and a recognizable face, split it: one fast clip on the body, one slower clip on the face, and cut between them.

### The one-dominant-move rule

One camera move per generated clip. Two moves means the model picks a blend of both, or oscillates, and the clip reads as drift. Enforce it in the prompt by naming the one move and forbidding the rest by name:

```text
Camera: one move only — a slow dolly in along the lens axis. The camera does not pan, tilt, zoom, orbit, roll, or shake.
```

A camera forbid-list is the one safe exception to the summoning risk described under negatives below: "does not pan" names an operation, not an object, so there is no noun for the model to instantiate. Do not extend the trick to things — "no red umbrella" behaves differently from "does not pan".

If the tool exposes a numeric camera-motion strength or a camera-path widget, set the move there and delete all camera words from the text prompt — a text description competing with a UI control is a common source of unwanted drift. See [ai-video-tool-adapters.md](ai-video-tool-adapters.md).

## Material, light and texture vocabulary

A material word does more work than a style word because it constrains reflectance, roughness, and how light behaves on the surface, and those constraints show up in the output. "Cinematic" comes back as an average; "wet asphalt" comes back with a specific specular response. Material words also smuggle in era, class, weather, and wealth for free: "waxed cotton" says period, outdoor, and money without a single adjective.

| Family | Phrases that survive generation |
|---|---|
| Wet and weather | wet asphalt, rain-slicked cobblestone, standing water on concrete, damp plaster, water-darkened timber, salt-crusted stone, frost on the pane, mud churned to slick |
| Fabric | rough-woven hemp, waxed cotton, coarse linen, raw silk, worn corduroy, felted wool, starched cotton, oiled canvas, threadbare velvet, unbleached muslin |
| Metal | patinated brass, cold-rolled steel, pitted iron, tarnished silver, brushed aluminium, blued gunmetal, hammered copper, galvanised sheet |
| Glass and ceramic | hazed glass, wired safety glass, chipped enamel, crazed glaze, frosted pane, smoked glass, unglazed terracotta |
| Wood, stone, earth | split oak, lacquered rosewood, sun-bleached pine, limewashed brick, rough granite, packed earth, cracked screed |
| Skin and hair | wind-chapped cheeks, oiled hair, sweat-flattened hair, sunburnt forearms, powdered face, stubble catching the sidelight, wet hair stuck to the temple |
| Air and atmosphere | mist between the trunks, smoke hanging at chest height, dust in the light shaft, heat shimmer off the road, steam off the pot, cold breath in the air |

Light itself is a material problem. Name the source and the surface it lands on, never the mood: "a single gas-mantle lamp behind him throws a hard rim on his wet shoulders" beats "moody backlight". Full lighting design lives in [lighting-and-color.md](lighting-and-color.md).

The families above are deliberately generic, which also makes them culturally neutral to a fault. A setting that is specific to a place and a period needs its own nouns; those are in the next section.

## Culturally specific noun banks

### Why a noun and not an adjective

"民国风", "period accurate", "old Shanghai vibe" and "traditional" are labels for a research task, not descriptions. The model cannot resolve them, so it falls back on its default dressing for the location type — which is contemporary — and you get a 1930s costume in a room with a flush ceiling panel and a lever door handle. That is cause 1 of F8 in [failure-modes.md](failure-modes.md).

A culturally specific noun arrives already resolved. 石库门 fixes a stone lintel, a pair of black-lacquered doors, a brass ring, a courtyard and a grey brick, all at once. 阴丹士林蓝布 fixes a dye, a weave, a fade pattern and a social class. 煤油灯 fixes a colour temperature, a fall-off, a flicker and a soot line on the glass. Three named objects lock an era harder than any adjective, and they do it in the *positive* prompt, where naming things is safe — the negative list can only say what is absent, and the category negatives people reach for instead ("no modern objects") are unresolvable, which is F8's third cause.

Two working rules. Lead with a light source: lighting technology dates a frame faster than costume does, and it is the element models most reliably default to the present day. And name the material as well as the object — the same cut in 香云纱 and in 呢子 reads as a southern summer and a northern winter, and as two different kinds of money.

On language: where the tool takes Chinese, send the 中文 term. Where it is English-first, send the English gloss plus one material rather than the transliteration, because "shikumen" alone is not reliably resolved while "stone-gate lane house doorway, black-lacquered timber doors, brass ring knocker" is. Which language a given tool wants is a per-tool decision — see [ai-video-tool-adapters.md](ai-video-tool-adapters.md).

### 民国 / 1930s China, urban

Shanghai-weighted, because the skill's running example and its F8 worked example both live there. Everything below is a thing you can point at.

| Family | 中文 nouns and materials | English gloss for an English-first tool |
|---|---|---|
| 服装 costume | 长衫、马褂、高领贴身旗袍（开衩及膝）、中山装（立领四贴袋）、学生装、对襟短褂、盘扣、绑腿、千层底布鞋、皮鞋、礼帽、瓜皮帽、学生帽、邮差帽、圆框眼镜、铜纽扣、帆布邮包 | ankle-length men's gown; short riding jacket; high-collar close-cut cheongsam slit to the knee; stand-collar four-pocket tunic; frog-button closures; cloth puttees; layered cloth-soled shoes; felt homburg; round wire spectacles; canvas mail satchel |
| 面料 fabric | 阴丹士林蓝布、香云纱、竹布、洋纱、毛哔叽、呢子、粗棉、土布、绸缎 | indanthrene-blue cotton; lacquered gambiered silk gauze, stiff and near-black; wool serge; heavy woollen coating; coarse handloom cotton |
| 建筑 architecture | 石库门、门楣石雕、乌漆大门、铜门环、弄堂、里弄、过街楼、天井、亭子间、老虎窗、骑楼、洋行大楼、青砖、红砖、灰泥墙、板壁、木楼梯、水磨石、马赛克地砖、百叶窗、木格窗、铸铁栏杆、竹脚手架 | stone-gate lane house with a carved lintel and black-lacquered double doors; narrow lane; archway room spanning the lane; courtyard well; dormer window; arcaded shophouse; grey brick; plank partition; terrazzo floor; louvred shutters; bamboo scaffolding |
| 器物 objects | 搪瓷缸、搪瓷面盆、竹壳热水瓶、铜脸盆、藤椅、八仙桌、太师椅、留声机、木壳收音机、拨盘电话、电报纸、钢笔、毛笔、砚台、墨水瓶、火漆、糨糊、邮票、月份牌、铁皮箱、樟木箱、藤箱、算盘、账本、火柴盒、香烟铁盒、铜脚炉 | enamel mug and washbasin; wicker-cased vacuum flask; rattan chair; square hardwood table; wind-up gramophone; wooden-cased valve radio; dial telephone; telegram form; sealing wax; calendar poster; camphor trunk; abacus; paper matchbox; tin cigarette case |
| 光源 light sources | 煤油灯、汽灯、蜡烛、钨丝灯泡（裸露）、绿玻璃罩台灯、珐琅灯罩、煤气路灯、弧光灯、纸灯笼、走马灯、霓虹灯管、手电筒 | kerosene lamp; pressure gas-mantle lamp; bare tungsten filament bulb; green glass desk shade; enamel cone shade; gas streetlamp; paper lantern; neon tube — correct for a 1930s Shanghai street and worth naming, since it reads modern and is not |
| 交通 transport | 黄包车、人力车、独轮车、板车、马车、有轨电车（木质车厢、集电杆）、老式轿车（直立式水箱格栅、辐条轮、踏板、外挂备胎、圆形大灯）、黑色重型自行车（后座货架）、舢板、拖轮、趸船 | rickshaw; handcart; wooden-bodied tram with a trolley pole; pre-war saloon car with an upright radiator grille, spoked wheels, running boards and a spare on the flank; heavy black bicycle with a rear rack; sampan; river tug |
| 街道 street | 弹格路、石板路、无划线路面、手写竖式木招牌、布幌子、手绘广告墙、木电线杆、瓷绝缘子、明线、绿色邮筒、铸铁井盖、晾衣竹竿、摊贩担子、蒸笼、铜壶、报童、墙上标语 | stone sett paving; unmarked roadway; hand-lettered vertical wooden shop signs; cloth banner sign; hand-painted wall advertisement; wooden power poles with ceramic insulators and exposed wiring; green pillar postbox; bamboo laundry poles strung across the lane; shoulder-pole vendor with stacked steamer baskets |

Never, for this era: 荧光灯 / 日光灯管, LED, 冷白光, 模压塑料, 尼龙, 铝合金型材, 印刷或背光招牌, 沥青划线路面, 塑胶鞋底. Two things worth not banning by reflex: 电木（胶木）is period-correct for switches, telephones and radio cases, and so are wristwatches and eyeglasses. Name the instance, not the category — see the F8 entry in [failure-modes.md](failure-modes.md).

### Contemporary Chinese urban

The other half of the same problem: a present-day mainland setting written in generic international nouns comes back looking like a stock photograph of nowhere.

| Setting | 中文 nouns and materials | English gloss for an English-first tool |
|---|---|---|
| 小区 residential compound | 单元楼、板楼、塔楼、防盗门、猫眼、门禁刷卡、楼道声控灯、阳台防盗窗、晾衣杆、空调外机、雨棚、瓷砖外墙、塑钢窗、水泥台阶、快递柜、电动车棚、充电桩、共享单车、道闸、岗亭、减速带、电表箱、燃气表、楼道小广告 | steel security door with a peephole; card-reader gate; sound-activated stairwell light that comes on with a footstep; balcony window cage; drying poles; outdoor AC units stacked on the façade; tiled exterior wall; uPVC windows; parcel locker bank; e-bike charging shelter; barrier gate and guard box; flyers pasted in the stairwell |
| 城中村 urban village | 握手楼、一线天、缠绕的电线束、卫星锅、卷帘门、瓷砖贴面、裸露红砖、自建水泥房、铁艺防盗网、晾衣绳、红色塑料凳、塑料水桶、泡沫箱种菜、手写"房屋出租"招牌、喷漆电话号码、排水明沟、积水、苔藓、小卖部、麻将桌、堆放的电动车 | handshake buildings almost touching, a sliver of sky between them; tangled overhead cable bundles; satellite dishes; roller shutters; self-built concrete blocks in tile and bare red brick; welded window bars; red plastic stools; vegetables grown in polystyrene boxes; hand-written "room to let" board with a phone number sprayed on the wall; open drainage channel |
| 夜市 night market | 折叠桌、红色塑料凳、铁皮推车、改装三轮摊车、遮阳伞、蓝色防水篷布、液化气罐、铁炒锅、炭炉、铁签、铁网烤架、塑料筐、泡沫箱、冰块、一次性塑料袋、LED灯条、白炽灯泡串、应急灯、泡沫板手写价目牌、红色横幅、收款二维码立牌、油烟、蒸汽、地面油渍 | folding tables and red plastic stools; converted three-wheeler food carts; blue tarpaulin awning; LPG cylinder; carbon-steel wok on a roaring burner; charcoal grill and metal skewers; polystyrene coolers; LED strip lighting and strung bare bulbs; hand-written price board on foam sheet; QR payment stand on every table; oil haze and steam over a wet greasy floor |
| 地铁 metro | 闸机、安检机、屏蔽门、不锈钢扶手、吊环拉手、塑料座椅、线路图贴纸、LED报站屏、站台黄色警戒线、导盲砖、瓷砖墙面、铝扣板天花、灯箱广告、自动扶梯、防滑地砖 | ticket gates and a bag scanner; platform screen doors; stainless grab rails and hanging loop straps; moulded plastic bench seats; route-map decal; scrolling LED station display; yellow platform edge line; tactile paving; tiled walls under an aluminium slat ceiling; backlit ad boxes |
| 便利店 convenience store | 玻璃自动门、促销海报、立式冷藏柜、关东煮锅、蒸包柜、咖啡机、微波炉、钢制货架、电子价签、促销吊旗、收银台、扫码枪、收款二维码、塑料袋卷、小票打印机、LED平板灯、白色亚光地砖 | automatic glass door plastered with promo posters; upright glass-door chillers; oden pot and steamer cabinet on the counter; steel shelving with electronic shelf labels; hanging promo flags; scanner and receipt printer; flat LED ceiling panels throwing an even cool light onto matte white floor tile |

Use three or four of these per prompt, not fifteen. The token economy rules below still apply, and a noun bank is a place to choose from, not a list to paste.

## Time, pace and duration

Do not write to a clock. Words that put events in an order, or that name a state the clip should end in, come back honoured far more often than words that name seconds. The Reliability column below ranks phrasings against each other from repeated use; it is a working order of preference, not a measurement, and any tool with real timestamp syntax overrides it.

| Phrase | What it does | Reliability |
|---|---|---|
| "the motion decelerates to a stop" | defines an end state the model can converge on | high |
| "one continuous action, no repeats" | suppresses looping and re-triggering | medium-high |
| "over the full length of the shot" | spreads a single change across the clip | medium-high |
| "in the last moment" / "at the very end" | back-loads the change | medium |
| "holds still for a beat, then" | inserts a pause before the action | medium |
| "most of the change happens in the second half" | biases the distribution | medium |
| "for two seconds" / "at 00:03" | asks the model to count | low, unless the tool has explicit timestamp syntax |
| "quickly but not rushed" | contradicts itself; the model averages to nothing | none |

The reliable trick is to express duration through the completeness of a physical action rather than through numbers. "The door swings from fully closed to fully open and stops against the wall" fixes the duration better than "over 4 seconds", because the model can see both endpoints. Choose actions whose start and end states are both visible in-frame, then let the clip length do the timing. Multi-shot and timestamped syntaxes are the exception — see [ai-video-tool-adapters.md](ai-video-tool-adapters.md).

## Why slot order changes the result

The four prompt shapes and their full slot lists are owned by [ai-video-tool-adapters.md](ai-video-tool-adapters.md) — S1 motion-only, S2 full description, S3 keyframe pair, S4 multi-shot. Fill the slots from there. This section is only about why the order in those templates is what it is, so you can tell when you are about to break it.

Two things push in the same direction. Many pipelines truncate the prompt at a fixed length, so late clauses can simply be discarded; and in practice, across the tools in common use, early clauses tend to dominate the result more than late ones. Treat that as an empirical regularity to design around, not a mechanism to reason from — and if a tool documents otherwise, follow the tool.

What actually goes wrong when the order slips:

| Mistake | Symptom you will see |
|---|---|
| Style or quality words first | Camera and action get the leftovers — a pretty clip that barely moves |
| End state first | The model tries to start there; frame one drifts off your input image |
| Negatives first | The forbidden nouns take the strongest position, which is the exact inverse of the intent |
| Invariants first | "Same, unchanged, maintain" outrank the action verb and you get a locked still |
| Character re-described inside a later shot | The model recasts them at that boundary |

Three ordering rules that are about wording rather than about any one tool:

- On any shape with an input image (S1, S3), everything the image already fixes — identity, costume, set, light, style — collapses into one short invariant clause. Re-describing it re-renders it, and a re-render is a chance to drift.
- On a keyframe pair (S3), never write anything not derivable from the two frames. If the transition needs an event visible in neither, the gap is too large; build a middle keyframe and make it two clips.
- On multi-shot (S4), repeat each character's permanent visual label in every segment. Pronouns do not survive a shot boundary — "he" in shot 3 resolves to whoever the model rendered most recently, not to whoever you meant.

## Negative-prompt library

Three rules before the lists. First, long negative lists dilute — a thirty-item list spreads whatever suppression the tool applies across thirty targets, and in practice none of them holds. Four to six items that name real risks beat a wall. Second, in tools with no separate negative field, your "no X" is concatenated into the positive prompt, and naming a noun there can summon it: "no red umbrella" produces a red umbrella. In that case express the constraint positively — "the street stays empty" rather than "no people". Third, every item names an **instance, never a category**. "No modern objects" is unresolvable — the model has no way to enumerate the class, so the clause does nothing and you believe you are protected. "No moulded plastic, no printed signage, no fluorescent light" is three things it can actually suppress. This is the mechanism behind F8; see [failure-modes.md](failure-modes.md).

Selection rule: include only the classes whose failure this specific shot actually invites. A locked wide of an empty room does not need identity negatives. A close-up of hands does not need crowd negatives. Two or three classes, roughly 8-14 words total, is the working budget for most shots.

| Failure class | Invite it when | Minimal effective set |
|---|---|---|
| Identity drift | any recurring character; risk rises with clip length | face change, different person, changing hairstyle, costume change |
| Anatomy | hands, fingers, or limbs visible and moving | extra fingers, fused fingers, extra limbs, warped face |
| Motion artifacts | fast motion, high camera-strength settings | jitter, flicker, morphing, stuttering |
| Environment and set | camera moves, or the set has repeatable geometry | scene change, background swap, changing weather, new room |
| Generation artifacts | low-light, fine texture, straight architectural lines | ghosting, duplicated edges, warped straight lines, smearing |
| Era and anachronism | any period or non-contemporary setting | moulded plastic, printed or backlit signage, fluorescent or LED light, nylon fabric, rubber soles |
| Framing and crop | tools that auto-reframe or auto-zoom | zoom, sudden reframe, aspect change, cut to another shot |
| Text and watermark | any tool that has produced captions before | text, subtitles, watermark, logo |
| Extra entities | any shot with a defined headcount | extra people, second figure entering frame, animals |
| Style drift | photoreal targets, or any stylized keyframe | illustration, anime, 3D render, plastic skin |

Which era instances to name is a per-period question, and getting it wrong costs you a real object: a wristwatch and eyeglasses belong in a 1930s frame, while moulded plastic frames and a digital display do not. Choose them from the era's own noun bank above, and check each item is genuinely anachronistic before it goes on the list.

Worked selection: a period-drama close-up of a man's face in rain, from a keyframe. Real risks are identity drift (close-up, recurring character), era (period), and text. Negatives: `face change, costume change, moulded plastic, printed signage, watermark`. Five items. The tempting sixth is "modern objects", and it is worth nothing — it names a category, so it suppresses nothing while making the list feel complete. Anatomy, crowd, and style negatives are omitted because nothing in this shot invites them.

## Token economy

When the prompt is too long, cut in this order. Stop as soon as it fits. Working budgets: 40-80 words for image-to-video, 60-120 for text-to-video.

1. Style and quality adjectives. Zero yield, and they compete with the tokens that matter.
2. Anything the input image already shows — identity, costume, set dressing, lighting, style. Keep exactly one short invariant clause.
3. Secondary environmental motion beyond the single chosen element.
4. Negatives beyond the top-risk class, per the selection rule above.
5. Camera detail beyond one named move plus one speed word. Delete the forbid-list last within this item; it earns its tokens.
6. Compound sentence structure. Convert to short declaratives; subordinate clauses dilute the verbs inside them.
7. Emotional framing of the action ("as if he had just remembered"). Useful, but the physical description must survive it.

Never cut: the primary action verb, its direction, and the end state. A prompt without an end state produces drift; a prompt without a primary action produces a still.

Worked cut. An image-to-video prompt at 128 words, well over budget:

```text
Beautiful cinematic shot of a young woman with long dark hair in a red wool coat standing on a wet railway platform at dusk, atmospheric and moody, 8K, highly detailed. She waits nervously as rain falls around her and steam drifts along the platform and the departure board flickers overhead and pigeons move near the bench. The camera slowly pushes in toward her while also drifting slightly to the left, then holds. She turns her head to look down the track, as if she had been waiting a long time, and her expression changes. Same face, same red coat, same platform, same lighting, same time of day. No extra people, no text, no watermark, no logo, no distortion, no morphing, no blur, no jitter, no anime, no cartoon.
```

Same shot at 67 words, cut in the order above:

```text
The camera pushes in slowly along the lens axis; it does not pan, tilt, zoom, or drift. She stands still on the platform, hands in her coat pockets. She turns her head left to look down the track and holds there. Rain streaks past the platform lamp behind her. End with her head turned and her body unmoved. Same face, same coat. No face change, no text.
```

What went, in order: the style block and "8K" (item 1); hair, coat colour, location, dusk, and the five-clause invariant list, all already in the still (item 2); steam, the board, and the pigeons, leaving rain as the one element (item 3); seven of nine negatives (item 4); the second camera move (item 5); the "and… and… and…" chain, rewritten as short declaratives (item 6); "as if she had been waiting" (item 7). What survived: turns the head, left, and holds — verb, direction, end state.

## EN to 中文 craft terms

For Chinese-UI tools, write native Chinese prompts rather than translating word by word. These are the standard trade terms; the editing and composition rows are translations only — the craft behind them lives in [editing-and-assembly.md](editing-and-assembly.md), [cinematic-language.md](cinematic-language.md) and [blocking-and-staging.md](blocking-and-staging.md). Mainland 景别 convention throughout: 近景 is a medium close-up, 特写 a close-up, 大特写 an extreme close-up. Where a row lists two terms, the first is the one to send; the second is there so you recognise it in someone else's notes. For the subject matter of a Chinese-language prompt rather than its craft terms, use the noun banks above.

### 景别 shot sizes

| EN | 中文 |
|---|---|
| extreme wide shot | 大远景 |
| wide shot / long shot | 远景 |
| full shot | 全景 |
| medium long shot | 中全景 / 中远景 |
| medium shot | 中景 |
| medium close-up | 近景 |
| close-up | 特写 |
| extreme close-up | 大特写 |
| two-shot | 双人镜头 |
| insert / detail shot | 插入镜头 / 细节镜头 |

### 机位与角度 angles

| EN | 中文 |
|---|---|
| eye level | 平视 |
| low angle | 仰拍 / 仰角 |
| high angle | 俯拍 / 俯角 |
| overhead / top-down | 顶拍 |
| bird's eye | 鸟瞰 |
| dutch angle | 斜角 / 荷兰角 |
| over-the-shoulder | 过肩镜头 |
| point of view | 主观镜头 |

### 运镜 camera moves

| EN | 中文 |
|---|---|
| static / locked | 固定镜头 |
| dolly in / push-in | 推镜 |
| dolly out / pull-back | 拉镜 |
| pan | 摇镜头 / 横摇（左右摇） |
| tilt | 摇镜头 / 竖摇（上下摇、俯仰摇） |
| truck / crab | 移镜头 / 横移 / 平移 |
| pedestal up-down | 升降（机位垂直升降，角度不变） |
| crane / boom | 摇臂镜头 / 升降镜头（大幅升降并重新构图） |
| orbit / arc | 环移 / 环绕 / 弧形运动 |
| tracking / follow | 跟拍 |
| handheld | 手持 |
| steadicam | 稳定器 / 斯坦尼康 |
| zoom in / out | 变焦推近 / 变焦拉远 |
| rack focus | 移焦 / 焦点转移 |
| whip pan | 甩镜 |
| dolly zoom | 滑动变焦 / 希区柯克变焦 |
| long take | 长镜头 |

Two traps in that table. 长镜头 is a **long take** — a shot of long duration — and never a long lens; the long lens is 长焦镜头, one character apart and a completely different instruction. And 推 / 拉 move the camera while 变焦 changes the focal length, so write 推镜 when you want the body to travel and 变焦推近 when you want the lens to do it; a model given 推近 alone will pick one at random.

### 灯光 lighting

| EN | 中文 |
|---|---|
| key light | 主光 |
| fill light | 辅光 / 补光 |
| backlight | 逆光 |
| rim light | 轮廓光 / 边缘光 |
| practical light | 画内光源 / 实用光（画面内可见的光源） |
| motivated light | 动机光 / 有光源依据的布光 |
| low-key | 低调布光 |
| high-key | 高调布光 |
| hard light | 硬光 |
| soft light | 柔光 |
| sidelight | 侧光 |
| toplight | 顶光 |
| underlight | 底光 / 脚光 |
| silhouette | 剪影 |
| lighting ratio | 光比（受光面：暗面，在脸上量） |
| light shafts | 光束 / 丁达尔光 |
| golden hour | 黄金时刻（日出后或日落前约一小时） |
| blue hour | 蓝调时刻 |
| overcast diffuse | 阴天散射光 |
| flicker | 闪烁光 |

光比 is written lit side : shadow side, measured on the face — the convention and the ranges are owned by [lighting-and-color.md](lighting-and-color.md). Do not send a key-to-fill number under this label; the same face comes back a stop flatter than designed.

### 镜头与构图 lens and composition

| EN | 中文 |
|---|---|
| wide-angle lens | 广角镜头 |
| standard lens | 标准镜头 |
| telephoto lens | 长焦镜头 |
| macro | 微距 |
| shallow depth of field | 浅景深 |
| deep focus | 深焦 / 大景深 |
| bokeh | 散景 / 焦外虚化 |
| lens flare | 镜头眩光 |
| telephoto compression | 长焦空间压缩 |
| negative space | 留白 / 负空间 |
| frame within a frame | 框中框 |
| symmetry | 对称构图 |
| rule of thirds | 三分法构图 / 九宫格构图 |
| leading lines | 引导线 |
| foreground obstruction | 前景遮挡 |
| deep staging | 纵深调度 |
| headroom | 头部空间 |
| lead room / looking room | 视线空间 |
| eyeline | 视线方向 |
| 180-degree rule | 轴线原则（违反即"越轴"） |
| screen direction | 运动方向 / 银幕方向 |
| blocking | 走位 |
| staging | 场面调度 |

### 剪辑 editing

| EN | 中文 |
|---|---|
| hard cut | 直切 / 硬切 |
| match cut | 匹配剪辑 |
| jump cut | 跳切 |
| parallel cut | 平行剪辑（两条线索，不必同时发生） |
| cross-cut | 交叉剪辑（同时发生，趋向汇合） |
| cutaway / empty shot | 空镜头 |
| transition | 转场 |
| dissolve | 叠化 |
| fade in / fade out | 淡入 / 淡出 |
| whip-pan transition | 甩镜转场 |
| J-cut / L-cut | 声音先入 / 声音延续 |
| average shot length | 平均镜头长度 |
| establishing shot | 定场镜头 |
| reaction shot | 反应镜头 |

### 动作 motion verbs

| EN | 中文 |
|---|---|
| slow push-in | 缓慢推近 |
| lifts the head | 抬头 |
| lowers the head | 低头 |
| turns the head | 转头 |
| reaches out | 伸手 |
| clenches the fist | 握拳 |
| exhales, breath fogs | 呼气，呼出白气 |
| steps forward once | 上前一步 |
| staggers | 踉跄 |
| kneels | 跪下 |
| collapses | 瘫倒 |
| blinks | 眨眼 |
| eyes widen | 睁大眼睛 |
| brow furrows | 皱眉 |
| jaw tightens | 下颌收紧 / 咬紧牙关 |
| rain streaks down | 雨水顺着流下 |
| smoke curls upward | 烟雾缓缓升腾 |
| fabric ripples | 布料轻微起伏 |
| hair lifts in the wind | 头发被风吹起 |
| flame flickers | 火苗摇曳 |
| dust motes drift | 尘埃在光束中浮动 |

### A prompt in both languages

The same shot, written twice. Note what the 中文 version is not: it is not the English sentence with the nouns swapped. It uses trade terms (固定中景, 硬光, 逆光), drops the articles and linking verbs English needs, and lands the same content in noticeably fewer characters. Which language to send is a per-tool decision — see [ai-video-tool-adapters.md](ai-video-tool-adapters.md).

```text
EN: Static medium shot, camera at waist height. A man in a waxed cotton overcoat walks left to right across wet cobblestone at an unhurried pace, the coat hem swinging with each step. A single gas-mantle streetlamp behind him throws a hard rim on his shoulders. Rain beads on the coat and runs off. He exits frame right and the empty wet street holds. Same face, same coat, same street. No cars, no printed signage, no text.
```

```text
中文：固定中景，机位齐腰高度。一名身穿蜡棉大衣的男子从左向右走过湿漉漉的石板路，步速不紧不慢，衣摆随步伐摆动。身后一盏煤气路灯作逆光硬光，在他肩上勾出一道亮边。雨水在大衣上结成水珠并滑落。他走出画右，画面留在空荡的湿街上。人物面部、服装、街道保持一致。画面中不出现汽车、印刷招牌、文字。
```

## Before and after

Eight pairs. Each ends with the single change that mattered — not the whole rewrite, the one edit that moved the result.

### Character performance

```text
Before: A woman stands at a door holding a gift, feeling conflicted and emotional. She hesitates, struggles with her decision, then walks away dramatically. Cinematic, moody, 8K.
```

```text
After: Locked medium shot at chest height. She faces the closed apartment door, a brown paper parcel held against her chest in the left hand, the right hand raised near the jamb with the knuckles about 5 cm off the wood. Over two beats the right hand lowers to her side without touching the door. Her chin drops slightly and her jaw sets. She turns her shoulders left and walks out of frame left at a slow, even pace, the parcel still against her chest. End on the closed door and the unmoved handle. Same face, same grey coat, same parcel, same corridor. The door never opens. No text, no watermark, no extra people.
```

The one change: "hesitates" became a raised hand that lowers without ever touching the door.

### Crowd

```text
Before: A busy market, lots of people moving around, lively atmosphere, dramatic energy.
```

```text
After: Static wide shot, camera at chest height. The soup vendor in the foreground keeps ladling at a steady rhythm. Behind him, shoppers drift right to left in a continuous stream; nobody stops and nobody faces the lens. Two figures cross the near foreground and exit frame left. Steam rises off the pot and bends left with the draught of the crowd. End with the vendor still ladling and the stream unbroken. No one looking at camera, no extra vendors, no text.
```

The one change: gave the crowd one direction and anchored the shot to one repeating foreground action.

### Environment

```text
Before: A beautiful misty forest, atmospheric, epic nature scene, stunning light.
```

```text
After: Static wide shot, 35mm-equivalent, camera low near the leaf litter. Mist drifts left to right between the trunks at walking pace. Three shafts of low sun rake through the canopy from the upper right and the drifting mist turns visible inside them. The same drift tips the nearest fern fronds once and they settle. Nothing else moves. End on the same framing with the foreground mist thinner than at the start. No animals, no people, no text.
```

The one change: the mist got a direction and a speed, and the light became a countable number of shafts.

### Product

```text
Before: A luxury watch on a table, cinematic product shot, high quality, elegant, 8K.
```

```text
After: Extreme close-up, static camera, 100mm-equivalent macro, focus on the crown. The watch rests on brushed slate. A single soft source above and camera-left travels slowly right, so the highlight walks across the polished steel bezel; as it passes, the sapphire crystal clears and the second hand is visible sweeping. The leather strap does not move. End with the highlight resting on the crown. No hands, no reflected lighting rig or crew, no text, no logo change.
```

The one change: the light moves instead of the camera — the travelling highlight is the whole shot.

### Period drama

```text
Before: 1930s Shanghai street at night, a man in period clothes walks, very cinematic and dramatic, film noir style.
```

```text
After: Static medium-wide, camera at waist height. A man in a waxed cotton overcoat walks left to right across wet cobblestone at an unhurried pace, hands in pockets, the coat hem swinging with each step. A single gas-mantle streetlamp behind him throws a hard rim on his shoulders, and the shadow it casts ahead of him swings across the wet cobblestone toward camera as he passes under it. Rain beads on the coat and runs off the shoulders. He exits frame right and the empty wet street holds. Same face, same coat, same street. No moulded plastic, no printed or backlit signage, no fluorescent light, no rubber soles, no text, no watermark.
```

The one change: "period clothes, film noir" became two material words — waxed cotton, wet cobblestone — and one named light source. Note also what the negatives became: five nameable instances instead of "no modern objects", and no ban on cars or neon, both of which are period-correct in 1930s Shanghai and would have cost the frame something real. For the local nouns that would tighten this further — 弹格路, 石库门, 阴丹士林蓝布, 煤油灯 — see the noun banks above.

### Action

```text
Before: The fighter attacks powerfully and dramatically, fast intense action, dynamic camera moves everywhere.
```

```text
After: Camera: one move only — a handheld follow level with his shoulders, drifting right with him. It does not pan, zoom, orbit, or whip. He plants his left foot, drives his right shoulder forward, and swings once. The blow lands on the heavy bag; the bag folds around the impact and swings away. Dust jumps off the seams of the bag and hangs in the light. His shoulders drop on the exhale. End with the bag at the top of its swing and his fist already withdrawn. Same face, same hand wraps, same gym. No extra fighters, no speed ramp, no motion smearing.
```

The one change: one strike with a stated impact result, replacing "attacks powerfully".

### Dialogue

```text
Before: Two people argue emotionally in a kitchen, they react to each other, tense dramatic conversation.
```

```text
After: Static medium two-shot, eye level, both faces visible.
WOMAN IN RED APRON, jaw set, quietly: "You said you would tell them."
Her hands do not move.
MAN IN GREY SHIRT, looking at the counter, flatly: "I will."
On the last word his thumb stops rubbing the mug handle. She holds her gaze on him one beat
longer, then turns her head to the window. End with both still, neither looking at the other.
Same faces, same kitchen, same light. No cutaway, no camera move, no third person, no subtitles.
```

The one change: each speaker got a permanent visual label, and each line got one body part that stops moving on it.

### Transition

```text
Before: Transition dramatically from the hospital to the beach, dreamy and emotional, beautiful dissolve.
```

```text
After: Starting from the first image and ending on the second image. The camera holds a slow forward drift throughout. The horizontal slats of the white window blind in the first frame widen and become the parallel white lines of surf running across the second frame's shoreline. Most of the change happens in the second half and settles before the end. Colour temperature stays constant. No cut, no dissolve, no fade to black, no new elements appearing. No text, no watermark.
```

The one change: named the shared graphic element that carries the morph, instead of asking for a mood.
