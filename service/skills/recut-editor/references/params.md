# params 键与默认值（recut.editor）

> `timeline.command { type:"param", payload:{ ref, params } }` 可设置以下键。实现对齐 `ui/src/params/registry.ts` 与 `ui/src/params/defaults.ts`。写入非法键值会被 `timeline.validate` 的 `param-valid` 命中。

## 通用视觉参数（video/image/text/graphic/component）

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `transform.positionX` | number | 0 | 相对画布中心水平位移（px） |
| `transform.positionY` | number | 0 | 相对画布中心垂直位移（px） |
| `transform.positionZ` | number | 0 | 深度（3D 特效层） |
| `transform.scaleX` | number | 1 | 水平缩放倍率 |
| `transform.scaleY` | number | 1 | 垂直缩放倍率 |
| `transform.rotate` | number | 0 | 旋转（度） |
| `opacity` | number | 1 | 0..1 |
| `blendMode` | string | `normal` | 见下方枚举 |

### blendMode 枚举（17 种）
```text
normal multiply screen overlay darken lighten color-dodge color-burn
hard-light soft-light difference exclusion hue saturation color luminosity additive
```

## 音频（audio + video 的源音频）

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `volume` | number | 1 | 0..1 |
| `muted` | boolean | false | 静音 |

## 文字（text 元素）

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `content` | string | `"文本"` | 文本内容 |
| `fontFamily` | string | `"sans-serif"` | 字体 |
| `fontSize` | number | 72 | 字号（px） |
| `color` | string | `"#FFFFFF"` | 文字颜色 |
| `textAlign` | string | `"center"` | left/center/right |
| `fontWeight` | string | `"400"` | 字重 |
| `fontStyle` | string | `"normal"` | normal/italic |
| `textDecoration` | string | `"none"` | none/underline/… |
| `letterSpacing` | number | 0 | 字距 |
| `lineHeight` | number | 1.2 | 行高倍率 |

> 视觉铁律：1080p 主信息 ≥56px、字幕 ≥40px、辅助 ≥32px；字幕无底框、高对比。

## 组件（component 元素）

`inputs` 来自 `component.list` 的 `inputs: ParamDefinition[]`，每个 `{ key, label?, type?, default? }`。建 `type:"component"` 的 clip 时把各 input 的 `default` 展开进 `params`。组件参数同样可打关键帧（`params.<key>` 路径）。

## 效果 / 蒙版

- 效果参数走 `element.get` 读回的 `effects[].params`，经 `element.get` 确认后在 `param` 的 `fields` 或后续 effect 专用 op 中更新。
- 蒙版 9 种：split / cinematic-bars / rectangle / ellipse / heart / diamond / star / text / freeform（含 feather/stroke/invert 参数），见 `ui/src/masks`。
