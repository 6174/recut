# 全局导演技能库（recut/skills）：把导演能力从各 App 中抽出为跨 App 复用技能

状态：Draft / 待评审

## 一、目标

Recut 的「导演知识」目前分散在 `apps/editor`、`apps/remotion-studio`、`apps/ai-short-film` 各自的 skill references 里，且明显重复（`directing.md`、`music-beat-sync.md` 等在两个 App 各维护一份，仅「表达介质」不同）。本 RFC 提议仿照 `recut-design-system` 的模式，把**App 无关的导演知识**抽到全局 `skills/`（安装形态为 `service/skills/recut-directing-*`，下文统一称 `recut/skills/<skill>`），使 editor、remotion-studio、ai-short-film 及未来 App 共享同一份权威来源。

设计系统抽的是「视觉风格」，这里抽的是「叙事与视听决策」：结构、节拍、镜头语言、B-roll/A-roll、字幕、声音、平台玩法。两者同构：

- **design-system**：抽象风格定义（DESIGN.md / tokens.css）→ 各 App 自行映射到 palette / 组件 / CSS
- **directing-skill**：抽象导演决策（规则 / 配方 / 检查清单）→ 各 App 自行映射到 timeline op / Remotion 代码 / AI 生成 prompt

## 二、现状盘点（App 内已有的导演知识）

### apps/editor/skills/recut-editor/references/

| 文件 | 内容 | 通用性 |
|---|---|---|
| `directing.md` | 动效嗓音预设（能量/调性两轴）、5 秒节拍、镜头动词→配方、导演自检清单 | 高，仅 op 表达是 App 特有 |
| `shot-library.md` | 10 个镜头配方（开场/转场/运镜/卡点/聚光/呼吸） | 高 |
| `music-beat-sync.md` | 卡点：BPM/拍号/切点纪律 | 高 |
| `speech-editing.md` | A-roll 口播/访谈剪辑：语义单元、口癖判断、filler 处理 | 高 |
| `subject-protection.md` | B-roll/PiP/全幅 cutaway 摆放、安全区、cover vs contain、人脸保护 | 高 |
| `motion-graphics.md`、`captions.md`、`voiceover.md`、`voice-assets.md` | 局部 | 中-高 |
| `components.md`、`keyframes.md`、`params.md` 等 | 纯 App 契约，不迁移 | 低 |

### apps/remotion-studio/skills/remotion-studio/references/

`directing.md`、`music-beat-sync.md`（与 editor 版声明「同源」但各自维护）、`shot-recipes/`（camera/data/effects/opening/outro/rhythm/transition/typography/ui-entrance 八类）、`sequence-patterns/promo-energy-arc.md`、`paper-ink-product-promo.md`、`aesthetic-rules.md`、`captions.md`、`sound-design.md`、`final-review.md`。

### apps/remotion-studio/packages/remotion-kit/src/scenarios/

`faceless-explainer`、`product-launch`、`doodle-explainer`：每个场景 = SKILL.md（导演视角：分镜结构/节奏/素材纪律）+ template 代码。**场景层（scenario）与配方层（recipe）应当分离**——场景是叙事骨架，配方是镜头语法，前者引用后者。

### apps/ai-short-film/

`editorial-vox` / `hand-drawn-essay` / `animated-character` 风格模板 + 资料研究/方案/剧本工作流，含「资料研究」「钩子」「节奏」散落规则。

**结论**：editor 与 remotion-studio 的 directing/shot/music-beat-sync 三份文件约 70% 内容逐字同源，是本次抽取的第一动机；speech-editing（A-roll）与 subject-protection（B-roll）是两个 App 都缺、但外部生态已验证价值最高的两块。

## 三、外部生态盘点（已 clone 到 /tmp/skill-review 审阅）

按「对 Recut 的可借鉴度」分档；⭐ = 建议直接吸收其知识进全局 skill。

### 第一梯队（结构可直接借鉴）

