# 字幕实践（recut.editor · 薄适配层）

> 决策规则权威来源：`service/skills/recut-directing-captions`；本文件仅保留 `recut.editor` 介质映射（字幕轨结构、`subtitle.*` 与 `timeline.command` 的 App 实现）。
> 字幕样式、安全区、强调词与平台默认样式等决策以全局 `recut-directing-captions` 为准，本文件不重复定义。

## 定位与边界

本文件是 `recut.editor` 对 `recut-directing-captions` 的薄适配层，只回答“字幕如何用轨道与 op 实现”。
字幕怎么写、怎么强调、怎么保证可读由全局决定；本文件仅说明在 `recut.editor` 中字幕轨与 cue 的结构、`subtitle.*` MCP 链路、批量导入与全轨广播的 op 语法。

## 决策路由表

| 决策问题 | 权威来源 | 全局文件 |
|---|---|---|
| 字幕层级、安全区、落位与缩屏验收 | `recut-directing-captions` | `SKILL.md` 一、`references/captions.md` |
| 强调词/关键词高亮（三选一、一屏一强调、选词纪律） | `recut-directing-captions` | `SKILL.md` 二、`references/kinetic-captions-zh.md` |
| 平台默认样式速查与主题化 | `recut-directing-captions` | `SKILL.md` 三、`references/captions.md` |
| 长转短与静音观看字幕策略 | `recut-directing-captions` | `references/captions-and-clipping.md` |
| 钩子首帧文案与缝线字幕的版式使命（交界） | `recut-directing-hooks` / `recut-directing-b-roll` | 全局边界声明 |

## 介质映射（App 特有，保留）

### 结构

- 字幕轨：`type:"text"` 的轨道，带有 `captionStyle`（全轨共享样式 params，不含 `content`）；`timeline.read` 的 `tracks[].captionStyle` 标识字幕轨。
- 每条 cue：`type:"text"` 元素 + `subtitle: { source, cueIndex }` 标记，落在字幕轨；独立拖拽/裁剪/移动，但样式全轨统一。
- 共享样式：编辑任一 cue 的文字外观/位置 → 自动广播到全轨（`content` 与时间除外）；新增 cue 自动继承 `captionStyle`。位置按轨道锚点自动下三分之一，不逐条手写坐标。

### 推荐流程（MCP）

0. **生成字幕**：`subtitle.capabilities` 确认 audio-studio 就绪 → `subtitle.generate { targetAssetId, kind:"video"|"audio", model, language }`（幂等去重，返回 `jobId`）→ `subtitle.status({jobId})` 轮询到 `completed` 得全局 `transcriptAssetId` + `srt`/`segments` → `subtitle.commit({transcriptAssetId})` 登记进 `registeredAssets`（可附 `trackId+elementId` 让字幕与文稿同源）。
1. **批量导入**：`subtitle.import { content: SRT/ASS 文本, style, trackId?, startSec?, source? }` 一次铺成字幕轨，返回 `trackId` + 各 cue 的 `ref`。`style` 只写文字外观类键（`fontSize/color/background.*/textAlign/letterSpacing/lineHeight/opacity/blendMode`），位置由后台按画布自动算。
2. **读回**：`subtitle.export` 返回整轨 SRT 文本 `{ srt, cueCount, trackId }`。
3. **精细编辑**：
```text
timeline.command { op: { type:"insert", payload:{ element:{ type:"text", content:"核心结论", startSec:3.2, durationSec:2.6, subtitle:true, subtitleSource:"transcript", params:{} } } } }
timeline.command { op: { type:"caption-style", payload:{ trackId, style:{ fontSize:6, color:"#FFFF00" } } } }
```
`insert` 带 `subtitle:true` 落字幕轨自动继承共享样式；改全轨样式用 `caption-style` 或 `param` 任一 cue（两者均全轨同步）。

### 参数（字幕 = text 元素 + 共享样式）

| 参数 | 说明 | App 映射 |
|---|---|---|
| `content` | 字幕文本（唯一不共享） | cue 独有 |
| `fontSize` | 字号（app 单位；1080p 有效字高≈fontSize×12） | `captionStyle` 全轨统一，阶梯值见全局 SKILL.md 三 |
| `color` | 颜色 | 高对比，`captionStyle` 全轨统一 |
| `textAlign` | 对齐 | 默认 `center`，全轨统一 |
| `letterSpacing`/`lineHeight` | 字距/行高 | 长句行高≥1.2，全轨统一 |
| `background.*` | 底框 | 默认关闭；开启时高对比，全轨统一 |
| `transform.positionX/Y` 等 | 位置/变换 | 全轨统一，自动下三分之一，不手动写 |

> 铁律（无底框、一条一信息、最高层、缩屏 480px 可读等）与字号阶梯、强调手法等决策见全局 `recut-directing-captions` SKILL.md 一/二/三与交付自检；本文件仅保留 op 层面的实现约束。
