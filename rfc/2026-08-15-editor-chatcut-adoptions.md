<!--
 * [INPUT]: 依赖 apps/editor 现有能力与近期落地基线：
 *          rfc/2026-08-14-editor-ai-agent-surface.md（统一 op 日志 / aiLock / baseVersion / timeline.validate / preview.frame / headless 双模导出，P1 已落地）、
 *          rfc/2026-08-14-ai-temp-components.md（component.* 工具）、references/captions.md（subtitle.import/export、字幕轨 captionStyle）、
 *          audio-studio App（本地转写 transcript.json + SRT + transcript 素材）、平台 media 模型与 MCP manifest（mcp surface → background.js operation）、
 *          service/mcp_forward.go（薄转发器，协议不变，新增 op 不需改它）
 * [OUTPUT]: 定义 recut.editor 系统性吸收 ChatCut（chatcut.io 插件 v0.2.21）对标结论的采纳契约：
 *          script-first 文稿剪辑面（script.read/apply/clean）、speech-track 转录来源、track role 自动 duck + audio.smooth、
 *          catalog-first 内置效果/SFX 目录、skill 工艺层（speech-editing/subject-protection/errors references）、
 *          验证与生成纪律、以及明确的"不采纳"边界（保留 recut 的 op 日志 / 确定性关键帧 / preview==export / 本地渲染优势）
 * [POS]: rfc 的架构设计蓝图；获批后作为 recut.editor MCP 工具面扩展、共享 Model API 演进、skill references 增补与
 *          audio-studio 转录接入的共同契约。P1 为纯技能层改动（无引擎风险），P2-P4 逐步落到写引擎
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: 系统性吸收 ChatCut 对标结论 —— recut.editor 的文稿剪辑、自动混音与工艺层

- 状态：提议
- 作者：Recut
- 日期：2026-08-15
- 决策范围：script-first 文稿剪辑面（script.read/apply/clean/find/fix-transcript）、speech-track 转录来源、track role 自动 duck 与 audio.smooth、catalog-first 内置效果/SFX 目录、skill 工艺层（speech-editing/subject-protection/errors）、验证与生成纪律、工具层对标映射、不采纳边界
- 关联：`rfc/2026-08-14-editor-ai-agent-surface.md`（op 日志 / 校验 / 预览闭环基座）、`rfc/2026-08-14-ai-temp-components.md`（component.* 工具）、`references/captions.md`（subtitle 链路）、recut.audio-studio（本地转写）、`rfc/2026-08-14-realtime-channel-ws.md`（project channel 同步）
- 实施进展：**P1 已落地**（技能层：speech-editing/subject-protection/errors references + SKILL.md/directing/preview-export 纪律）。**P2 核心已落地**：`ctx.media.transcript`（service runtime）、speech-track（元素 `transcript` 字段 + `transcript-attach`/`transcript-fix` op）、`script.read/apply/clean/find/fix-transcript/attach` 六个 mcp 操作、`timeline.validate` 增 `transcript-src`、manifest 注册、L0 全绿 + `parseTranscriptSrt` Go 单测。P2 未覆盖：多元素说话 run 的手工重排、词级停顿压缩。**P3 已落地**：`track-role` op + 轨道 role/audioRouting、`buildDuckEnvelope`（background.js 与 UI `timeline/duck.ts` 同构，Preview==Export）、`audio.smooth`（音量关键帧，幂等）、UI AudioManager 与 `createTimelineAudioBuffer` 双路径接入 duck、`TestEditorAudioMix` 全绿。P3 未覆盖：duckDepthDb 真实响度测量。**P4 已落地**：`library.browse`（catalog-first，动态目录 CDN→随包→builtin 三级回退）、`ctx.http.get`（http 权限门控）、`ctx.app.readText`（随包文件只读）、`cdn/buckets/effects/catalog.json` + `apps/editor/catalog/effects.json`/`audio.json`、生成脚本 `scripts/build-effects-catalog.mjs` + `make effects-catalog` 更新循环、`timeline.validate` 增 `effect-type`、L0 + `TestEditorLibraryBrowse`/`TestAppHTTPFetch` 全绿。P4 未覆盖：转场/LUT 渲染（目录已预留空数组，渲染器支持后填充）。**平台依赖（workflow.ask / stock / media pool / 项目 duplicate）另立 RFC。**