| 项目 | 是什么 | 借鉴点 |
|---|---|---|
| **maxazure/video-editing-skill** | 小红书/抖音/视频号三平台调参的端到端剪辑流水线（70+ 脚本：highlight_picker、hook_variants、rewrite_script 五段式 hook/pain/turn/value/cta、content_guard 80+ 平台雷区 lint、beat_sync、speed_ramp、platform-safe-area、CapCut/Remotion 导出） | ⭐ 唯一深度本土化的平台向 skill；`content_guard`（平台雷区 lint）与 `rewrite_script`（五段式）应直接吸收；长转短（highlight→shorts_batch）流程与我们 audio-studio ASR + editor 时间线天然对齐 |
| **DirectorSKILL（cinematic-director）** | 导演/Previs 超级 skill：A–J 十种工作模式（导演分析/节拍表/导演阐述/shot plan/关键帧 prompt/运动 prompt/连续性圣经/声音/剪辑装配/失败诊断），配套受控 prompt 词典与失败码手册 | ⭐ 「失败诊断手册」（slideshow 感、换脸、穿模的症状→原因→修法）是所有 skill 都缺的；「反形容词汤：用可观察的物理描述替代 cinematic/masterpiece」原则全局适用 |
| **62656456/ai-film-skills** | 19 个 skill 的 AI 影视体系：director-agent（编剧+前期导演，因果链/人物行动/状态引擎）、ai-storyboard-director、ai-short-drama-production（六种可控性合同：节拍/资产库/调度图/布光图/动作账本/草图转镜头 + 生成前门禁）、produce-ai-video、character/scene/prop-asset | ⭐ 短剧编排骨架（blocking_map、action_ledger、生成前 QC 门禁）与 Recut Creation Worlds（character/location/story 实体）同构，可直接对接 |
| **nopefallacy/vertical-video-editing-skills** | 9:16 短视频「主剪辑师」skill：engineered hook、A/B-roll 脊柱、0.2s 非节拍器切点、stacked split 工作版式、人脸安全裁切（眼睛上三分之一）、防抖运镜合同、风格包 FRAME.md、渲染验证门禁 | ⭐ 9:16 剪辑语法最完整；「style pack（FRAME.md）→ 设计 spec → 每帧套版式」的模式与 design-system 消费方式一致 |
| **vyralcontent/content-skills** | 20 万条爆款提炼：viral-hooks（0–3s 视觉/口播/文字三层 hook）、viral-short-form（hook→escalation→payoff→CTA）、viral-captions-and-ctas、平台分包（TikTok/Reels/Shorts） | ⭐ 「为什么有人看完」这一层我们完全空白；hook 分类学可直接做成全局 skill |

### 第二梯队（选章节吸收）

| 项目 | 借鉴点 |
|---|---|
| **0xhughs/director-skills** | 三层路由（creative intent → cinematic execution → **model adaptation**）；「导演语言→视觉语言→具体模型 prompt」的适配层设计，映射到 Recut 即「导演 skill → 各 App 介质适配」 |
| **Qwen-MM-Plugins video-edit** | 「先看懂素材再剪」：footage judgment → selection → pacing → per-scene design；对 Recut 的 preview.frame/inspect 工作流是方法论背书 |
| **s1dashu/director** | 顶层 Mode 路由（Storytime/Explainer/Cinematic Drama 各有已验证 workflow，未验证的类型不得冒充支持）——「能力边界声明」值得抄 |
| **social-media-skills/skills** | `ai-voiceover`（80% 是 script-for-ear + delivery direction，20% 才是 TTS）、`short-form-video-script`（hook/retention/pacing/loop） |
| **AgriciDaniel/claude-shorts** | 长转短：Whisper → 候选片段 → 人工批准 → 自然切点 → 动画字幕 → 9:16；与我们 subtitle/audio-studio 工作流对齐 |
| **hoodini/ai-agents-skills** | yuv 系列证明「design-system skill + director skill + edit skill 分层、由 orchestrator 路由」可行；video-edit 的「转写校对 gate 后才渲染」值得抄 |
| **KINNONG/viral-video-breakdown、riffkit** | 爆款拆解（视频→关键帧→transcript→hook 分析）与「riff the formula, not the video」——未来做 Reference→仿拍 的输入 |
| **fal cinematography、director-craft-framework** | 镜头/焦段/光位/调度的参数化词汇表，可充实 shot-library 的镜头动词部分 |

### 结论

生态是割裂的：懂爆款的（vyral）不懂镜头语言，懂导演的（ai-film-skills）不懂平台，懂剪辑的（maxazure）最贴中文平台但偏脚本流水线。Recut 已有 timeline/editor/ASR/TTS/生成能力作为执行层，缺的正是把「导演决策」作为可复用知识层沉淀下来。

## 四、设计

### 4.1 分层契约（本 RFC 的核心）

```text
recut/skills/<director-skill>/          全局层：App 无关的导演知识
  SKILL.md        决策规则、配方、检查清单、边界声明
  references/     按需加载的深化文档
  （无任何 App 工具调用、无 timeline op、无代码）

apps/*/skills/<app>/                    适配层：介质映射
  directing-adapter.md   「如何把全局配方落到本 App」：
                         editor = timeline.command op 序列
                         remotion-studio = composition 代码 / keyframe
                         ai-short-film = 生成 prompt + 分镜合同
```

全局 skill 用**介质中性语言**表达：「主标题落定后 hold ≥1s」「切点必须落整数拍 ±0.03s」「cover 仅在受保护信息可存活时使用」。适配层保留各 App 现文件中纯 App 契约部分（op 语法、ref 获取方式、preview 验证步骤），并指向全局层。

