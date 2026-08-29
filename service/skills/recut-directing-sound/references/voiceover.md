> 来源: apps/editor/skills/recut-editor/references/voiceover.md (Recut 自有内容，内部复用)

<!--
 [INPUT]: 依赖 recut.context 的 media readiness/voices、recut.speech.generate、Editor timeline.read/timeline.command/track.role 与 preview.frame。
 [OUTPUT]: voice-led 旁白、TTS、音频同步、音轨角色和 SFX 的 Editor 工作流。
 [POS]: voice-led route 的平台能力适配层；不伪造 Audio Studio 或 Provider 专属功能。
 [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# 旁白与语音同步（voice-led）

voice-led 不是“生成一段音频再铺到时间线”。当画面已经存在时，旁白必须解释当前画面；当画面还不存在时，旁白脚本必须先成为 scene 结构，再生产视觉。语音生成、视觉编排和时间线落轨是三个不同阶段。**工具与就绪门先看 `voice-assets.md`**（ASR/TTS 怎么选、本地环境缺失时怎么引导），本文件专注脚本/同步/落轨。

## 能力路由

- 已有口播/访谈：走 `speech-led` 与 Audio Studio transcription；不要用 TTS 替换原始人声。
- 只有旁白脚本、没有 source speech：走 `voice-led`，先分 scene，再决定 motion graphic/B-roll/生成媒体。
- 已有视觉序列，需要新增或替换 narration：先建立 visual-voiceover sync map，再调用 `recut.speech.generate`。
- Audio Studio/transcription 未安装或 MCP 未 ready：明确告诉用户“转写/A-roll 暂不可用”，不能静默退化成 text-only；可在用户允许时切换到 voice-led 或 motion-graphics，并重新判断视觉方案。

调用平台媒体生成前检查 `recut.context.media.readiness.speech`；提交后用统一 `recut.job.wait` 观察到 `completed/failed`，queued/running 不能视为可用音频。语音生成需要 `voiceId`，先从 `recut.media.list_voices` 获取真实 ID，不凭记忆捏造音色。

## Visual-first sync map

只要存在目标画面，就先按“画面变化”分段，不按平均时长切段。**这是 voice-led 的硬前置**：每条解说必须登记
`visual range + visual anchor`；**没有画面锚点的解说不得单独落轨**（杜绝“纯音频空格”）。每一行 sync map 至少记录：

| 字段 | 含义 |
|---|---|
| visual range | 当前画面的 start/end 秒与证据 frame |
| visual anchor | 标题、产品状态、屏幕动作、图表数据、场景事件 |
| narration | 只描述该画面时刻的旁白文本 |
| target duration | 该画面能承载的语音窗口 |
| estimated/actual duration | 提交前估算、完成后真实音频时长 |
| fit status | `fits` / `too-long` / `uncertain` |
| placement | 通过 fit check 后的 audio start/end |
| map revision | 关联的 timeline version；视觉变更后必须标 stale |

在 `fit status` 为 `too-long` 或 `uncertain` 时，不提交长句 TTS。优先缩短为 phrase、拆分成 scene-level clips、调整支持的 speed，或让用户选择“保留文案/延长画面/接受重叠”的取舍。不要用一条长音频覆盖多个视觉状态。

## 生产与落轨顺序

1. 复用当前编辑会话的 `workflow.context` / `timeline.read` 快照；快照不存在或已失效时再读取，并检查目标 frame，标记所有视觉变化。
2. 检查项目是否已有 narration、speech、music、SFX；如果有，先确定替换、静音、duck 还是混音。
3. 为每个视觉段写 sync map，确认每句旁白的事实、视觉 anchor 和可用时长。
4. 按 scene/beat 分段调用 `recut.speech.generate`，每个 job 完成后读取真实音频 duration；不要把“job completed”当成 fit 通过。
5. 只有实际 duration 落入对应 visual window，才落轨：已保存/生成的媒体音频（配音、旁白）用 `timeline.placeAudio`（只传 assetId+start/duration，source 由后端推导为 upload+mediaId）；目录音乐/音效继续用 `timeline.command insert`（sourceType:library+sourceUrl）。两者不可混用，也不要把已保存素材当 library 处理。audio track 不要逐段漂移到“差不多的位置”。
6. 旁白所在 track 设 `role:"anchor"`；背景音乐和需要被压低的 ambience 设 `role:"follower"`；短 SFX/stinger 默认不设 role，避免被 duck。
7. 回读每个 audio ref 的 start/end/duration，并在每段 start/mid/end 检查画面和语音含义仍一致。

## 视觉变更后的 stale map

任何改变视觉 start/end、镜头顺序、scene duration、A-roll timing 或 motion graphic/B-roll placement 的操作都会使受影响的 sync map 行过期。过期后：

- 只重建受影响行，不盲目重做整张表；
- 重新检查 narration 是否描述了当前画面；
- 重新读取真实音频 duration 和 placement；
- 在最终报告写出 `Final sync check`，列出通过、修复和仍存在的 coverage gap。

禁止让旁白继续描述已经消失或尚未出现的画面，也禁止在视觉改变后沿用旧 startSec。

## 音乐与 SFX

- 音乐用于情绪和微小空隙，不用于掩盖结构问题；先完成 A-roll/visual structure，再 fit BGM。
- BGM 资产过长则按最终 visual end 裁剪并淡出；过短则按真实资产长度分段铺满，不把一个 audio item 拉过源文件末尾。
- 生成 SFX 前先 `library.browse({ category:"sound-effects", query })`；只有目录无合适结果或用户明确要原创音效时，才调用平台生成能力。
- `audio.smooth` 是结构定稿后的最后音频步骤；A-roll 再变更后需要重新 smooth。

## 完成标准

voice-led 交付必须同时说明：目标视觉范围、每段 narration、实际音频 duration、placement、mix/duck 处理、Final sync check。没有 visual anchor 或真实 duration 证据时，只能报告为 draft，不能声称同步完成。
