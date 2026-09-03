<!--
 [INPUT]: 依赖 workflow.context/timeline.read/element.get/timeline.validate、preview.frame 与 recut.job.* 返回的结构和像素证据。
 [OUTPUT]: Editor 的结构、视觉、交付三层验收和失败分类。
 [POS]: 所有 route 共用的 verification contract；不把 mutation 成功当作视觉完成。
 [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# 验证契约（recut.editor）

Editor 的“完成”不是一个布尔值，而是三层证据：结构成立、画面成立、交付成立。新片检查全片；二次编辑按本次 scope 检查受影响的结构、画面和依赖。任何一层缺失，都只能报告为 draft/reviewable，不能声称已交付。

## 1. 结构证据

在写入后读取最新 `workflow.context.version` 与 `timeline.read`，必要时用 `element.get` 检查具体元素。然后调用 `timeline.validate`，确认：

- 每个 `assetId`/`mediaId` 存在且已登记；
- track type 与 element type 匹配，时间在范围内且没有意外 overlap；
- component head 已 verified、参数合法、transcript source 仍可解析；
- 受影响的 A-roll、motion graphics、B-roll、字幕、音乐和 voiceover 依赖仍对应当前时间线；未受影响的下游不因局部编辑被强制重做。

结构证据只回答“文档可执行”，不回答“画面好不好”。

## 2. 视觉证据

视觉变化必须用真实 composed frame，再用读图能力检查像素。优先 `preview.batch({ times, purpose: "settled-scenes" })` 一次拿多个异步 frame job，或 `preview.contact-sheet({ times })` 快速审阅主体/可读性/视觉重复；单点排查再用 `preview.frame({ timeSec })`。这些都是 UI 快路径：iframe 离线返回 `editor-not-open`，`mode:headless` 返回 `headless-unavailable`——此时只能报告 draft/reviewable，不能声称画面已验收。新片覆盖全片关键场景；二次编辑至少覆盖受影响元素的 start/settled/end 和可能受遮挡的邻近画面。关键时刻至少覆盖：

1. 开场 hook 或第一视觉主体；
2. 每个新的 viewer job 首次落定的时刻；
3. 主要转场/overlay/full-screen beat；
4. 文字最多、字幕最多或画面最拥挤的 settled frame；
5. 结尾与最后一个音频/视觉元素结束处。

批量检查时同时取 start/mid/settled/end，但以 settled frame 判定质量。中间帧短暂缺元素、截断或处于入场状态，不自动算缺陷；连续 settled frame 才缺主体/溢字/遮挡，才需要修复。

逐帧检查：主体存在且没有被 motion graphics/B-roll/字幕遮住；主信息在 1080p 至少约 56px，字幕约 40px，辅助信息约 32px；字幕带、脸/嘴、产品和关键 UI 不冲突；overlay 位置来自当前目标 frame，不是固定角落；组件自然 box 没有被裁切；视觉机制确实表达 viewer job，而不是重复文本框。

## 3. 交付证据

只有 `timeline.validate` 通过且关键 settled frames 通过后，才调用 `export.start`（不要传 `mode:"headless"`）。记录 jobId、目标 version、模式、尺寸、fps 和最终 assetId；用 `recut.job.wait` 观察到 `completed`，再读取导出结果和封面。queued/running/failed/cancelled/`editor-not-open`/`headless-unavailable` 都不能报告为完成。

## 失败分类

- **状态/ID 失败**：stale id、version conflict、asset 未登记 → 重读上下文后重放；
- **结构失败**：track/overlap/range/component/param violation → 修 op，不先修视觉；
- **资产失败**：component build、媒体生成或 transcription 未就绪 → 处理 job 终态，禁止用 text-only 静默替代；
- **构图失败**：主体被盖、fit 错、自然 box 溢出、文字不可读 → 先修 placement/form，再决定是否修 source；
- **节奏失败**：read time 不够、旁白描述错画面、motion graphic 晚于 speech beat → 修 sync map、duration 或 scene 结构；
- **交付失败**：export job 非终态、产物缺失或 version 不匹配 → 不声称交付，报告具体 blocker。

重试前先分类。相同错误的 mutation 重试不会生成视觉证据；同一 visual identity 问题两次文字修正仍失败时，改用 reference/anchor 或重做 form。

## 报告格式

最终报告至少给出：

```text
Structure proof: timeline version + validate result
Visual proof: scene/time settled frames + each failed check/fix
Delivery proof: export job + completed video asset + cover
Open blockers: missing Audio Studio / readiness / user decision / unresolved mismatch
```

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
