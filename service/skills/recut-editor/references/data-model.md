# 数据模型（recut.editor）

> 供 AI 编辑使用的最小数据契约。实现与完整类型以 `apps/editor` 源码为准；本文档与 `ui/src/timeline/types.ts`、`ui/src/project/types.ts` 保持一致。

## 时间单位

- Agent 输入和读取结果统一使用秒；不要在创作判断中自行换算系统时间单位。
- MCP 输入时间一律**秒**（浮点），后台换算 `tick = round(sec * 120000)`。
- 读取双返回：`startSec` 与 `startTicks`。

## ElementRef

```text
{ trackId: string, elementId: string }
```

- 所有元素操作（trim/split/param/keyframe/delete）都经 `ref` 定位。
- `timeline.read` 的 `clips[].ref` 与 `element.get` 的 `element.ref` 是合法 ref 的唯一来源。

## CondensedClip（timeline.read.clips[]）

```ts
{
  ref: { trackId, elementId },
  type: "video" | "image" | "text" | "graphic" | "component" | "audio" | "effect",
  name: string,
  startSec, durationSec, trimStartSec, trimEndSec: number,
  params: {
    transform: { positionX, positionY, scaleX, scaleY, rotate },
    opacity: number, volume?: number, blendMode: string,
    text?: { content: string, fontSize: number, color: string }   // 仅 text
  },
  keyframeCount, effectCount, maskCount: number,
  muted, hidden: boolean,
  mediaId?, componentId?, definitionId?, effectType?, sourceType?, sourceUrl?: string,
}
```

## 轨道与元素

- 每场景 `tracks: { overlay[], main, audio[] }`；`main` 从 0 开始（视频/图片主故事轨）。
- 元素类型与轨道类型约束（`track-type` 校验）：

| 元素 type | 落轨 |
|---|---|
| `video` / `image` | main（或 overlay video 轨） |
| `text` | overlay text 轨（带 `subtitle` 标记 = 字幕 cue，见 `captions.md`） |
| `audio` | audio 轨（`sourceType: "upload"` 需 `mediaId`；`"library"` 需 `sourceUrl`） |
| `graphic` | overlay graphic 轨（`definitionId`，默认 rectangle） |
| `component` | overlay graphic 轨（`componentId`，来自 `component.list`） |
| `effect` | overlay effect 轨（`effectType`，全画布效果） |

- **字幕轨**：text 轨带有 `captionStyle`（全轨共享样式 params）即被视为字幕轨；`timeline.read` 的 `tracks[].captionStyle` 标识。字幕 cue 元素带 `subtitle: { source, cueIndex }`。
- 字幕 cue 的 `param` 编辑会广播到全轨（`content` 除外）；`caption-style` op 设置全轨样式；`subtitle.import`/`subtitle.export` 批量导入/导出字幕文本。

## 元素基础字段

```text
{ id, name, type, startTime(tick), duration(tick), trimStart(tick), trimEnd(tick),
  params: {…}, animations?: { path: { keys: […] } }, hidden?, effects?, masks?, retime?,
  subtitle?: { source: "srt"|"ass"|"transcript", cueIndex?: number } }
```

## 版本与锁

- `version`：单调递增；每次 `timeline.command`/`history.*` 写后 +1。
- 写入可带 `baseVersion`；过期返回 `{ ok:false, conflict:true, currentVersion, opsSince }`，重读后按 `opsSince` 重放或整份 `project.get` 同步。
- `aiLock`：`project.lock` 建立；锁内 `project.save`（UI 整份保存）被拒；`project.unlock` 或 5 分钟空闲超时解除。
