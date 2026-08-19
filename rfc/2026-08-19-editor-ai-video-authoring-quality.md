<!--
 * [INPUT]: 依赖 2026-08-19 agent-session-debug 快照（session 6e0c4468…，project
 *          8502b16d…）、apps/editor 的 skill/UI 同步/导出代码，以及 ChatCut
 *          agent-plugin 的 create-motion-graphics、video-gen、talking-head-guide 与
 *          verification 工作流。
 * [OUTPUT]: 定义 Editor AI 从“文字时间线拼接”升级为“设计系统约束下的组件驱动导演”的
 *           质量契约、工具边界、同步模型、迁移顺序和验收标准。
 * [POS]: rfc 的编辑器 AI 成片质量治理文档；约束 skill、MCP 工具面、时间线同步与交付验证，
 *        不重写编辑器渲染内核。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: Editor AI 成片创作——导演模型、组件驱动与增量同步

- 状态：Proposal
- 作者：Recut
- 日期：2026-08-19
- 决策范围：`recut.editor` 的 AI 创作 skill、设计系统与组件准入、时间线批量写入、Agent/UI 同步、预览与导出交付门；不改变现有时间线模型、组件运行时或用户手动编辑能力。
- 关联：[Editor AI Agent Surface](./2026-08-14-editor-ai-agent-surface.md)、[组件素材工作流](./2026-08-16-editor-component-asset-workflow.md)、[组件创建链架构修复](./2026-08-19-editor-component-create-resilience-and-compositing.md)、[平台通讯 Op 总线](./2026-08-19-platform-communication-op-bus.md)。
- 外部参考：ChatCut [AI Video Editor](https://chatcut.io/features/ai-video-editor) 与 [agent-plugin skills](https://github.com/ChatCut-Inc/agent-plugin/tree/main/codex/skills)。2026-08-19 重新浅克隆最新 `agent-plugin` commit `f9bc5c9e8353372d002036f8bdde7cfba3eeeffa`，逐文件阅读 Codex 版本的 `chatcut-plugin-basics`、`asset-import`、`transcription`、`talking-head-guide` 及其全部 references、`create-motion-graphics`、`voice` 及其全部 references、`video-gen` 及其模型 references、`music`、`export` 与 `verification`。迁移的是 treatment 的输入/判断/执行/回读闭环，不采纳其插件安装、widget、Provider 或宿主专属工具契约。

## 1. 摘要

一次“自主创建 30 秒短片”的会话产出了 6 段文字、6 条装饰条和一段音乐。时间线结构合法，却不是一个可被视觉验收的短片。用户指出“图形元素必须同构创建组件”后，Agent 才删除 raw rectangle，创建并放置 `AccentBar` 组件；它仍没有为整支片建立画面主角、镜头变化或视觉系统。

结论不是“模型审美差”，而是当前 editor skill 根本没有定义好视频。它只定义了如何操作一条时间线：插入、裁剪、关键帧、校验。模型因此选择最便宜的可行路径：大字、单色背景、重复淡入淡出。

本 RFC 把“成片”定义为一个有**导演方案、设计来源、场景职能、画面资产、受控动效与交付证据**的对象。`timeline.validate = 0` 只代表数据合法，绝不代表视频成立。

## 2. 什么是一支好视频

ChatCut 的重要启发不是某个工具，而是它的产品边界：视频是“真实多轨时间线上可编辑的剪辑、motion graphics、B-roll、字幕、音频和生成素材”的合成结果；自然语言只是进入这些能力的入口。它明确要求：描述编辑后，变更必须落在可观察、可手动继续编辑的真实轨道上。

对 Recut，最小导演定义如下：

1. **叙事**：每个 scene 有观众要理解或感受的单一任务，而非均分 5 秒的文案页。
2. **画面**：每个非转场 scene 有一个可见主体，来自真实媒体、生成媒体或组件；文字用于命名、强化或引导，极少单独承担整幅画面。
3. **镜头关系**：画面形式由该时刻的 A-roll/B-roll、主体位置、字幕区、阅读时长和视觉重心决定，不由固定的居中安全区决定。
4. **视觉系统**：颜色、字体、空间、材料和动效语气来自一个明确设计系统；同片共享语言，不把所有 scene 压成同一条 bar 或同一张卡。
5. **节奏**：先结构，再时序，最后修饰。动效必须解释、强调、连接或制造节拍；不能用相同的淡入淡出假装发生了镜头变化。
6. **可交付性**：用户随时能看到并编辑 scene、组件、素材和时间线；最终结论必须由合成画面和导出结果证明。

这组定义让“无 TTS”成为声音策略选择，而不是“只剩文字”的理由。没有旁白时仍可做 component-led 的视觉短片、media-led 的蒙太奇或 explicit-text-only 的实验性排版，但最后一种必须由用户明确选择。

### 2.1 先判断编辑意图，再做视频类型路由

ChatCut skills 的核心不是“有很多功能”，而是**先判断当前请求属于哪一种编辑问题**。Recut 先区分从零创作和已有时间线的二次编辑，再决定是否需要视频类型 route。已有项目必须先读 `timeline.read`，确定 scope；未点名的内容默认保持不动。

| 编辑意图 | 识别信号 | 首要动作 |
|---|---|---|
| `new-authoring` | 空时间线或明确要求从想法做成新片 | 建立视觉方向，再选择 route |
| `timeline-revision` | 修改已有内容、节奏、镜头或顺序 | 圈定 scene/track/element，只改目标范围 |
| `visual-revision` | 修改构图、组件、字幕样式、颜色或动效 | 先看目标 frame，优先调整现有 asset |
| `audio-revision` | 修改人声、旁白、音乐、duck 或同步 | 读取音轨与 speech timing，保留画面时间 |
| `asset-replacement` | 替换某个媒体、组件或声音资产 | 保留原 placement 和依赖，替换后回读 |
| `delivery` | 只预览、校验、导出或设置封面 | 不做创作性改动 |

只有 `new-authoring` 或二次编辑 scope 需要新增画面时，才进入下面的 route 表。route 决定要读哪些 reference 和哪些 treatment 有资格进入当前编辑单元，不是项目的永久类型。

| 输入/意图信号 | canonical route | 必须先处理 | 可选下游 |
|---|---|---|---|
| 已有单人口播、访谈、播客、课程、演讲，且声音承载内容 | `speech-led` | 转写/文字稿、A-roll | B-roll、motion graphics、字幕、背景音乐、人声处理、多机位 |
| 已有视频/图片/屏幕录制，但没有以讲话为主线 | `media-led` | 素材盘点、镜头结构、画幅/保护区 | 主画面素材、motion graphics、字幕、音乐、转场 |
| 没有源视频，要求生成一条叙事视频 | `generated-video` | 视觉脚本、shot list、角色/场景连续性 | 生成视频/图片、旁白、音乐、motion graphics、字幕 |
| 明确要求标题卡、数据图、片头、独立动画 | `motion-graphics` | viewer job、Design Style、representative frame | 组件批量制作、音乐/SFX |
| 只有音频/旁白/脚本 | `voice-led` | 语音轨和脚本结构 | B-roll、motion graphics、字幕、音乐 |
| 只要求剪辑已有素材的长度/顺序 | `timeline-edit` | 结构和时序 | 只执行用户点名的处理，不自动加 motion graphics/B-roll/音乐 |

路由不能由某个工具是否可用决定。例如 TTS 不可用时，`speech-led` 不能自动变成 `explicit-text-only`；它应报告声音能力缺失，并在用户允许的情况下切换到 `generated-video` 或 `motion-graphics`，重新判断当前编辑单元。

### 2.1.1 ChatCut 的真实判断链：不是标签，而是工作流分派

这次参考中最容易被误读的地方，是把 A-roll、B-roll、motion graphics 当成素材标签。ChatCut 的 skill 实际上把它们定义成不同的**编辑问题**，每个问题都有自己的输入、决策、工具边界和验收证据：

| ChatCut skill 中的判断 | 它真正回答的问题 | Recut 必须固化的结果 |
|---|---|---|
| `chatcut-plugin-basics` | 这是项目/时间线/素材/轨道上的什么任务？是否需要先对齐目标？ | `workflow.context` 返回 route、source state、canvas、已有 tracks/assets；Agent 不能从工具列表反推创作策略。 |
| `talking-head-guide` | 语音是否承载主线？A-roll 是 cleanup、highlight、restructure、hook 还是 target-script？ | `speech-led` 必须先建立 transcript-backed A-roll plan；A-roll 不是“有一条视频就默认保留原片”。 |
| `talking-head-guide` 的 motion graphics 段 | 哪个信息用视觉表达比说出来更清楚？它是 overlay 还是 full-screen beat？ | 每个 motion graphic 有 viewer job、content、timing、form、background、target frame；不能用一个 text box 代替所有 motion graphics。 |
| `talking-head-guide` 的 B-roll 段 | B-roll 是遮跳切，还是把语义对象具体化？应该 cutaway 还是 PiP？ | 每个 B-roll 先选 mode，再检查源画面和目标画面的 protected regions，最后决定 fit/placement。 |
| `talking-head-guide` 的音频段 | 谁是 anchor，哪些声音应该 follower，哪些 SFX 不应 duck？ | 语音/旁白和音乐是 track role 关系，不是几个独立音频 insert；最终结构稳定后才 smooth。 |
| `create-motion-graphics` | 该图形的内容、时间跨度、overlay/full-frame 角色和视觉方向是什么？ | 先做一个 representative component 并验证合成帧，再批量创建同一视觉语言下的不同 viewer job。 |
| `video-gen` | 是一条多 shot clip 还是多个独立 clips？每个 shot 的 subject/action/scene/camera/style 和 anchor 是什么？ | 生成 job 只返回候选 asset；shot plan、continuity receipt 和用户反馈完成后才允许落轨。 |
| `verification` | 结构合法是否真的等于画面成立？ | 结构 readback、composed pixels、export result 是三个不可互相替代的证据层。 |

因此，Recut 的 route 判断不能只说“这是 speech-led”。Agent 需要能用自然语言说明：当前编辑单元要解决什么、哪些 treatment 需要/不需要、下一步读什么、完成后如何回读。用户说“不要问细节”时可以自主选择默认值，但不能跳过这些判断，也不能把未启用 treatment 留成含糊的空白。

### 2.1.2 四类场景必须有不同的落地算法

**A-roll（speech-led）**：先读转写，再按完整语义单元选择 cleanup、highlight、restructure、hook 或 target-script。不能用 `find_transcript` 找时间戳后手工切片来代替 Script；`script.apply` 后必须重新读取 canonical speech timeline。A-roll 定稿产生 `speechTimingVersion`，所有 motion graphics/B-roll/字幕/音乐引用都绑定这个版本。

**B-roll（语义补画面或遮跳切）**：先判断是 `jump-cut-cover` 还是 `semantic-visual`，再决定 `cutaway` 或 `pip`。PiP 必须检查 A-roll 的脸、嘴、手势、字幕、logo 和现有 overlay；全屏 cutaway 必须比较源/画布比例，逐源决定 `cover`、安全重构或 `contain + deliberate background`。不能批量默认右下角、批量默认 `cover`，也不能把“素材进入 library”当成已落轨或已验证。

**Motion graphics**：先写 viewer job 和 visual mechanism，再选透明 overlay 或不透明 full-screen；资产内部只表达内容和自身节拍，不写最终画布坐标。第一个 representative motion graphic 的 settled frame 通过后，才允许创建同风格的其他角色；相同颜色/字体不足以证明可以复用同一个组件，复用条件必须是相同 viewer job、信息结构和视觉形式。这里 motion graphic 是创作语义，component 是默认实现载体。

**Generated video**：先写 shot list，不让生成模型自行补全叙事。每个 shot 至少声明 subject、action、scene、lighting/color、camera、style、motion endpoint；跨 shot 复用角色/物体/场景时建立 anchor，并按依赖串行等待已批准 shot。生成结果是新 asset，不自动改变 timeline；若同一提示词两次仍出现 identity drift，应切换 anchor 或编辑路径，而不是继续堆文字 prompt。

这四条算法正是当前会话缺失的判断层：它把“做视频”从 `insert(text)` 改成“先决定观众要看什么、为什么看、由哪一层表达、何时可以落轨”。

### 2.2 treatment 是正交选择，不是默认大礼包

路由确定后，再判断下列 treatment 是否有必要。每个 treatment 都必须有一个“为什么需要它”的编辑理由：

| treatment | 观众/剪辑问题 | 默认启用条件 | 禁止的捷径 |
|---|---|---|---|
| **A-roll** | 观众应该听到哪些完整语义单元？ | `speech-led` / `voice-led` 必须先定稿 | 不能先铺字幕、motion graphics 或音乐再回头改口播。 |
| **B-roll** | 如何覆盖跳切或把提到的对象具体化？ | 有明显 jump cut，或语义需要对象/场景画面 | “加 B-roll”不等于批量 cover；每个源要检查画幅和受保护信息。 |
| **Motion graphics** | 哪个信息、关系、数字或章节用画面比口头表达更清楚？ | 有结构化信息、抽象概念、章节或品牌信息 | 不能把 motion graphics 当字幕条；不能让所有 motion graphics 复用同一形状。 |
| **字幕** | 如何让语音可访问、可扫描或适配社交平台？ | 用户要求，或 route/target 明确需要 | 不能在 A-roll 时序未定稿前生成；字幕不是普通 text 轨。 |
| **背景音乐** | 如何建立情绪、填补微小空隙并托住语音？ | 用户要求或视频确实需要声音底 | 不用音乐掩盖结构问题；speech track 必须 anchor，BGM 才是 follower。 |
| **人声/旁白** | 谁在说、说什么、以什么语气？ | 用户要求旁白、无源视频但需要讲述 | 不因“没有 TTS”把叙事替换成大字。 |
| **转场/效果** | 两个镜头为什么需要连接或强调？ | 镜头关系和节奏有明确理由 | 不把转场数量当完成度。 |

Treatment selection 记录在项目内普通 Markdown 工作稿 `project.md` 中即可，不引入 `CreativePlan` 类型、状态机或专用 CRUD。每个 treatment 用自然语言写清“为什么需要/不需要、依赖什么、下一步读哪个 reference、完成后回读什么”；`not-needed` 也写成一行明确理由。timeline 才是最终结构化结果，工作稿只负责让导演决策可读、可续接、可追溯。

### 2.3 依赖图：A-roll 先定稿，其他层按需下游化

对于讲话驱动视频，ChatCut 的执行顺序应完整迁移为 Recut 的硬门禁：

```text
asset-import
    -> transcription ready
    -> A-roll plan (cleanup / highlight / restructure / hook)
    -> script.apply + re-read + semantic check
    -> speech timing frozen
        ├── B-roll sourcing / generation / placement
        ├── motion graphic style choice -> component.create -> placement
        ├── captions import/refresh
        └── music fit + anchor/follower ducking
    -> smooth audio (last audio mutation)
    -> structure proof -> composed-frame proof
    -> export proof
```

具体规则：

1. `speech-led` 中，A-roll 未进入 `complete`，拒绝 `timeline.placeComponents`、B-roll placement、`subtitle.import` 和 music fit；允许读取素材和生成候选，但不允许把候选落轨。
2. A-roll 完成后，读取新 timeline version；所有下游引用的 `startSec/durationSec` 都必须来自这个版本，不能使用 pre-edit transcript 时间。
3. B-roll、motion graphics、字幕、音乐是相互可选的 sibling treatments，不要求每条口播都填满所有层；但每个选择必须有 reason。
4. A-roll 再次变化时，所有下游 treatment 标记 `stale`，不得悄悄保留旧时间；系统应返回受影响 scene 和需要重做的资产/placement。
5. `smooth_audio` 必须是 A-roll/音频结构稳定后的最后一个 audio mutation，避免每次中间编辑都重复做淡入淡出。

对于 `media-led` 和 `generated-video`，没有 A-roll 时依赖图从 `shot-list/visual-script` 开始，但仍保留同样的层概念：主画面素材是 primary video layer，B-roll 是 cutaway/secondary visual，motion graphics 是解释层，字幕和音乐分别属于 text/audio layer。不能因为没有讲话就把所有画面任务都压到 text layer。

### 2.4 Scene 计划只做导演工作稿

不要在工作稿里复制 timeline 的 source/overlay/audio/text schema。Agent 在 `project.md` 里用一段一场的自然语言记录 scene 的观众任务、画面机制、候选媒体/组件、文字角色、预计读时和验证备注；真正的轨道角色、时间、assetId、参数和关键帧全部以 `timeline.read` 的结果为准。

例如 Agent 在创建“为什么人人都应该成为内容创作者”时，工作稿可以写成：

```text
scene-01 hook: full-screen component / “观察 -> 发布”路径建立世界观
scene-02 proof: generated or library B-roll / 手机拍摄、剪辑、发布的真实动作
scene-03 metaphor: component / 经验节点连接成可复用资产
scene-04 contrast: B-roll cutaway + motion graphic / 不发布 vs 发布后的反馈循环
scene-05 release: music lift + hero component / 从旁观者转为创作者
scene-06 cta: title component + short supporting text / 今天发布第一条
```

文字只是每个 scene 的 supporting/headline 层；它不再是 primary 的默认值。落轨后必须回读 timeline，而不是把这段工作稿当作结构化事实。

### 2.5 现有 Recut 操作与 ChatCut treatment 的对应表

| ChatCut skill 分层 | Recut 现有入口 | 需要补的门禁/适配 |
|---|---|---|
| asset-import | `recut.media.list_assets` / asset registration | route 阶段记录 source kind、时长、画幅和 transcript 状态。 |
| transcription / A-roll | `script.attach/read/clean/apply/find` | `speech-led` 必须先完成；下游操作读 `speechTimingVersion`。 |
| B-roll | `library.browse` + media asset + `timeline.command` | 新增 `broll.plan`/source inspection，逐源选择 cutaway/PiP、cover/contain 和受保护区域。 |
| Motion Graphics | `component.create` + `timeline.placeComponents` | Prompt 说明统一风格、viewer job、target frame 和可编辑 props。 |
| captions | `subtitle.import/export` + caption style | 只能从 frozen transcript/script 生成；独立字幕轨，不能混普通 text。 |
| audio/music | `track.role` + `audio.smooth` + library audio | anchor/follower 配对、最终时长确定后再 fit，SFX 不默认 follower。 |
| video generation | 媒体生成 adapter / asset pipeline | 生成 job 只生产候选 asset，不隐式落轨；需 reference/continuity/ratio receipt。 |
| verification | `timeline.validate` + `preview.frame` | 增加按 scene 的 composed-frame/contact-sheet proof。 |
| export | `export.start/progress/complete` | 暴露 MCP async handle，并绑定最后 proof version。 |

### 2.6 路由与执行的伪代码

```ts
async function authorVideo(request, context) {
  const route = classifyInput(request, context);
  const treatments = selectTreatments(route, request, context);
  await writeCreativeMarkdown({ route, treatments, request, context });

  if (route === "speech-led") {
    await finishARoll();
    await appendCreativeMarkdown({ speechTiming: await readVersion() });
  }
  await resolvePrimaryAssets();
  await resolveSelectedBroll();
  await resolveSelectedMotionGraphics();
  await placeCaptionsAfterSpeechFreeze();
  await fitMusicAfterStructureFreeze();
  await readTimeline();
  await proveStructure();
  await proveSettledFrames();
  await smoothAudioIfNeeded();
  return await deliverOnlyWithEvidence();
}
```

关键不是函数名，而是**每个 treatment 都有 route、reason、依赖和完成状态**。Agent 不能因为当前有一个 `text insert` 工具，就跳过 route 和 dependency。

## 3. 会话复盘

| 观察 | 会话事实 | 根因 |
|---|---|---|
| 未做场景路由 | 项目为空、没有源视频、用户要求“创建一条 30s 短片”；正确入口应是 `generated-video` 或无生成能力时的 `motion-graphics`，Agent 却直接把请求解释成 kinetic typography。 | 缺少 ChatCut 式 scenario/router 层，工具可用性反过来决定了视频类型。 |
| 过早退化为文字片 | 首个判断就是“TTS 未配置，因此做动态文字 + 音乐”；随后固定为 6 个 5 秒文案节拍。 | 没有导演方案门，也没有“每个 scene 必须有画面主体”的约束。 |
| 图形资产路径错误 | 先用 `timeline.command insert` 写入 6 个 raw `graphic/rectangle`；收到用户纠正后才走 `component.create -> verified asset -> timeline.placeComponents`。 | 组件链已经存在，主 skill 却没有把 AI 创造视觉的组件路径设为默认。 |
| 没有真实设计系统 | Agent 声称会检查设计系统，但没有 `recut.design_system.list/get` 回执；最后硬编码 `#FF6B00` 和 `#1D1836`。 | 全局设计系统要求先 list/get 并落 token，editor skill 没将其列为创作门。 |
| 关键帧吞噬创作时间 | 6 个 text beat 使用同一淡入、缩放、淡出模板，版本从 16 增至 64；并行写入还因相同 `baseVersion` 冲突。 | 低层逐 op 写入被当作创作主路径；画面尚未被证明成立就开始优化动效。 |
| 用户纠正未立即收敛 | 用户 04:44:20 要求组件后，运行中的 keyframe 循环仍继续到 04:48:22。 | 当前执行模型没有把新用户指令变成对队列/事务的取消信号。 |
| “零违反”误报为“成片” | validate 通过后，`preview.frame` 因 iframe 不在线失败；无头预览未实现，导出又不在可用 MCP 工具面。 | 结构正确性、视觉正确性、交付正确性被混为一谈；skill 承诺与工具可达性不一致。 |
| 每次 mutation 刷新 iframe | `useRecutProjectSync` 收到 agent 的 `project.document.changed` 后调用 `loadProject`；E2E 也把该 reload 当作正确。 | Op 总线只传 version，不传可应用 delta；已有通信机制被降级为“通知后全量取数”。 |

## 4. 根因：系统缺少导演中间层

现状跳过了真正决定画面质量的层：

```text
用户意图 -> 文案节拍 -> 低层 timeline.command -> validate
                                      |
                                      +-> iframe 全量 reload

设计系统 / scene 职能 / 画面资产 / 合成帧证据 / 成片导出
                 （可选、断开、或 MCP 不可达）
```

正确路径应当是：

```text
用户意图
  -> Art Direction
  -> Scene Design Map
  -> verified Components / Media Assets
  -> Atomic Timeline Transaction
  -> Versioned Delta Event -> iframe applyRemoteOperations
  -> preview evidence -> export evidence -> delivered
```

其中 operation log 与 timeline 是唯一时间线事实源。导演方案只是项目内 Markdown 需求/执行记录，组件资产和交付证据是围绕 timeline 的辅助记录；它们都不能替代 timeline。

## 5. 决策

### 5.1 强制导演方案：先画面，后时间线

空项目的“直接做一支视频”必须先写一份项目内 `project.md` 工作稿，再取得写时间线权限。工作稿是自然语言的需求与执行记录，不是第二套数据模型；不注册 Plan 工具，不保存 JSON schema，不要求服务端审批。用户说“不要问细节”授权的是自主决策，不是跳过决策。

建议用简单标题和清单表达：

```md
# Creative work log

## Direction
- route: motion-graphics
- design system: <selected style + one-sentence visual rationale>
- visual rule: every non-transition scene has a visible media or component subject

## Treatments
- A-roll: not needed — no speech source
- motion graphics: selected — explain the relationship, not repeat captions
- music: selected — follower under the visual rhythm

## Scenes
### scene-01 · hook
- viewer job: establish the promise
- visual mechanism: a verified component, not a text box
- asset/status: component job pending
- proof: settle frame still needed

## Execution log
- 2026-08-19: style read
- 2026-08-19: component verified and placed; timeline version 12
- next: preview settled frame, then limited motion polish
```

每次 mutation 前读这份工作稿并读 `timeline.read`；每次 mutation 后把结果、version、jobId、proof 或 stale 原因追加回工作稿。若两者冲突，以 timeline 为准，修正文档，不反向编译 timeline。

- `recut.design_system.list` 后必须有 `recut.design_system.get`；组件 brief、文字和背景遵循已读取的统一视觉语言。
- 工作稿中的每个非转场 scene 必须写清 viewer job、visual mechanism 与候选可见主体；例如“创作是杠杆”可以是上升关系图、积木式复利结构或真实创作工作流，而不是同样一句居中文字。
- 30 秒 demo 默认包含 1 个开场/世界观主体、2–4 个解释或隐喻画面、1 个收束；可用全屏组件、局部组件、生成 B-roll、图片或视频组合实现。数量不是目标，画面职责才是。
- `explicit-text-only` 只能由用户明示；没有声音、没有媒体、没有 TTS 都不构成自动选择它的理由。

### 5.2 组件是 AI 的视觉素材，不是补救措施

保留 raw graphic 给用户手动编辑和平台内部实现，但对 AI 创造画面改变默认规则：

- 全屏背景、信息图、关系图、具象隐喻、程序化纹理、数据可视化、可重复装饰和字形表现优先走 `component.create`。
- Prompt 只要求 motion graphic 遵循同一套已读取的设计系统；`component.create` 保持现有轻量工具契约，不新增 `styleId`、token receipt 或 scene schema 的服务端门禁。
- 一组视觉元素只通过 `timeline.placeComponents` 的 verified `assetId` 原子落轨。`timeline.command insert` 不得成为“先塞个 rectangle”的规避通道。
- 只有同一观看任务、信息结构和视觉形式的项目才能复用同一组件实例。共享颜色、字体、动效语气是设计语言，不是复用同一组件的理由。
- 组件必须暴露会被用户改的文本、颜色、数值与媒体参数；可编辑性是组件价值的一半。

这吸收了 ChatCut motion-graphics workflow 最重要的部分：先为每个图形确定观众任务、内容、非文字机制、目标帧、读时、位置关系与内部节拍；文字很少独自构成一张图形。

### 5.3 先稳定态，后动效；关键帧退回实现细节

- 先用 target frame 决定形式与摆放，先设计 settled frame，再设计进出场。时间点告诉系统“何时”，合成画面才告诉它“什么形状、在哪、是否可读”。
- 第一次 `preview.frame` 证明 scene 成立前，禁止批量 keyframe 微调。
- 每个 scene 至多一个主动作和一个支持动作。相邻 scene 不得无理由复用同一入/退场语法。
- 复杂可重复运动放进组件的确定性 `ctx.anim`，不要让主 Agent 沿每个 path 逐条写 keyframe。
- 组件首稿使用现有 `timeline.placeComponents` 批量落轨，其他修改使用 `timeline.command`；低层 `keyframe-upsert` 只留给 proof 之后的局部精修。

这会从结构上消灭 stale `baseVersion` 并发冲突，而不是要求模型“记得串行调用”。

### 5.4 用既有双向通信做增量同步

`project.document.changed` 从只有 version 的通知，升级为可应用的 delta：

```ts
type ProjectDocumentChanged = {
  type: "project.document.changed";
  source: "agent" | "ui";
  fromVersion: number;
  toVersion: number;
  operations: TimelineOperation[];
  transactionId: string;
};
```

iframe 在 `recut.events.subscribe` 中调用 `editor.project.applyRemoteOperations(...)`，复用同一 operation reducer，保留播放头、选区、缩放、面板和 renderer。连续 version 合并到下一帧渲染；只有缺段、apply 失败或校验失败时才 `loadProject` 恢复。

AI 锁也应收窄：批事务期间 UI 暂停本地写入，但持续应用远端 delta 并呈现进度；解锁不得额外强制 reload。刷新是故障恢复，不是正常通信路径。

### 5.5 视觉证据和导出才是交付门

- `timeline.validate = 0` 只证明结构合法。每个关键 scene 必须有实际合成的 settled frame；检查内容、可读性、元素边界、安全区、层级与相邻场景重复度。
- `preview.frame` 必须在 workflow context 对 Agent 可达。无头 renderer 未上线时，skill 必须诚实地把产物称为“待视觉验收的时间线草稿”。
- `export.start` 必须有 MCP surface 并返回统一 async handle。UI 仍可作为编码 adapter，但 Agent 不应把最后一步转交给用户。
- `DeliveryEvidence` 至少包含开场、转场、收束的 preview 引用、导出 job、最终 video asset 与版本号。证据不齐，不得称 delivered。

### 5.6 用户新指令必须中断当前创作单元

项目工作稿、组件创建、timeline mutation、预览和导出都是可观察的工作单元。每个单元边界读取最新用户指令；新约束出现时，停止未提交队列，取消或 rollback 当前 timeline mutation，把约束追加到 `project.md`，从受影响 scene 重跑。用户反馈是上游事实，不能排队等装饰动画结束。

## 6. ChatCut 参考如何落地到 Recut

| ChatCut 的能力定义 | Recut 应迁移的原则 | 不应照搬的部分 |
|---|---|---|
| “Describe the edit, get the cut”，每种改变落在真实多轨。 | Agent 是导演，时间线是可编辑结果，不是扁平导出物。 | ChatCut 的特定 MCP 名称和 hosted connector。 |
| Motion graphics 有独立 authoring skill、Design Style、可编辑 props、目标帧审查。 | Prompt 让组件共享视觉方向、scene role、可编辑参数与 frame proof。 | JSX/Remotion 的具体代码契约。 |
| 多个 motion graphics 必须共享视觉语言，但不同 viewer job 不复用同一形状。 | 组件复用基于职能和信息结构，不是“同一种圆角条”。 | 必须先向用户展示视觉 preset 的交互策略；Recut 的 autonomous path 可自主选择，但必须记录并可修订。 |
| B-roll、motion graphics、字幕、音乐是不同层；先结构，再时序，最后打磨。 | Scene plan 把媒体/组件/文字/音频明确分层，禁止先给空画面上关键帧。 | 只针对 talking-head 的专用细节。 |
| 成功工具调用不等于验证；检查合成帧与最终渲染。 | `validate`、`preview`、`export` 是三种不同证据，缺一不能越级。 | 其云渲染供应商、定价与模型选择。 |

## 7. 详细落地蓝图

本节把前面的决策映射到现有仓库。实现顺序遵循一条原则：先把错误的创作路径挡住，再提高自动化程度；不先做一个漂亮的新 API，却让旧 skill 继续把 Agent 引向文字时间线。

### 7.1 文件与职责映射

| 文件/模块 | 具体改动 | 完成标志 |
|---|---|---|
| `apps/editor/skills/recut-editor/SKILL.md` | 将工作流改成 `context -> direction -> style choice -> scene notes -> assets -> placement -> settled-frame proof -> motion -> delivery`；明确“无 TTS 不等于文字片”。 | 新会话在第一次 mutation 前必须能产出 project.md 工作稿。 |
| `apps/editor/skills/recut-editor/references/directing.md` | 增加 viewer job、visual mechanism、settled frame、read time、motion budget、scene diversity 的决策表和反例。 | Agent 能解释每个 scene 为什么需要该画面，而不是只报文案。 |
| `apps/editor/skills/recut-editor/references/components.md` | 删除 raw graphic 与 AI 组件之间的歧义；规定 AI 创造的背景、隐喻、图表、装饰默认走 `component.create`。 | `component.create` 成为唯一 AI 视觉素材入口。 |
| `project.md`（项目文件） | 用普通 Markdown 记录 route、treatment 理由、scene 画面意图、资产/job、timeline version、proof 与下一步；原生 Read/Write/Edit 处理。 | 工作稿可读、可续接、可追溯，但不复制 timeline schema。 |
| `apps/editor/background/project-operations.js` | 继续让 `timeline.command` 与 `timeline.placeComponents` 作为唯一写入口；不新增 Plan 编译器。 | 每次真实 mutation 都进入统一 command log。 |
| `apps/editor/background/components.js` | 保持现有 component job/asset 校验；不新增 styleId、tokenReceipt 或 Plan schema。 | 组件创建继续轻量，视觉统一由 Prompt 与 brief 引导。 |
| `apps/editor/background/op-engine.js` | 将每次 command 的 normalized ops 保存为 delta，支持按 `fromVersion` 读取连续操作。 | UI 可重放 delta，不必读取完整 project。 |
| `apps/editor/manifest.json` | 只暴露现有 timeline、component、preview、export 能力；不暴露 Plan CRUD。 | skill 宣称的动作在工具面真实可见。 |
| `apps/editor/ui/src/recut/use-project-sync.ts` | 从 `loadProject` 正常刷新切换为 delta queue；只在 gap/apply failure 时 fallback reload。 | 连续 Agent 更新不卸载 renderer。 |
| `apps/editor/ui/src/core/managers/project-manager.ts` | 暴露 `applyRemoteOperations` 和 `getAppliedVersion`，沿用 UI 自己的 reducer。 | 外部 mutation 与 UI mutation 使用同一状态变换。 |
| `apps/editor/ui/tests/e2e/recut-sync.spec.ts` | 将“agent event 触发 reload”的断言改成“agent event 应用 delta 且 reloadCount 不变”；新增 gap/fallback 测试。 | 回归测试不再把刷新当作正常同步。 |
| `service/mcp.go` / `service/runtime.go` | 将 preview、export、cancel 统一纳入 async handle 和结构化错误信封；Plan 仍是普通文件。 | Agent 能观察、取消和恢复长任务。 |

### 7.2 Plan 的实际形态：普通 Markdown 工作稿

不新增 Plan 工具、SQLite 表、JSON schema、revision 状态机或编译器。Agent 直接用项目文件的原生读写维护 `project.md`；文件只记录导演判断和执行过程，例如 route、treatment 理由、风格选择、scene 意图、候选 asset/job、timeline version、proof 和下一步。

Plan 的状态由人类可读的标题和清单表达（如 `pending`、`running`、`done`、`stale`），不作为服务端门禁。真正的状态检查通过现有工具完成：`workflow.context`、`timeline.read`、`timeline.validate`、`preview.frame`、`recut.job.*`。当 Markdown 与 timeline 不一致时，timeline 胜出，Agent 修正文档。

### 7.3 执行与质量门

执行顺序仍然是：读工作稿 → 读当前 timeline → 选择 treatment → 生成/读取资产 → 用现有写入口落轨 → 回读 timeline → 做结构/画面/交付验证。任何“lint”都是 Agent 在工作稿中的自检清单，不新增一个 Plan 验证器，也不把工作稿编译成隐藏的结构化对象。

最低自检清单：

- 非转场 scene 是否有真实媒体、生成媒体或 verified component 主体；
- 是否先读 design system，再把统一风格的简短说明写入 component brief；
- 是否在 settled-frame proof 前避免批量 keyframe；
- placement 后的 assetId、trackId、start/duration 是否来自最新 `timeline.read`；
- `timeline.validate`、settled frame 和 export job 是否分别通过。

### 7.3.1 路由输出必须可直接驱动工具

`workflow.context` 不应只返回 `allowedActions`。P0 至少返回下列事实，让 Agent 不需要从自然语言猜测下一步：

```json
{
  "authoring": {
    "route": "media-led",
    "confidence": 0.91,
    "sourceAssets": [{ "assetId": "asset-01", "kind": "video", "durationSec": 12.4, "ratio": "16:9", "transcript": "none" }],
    "treatmentDefaults": { "aRoll": "not-applicable", "bRoll": "selected", "motionGraphics": "selected", "captions": "not-needed", "music": "selected" },
    "requiredReads": ["directing", "shot-library", "components", "preview-export"],
    "blockedWrites": ["timeline.placeComponents", "subtitle.import"]
  }
}
```

路由结果必须由事实触发：有 speech-track 才能进入 `speech-led`；有源视频但 speech 不承载主线才是 `media-led`；没有源媒体且要求新片才是 `generated-video`。`confidence` 低于阈值时进入 alignment，而不是静默选择文字片。用户明确“不要问”时可采用最高置信默认值，但仍写入 `assumptionReceipt`。

B-roll 的 source inspection 不能只保存一个 `assetId`：

```ts
type BrollInspection = {
  assetId: string;
  sourceFrameSec: number;
  sourceRatio: number;
  protectedRegions: Array<{ kind: "text" | "logo" | "subject" | "ui" | "edge"; box: [number, number, number, number] }>;
  safeCrop: "cover" | "contain" | "reframe" | "unknown";
  targetMode: "cutaway" | "pip";
  targetRegion?: [number, number, number, number];
  receipt: string;
};
```

落轨只接受带 inspection receipt 的 B-roll item；没有 receipt 的候选仍可保留在 asset library，但不能落轨。generated-video 的 `shotId`、`durationSec`、`shotSpec`、`anchorAssetIds`、`continuityPolicy` 和 `outputAssetId` 记入 `project.md`，以便后续知道是在改镜头还是换素材。

### 7.4 组件创建的精确契约

当前 `component.create` 的 `design` 只传运行上下文（如 `canvas`、`locale`）；Prompt 要求 Agent 把已读取设计系统的简短风格说明写进每个 item 的 `brief`，参考组件或素材通过 `references` 传入。不要把 Plan 字段或任意 `designSpec/tokens` 假设成工具契约：

```json
{
  "items": [{
    "nameHint": "creator-workflow-map",
    "brief": "用一条从观察到发布的可视化路径表达创作杠杆",
    "mode": "fullscreen",
    "role": "metaphor"
  }],
  "design": {
    "canvas": { "width": 1920, "height": 1080 },
    "locale": "zh-CN"
  },
  "references": { "assetIds": [], "componentIds": [] }
}
```

`brief` 应包含风格说明、viewer job、visual mechanism 和 scene 角色；服务端不新增设计 schema，视觉质量留给 `preview.frame`。组件 job 的 result 只需返回现有 verified asset/component 引用：

```json
{
  "assetId": "component:...",
  "componentId": "...",
  "versionId": "...",
  "status": "verified"
}
```

多个相关 motion graphics 的批量规则沿用 ChatCut：如果没有统一风格，先在 `project.md` 记下风格方向，创建一个 representative component，完成一次 composed-frame proof 后，才允许批量扩展同一视觉语言。`surprise me/不要问` 模式可以自动选择风格，但必须把选择写进工作稿，不能把“自动”解释成“跳过设计”。

### 7.5 时间线仍是唯一结构化写入面

当前不新增 Plan 编译器或隐藏 transaction。组件批量落轨使用现有 `timeline.placeComponents`；其他剪辑、参数和关键帧使用带最新 `baseVersion` 的 `timeline.command`。每次写入后立即 `timeline.read`，把真实 version、refs 和 proof 结果追加到 `project.md`。

如果未来需要减少多次往返，应先在 timeline/op 总线上设计一个可 undo 的批处理 op；它仍然只接受 timeline 结构，不接受或持久化 Plan schema，也不能改变 Plan 的非结构化定位。

### 7.6 增量同步的实现算法

当前 `use-project-sync.ts` 的 `loadProject` 正常路径改为以下队列：

```ts
onDocumentChanged(event) {
  if (event.source === "ui") return acknowledge(event.toVersion);
  if (event.fromVersion !== knownVersion) return requestDeltaOrReload(knownVersion);
  pending.push(event);
  scheduleAnimationFrame(flushRemoteOps);
}

flushRemoteOps() {
  const batch = coalesce(pending);
  const result = editor.project.applyRemoteOperations(batch.operations);
  if (!result.ok) return reloadAsRecovery(batch.toVersion);
  knownVersion = batch.toVersion;
  pending = [];
}
```

事件形状增加 `fromVersion/toVersion/operations/transactionId`；事件太大时只发送 `deltaId`，UI 通过 `timeline.delta({ fromVersion, toVersion })` 拉取。所有 delta 必须可重放且顺序稳定。

锁期间不卸载 canvas：停止 UI 写入、保留播放状态、应用 Agent delta、显示非阻塞的 editing indicator。`project:unlocked` 只恢复 save，不再自动 `loadProject`。完整 reload 仅保留三种情况：版本 gap、reducer 拒绝、资源 bundle 解析失败。

### 7.7 取消、反馈和失败恢复

每个长任务都登记 `workUnitId`：`plan`, `component-job`, `apply-plan`, `preview`, `export`。Agent 新消息到达时，runtime 将它广播给当前 work unit：

```text
running -> cancel_requested -> cancelled
                         \-> cancel_too_late (进入不可逆编码阶段)
```

规则：

1. component job 尚未 commit：调用 `recut.job.cancel`，不入库、不落轨。
2. component 已 verified 但尚未 placement：保留素材，在 `project.md` 标记 superseded，不删除用户可能复用的资产。
3. timeline mutation 已提交：通过统一 history/undo 生成新的 undo command；不直接改数据库快照。
4. preview/export 已进入编码：不能伪造取消成功，返回 `cancel_too_late`，但阻止后续 delivery claim。
5. 用户反馈必须追加到 `project.md` 的 constraints/执行记录，而不是只留在 chat transcript。

### 7.8 视觉验证与交付证据

新增 `preview.batch`，一次接收 scene settled times，返回多个异步 frame handles；避免 Agent 逐帧调用导致上下文膨胀：

```json
{
  "times": [0.8, 6.2, 12.5, 28.4],
  "purpose": "settled-scenes",
  "saveToLibrary": false
}
```

验证分三级：

1. **结构 proof**：`timeline.validate`，检查 asset、track、overlap、range、component、param。
2. **画面 proof**：每个 scene 至少一张 settled frame；检查主体存在、文字可读、无裁切、无字幕/主体冲突、视觉机制成立。
3. **交付 proof**：导出 job completed，video asset 存在，导出版本等于最后 proof 版本。

`DeliveryEvidence` 建议结构：

```json
{
  "timelineVersion": 19,
  "frames": [{ "sceneId": "scene-01", "timeSec": 0.8, "imageUrl": "...", "sha256": "..." }],
  "export": { "jobId": "job-01", "assetId": "video:01", "status": "completed" },
  "checks": { "structure": true, "visual": true, "delivery": true }
}
```

最终回答根据 evidence 状态生成：`draft`、`reviewable`、`delivered` 三种措辞，禁止模型自由声称“完成”。

### 7.9 测试分层与可观测性

| 层级 | 新增测试 | 关键断言 |
|---|---|---|
| L0 worklog | Markdown fixture review、manifest schema test | 工作稿包含 route、treatment 理由、主体、风格选择、proof 与下一步；不要求 JSON schema。 |
| L1 background | 现有 component/timeline tests | 统一 op 原子性、幂等、undo、baseVersion conflict。 |
| L2 service | `editor_delta_test.go`、`editor_work_unit_test.go` | delta 事件顺序、async handle、cancel 状态和错误信封。 |
| L3 UI | `recut-sync.spec.ts` | 连续 delta 不 reload；gap 才 reload；播放头/selection 保持。 |
| L4 component | 扩展 `component_pipeline_e2e_test.go` | brief -> verified asset -> placement -> resolve -> preview。 |
| L5 golden video | `editor-authoring-fixtures/` | 30 秒 brief 不产出 text-only；至少包含主体组件/媒体、三类 viewer job 和 evidence。 |

每次 Agent 会话记录指标：`time_to_first_visual_asset`、`text_only_scene_ratio`、`keyframes_before_first_proof`、`reloads_per_transaction`、`conflict_retries`、`delivery_evidence_rate`。这些指标比总 tool call 数更能暴露“忙但没有产出”的路径。

### 7.10 最新 ChatCut skill 对照的 Prompt 层补齐

最新源码审查确认，ChatCut 的优势不在一级 route 名称，而在每个 treatment 都有单独的输入、判断、执行、回读和升级条件。Editor 原有 `speech-editing.md`、`subject-protection.md` 与 `component-authoring.md` 已覆盖部分原则，但缺少以下闭环：

| ChatCut 深度 | 原 Editor 缺口 | Prompt 层落地 |
|---|---|---|
| Talking-head：转写 readiness、cleanup/highlight/restructure/hook/target-script 分支、A-roll 后下游失效 | 只有 A-roll 原则，缺少 route 前置和 branch/re-read 协议 | `speech-editing.md` 补 Audio Studio 状态、treatment 表、A-roll 分支、canonical re-read 与 stale 下游处理 |
| Motion graphics：style alignment、representative asset、content/timing/form/background、natural box、per-frame placement | 组件 SDK 深，但缺少导演到组件的 production workflow | 新增 `motion-graphics.md`，以 style gate → representative component → target-frame proof → batch 为主链 |
| Voice：visual-first sync map、真实音频时长、stale map、coverage/final sync check | 只有 music duck，没有 narration 与视觉同步模型 | 新增 `voiceover.md`，适配 `recut.speech.generate` 与 Editor 音轨/role；不伪造克隆和 Provider UI |
| Generated video：shot list、anchor、串行依赖、二次 text retry 后升级参考 | 只有 generated-video route，没有连续性算法 | 新增 `video-generation.md`，适配 `recut.video.generate`、真实 reference asset 与 job 终态 |
| Verification：结构 readback + composed pixels + delivery job、失败分类 | 只有 preview/export 的局部说明 | 新增 `verification.md`，规定三层证据和 failure taxonomy |

这些文档仍是低成本 Prompt 层：Project 只用普通 Markdown，不增加 Plan CRUD、SQLite schema、编译器或新的 MCP 往返。它们把 ChatCut 的深度搬到 Recut 已有的项目文件、平台媒体任务、组件资产、统一 op 日志和 preview/export 之上。

## 8. 分阶段实施

### 当前执行策略：Prompt + Project Markdown

第一阶段只修改 Editor Skill、onboarding prompt 和 references，把 route、A-roll/B-roll/motion graphics 判断、设计系统选择、组件优先、关键帧预算和 settled-frame 验收变成模型的硬性首轮行为；项目内 `project.md` 是普通 Markdown 需求/执行记录，timeline 是唯一结构化事实源，不新增 Plan 工具、schema 或编译器。

先观察以下指标是否改善：首个可见媒体/组件出现时间、text-only scene 比例、首次画面 proof 前的 keyframe 数量、每个 scene 的视觉主体覆盖率。若 Prompt 层已经稳定解决主要失败模式，继续保持该低成本边界；只有 timeline 本身出现明确的原子批处理需求时，才单独评估 timeline/op 设计，不把 Project Markdown 结构化。

### P0：停止产生伪成片

1. 修订 `recut-editor/SKILL.md`：强制 `route/treatments -> design system -> visual assets -> placement -> frame proof` 顺序；计划只用项目 `project.md` 工作稿表达。
2. 为 treatment 建立独立 reference：`speech-editing.md`（Audio Studio/transcript/A-roll）、`motion-graphics.md`（style gate/representative motion graphic/target frame）、`voiceover.md`（visual-first sync）、`video-generation.md`（shot/anchor/continuity）、`verification.md`（三层证据）。
3. 合并 `components.md` 与 `component-authoring.md` 的歧义：AI 创造画面的默认路径是组件，raw graphic 只留给低层或手工编辑。
4. 在 workflow context 暴露 `preview.frame`；headless 未完成时禁止“已交付”措辞。
5. 将 `export.start` 暴露为 MCP async operation，或在此之前移除自动成片交付承诺。

### P1：消除重复写入和 iframe 刷新

1. 不实现 Plan 资源、Plan CRUD 或隐藏批处理 transaction；先用现有 timeline 写入口和 Project Markdown 验证质量指标。
2. 实现 document delta 事件、`applyRemoteOperations`、版本 gap 检测和帧级合并。
3. 实现用户消息驱动的 cancellation checkpoint 与事务 rollback。

### P2：把质量门自动化

1. 落地与 UI renderer 同构的 headless preview/export。
2. 生成 scene contact sheet，检查空画布、文字截断、安全区冲突、token 漂移与无意义视觉重复。
3. 用“短片需求 -> 可编辑时间线 + 视觉证据 + 导出资产”的样例集回归，不再只回归 `timeline.validate`。

## 9. 验收标准

| 场景 | 可验证结果 |
|---|---|
| “30 秒、不要问细节、自己定夺” | 工具轨迹包含 route/treatments、设计系统选择、scene 视觉资产和 settled-frame 验证；`project.md` 只作工作稿，除非用户明确要文字片。 |
| TTS 不可用 | 选择 component-led 或 media-led 画面策略，而不是自动退化为大字 + 单色底。 |
| AI 图形 | 每个画面组件都有 verified asset、可编辑属性，并通过一次批量 `timeline.placeComponents` 落轨；同片遵循同一风格方向。 |
| 动效 | 首次 frame proof 前没有批量 keyframe；基础动效以一次 transaction 落地，不发生同 baseVersion 冲突。 |
| 用户中途纠正 | 下一个工作单元前取消旧计划；后续 asset 与 placement 全部满足新约束。 |
| Agent 编辑时 UI | 连续 agent versions 不调用 `loadProject`，播放头/选区/面板保持；只有 delta 缺失或 apply 失败才全量恢复。 |
| 交付 | 无 UI 可完成 headless preview/export；最终记录三帧视觉证据、export job 与 video asset。 |

## 10. 非目标与结论

本 RFC 不禁止用户手动放 rectangle，也不把每一个文本都强迫做成组件。约束对象是 AI 主动创造一支视频时的视觉语言与交付过程。组件数量也不是质量指标：一个有画面职能、经 target-frame 验证且可复用的组件，优于六条无意义装饰条。

本次失败表面是“只插了几个文本框”，本质是系统允许 Agent 在没有导演模型、设计事实、画面主体和视觉证据时，直接操作最低层时间线，再把每个操作广播成一次 iframe 重载。

正确边界是：**平台拥有组件验证、可 undo 写入、增量同步和交付证据；Agent 拥有导演判断、统一视觉方向、场景叙事和组件内容。** 这样，文本不再是视频的替身，而只是画面语言中的一个层。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