## 1. 背景与病灶

对标 ChatCut（`chatcut.io` 插件 v0.2.21，远程 SaaS MCP：15 个 task-scoped skills + ~40 个工具）逐项评审后，确认其**三处结构性长处**恰是 recut.editor 目前缺失的：

1. **script-first 文稿剪辑面**。ChatCut 把口播/访谈剪辑变成"编辑一份 markdown"：`read_script` 把时间线说话内容物化为 `timeline.md`（`[sN]` 段、`~~..~~` 行内删除、`[silence=Ns]` 停顿标记）与 `library/*.md` 全量源稿，AI 用原生 Edit/Write 改文件，`apply_script` 一次回写时间线；另有 `clean_script` 做机械清口癖与批量压停顿（`compress:300`/`restore:500`/`normalize:500`/`range:300-800`）。recut 目前只有 `subtitle.import`/`subtitle.export`（SRT/ASS 文本），去口癖/删停顿/选重拍只能靠 `timeline.command` 逐 clip 物理裁剪——口播是双方旗舰场景，这是最大差距。
2. **音频自动混音**。ChatCut 用一条 `role` 声明驱动整条混音：口播轨 `role:"anchor"`、音乐/氛围轨 `role:"follower"`，引擎自动 duck，再加 `smooth_audio` 对每个硬切做微交叉淡化。recut 只有 `track-mute`，无 ducking 抽象、无切点顺滑。
3. **工艺层知识**。`talking-head-guide`（638 行）给出 filler 分类决策、重拍取舍、停顿压缩默认值、高光提取/重构/hook/目标稿对齐规则、多处理依赖排序（A-roll→MG→B-roll→音乐→字幕，逐门槛确认）；`known-errors` 提供错误 runbook；生成类 skill 强纪律（生成前对齐、submit 即收手、同 prompt 失败两次即换锚点）。这些是可直接写进 references 的编辑工艺，零引擎风险。

其余长处（catalog-first、结构化表单、验证纪律、live 编辑器协作）部分采纳或标记为平台依赖。

**不采纳边界（recut 的优势要保住，不照搬）**：云端渲染 + 额度门（recut 本地渲染、无信用点）；wall-clock 动画（recut 关键帧确定性，Preview==Export）；一次性无 undo 写入（recut 统一 op 日志，`script.apply` 将把 markdown 编辑翻译成**可逐条 undo 的 op 批**——这是对 ChatCut 的关键增强）；逐宿主分叉 skill（recut 单一 skill 树服务所有 host）。

## 2. 决策记录

| # | 决策 |
|---|---|
| D1 | **script-first 文稿剪辑面**：新增 `script.read` / `script.apply` / `script.clean` 三个 mcp op。文稿是编辑表面的"主视图"，`script.apply` 把 markdown 差异翻译成 `timeline.command` op 批（每步可 undo），不手写任何新文档格式 |
| D2 | **speech-track 转录来源**：时间线元素可选携带 `transcript: { assetId?, source: "transcript"\|"srt"\|"ass", language }`；缺省时后台按 `mediaId` 解析 platform transcript 素材（audio-studio 导入产物）。`timeline.validate` 新增 `transcript-src` 不变式：script 系 op 只作用于有转录来源的元素 |
| D3 | **track role 自动 duck**：音频轨扩展 `role: "anchor"\|"follower"\|"none"`；新增 `track.role` op（undoable）。混音引擎按 anchor 语音能量生成 follower 包络，duckDepthDb 缺省由时间线响度初始化。包络确定性、随 Preview==Export 烘焙 |
| D4 | **audio.smooth**：新增 op，对每个硬切边界做 ~120ms 微交叉淡化 + 暴露边缘淡入淡出；幂等；作为结构定稿后的最后一个音频步骤 |
| D5 | **catalog-first 内置目录**：新增 `library.browse`（effects/transitions/audio-fx/sound-effects/luts），v1 内置 zoom、LUT、过渡、SFX 集；`generate` 仅在目录无匹配时使用（skill 纪律强制） |
| D6 | **工艺层 skill**：新增 `references/speech-editing.md`（口播/访谈剪辑判断法）、`references/subject-protection.md`（MG/B-roll 安全区与 cover/contain 决策）、`references/errors.md`（known-errors runbook）；更新 SKILL.md 与 `directing.md`（依赖排序 + 逐门槛确认、验证纪律、生成纪律） |
| D7 | **验证纪律**：`preview.frame` 支持 `times: number[]` 批量渲染 + 多帧对比；技能层明确"mutation ≠ 视觉证明"、"排队渲染不 claim 交付" |
| D8 | **生成纪律**（skill 层）：生成前对齐（时长/分镜/一致性锚点）、submit 即收手、同一文字 prompt 失败两次即换 reference 锚点或编辑路径、生成前告知用户计费/额度 |
| D9 | **平台依赖（不展开设计）**：结构化 intake 表单（`workflow.ask`）依赖 host 渲染能力，另立平台 RFC；编辑器 live 链接即时露出走平台 web 既有能力，仅进 skill |
| D10 | **transcript 查找与修复工具**：新增 `script.find`（带时间戳的文本定位）与 `script.fix-transcript`（只修 ASR 错听词/说话人归属，不动音频、不改时间线），对标 ChatCut `find_transcript` / `manage_transcript action:"fix"` |

