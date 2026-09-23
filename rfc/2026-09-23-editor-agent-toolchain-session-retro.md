<!--
 * [INPUT]: 依赖 2026-09-23「制作一个视频来测试 recut editor 各种 MCP tool」的 agent-session-debug 快照
 *          （session beeb882d890c0910c030b287，project a41f9c83832d4e5f435977bd，387 事件/93 分钟，最终
 *          被用户取消、从未 export）；代码现状：service/editor_model.go（editorCoreDefaultAudioParams）、
 *          service/editor_ops.go（audio-placement / validate component-def / effect-type）、
 *          service/editor_script.go（buildScriptOps delete+insert 重建、findSpeechRun）、
 *          service/editor_handlers.go（placeAudio、editor-not-open、subtitle.import）、
 *          service/local_speech_bridge.go（audio.save 桥）、service/motion_graphic/ops.go（create finalize /
 *          applyVerify / update forceVerified）、web/app/projects/[id]/project-detail-client.tsx（iframe 宿主
 *          与心跳）；技能面 service/skills/recut-editor/references/*.md、service/skills/recut/SKILL.md
 *          （「生成必先导演」硬约束）、service/skills/recut-director（导演链与门）；先例 RFC
 *          2026-08-21-ai-narration-audio-asset-lifecycle.md、2026-08-19-editor-component-create-resilience-
 *          and-compositing.md、2026-08-20-editor-component-gsap-animation.md、2026-08-22-editor-captions-
 *          audio-studio-asr.md、2026-08-19-editor-ai-video-authoring-quality.md、2026-08-29-global-directing-
 *          skills.md、2026-09-15-generation-reference-protocol.md、2026-09-22-clone-director-generation.md。
 * [OUTPUT]: 以一次「覆盖全部编辑器 MCP tool」的真实测试会话为样本，梳理 17 项体验缺陷，归并为 6 个架构
 *           主题（默认值可交付 / 派生物依赖 / 工具契约可验证且默认直通 / 写入身份与并发 / 验证交付闭环 /
 *           生成必先导演），给出落地方案、契约改动清单与 M0–M4 里程碑；不新增渲染引擎、不引入新中间语言。
 *           方法论：**代码只保证事实（默认值/状态/身份/派生/目录/失败面），行为规则（导演/选材/节奏/门禁）
 *           用 Prompt/Skill 引导，不加代码门禁**（本稿对 08-19「平台强制」立场的有意修正）。
 * [POS]: rfc 的「AI 用编辑器工具链做完整成片」的体验复盘 + 架构方案；是对 08-19 组件链、08-21 音频生命
 *        周期、08-22 字幕桥三份 RFC 的跨链收敛，重点补上「默认值/派生关系/元素身份/目录语义/无头门禁/
 *        导演参与」这六处此前未收口的缺口，并划清「代码 vs Prompt」的边界。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
-->

# RFC：编辑器 Agent 工具链成片体验复盘——从「能调用」到「能交付」

- 状态：Proposal
- 作者：Recut
- 日期：2026-09-23
- 决策范围：`recut.editor` 的 MCP 工具契约与默认值、script/字幕/音频的派生关系、组件与效果素材状态机、时间线写入的并发与副作用、无头预览/导出门禁与确定性验证
- 关联：[AI 解说音频素材生命周期](./2026-08-21-ai-narration-audio-asset-lifecycle.md)、[组件创建链架构修复](./2026-08-19-editor-component-create-resilience-and-compositing.md)、[组件 GSAP 动画](./2026-08-20-editor-component-gsap-animation.md)、[编辑器字幕对接 audio-studio ASR](./2026-08-22-editor-captions-audio-studio-asr.md)、[Editor AI 成片质量重构](./2026-08-19-editor-ai-video-authoring-quality.md)

## 0. 白话总结（先看这个）

**这件事是：** 我们让 AI 用编辑器里的各种工具，独立做一条 50 秒的短片（主题是"AI 应用最大的挑战不是开发，而是分发"），顺便把这些工具全都试一遍。

**结果是：** 折腾了 1 个半小时，工具基本都点过一遍，**但短片没做出来，用户最后手动按了停止**。

**问题不在"工具不够"或"AI 不够聪明"，而在于很多本该自动、本该防呆的地方没做到位，AI 只能不停地停下来救火。** 打个比方：这不是"厨房没食材"，而是"炒菜时发现炉子默认是关的、切了菜配菜就散了、菜做好了还被盖上'半成品'章不能用、抽油烟机一关就看不见锅"。一件件都不大，但叠在一起就做不完一顿饭。

具体遇到过这些让人抓狂的事：

1. **配了旁白，但默认是静音的**——像录好了音却把音量旋钮默认拧到 0，AI 发现后只能一条条手动调大。
2. **改一句口播，字幕全错位**——而且改完之后"刚才那段音频"突然找不到了（元素被重新生成、编号变了），得重新翻整条时间线；最后只能把整条字幕删掉、重新导入对齐。
3. **AI 做好的动效/组件盖着"草稿"章，不能直接用**——明明做完了，却得像重新交一次作业那样再提交一遍才生效。其实简单组件应该"把代码直接交上去，一步就建好、验证、给结果"；只有那种需要 AI 慢慢琢磨的复杂组件，才值得专门开一个"作者 AI"来磨。
4. **语音合成走到最后"保存"那一步就坏了**——还占着唯一的机器位不放，导致任务重复排队、要手动去任务中心取消。
5. **导入一个现成的素材包，它直接塞进了正在剪的主画面里**——把原有内容盖住了，只能撤销。
6. **想加个特效，系统到最后校验时才说"不能这么加"**——而不是在加的当下就挡住并告诉 AI 正确做法。
7. **最要命的一条：没开着编辑器页面时，AI 看不见画面**——有整整 50 分钟是在"闭着眼睛剪"，改完不知道好不好看。这也是最后没能导出的直接原因。
8. **生图、生视频是"没导演就开拍"**——平台规定"生成前必须先请导演确定镜头和风格"，但这次 AI 直接就把图片和视频生成提交了，出来的画面是零散碎片、彼此不连贯；这条硬约束形同虚设。
9. **最终没有导出成片**——等画面能看时，用户已经失去耐心。

**一句话：现在的工具"能调用"，但还做不到"能交付"。** 差的正是六件事——默认值要对、联动要跟得上、工具说成功就得真成功、一个操作别把下一个操作弄坏、生成前先有导演、以及不打开页面也能渲染验收。

**接下来要做的（白话版）：**
- 让默认的声音是能听见的，画面引用没生成完要提前提示；
- 改了旁白，字幕自动跟着走，不用手动重排；
- 工具说"做好了"就真的能直接用；做了一半也说清楚差哪一步、怎么补；
- 工具之间的操作别互相拆台，导入素材先"预览/隔离"再落地；
- **做计划时就得有导演参与**：先定"讲什么、这个镜头为什么存在、用生成还是图形、怎么连贯"，生图/生视频带上风格锁定和参考锚点——把这些要求写进计划和技能、放在 AI 一上来就能看到的地方，靠引导而不是靠系统拦截；
- 让人不用一直开着编辑器页面，AI 也能渲染出画面来检查、并最终导出成片。

下面从 `## 0.1 技术摘要` 开始是给工程同学看的详细版（问题清单、根因、契约改动、里程碑）。

---

## 0.1 技术摘要

这是一个「**把编辑器所有 MCP tool 都跑一遍**」的压力测试会话：主题「AI 应用最大的挑战不是开发，而是分发」，1920×1080 / 30fps / 约 51s，voice-led + 动效图形路线。会话从 02:39 跑到 04:12（约 93 分钟），工具几乎全部被调用过，**但最终从未执行 `export.start`，用户手动取消了会话，测试影片没有产出**。

复盘结论：**阻碍不在工具数量，也不在模型能力，而在六个「契约没建起来的墙」**——它们让每一步都要靠 Agent 现场猜、现场救、现场重读，累积成 93 分钟仍未交付：

| 主题 | 一句话判断 | 代表缺陷 |
|---|---|---|
| **A 默认值必须可交付** | 默认参数能让成片静默不可用 | 音频默认 `volume:0` → 旁白全程无声 |
| **B 派生物必须有依赖** | 源一改，派生内容静默漂移 | 字幕与语音无绑定 → 改口播后删掉整条字幕轨重导 |
| **C 工具契约必须可验证** | 返回的「成功」与库中真实状态不一致 | `component.create` 返回 draft，仍要逐个 `update` 救 |
| **D 写入身份与并发要稳定** | 编辑会偷换元素身份、内部 op 让 baseVersion 过期 | `script.clean` delete+insert 重建 → `element.get` not found |
| **E 验证=交付的硬门禁** | 无头不可用 → 长时段盲剪 + 无法交付 | iframe 离线 50 分钟无画面验证，最终无法确认 |
| **F 生成必先导演（Prompt 引导）** | 约束写对了，但会话没读到 = 等于没有 | 图片/视频未经 `recut-director` 直接生成 → 画面碎片、不连贯 |

其中 A/C/E/F 各有单点即可修复的 P0；B/D 需要契约设计。**方法论上分两层（本稿对 08-19「平台强制」立场的有意修正）：平台代码只保证「事实正确」**（默认值、状态真实、身份稳定、派生物可重算、目录/契约正确）；**行为规则（导演、选材、节奏、是否该生成、门禁纪律）用 Prompt/Skill 引导**，并把引导放在会话一开始就能读到的地方，**不新增代码门禁去"强制"规则**（见 §3 原则 10/11）。

---

## 1. 复现轨迹（来自 session 快照）

| 时间 | 事件 | 暴露的缺陷 |
|---|---|---|
| 02:39–02:40 | 环境就绪、写计划、用户确认 | — |
| 02:41 | `recut.speech.generate` 提交 6 段旁白；图片/视频/MG 并发生成——**全程未加载 `recut-director`** | F1/F2 |
| 02:42 | **S0 语音在 save 步骤失败**：`local speech save failed, transport` | C1 |
| 02:43 | 语音任务持续 save 失败且**占用 Audio Studio 单槽**；取消后改走 `audio.synthesize` | C1 |
| 02:44 | 项目 lock/checkpoint；加轨；插图；S0 合成完成，**取消 3 个重复任务** | C1 |
| 02:46 | 预览帧发现 `fontSize` 单位误解（96 过大） | E3 |
| 02:48–02:51 | **MG 批完成但组件是 `draft`**；逐个 `motion-graphic.update` 才拿到 verified head | C2 |
| 02:53 | 插入 `effect.particle-scroll` 效果元素 | D3 |
| 02:58 | contact sheet：S3（30s）**黑屏**（视频仍 proposed）、漏斗计数 `0+` | C3/E1 |
| 02:59–03:03 | **两次**重写漏斗计数为 seek-safe（`onUpdate` 不存活于 seek） | E2 |
| 03:15 | **编辑器 iframe 离线**，`preview/export` 阻塞 | E1 |
| 03:21 | `film.package.import` 往**主轨**塞入片段 → 用 undo 回退 | D2 |
| 03:28 | 发现 6 条旁白 `volume:0` → 逐条 `param {volume:1}` | A1 |
| 03:30–03:47 | 字幕生成/导入；`script.clean` **delete+insert+trim 重建片段** → `element.get` not found，只能重读时间线 | B1/D1 |
| 03:53 | `cover.set-frame` 需 base64，先 shell `sips` 压图 | E3 |
| 03:56–03:58 | validate 报 `component-def: effect.particle-scroll` → 删效果元素 + 移除 FX 轨 | D3 |
| 04:02 | **删除整条字幕轨**，`startSec:-0.4` 整轨重导对齐口播 | B2 |
| 04:06 | validate 零违规；`preview.frame(21s)` | — |
| 04:08 | 编辑器恢复在线，等漏斗帧确认 | E1 |
| 04:12 | **用户取消会话；从未导出** | E1 |

**量化**：93 分钟内，仅"救火"型操作就包括 1 次语音链路切换 + 3 次组件 update + 6 次音量修正 + 2 次漏斗重写 + 1 次 import 回退 + 1 次元素查找失败重读 + 1 次整条字幕轨重导 + 1 次效果元素删除。真正"创作"的操作（分镜、关键帧、动效）占比被严重稀释。

---

## 2. 问题清单

严重度：P0 = 会让成片错误/不可交付或工具契约说谎；P1 = 显著增加往返与出错概率；P2 = 文档/细节。

| # | 问题 | 严重度 | 证据 | 根因 |
|---|---|---|---|---|
| **A1** | 新落轨音频 `volume:0`，成片静默 | **P0** | 6 条旁白全为 `volume:0`，Agent 逐条改 1 | `editor_model.go:55` `editorCoreDefaultAudioParams={"volume":0}`；`placeAudio` items 无 `volume` |
| **B1** | `script.apply/clean` delete+insert 重建语音元素，元素 id 失效 | **P0** | `element.get el-ai46-0` → `element not found`；重读得 `el-ai63-0` | `editor_script.go:745` `buildScriptOps` 先 delete 整段再 insert 新元素；返回值不含新 refs |
| **B2** | 语音时间一改，字幕静默失同步，无重算入口 | **P0** | 删掉整条字幕轨，`startSec:-0.4` 重导入 | 字幕 cue 与 speech/transcript 无派生关系；无 `subtitle.resync` |
| **B3** | `script.read` 仅覆盖已挂 transcript 的元素，6 段旁白只出 1 段 | P1 | 文稿只有 1 段（vo-s0 的 ASR） | `script.read` 逐元素要求 `transcript`；无整轨转写/批量 attach |
| **C1** | 平台本地语音路由在 save 步失败，且占用单槽、产生重复任务 | **P0** | `local speech save failed: transport`；取消运行中任务；取消 3 个重复 | `local_speech_bridge.go:77` 的 `capabilityInvoke(audio.save)` 失败；重提交无幂等去重 |
| **C2** | `component.create` 返回草稿态，却按成功返回，需逐个 `update` 救 | **P0** | "created but shown as draft"；3 次 `motion-graphic.update` | 默认路径被设计成**必经受限作者子 Agent**：`motion_graphic/ops.go:401 finalize` 只在 commit 账本齐全时才 `applyVerify`，账本一断就退化为 draft，而调用方只看得到"成功"；同时缺少"直接传源码、一步 verified"的直通路径 |
| **C3** | 生成中的视频/图片仍显示能占位 → contact sheet 黑屏 | P1 | S3(30s) 黑屏，视频仍 `proposed` | `proposed` 资产可作为画面引用且不报 `asset-exists`，validate 不拦 |
| **D1** | 服务端副作用 op 让调用方的 `baseVersion` 意外过期 | P1 | `placeAudio baseVersion:71` → conflict（`transcript-attach` 已 +1） | 写入口内部 op 不参与调用方的版本协商，需手工重试 |
| **D2** | `film.package.import` 污染现有主轨，无 staging/dry-run | P1 | import 后主轨多出片段 → undo | import 直接并入当前场景主轨 |
| **D3** | 效果目录 id 被当作组件放置，validate 才拦；无效果插入一等路径 | P1 | `component-def: effect.particle-scroll` → 删元素 + 移轨 | catalog `effect.*` 与元素 `type:effect+effectType` 无唯一映射；写入时不校验 |
| **E1** | `preview/export` 强依赖 iframe 心跳；无头不可用 → 长时盲剪、无法交付 | **P0** | 03:15–04:06 无画面验证；最终未导出 | `editor-not-open` 硬门禁 + `headless-unavailable`（P2 未实现） |
| **E2** | 组件 seek-safe 确定性仅在运行期暴露，构建/验证期不检测 | P1 | 漏斗计数 `0+`，两次重写 | 确定性扫描未覆盖 `onUpdate`/`Date.now`/`Math.random`；运行时 `progress`/`localTime` 上下文无契约 |
| **E3** | 文本 `fontSize` 单位无文档：单位≈×10px，默认值与画布脱节 | P2 | 首次 96 过大，改 9–11 | `params.md`/`data-model.md` 无单位表；默认 72 |
| **E4** | 帧做封面需手工 base64 压缩 | P2 | shell `sips` 压图再 `cover.set-frame` | `preview.frame` 默认不落库；无 `cover.set-from-frame(assetId)` |
| **E5** | 工具从"调用覆盖"到"交付闭环"缺少自检清单 | P2 | 全工具跑遍却无 export | skill 缺"覆盖测试必须收敛到 export"的收口纪律 |
| **E6** | 视觉验证反馈多为"多张单帧"或"单封面"，AI 需多次读图；组件多帧效果无法一次验收 | P1 | contact-sheet 一张图即发现 S3 黑屏/漏斗 `0+`，但组件 verify 只回单封面 | `preview.contact-sheet` 已能多帧拼一张，却未作为所有验证面的统一交付；组件 verify 无多 progress 拼图 |
| **F1** | **Plan 阶段没有导演参与**：计划只有选题/route/分镜标题，无 viewer job、媒介判定、段/场景单位与连续性 | **P0** | 全程未加载 `recut-director`；计划里没有导演段 | `recut/SKILL.md:96-98`「生成必先导演」是平台 skill 散文；plan-first 未把导演列为合同项；work_surface `requiredSkill` 只带 `recut.editor/recut-editor` |
| **F2** | **生图/生视频硬约束不生效**：未加载导演、无 STYLE LOCK、references 可空、`mode:"generate"` 可绕确认 | **P0** | 图片/视频直接生成提交；视频仍落 `proposed` 但未走导演 | 生成工具 `recut.image.generate`/`recut.video.generate` 不检查"导演回执/计划绑定/风格与参考合同"，约束只在 skill 文档 |
| **F3** | 生成产物无导演溯源，事后无法判断是否经过导演、属于哪段 | P1 | 无法从 asset 回溯 plan/shot | 生成 asset 只记 modelId/jobId，无 `planRef/route/shotId` provenance |

---

## 3. 架构原则（代码管事实，Prompt 管规则）

> 1–9 是"事实/机制"层，必须由平台代码保证（这些不是规则，而是正确性）。10–11 是"行为/政策"层，**只用 Prompt/Skill 引导，不加代码门禁**。

1. **默认值必须可交付**：任何默认参数都不能让成片静默不可用（音量、透明度、可见性、时长）。默认值错误应被 validate 拦成告警。
2. **派生物必须有依赖**：字幕←语音、duck←track role、封面←成片。编辑源时必须显式失效派生并可一键重算，禁止静默漂移。
3. **工具契约必须可验证**：工具返回的 `status` 必须等于库中真实状态；不允许「返回成功、状态却是草稿」；失败必须结构化并带可执行 hint。
4. **元素身份要稳定**：编辑不得用 delete+insert 偷换身份；地址失效时，写入口必须在返回值里给出新 refs / remap。
5. **副作用必须可预测可重试**：写入口唯一；内部 op 不得让调用方的 `baseVersion` 意外过期；冲突返回 `retryWith` 由调用方原样重试（不做服务端自动重试）。
6. **验证不得依赖人的在场**：无头渲染是交付闭环的硬前提；不可交付时必须早期就告知，而不是让 Agent 盲剪 50 分钟。
7. **目录语义唯一**：catalog id ↔ 元素类型/字段必须有唯一映射与写入校验（`effect.*` 只能是 effect，不能是 component）。
8. **默认直通，Agent 是显式例外**：能用一次同步调用（传源码 → 构建 → 验证 → 返回结果）走完的，就不该默认拉一个子 Agent。子 Agent 只用于**确实需要自主探索**的复杂任务，且必须以显式参数开启——把"需要多绕几层"从默认路径变成显式成本。
9. **验证反馈以一张图交付**：多帧验收必须能在一张**带时间/progress 标注的拼图（storyboard / contact sheet）**里完成；AI 的一次视觉调用应能覆盖一个场景或一段动画的多个关键时刻，而不是拿一堆单帧逐张读。
10. **行为规则用 Prompt 引导，不用代码硬拦**：导演、选材、节奏、"生成前该做什么"、门禁纪律，一律写在 Skill / Plan 模板 / 工具描述里，并放在**会话一开始就能读到**的位置（而不是靠 Agent 偶然翻到）。平台不为此新增校验/拒绝/回执校验——规则的执行力来自清晰的引导，而不是代码门。
11. **探索软、交付硬**：便宜的探索（草稿图、试镜、草剪、试排）不做任何硬门，允许快速试错；贵且不可逆的交付（视频生成确认、导出）沿用**既有**确认门，不额外加码。判断标准是"错了能不能便宜地重来"。

---

## 4. 落地方案

### 4.1 主题 A：音频默认值与可听性（A1）

- **默认值修正**：`editorCoreDefaultAudioParams.volume` 由 `0` 改为 `1`；按 track role 区分语义（`anchor` 旁白默认 1，`follower` BGM 使用素材自带/显式 volume）。`timeline.placeAudio` 的 items 增加可选 `volume`，缺省 1。
- **软提示（不拦）**：`timeline.read` / `timeline.validate` 对 `type:audio && volume==0 && 无 volume keyframe && !muted` 给一条**信息性提示**，指出"该音频当前静音，若为旁白请检查 volume"。不做 hard violation，也不在 `export.start` 加确认门——是否静音由用户/Agent 判断。
- **回填**：对历史项目，`placeAudio` 重放时把 volume 0 视为显式静音（用户主动设 0），不自动改；仅在新建路径改默认。

### 4.2 主题 B：声/字联动与语音元素稳定身份（B1/B2/B3）

- **B1 稳定身份**：`buildScriptOps` 不再"整段 delete + insert 重建"，改为用既有 `trim` + `split` 原地切分，保留原元素 id；若确需重建（如跨元素合并），`script.apply/clean` 返回 `refs` 与新元素 id 映射（`remap: [{oldRef, newRef}]`），使调用方无需全量 `timeline.read`。（不引入"逻辑地址/物理 id"两层抽象。）
- **B2 字幕重算（轻量版）**：字幕 cue 可选带 `subtitle.sourceRef = {trackId, elementId, segIdx}`；新增 `subtitle.resync` op，按同一 transcript + 当前 speech 时间**重算** cue 时间与文本。**不做** `caption-desync` 硬校验（用户手工微调字幕是合法行为，硬校验必误报），也不做双向依赖图。
- **B3 整轨转写**：`subtitle.generate` 从「单元素 ASR」升级为「整条 speech 轨一次性转写并回填到各元素 `transcript.segments`」；`script.read` 对无 transcript 的 speech 元素给出明确提示或自动排队。转写仍走 audio-studio 能力桥（08-22），只是目标从元素改为轨。

### 4.3 主题 C：生成链路契约（C1/C2/C3）

- **C1 本地语音路由端到端**：修 `wireLocalSpeechBridge` 的 `audio.save` 能力调用（正确 scope/签名/目标）；save 失败时任务以结构化错误（`code` + `hint`）终结，**不占用推理单槽**（合成与落库解耦）；`recut.speech.generate` 按幂等键去重，避免重提交产生重复任务。补一条 E2E：local route → 产物含真实字节。失败时 hint 指向"改用 audio.synthesize/audio.save 或切换云端"。
- **C2 组件契约：默认直通，作者子 Agent 是显式例外**（本稿采纳 2026-09-23 讨论决策）：
  - **默认直通（synchronous）**：`motion-graphic.create` 默认接收 `source`（单文件 TS/TSX，符合作者契约），平台同步执行 **构建 + 轻量验证 + 发布 verified**，直接返回 `{componentId, versionId, status, report}`；有问题用 `motion-graphic.update(componentId, source)` 迭代。即把现有 `define(forceVerified)` / `update` 的"一次调用出 verified"能力补到 create，简单组件不再需要子 Agent 回合，也从构造上消除了"作者没 commit / 返回草稿"这一整类失败面。
  - **Agent 模式（显式参数 opt-in）**：新增显式参数（建议 `author: true`，或 `mode: "agent"`）才启动受管作者子 Agent，用于**复杂到需要自主探索/多镜编排/视觉迭代**的组件。此模式下保留 `subagentTools`/`commit`/`finalize` 账本，并强制契约：返回的每个 component 要么 `status=verified`，要么在结构化结果里给出 `{status, reason, recoverable}`——不得把 draft 当成功。
  - **失败面收敛（两条路径共同）**：直通路径构建失败即 `failed` + 结构化 `buildError`；Agent 路径缺 commit / 被中断即结构化 error，不静默退化为 draft。
  - **不新增 op**：agent 模式偶发的 draft 直接用**既有** `motion-graphic.verify`（附 build-passed 报告）收敛即可，不新造 `finalize`；`create` 返回结构化明细（哪些 verified、哪些 draft 及原因）已足够指引下一步。
  - **对账**：覆盖 2026-09-22 作者子会话 commit 门回归（`motion_graphic_platform_test.go`），确认 agent 模式 finalize 正确读取 commit 账本。
- **C3 占位不静默**：生成中（`proposed`/`queued`/`running`）的媒体素材作为画面引用时，`timeline.validate` 增加 `asset-pending` 提示；`preview.*` 对未完成资产渲染明确的占位（而非黑屏），并在返回里标注 `pendingAssets`。

### 4.4 主题 D：写入并发、导入与目录语义（D1/D2/D3）

- **D1 冲突可重试（不做自动重试）**：写入口返回冲突时附 `{conflict:true, retryWith:{baseVersion}}`；由调用方原样重试。**不做服务端自动重试**（会掩盖用户/UI 同时改的真实冲突）；skill runbook 写一句"`conflict` 不是错误，用 `retryWith` 原样重试"。
- **D2 导入隔离（单一方案）**：`film.package.import` 默认导入到**新场景**并返回 `importedRefs`；不做 `dryRun`/`staging`/`mode` 三套开关。禁止默认污染当前 main 轨。
- **D3 目录语义唯一**：
  - `library.browse` 的 effects 每项附 `elementTemplate`（`{type:"effect", effectType:id, params:默认值}`），并在文档明确"effects 用 `insert` 落 `effect` 元素，不是组件"。
  - `placeComponents` 拒绝非组件 id（含 `effect.*`），hint 指向正确路径；`timeline.command insert` 对 `componentId` 解析失败时同样 fail closed。
  - validate 的 `component-def` 与 `effect-type` 违规补 `hint`（"未见 type=effect + effectType" / "componentId 未登记，先 asset.add"）。

### 4.5 主题 E：验证与交付闭环（E1–E6）

- **E1 无头渲染（本体归既有 RFC，本稿只做过渡）**：无头 Render Host 的规格已在 `2026-09-17-editor-native-migration.md`（`frame.render`/`export.encode`），本稿不重复设计。过渡期只做三件小事：
  - `preview.frame` 在 iframe 离线时返回"最近一次同 version 缓存帧 + `stale:true`"而非硬错，避免完全盲剪；
  - `editor-not-open` 的 hint 给出"一键打开编辑器"的可执行动作，而不是让 Agent 停下；
  - 编辑器宿主（`web/app/projects/[id]/project-detail-client.tsx:277-287`）在页面切换/折叠时尽量保持心跳，或明确告知渲染不可用。
- **E2 确定性用引导 + 软扫描**：在**作者契约（Prompt）**里写清组件时间上下文（`progress`/`localTime` 的定义与优先级）和"不要用 `onUpdate`/`Date.now` 驱动逐帧变化"；构建期扫描只作为**提示（warning）**列出可疑模式，不做 error 硬拦（构造期一次性使用是合法的）。
- **E3 参数与封面**：`params.md`/`data-model.md` 补 `fontSize` 等单位表（单位≈×10px、相对画布）与推荐区间；校正文本默认值使其相对 1080p 合理；`preview.frame` 增加 `saveToLibrary:true`，或新增 `cover.set-from-frame(assetId)`。
- **E4/E5 元数据与收口**：`recut.media.probe` 对纯音频返回合理元数据（当前 width/height/fps=0）；skill 增加"工具覆盖/成片"收口清单：任何成片任务必须收敛到 `validate` 零违规 → 关键帧视觉验收 → `export.start` → `job.wait` completed，否则只报告 draft。
- **E6 多帧拼图作为 AI 验证反馈（复用现有 contact-sheet，只做最小扩展）**：
  - **时间线**：沿用现有 `preview.contact-sheet({ times })`（一次 ≤16 帧拼一张，已可用），**不新增** `layout/range/count/columns` 一套参数矩阵；如需要，只在 Skill 里教 Agent"自己算好 times 再调"。
  - **组件/MG**：给现有拼图加一个 `progress` 参数（或让 `verify` 的证据从单 `cover` 变成 `progress: [0,.25,.5,.75,1]` 的拼图）+ **每格角标**，把动效节奏/可读性一次看全。就这两点，不做"统一所有验证面"的大改造。

### 4.6 主题 F：导演参与（用 Prompt 引导，不做代码门禁）

> 这条硬约束已经写在 `recut/SKILL.md:96-98`，问题是**它没被读到**，不是"没有代码拦"。所以解法是**把引导放到会被读到的地方 + 写得更可执行**，而不是加校验。

- **F1 Plan/Skill 引导**：Plan 模板增加"导演段"（`route` + 每个 shot/场景的 `viewer job` + 媒介判定 + 段·场景单位与连续性 + STYLE LOCK + typed references），并在 `recut-editor` 的生成段落（`references/video-generation.md` / `directing.md`）**第一步**就写"先 `recut-director` → route + shot，再提交生成"。不校验"计划里有没有导演段"。
- **F2 让约束在会话开始就可见**：
  - 把"生成必先导演"从平台通用 `recut/SKILL.md` **镜像到 editor skill 的生成段落**（会话的 `requiredSkill` 是 `recut-editor`，Agent 未必会读平台通用 skill）；或在生成工具的 description 里加一句提示"先读 `recut-director`"（**纯提示，不校验、不拒绝**）。
  - 视频继续走**既有**"待用户确认"（非新增）；图片不加任何门禁；`mode:"generate"` 不写进引导路径（Skill 纪律一句"不要用它绕过确认"）。
- **F3（可选，P2）生成溯源**：生成 asset 的 `metadata.generation` 可记 `planRef/route/shotId` 供回溯，**不做** validate 告警、不做门禁。

---

## 5. 契约改动清单

| 契约 | 改动 | 类型 |
|---|---|---|
| `editorCoreDefaultAudioParams` | `volume: 0 → 1` | 默认值（附回填策略） |
| `timeline.placeAudio` items | `+ volume?: number`（缺省 1） | 工具 schema |
| `timeline.read` / `timeline.validate` | `+ audio-silent` / `asset-pending` **信息性提示**（非 violation、不拦导出） | 提示 |
| `script.apply` / `script.clean` | 返回 `refs` + `remap`；内部改 trim/split 保 id | 工具返回 |
| `subtitle.resync` | 新 op（按 transcript + 当前 speech 时间重算字幕）；cue 可选 `sourceRef` | 工具 |
| `subtitle.generate` | 支持整轨 ASR（目标从元素改为轨） | 工具 |
| `motion-graphic.create` | 默认直通：`source` → 同步构建+验证 → verified；返回结构化明细 | 工具契约 |
| `motion-graphic.create`（Agent 模式） | 新增显式参数 `author:true` / `mode:"agent"` 才走受限作者子 Agent | 工具参数 |
| `motion-graphic.verify` / 作者证据 | 证据从单 `cover` 升级为多 progress 拼图 + 角标（仅此，不做统一框架） | 工具返回 |
| `recut.speech.generate`（本地路由） | save 结构化失败 + 幂等去重 + 不占槽 | 行为（bug 修复） |
| 写入口冲突返回 | `{conflict, retryWith}`（不做服务端自动重试） | 工具返回 |
| `film.package.import` | 默认导入到新场景 + 返回 `importedRefs`（不做 dryRun/staging 多开关） | 行为 |
| `library.browse` effects | `+ elementTemplate`；组件入口拒绝 `effect.*`（数据正确性，非规则） | 目录/校验 |
| `preview.frame` | 离线返回 stale 缓存帧；`+ saveToLibrary` | 工具 |
| `preview.contact-sheet` | `+ progress` 与格角标（复用现有 `times`，不做参数矩阵） | 工具 |
| `cover.set-from-frame` | 新 op（或 preview 落库复用） | 工具 |
| Plan 模板 / `recut-editor` 生成段落 | 导演段 + "先 `recut-director`"（**Prompt 引导，非校验**） | 引导 |
| 生成 asset `metadata.generation` | 可选记 `planRef/route/shotId`（无门禁，P2） | 元数据（可选） |

---

## 6. 里程碑

- **M0（P0，可立即修，独立小改动）**：A1 音频默认值 + 静音软提示；C1 本地语音 save；C2 create **默认直通路径**（传 `source` 一步 verified）+ `author` 显式参数（不新增 finalize）；D3 效果/组件写入校验 + hint；**F1/F2 Prompt 引导**（Plan 模板加导演段 + editor 生成段落镜像"先 `recut-director`" + 工具描述提示）——纯文档/技能改动，不加代码门禁。
- **M1（P0/P1）**：B1 script 稳定身份 + remap；B2 `subtitle.resync`（轻量版）+ 整轨 ASR；B3。
- **M2（P1）**：C3 占位提示；D1 `retryWith`；D2 import 到新场景；F3（可选）生成溯源 provenance（无告警）。
- **M3（P1/P2）**：E1 过渡期（stale 帧/保心跳/hint，本体指向既有 RFC）；E2 作者契约引导 + warning 扫描；E6 contact-sheet 加 `progress` + 角标。
- **M4（P2）**：E3 参数单位/封面；E4/E5 元数据与收口清单。

---

## 7. 验收

1. **A 类**：新建项目 `placeAudio` 后旁白可听；静音音频在 `timeline.read`/`validate` 有信息性提示（不阻断导出）。
2. **B 类**：对一段口播执行 `script.clean` 后，不 `timeline.read` 即可用返回的 `remap` 继续编辑；改动口播后 `subtitle.resync` 一键对齐，字幕无漂移。
3. **C 类**：本地路由 `recut.speech.generate` 端到端产出含字节音频（E2E 测试）；`component.create` 默认传 `source` 即返回 verified（无需子 Agent、无需再 `update`），Agent 模式（`author:true`）才走作者子 Agent 且返回结构化明细。
4. **D 类**：写入口冲突返回 `retryWith` 且可原样重试成功；`film.package.import` 默认落到新场景、不污染 main 轨；`effect.*` 经组件入口被拒并给出正确路径。
5. **E 类**：无 UI 场景下至少返回 stale 缓存帧而非中止；组件多个 `progress` 以带角标拼图返回，AI 一次读图即可定位问题格；含 `onUpdate` 的组件在构建期有 warning 提示；一次完整成片任务可在无"救火操作"的情况下收敛到 `export.start` completed。
6. **F 类**：会话一开始就能读到"生成必先导演"（editor skill 生成段落 / 工具描述 / Plan 模板导演段），**实际观察到 Agent 在生成前加载了 `recut-director` 并产出 route + shot**；不新增任何生成门禁。
7. **元验收**：以此会话脚本重跑，"救火型"操作数从 ≥14 降到 ≤2，且图片/视频生成发生在导演意图形成之后。