### 4.2 融合策略：按能力域拆分，每个域融合多个来源的优势

外部生态的分工恰好在六个能力域上互补，我们按域拆分、逐域融合：

| 能力域 | 主导来源（各取所长） | 融合进的全局 skill |
|---|---|---|
| 为什么用户会看（vyral） | vyralcontent `viral-hooks`/`viral-short-form`（MIT）+ KINNONG `viral-video-breakdown`（MIT）+ riffkit（MIT） | `hooks`、`remix` |
| 怎么讲故事（director-skills） | 0xhughs `screenplay-and-scene-writing`/`short-film-development`（MIT）+ ai-film-skills `director-agent` 的因果链与状态引擎（Apache） | `story` |
| 故事→影视生产流程（ai-film-skills） | `ai-short-drama-production` 六种可控性合同 + `produce-ai-video` 生成门禁（Apache）+ s1dashu `director` 的 Mode 路由（MIT） | `short-drama`、`director`（路由层） |
| 真实素材剪辑判断（Qwen） | Qwen-MM-Plugins video-edit 的 footage judgment→selection→pacing 方法论（只吸收思想）+ hoodini `video-edit`（无 license，只吸收思想） | `b-roll` |
| 剪得像真正 Creator（vertical-video-editing） | vertical-video-editing-skills `video-editing`（MIT）的 9:16 语法拆分收编 + cinematic-director 失败诊断（MIT）+ 我们的 shot-library 存量 | `editing`、`b-roll`、`captions`、`motion`、`qc` |
| 平台机制（social-media-skills） | social-media-skills `short-form-video-script`/`ai-voiceover`/`ai-music-and-sound`（MIT）+ maxazure `content_guard` 思想重写（无 license）+ 平台公开规范 | `platform`、`sound` |

融合纪律：每个 skill 的 SKILL.md 头部写 `provenance`（来源 repo、文件、license），被融合的规则若来源之间冲突（如切点密度：vyral 主张 0.2s、directing 主张 5 秒节拍），按**场景分层**收编——hook 段用前者，信息段用后者，不静默平均。

### 4.3 全局技能清单：唯一性原则与最终分类

**唯一性原则**：平台提供的功能性 skill 互不重叠，每个 skill 只回答**一个决策问题**——Agent 在任一时刻面对某类决策时只有一个可加载的选项，不产生混淆。来源之间的重叠内容（如 vertical-video-editing 同时讲版式、字幕、切点、验证）在入库时**拆分收编**到对应 skill，不整份搬运。两个 skill 交界处的决策（如 jump cut：留哪些话 vs 怎么盖画面）在各自 SKILL.md 里用「边界声明」显式划清并互相指向。

| skill id | 唯一决策问题 | 融合来源 |
|---|---|---|
| `director` | 这次创作走什么链、按什么顺序？ | s1dashu `director`（MIT）+ cinematic-director Mode 路由；唯一路由入口，只写路由表与总流程，不写具体规则 |
| `story` | 讲什么、怎么编排？ | 0xhughs 剧本结构 + ai-film-skills `director-agent` 因果链；含五段式（hook-pain-turn-value-cta）整体叙事 |
| `hooks` | 开场怎么留人、结尾怎么收？ | vyral `viral-hooks`/`viral-short-form`（搬运）；只管 0–3s 与完播机制，叙事结构归 `story` |
| `shot` | 一个镜头/一场怎么拍？ | editor `shot-library` + remotion-studio `shot-recipes` 合并 + cinematic-director `prompt-lexicon` + `create-storyboard`/`ai-storyboard-director` 分镜连续性；分镜并入此处，不单设 storyboard |
| `motion` | 元素怎么动？ | 两份 `directing.md` 的动效嗓音两轴/呼吸落定 + `motion-graphics.md`；5 秒节拍归 `editing` |
| `b-roll` | 画面该放什么素材、怎么摆？ | editor `subject-protection.md` + vertical-video-editing 版式/人脸安全裁切 + Qwen footage-judgment 思想；含 PiP/cutaway/cover vs contain/竖版重构 |
| `editing` | 片子怎么剪到一起？ | 两份 `music-beat-sync` + vertical-video-editing 的切点密度/转场语法；5 秒节拍、卡点、转场、节奏密度都在此（hook 段密切规则从 `hooks` 引用） |
| `a-roll` | 说话内容留哪些、删哪些？ | editor `speech-editing.md`（自有权威）；只管语音语义取舍，jump cut 的画面遮盖归 `b-roll` |
| `captions` | 字怎么上屏？ | 两份 captions.md + vertical-video-editing kinetic caption 语法；字幕样式/安全区/强调词 |
| `sound` | 耳朵听到什么？ | social-media-skills `ai-voiceover`/`ai-music-and-sound`（搬运）+ remotion-studio `sound-design.md`；VO 写法/BGM/SFX/版权 |
| `platform` | 发给谁、什么规格、什么雷区？ | social-media-skills 平台分包 + maxazure `content_guard`/发布纪律思想重写 + 平台公开规范；时长/画幅/安全区/审核红线/封面标题 |
| `remix` | 从已有视频反推并产出新片？ | KINNONG `viral-video-breakdown` + riffkit（搬运）+ claude-shorts（MIT）；双向：长转短选段 + 爆款拆解仿拍，共用「反推结构→迁移公式」方法 |
| `short-drama` | 剧情类怎么编排生产？ | ai-film-skills `ai-short-drama-production`（搬运合同结构）+ `kelly-drama` 思想；节拍/资产库/调度/布光/动作合同，对接 Creation Worlds |
| `qc` | 哪里坏了、怎么修？ | cinematic-director `failure-modes`（搬运）+ ai-film-skills `produce-ai-video` 生成门禁；失败诊断与各环节验收门禁的唯一来源 |