## 3. script-first 文稿剪辑面（D1/D2）

### 3.0 工具层对标映射（ChatCut → recut.editor）

> 对照 recut.editor 当前真实工具面（24 个 op，`preview.frame` 未落地）。下表逐条给出"工具级"采纳结论，不只停留在 skill 层。

| ChatCut 工具 | recut 现状 | 采纳 | 阶段 |
|---|---|---|---|
| `read_script` / `apply_script` / `clean_script` | `subtitle.import/export` 仅 SRT 文本，无**源说话内容**编辑 | `script.read` / `script.apply` / `script.clean` | P2 |
| `find_transcript` / `manage_transcript fix` | 无 | `script.find` / `script.fix-transcript`（D10） | P2 |
| `browse_library`（内置效果/过渡/SFX/LUT） | 无内置目录 | `library.browse` + builtin 集 | P4 |
| `edit_track` role + `smooth_audio` | `track-mute` 仅静音 | `track.role` + `audio.smooth` | P3 |
| `render_cloud_screenshot`（多帧合成验证） | `preview.frame` 未落地 | `preview.frame { times }` 批量帧 | 随 P2 落地 preview.frame |
| `ask_followup_questions`（结构化表单） | 无（host 无 widget 渲染） | `workflow.ask`（平台依赖） | 平台 RFC |
| `browse_assets` / `inspect_asset` | `recut.media.list_assets` | 已等价 | — |
| `track_progress` | `recut.job.status/wait` | 已等价 | — |
| `submit_export` / `track_export` | `export.start` + `recut.job.*` | 已等价 | — |
| `edit_item` / `split_item` / `edit_track` | `timeline.command` ops（可 undo，更强） | 已等价（更强） | — |
| `manage_timelines`（多时间线版本） | 单时间线 + 场景 | 暂不采纳（场景即分层） | — |
| `multicam_sync` | 无多机位模型 | 不采纳（无模型支撑） | — |
| `search_stock_media` / `manage_media_pool` / `duplicate_project` | 平台级能力 | 平台依赖 | 平台 RFC |

### 3.1 心智模型

```text
AI 剪辑口播时的主视图 = 一份可编辑 markdown（script.read 物化到会话工作区）
  原生 Edit/Write 改文件  →  script.apply 翻译为 op 批（逐条 undo）→ timeline.validate → preview.frame 验收
  机械清口癖/压停顿        →  script.clean（固定词 + 停顿规则，不做语义判断）
```

### 3.2 speech-track 与转录来源（D2）

- 视频/音频元素可选字段（只读来自 `element.get` / `timeline.read` 摘要的 `hasTranscript` 标志）：
  ```ts
  transcript?: { assetId?: string; source: "transcript" | "srt" | "ass"; language?: string }
  ```
- 解析优先级：元素自带 `transcript` → 平台存在 `mediaId` 对应的 transcript 素材 → 报错并指引先用 audio-studio 转写或 `subtitle.import`（source:"transcript"）。
- `timeline.validate` 新增不变式 `transcript-src`：`script.*` 目标元素必须可解析转录来源，否则返回 `{ code: "transcript-src", ref, detail }`。

