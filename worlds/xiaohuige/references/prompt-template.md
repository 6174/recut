# 生图提示词模板

每张图单独生成。有角色一致性要求时，必须把 `examples/01-character-sheet.png`（以及涉及配角时的 `11-xiaonuan-grid.png` / `12-corgi-mantu-grid.png`）作为参考图传入，并声明「参考图仅作风格与角色锚点」。

## 单幅情绪漫画（3:4）

```text
Single-panel grayscale doodle comic.

Style anchor (use the referenced character sheet ONLY for character consistency and line style):
Thick uniform black hand-drawn outlines with slight wobble. Flat solid gray background, flat gray fills only (2-3 gray tones). No fur texture, no gradient, no shading, no anime style, no cute-mascot look.

Character required:
小灰, exactly as in the reference: smooth round white-gray head, tired dot eyes, dark oversized hoodie, loose dark pants, white wired earphones.

Theme:
{情绪/认知命题}

Core inner state:
{这张图的核心内心戏：乱线团/反刍/慢慢解开/瞬间清明/被接住…}

Composition:
{具体画面：小灰哥在哪（卧室床上/工作房桌前/深夜街头/末班地铁/公寓地板）、在做什么、思想泡泡里画什么、配角（馒头/小暖）是否出现及角色}

Inner-voice language (mandatory, pick at least one):
Thought bubble showing his inner state / tangled scribble ball = mental noise / scribble gradually untangling into one clean circle = cognitive shift.

Color use:
Entire image grayscale. One tiny warm accent allowed ONLY if the moment is insight/hope/warmth (glowing bulb, one distant lit window). Otherwise fully grayscale.

Constraints:
Caption (optional but recommended for story):
At most ONE short handwritten Chinese caption line (ideally 6-12 characters), placed near the top or bottom edge in small wobbly handwriting, must be exactly this text: 「{中文短句}」. It names the quiet truth of the scene without explaining it.

Constraints:
One image, one emotional beat. Keep the figure and its thought bubble as the clear focal point. No text other than the caption, no labels, no panel borders, no gradient, no texture, not cute-mascot, not anime.
```

## 九宫格参考集（1:1）

```text
3x3 nine-grid reference sheet, flat grayscale doodle comic style (same line language as the referenced character sheet: thick wobbly black outlines, flat gray fills, no fur texture, no gradient, no panel borders, even spacing).

Character: {角色 + 一致性锚定说明}

The 9 cells:
{九个表情/姿态/互动，逐条列出}

Constraints: character identical across all cells, readable at small size, no text, no labels, not cute-mascot, not anime.
```

## 场景图（16:9 全景 / 3:4 单景）

```text
Scene reference, flat grayscale doodle comic style: thick wobbly black outlines, flat gray fills, no gradient, no texture, no architectural-diagram look.

Location:
{场景：两室一厅全景（16:9 开放切面）/ 卧室 / 深夜街头 / 末班地铁}

{角色是否在场景中 + 在做什么}

Constraints: quiet mood, minimal detail but spatially readable, no text, no labels.
```