### 4.4 Phase 2 扩展（均按唯一性原则并入现有分类，不新增重叠项）

| 能力缺口 | 并入 | 说明 |
|---|---|---|
| 影视级摄影参数（焦段/光位/调度） | `shot` 的深化 references | fal `cinematography`、`director-craft-framework` 词汇表 |
| 短剧/微电影的导演判断（非编排） | `story` + `shot` | ai-film-skills `director-agent` 剩余部分 |
| AI Video 生成 prompt 适配层 | App 适配层（非全局 skill） | director-skills `model-adaptation` 思想：全局写「镜头意图」，各 App 的适配层翻译成 Veo/Kling/即梦 prompt |

### 4.5 发现与安装机制

- 形态对齐 `service/skills/recut-design-system`：frontmatter（name/appId=`recut.platform`/description）+ SKILL.md + references。
- 平台侧新增 `recut.skills.*` 全局技能枚举/读取（可复用现有 `recut.skills.list/read` 的实现路径，把 `service/skills/` 下非 App skill 也纳入）；各 App 的 `workflow.context` 列出技能元数据，Agent 按需读取。
- 参照 skills.sh 生态惯例，`skills/` 可独立成 git 仓库随版本分发；`recut.apps.install` 类机制将来可直接指向它。

### 4.6 许可与搬运合规

- **可整份搬运**（MIT/Apache，保留版权声明）：DirectorSKILL、ai-film-skills（Apache-2.0）、content-skills、vertical-video-editing-skills、claude-shorts、director-skills、s1dashu/director、KINNONG/viral-video-breakdown、social-media-skills、story-video-director、create-storyboard-skill、director-craft-framework、riffkit、ai-director-skill、Qwen-MM-Plugins（随其仓库 license）。
- **只吸收思想、必须重写**（无 LICENSE = 默认保留所有权利）：maxazure/video-editing-skill（content_guard/五段式/highlight 链路）、hoodini/ai-agents-skills。
- 每个搬运 skill 在 SKILL.md 头部加 `provenance` 注记（repo、commit、license），保持可追溯、可同步上游。

### 4.7 边界声明（抄 s1dashu/director 的纪律）

- 全局 skill **不调用任何 App 工具**、不出现 op/代码语法。
- 每个技能 SKILL.md 明确「已验证 / 未验证」的场景类型，未验证类型不得冒充支持。
- App 冲突时以 App 适配层为准；全局层的修改需跑各 App 的 fixture 验证（editor `authoring-fixtures/`）。

## 五、迁移计划

1. **P0（纯去重合并，不动行为）**：合并两份 `directing.md`（拆向 `motion`+`editing`）、`shot-library/shot-recipes`（→`shot`）、`music-beat-sync`（→`editing`）、`captions.md`（→`captions`）为全局版；editor/remotion-studio 各留薄适配层。验收：两边 fixture/导出回归无差异。
2. **P1（A-roll/B-roll 全局化 + 首批搬运）**：`speech-editing`→`a-roll`、`subject-protection`→`b-roll`；搬运 vyral→`hooks`、DirectorSKILL failure-modes→`qc`。
3. **P2（平台与 remix）**：`platform`（social-media-skills 搬运 + maxazure 思想重写，不引入其脚本依赖——执行层用 Recut 自己的 ASR/editor/export）、`remix`、`sound`。
4. **P3（剧情链）**：`director` 路由层、`story`、`short-drama` 对接 Creation Worlds。

外部仓库审阅副本保留在 `/tmp/skill-review/`（14 个 repo，可随时查阅原文）。