### 3.3 timeline.md 契约（script.read 输出）

```text
# 文稿 · recut.editor script surface
> 轨道：V1（3 个片段） · 源：transcript · 语言：zh
> 一行 = 一个可播放源区间；行内 ~~x~~ = 只删除 x 的音频
> [silence=0.8s] = 停顿（script.read showSilence:true 才出现）

[seg-V1:el-a:0] 大家好，~~嗯~~今天聊聊 Recut。
[seg-V1:el-a:1] 它是一套本地优先的视频创作平台。
[silence=0.6s]
[seg-V1:el-b:0] 首先，怎么把素材倒进来？
```

- 每行地址 `seg-<trackId>:<elementId>:<idx>` 映射到可播放源区间；`idx` 为该元素内 ASR 段序号。
- 行内 `~~..~~` 删除对应音频区间（中间删除会 split 元素）；整行删除 = 删整段；行移动 = 改播放顺序；`[silence=Ns]` 支持 `~~[silence=0.8s]~~`（全删）与 `[silence=0.8s→0.2s]`（压缩）。
- `script.read` 返回 `{ path, version, segments, silence: boolean }`；`path` 指向会话工作区文件（`recut.context.paths.sessionWorkspace`），AI 用原生工具编辑。

### 3.4 script.apply：markdown 差异 → op 批（D1）

- 与上次 `script.read` 的基线 diff，生成 op 清单，逐条经 `timeline.command` 落地（每步可 undo，符合统一 op 日志单一权威）：

| markdown 变更 | 翻译 op 序列 |
|---|---|
| 行内 `~~..~~` 删词 | `split`@边界 → `delete`(区间) → `trim{ripple}` 收口 |
| 整行删除 | `split` → `delete` → ripple |
| 行移动 | `element.move` / reorder（走既有 move op） |
| `[silence→x]` 压缩 / `~~[silence]~~` 删除 | `trim` 压缩/闭合停顿区间 |
| 未变更行 | 无 op（最小 diff） |

- 返回 `{ applied: op[], version, resultRefs }`；任一步冲突返回 `{ conflict, currentVersion, opsSince }`，AI 重读后重放。
- **确定性铁律不变**：op 可 JSON、可重放、禁墙钟；`script.apply` 只是"翻译器"，最终落在统一 op 日志。

### 3.5 script.clean：机械清口癖 + 压停顿

```ts
script.clean({
  refs?: ElementRef[];                     // 缺省 = 全时间线有转录的元素
  fillers?: boolean;                       // 固定无语义 filler（呃/额/嗯/um/uh/er/ah）
  silence?: "compress:300" | "restore:500" | "normalize:500" | "range:300-800" | null;
})
```

- 只处理固定词与停顿（机械层），不做语境相关 filler/重拍语义判断（那是 speech-editing reference 里 AI 用 `script.apply` 的活）。
- 停顿检测：源音频经 ffmpeg silencedetect（或 audio-studio 已有 gap）确定，本地、确定性；`restore/normalize/range` 的"恢复"只回到原录音既有停顿长度，不发明新静音。
- 输出为同 `script.apply` 的 op 批，可 undo。

### 3.6 与现有能力的边界

- 字幕链路不动：`subtitle.import/export` 仍是字幕轨文本；`script.*` 管**源说话内容**的剪辑，二者在 speech-track 转录来源上共享同一份 transcript 数据，但语义分离（文稿改音频，字幕改显示）。
- 编辑器 UI 不做文稿编辑视图（本期）；这是 AI 专属面，UI 用户照旧用时间线。

### 3.7 transcript 查找与修复（D10）

- `script.find { text, source? }`：带时间戳定位一段话在哪，只定位不编辑（对标 `find_transcript`）；后续若剪辑转 `script.apply` 面。
- `script.fix-transcript { ref, word?, corrected?, speakerId? }`：**只修转录文本本身**（ASR 错听词、说话人归属），不产生任何 op、不改变观众听到的音频——需要改音频的是 `script.apply` 的活。修复后转录源更新，`script.read` 与字幕再生成随之正确（对标 `manage_transcript action:"fix"`）。
- 关键区分：**别用 `script.fix-transcript` 去改观众听到的内容**，也别用 `script.apply` 去修 ASR 错词——两个工具边界不互换。

