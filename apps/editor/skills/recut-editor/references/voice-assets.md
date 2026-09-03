<!--
 * [INPUT]: 依赖 recut.context.media.readiness[capability].status / integrations.audioStudio、
 *          recut.speech.generate / recut.media.list_voices / recut.media.wait_for_job、
 *          Audio Studio MCP（audio.transcribe / audio.synthesize / audio.characters / audio.save）、
 *          Editor timeline（timeline.placeAudio / timeline.command / script.attach）。
 * [OUTPUT]: 声音资产（ASR 转写 + TTS 配音）的创建总览：能引用的平台/App 能力、就绪门、
 *          本地环境缺失时如何引导用户设置、就绪时如何直接使用。
 * [POS]: voice-led / speech-led 的"能力总览"层；不包含脚本创作与落轨细节（见 voiceover.md
 *        / speech-editing.md）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

# 声音资产总览：ASR（转写）与 TTS（配音）怎么用

声音分两条能力：**ASR 把音/视频变文稿字幕**，**TTS 把文字变成配音**。两者不在同一个工具里，
也不是所有环境都默认就绪——先看就绪门再选用对应工具，本地没有就提示用户去设置，绝不假装可
用，也不退化成无声/无字幕的"伪完成"。

## 一、就绪门（每次要动声音前先查）

调用 `recut.context`，读两块：

1. `media.readiness`：`transcription` 与 `speech.generate` 的 `status`。
2. `integrations.audioStudio`：Audio Studio 是否 `installed` / `mcpReady` / `ready`。

| 要做什么 | 就绪信号 | 可用工具 |
|---|---|---|
| 转写（音/视频 → 文稿+字幕） | `integrations.audioStudio.status == "ready"` | Audio Studio 的 `audio.transcribe` → `audio.transcript`，产物经 `audio.save(kind:"transcript")` 入库，再 `script.attach` 到说话元素 |
| 配音（文字 → 人声） | `media.readiness.speech.generate.status == "ready"` | 云端：`recut.speech.generate`（先 `recut.media.list_voices` 拿 voiceId） |
| 配音（本机 TTS） | 同上，且 `media.readiness.speech.generate.provider == "local-audio"` | Audio Studio 的 `audio.synthesize`（默认音；角色经 `audio.characters` 取 characterId）；验收后 `audio.save(kind:"synthesis")` 入库 |

### 本地环境缺失时的行为（必做）

- `integrations.audioStudio.status` 是 `not-installed` / `installed-no-mcp`，或 `readiness.speech.generate.status`
  是 `not-configured` / `unavailable` → **明确告诉用户**：转写/A-roll（或配音）暂不可用，需要在
  Recut 设置里安装/启动 Audio Studio、或在设置面板为对应用途选择默认模型。**不要**装作完成，
  **不要**擅自改成"纯文字片"或"无声片"，除非用户明确允许。
- 用户允许时，可把叙述性任务降级为 motion-graphics 或先出视觉骨架，但要说明这是降级，不是等同完成。

## 二、ASR 转写（讲话 → 可编辑文稿/字幕）

- 走 Audio Studio：`audio.transcribe({assetId, kind, model, language})`（异步 job）→ 完成后
  `audio.transcript(id)` 读分段/SRT；需要进时间线/素材库时，用户确认后才 `audio.save(kind:"transcript")`。
- 说话元素（口播/访谈）落 `timeline.placeAudio` 到 audio 轨后，把 transcript 资产挂到元素：
  `script.attach({ref, assetId})`，再经 `script.read` / `script.apply` 做文稿剪辑
  （细节见 `speech-editing.md`）。
- **ASR 不可能"无中生有"**：没有源音/视频就别提转写；引用真实 `assetId`，不臆造文稿。

## 三、TTS 配音（文字 → 人声 → 时间线）

两套入口，按就绪门选：

1. **云端（默认就绪时）**：`recut.speech.generate`
   - 先 `recut.media.list_voices({credentialId})` 拿真实 `voiceId`，不凭记忆编造音色；
   - 提交 → `recut.media.wait_for_job` 到 `completed` 才算素材可用；`failed` 如实报错，不把素材伪装成可用；
   - 产物是平台媒体 asset，用 `timeline.placeAudio` 落轨（只给 assetId+start/duration，source 由后端推导）。
2. **本机（`local-audio` route 就绪时）**：Audio Studio
   - 音色：默认音直接 `audio.synthesize({text, style})`；用角色就 `audio.characters` 拿 `characterId` 传入；
   - 验收：Audio Studio 会做 ASR 回读验收，未通过的配音不会暴露；
   - 落库：用户确认后 `audio.save(kind:"synthesis")` → 得到真实媒体 asset → `timeline.placeAudio` 落轨。
   - `recut.speech.generate` 的本地路由在 daemon 已接 Audio Studio 桥时也可用；未接通时提交会失败，
     应当改走 `audio.synthesize`。

**语音 fit check**：每条配音都要对上对应画面窗口（`visual range`），`too-long`/`uncertain` 时不提交长句
（详见 `voiceover.md` 的 Visual-first sync map）。落轨后回读再校验一次可播放（`timeline.validate`
的 `audio-unresolvable` 会拦截拼错的 source 组合）。

## 四、一句话流程（voice-led 示例）

```
准备 → 检查 readiness：speech.generate ready？audioStudio ready？
写法 → 每段解说登记 visual anchor（voiceover.md sync map）
生成 → 云端 recut.speech.generate 或本机 audio.synthesize（角色可选）
验收 → wait_for_job / ASR 回读通过 → audio.save 入库
落轨 → timeline.placeAudio(assetId + start/duration) → role:"anchor" → 字幕对齐
校验 → timeline.validate 零违规 + 回读可播放
```