## 4. 音频自动混音（D3/D4）

### 4.1 track role

- 音频轨新增 `role: "anchor" | "follower" | "none"`（缺省 none）。新 op `track.role`（undoable，日志/广播与 `track.mute` 同级）。
- 混音语义：follower 包络 = base × duck(anchor 语音能量)；`duckDepthDb` 缺省由时间线响度自动初始化（`edit_track` 同级）；只有同时存在 anchor 与 follower 才 duck。
- 工程上：包络在渲染/导出时由共享 Model API 与 AudioManager 同源计算，确定性、随 Preview==Export 逐帧一致（与视觉铁律同款）。
- skill 纪律：口播/旁白轨设 anchor；音乐/氛围/B-roll 底设 follower；短 SFX/垫底不设 role。

### 4.2 audio.smooth

```ts
audio.smooth({ refs?: ElementRef[], crossfadeMs?: number /* 默认 120 */ })
```

- 对每个硬切边界做 ~120ms 微交叉淡化、暴露边缘淡入淡出；幂等（重复跑不叠加）；作为结构定稿后的**最后一个音频步骤**（A-roll 结构再动需重跑）。

## 5. catalog-first 内置目录（D5）

- 新 op `library.browse`：
  ```ts
  library.browse({ category?: "effects" | "transitions" | "audio-fx" | "sound-effects" | "luts", query? })
  ```
  返回内置目录条目 `{ id, name, category, params, propertyOverrides, appliesTo }`。
- v1 内置集：
  - effects：`builtin:zoom`（magnification 1–4 / focalPointX|Y / shape: punch|hold|slow-push|instant / easeIn|OutFrames），`builtin:slog3-s709` 等 LUT（intensity 0–1）。
  - transitions：crossfade / dissolve / slide / cube。
  - sound-effects：whoosh / camera-shutter / censor-beep / record-scratch 等平台内置音频（`sourceUrl: "builtin://sfx/<id>"`）。
- 应用路径：效果走既有 effect 元素（clip-anchored 时间几何，随 clip 移动）；SFX 走 `audio` 元素 + `sourceUrl:"builtin://sfx/<id>"`（`timeline.validate` 的 `asset-exists` 对 `builtin://` 白名单放行）。
- 门禁：skill 强制"先 `library.browse`，目录无匹配才 `generate`"（烧额度前先找现成货）。

## 6. 工艺层 skill（D6）

### 6.1 新增 references/speech-editing.md（口播/访谈剪辑判断法）

吸收 talking-head-guide 的可移植部分，全部落到 `script.read/apply/clean` 的上下文：

- **filler 分类**：无语义 hesitation（呃/额/嗯/um/uh/er/ah）→ `script.clean` 机械清；语境相关（然后/就是/那个/so/like/对/所以/但是）→ 判断是否承载顺序/转折/因果/强调，否才删，不确定保留。
- **重拍与重复尝试**：确认是否真重拍（还是修辞强调/结构标记）；只删失败或已被覆盖部分；多完整版本取更完整/更接近意图者，不机械取最后一条；绝不把不完整碎片拼成一句话。
- **停顿**：0.8–1s 以上长停顿压到 ~0.3s；句间保留 0.3–0.5s 呼吸；围绕转折/强调留略长；短呼吸不删；用户给定阈值优先。
- **高光/重构/hook/目标稿对齐**：按完整语义单元编辑；任务点名保留则裁剪到指定边界；重构前先确认目标结构；hook 优先从原素材取，新生成需确认；时长与语义冲突时说明取舍。
- **依赖顺序与逐门槛确认**：A-roll 定稿 → 才落 MG/B-roll/音乐/字幕；每一步单独确认，不打包。确认后再动下游，避免上游返工重做下游（尤其生成类，浪费额度）。

### 6.2 新增 references/subject-protection.md（MG/B-roll 安全区）

- 保护人脸/头部/口部/关键手势/产品/字幕区；overlay 不上字幕带（landscape 下三分区上沿、portrait 底部避让）。
- PiP 默认 `borderRadius` 24–36；不默认固定角落，选最大空白低信息区。
- 大幅面差异（landscape 源入 portrait 画布等）：先 `inspect` 源再决定 cover/contain；cover 仅在保护信息能存活的中心主体/低信息边缘时可用，否则 contain + 背景层。
- overlay 与 full-screen MG 分开：默认 transparent overlay，不静默盖脸。

### 6.3 新增 references/errors.md（known-errors runbook）

按类别给恢复路径：conflict/opsSince（重读重放）、locked/stale-id（刷新后再试，不换 payload 盲重试）、asset 未登记（`timeline.assets` 覆盖式登记）、validate violations（只改被拒字段）、生成失败（保原 provider/内容策略错误，不重复花额度）、script 无转录来源（先 audio-studio 转写 / subtitle.import）。

### 6.4 更新 SKILL.md 与 references/directing.md

- SKILL.md 工具矩阵补 `script.*` / `track.role` / `audio.smooth` / `library.browse`；门禁加：文稿剪辑走 script 面、export 前 validate 零违反、mutation≠视觉证明。
- directing.md 增加"先定结构再精修"的依赖顺序原则（结构→时序→润色），与 speech-editing reference 互链。

## 7. 验证纪律与生成纪律（D7/D8）

### 7.1 preview.frame 批量帧

- `preview.frame` 支持 `{ t: number, times?: number[] }`：批量渲一或多个关键时刻 → 返回 assetId 列表。skill 指导"settled vs transient"多帧对比——批量帧里只有部分帧"缺元素/截断"通常是动画中间态，不是真实缺陷，以 settled 帧判定（ChatCut verification 的教训）。
- `preview-export.md` 补充：mutation 成功 ≠ 视觉证明；结构/视觉类结果必须 inspect 像素；排队/运行中的导出不 claim 交付。

### 7.2 生成纪律（skill 层，D8）

- 生成前对齐：时长/分镜/内容/一致性锚点；锚点（reference 图/视频）跨镜头复用，从项目既有资产取，不静默新生成。
- submit 即收手（除非已排队后续任务）；同文字 prompt 失败两次即换 reference 锚点或编辑路径，不第三次裸重试。
- 生成前告知用户即将消耗的资源（本地渲染无额度，但仍告知数量与时长）。

## 8. 分阶段实施路线

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P1**（纯技能层，无引擎改动） | 新增 `references/speech-editing.md`、`subject-protection.md`、`errors.md`；更新 SKILL.md / directing.md / preview-export.md（依赖顺序、验证纪律、生成纪律、catalog-first 门禁）；`preview.frame` 支持 `times` 批量 | `make check`；`recut.skills.read/reference` 抽查 |
| **P2**（文稿剪辑面，最大引擎增量） | 元素 `transcript` 字段 + speech-track 解析（audio-studio / transcript 素材）；`script.read`/`script.apply`/`script.clean` → op 翻译；`script.find`/`script.fix-transcript`（ASR 修复只改文本不动音频）；`timeline.validate` 新增 `transcript-src`；audio-studio 转写接入指引 | L0 script.parse / script.opmap / clean.silence；L1 command_log 落 script op；L2 Playwright 文稿 roundtrip |
| **P3**（音频自动混音） | `track.role` + duck 包络（共享 Model API 同源计算，Preview==Export）；`audio.smooth` | L0 duck-envelope spec；L1 混音落日志；L2 包络一致性（headless vs ui） |
| **P4**（目录与体验） | `library.browse` + builtin 效果/过渡/SFX 集 + `builtin://` 白名单；编辑器 live 链接即时露出（skill 层） | L0 catalog spec；L1 validate builtin 白名单；L4 全回归 |
| **平台依赖（另立 RFC）** | `workflow.ask` 结构化表单（依赖 host 渲染能力） | — |

## 9. 端到端验证方案

> 沿用 editor-ai-agent-surface 的 L0–L4 分层：L0 纯逻辑单测（node + vitest）→ L1 后台集成（goja + sqlite）→ L2 Playwright 双源/渲染一致性 → L3 MCP 全流程用户旅程 → L4 回归。

### 9.1 L0 · Model API 单元测试

| 套件 | 断言 |
|---|---|
| `script-parse.spec` | timeline.md 解析：行地址/行内删除/silence 标记/整行删除/行移动 全部命中 |
| `script-opmap.spec` | markdown 差异 → op 序列：最小 diff（未变行无 op）；中间删词 = split+delete+ripple；move 走 move op |
| `clean-filler.spec` | 固定 filler 与 compress/restore/normalize/range 停顿规则映射正确；restore 不发明新静音（只回既有停顿） |
| `duck-envelope.spec` | anchor 语音能量 → follower 包络：anchor 出声即压、间隙回升、duckDepthDb 初始化正确、确定性 |
| `catalog.spec` | `library.browse` 过滤/查询命中；builtin 条目参数契约正确 |

### 9.2 L1 · 后台集成测试（Go service）

| 套件 | 断言 |
|---|---|
| `script_apply` | `script.apply` 产生的每个 op 都落 `editor_command_log`，version 递增，逐条 undo 可逆 |
| `transcript_src` | 无转录来源元素的 `script.*` 被 `transcript-src` 不变式拦截；`timeline.validate` 返回对应 violation |
| `track_role` | `track.role` 落日志、广播；duck 参数参与渲染解析 |
| `audio_smooth` | 幂等（重复跑不叠加 crossfade）；结构再动后重跑正确 |

### 9.3 L2 · Playwright（ui/tests/e2e/）

| spec | 场景 | 断言 |
|---|---|---|
| `script-roundtrip.spec` | script.read → Edit timeline.md（删词/删段/移动）→ script.apply | iframe 渲染与后台 doc 一致；`__recutTest.getNodeBounds` 断言音频区间变化 |
| `duck-consistency.spec` | P3：headless 渲染 vs ui 渲染同 doc | 混音包络逐帧一致（Preview==Export） |
| `preview-times.spec` | `preview.frame { times:[0,1,2] }` | 返回批量 assetId；同 t 像素哈希一致 |

### 9.4 L3 · MCP 用户旅程（真实 daemon）

**场景 A · 口播去口癖**：
```
project.create → timeline.read（hasTranscript 素材）
script.read → 工作区 timeline.md
script.clean({ fillers:true, silence:"compress:300" }) → op 批
原生 Edit 修改 timeline.md（删重拍、压停顿）→ script.apply
timeline.validate（含 transcript-src）→ preview.frame(t) 批量帧验收
history.undo ×1 → timeline.read 确认回退
export.start({ mode:"headless" }) → recut.job.wait → 产物 assetId + setCover
```

**场景 B · 自动混音**：`track.role`（anchor/follower）→ 音频落轨 → `audio.smooth` → 导出包络验证。

**场景 C · 目录优先**：`library.browse("zoom")` → 应用 builtin → 不再烧生成额度；无匹配才 generate。

### 9.5 L4 · 回归

- `make check` + `make editor-e2e` 全绿；editor-ai-agent-surface 既有 spec 不回归；rfc/README.md 与本 RFC 反向一致。

## 10. 边界与未决

- **本期不含**：multicam 音画对齐（recut 无多机位模型，对标工具 `multicam_sync` 不采纳，留待编辑模型引入机位后）；MG 生成器 brief 流程（recut 走 component 作者面，无付费生成器）；product-help GUI 兜底 skill（不同产品形态）。
- **script 与字幕的转录来源共享**：audio-studio transcript 素材与字幕 SRT 都可能挂到 speech-track；解析优先级与冲突（同元素双来源）在 P2 实现时定，默认 transcript 优先、可显式指定。
- **duck 包络的精度**：包络渲染粒度（帧级 vs 采样级）与 `duckDepthDb` 自动初始化的响度算法在 P3 基准定档。
- **`builtin://` 白名单**：`timeline.validate` 对内置来源的放行规则与素材登记边界（是否需要登记）P4 定。
- **平台依赖**：`workflow.ask` 结构化表单需 host 渲染能力，另立平台 RFC；本 RFC 只保证工具面为未来接入预留（不设计、不实现）。

## 11. 工程实现备注

- `service/mcp_forward.go` 是薄转发器，仅按协议转发 JSON-RPC；新增 op 全部经既有 manifest（mcp surface → background.js operation → `recut.operation.register`）暴露，**无需改转发器**。
- `script.apply`/`script.clean` 的 op 翻译是纯函数（输入 markdown 差异 / 规则，输出 op 清单），放入共享 `model-api` 模块，UI 与后台同源。
- duck 包络与 audio.smooth 计算必须进共享 Model API / AudioManager 同源路径，保证 Preview==Export（与视觉确定性同款铁律）。
