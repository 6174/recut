---
name: recut-director
appId: recut.platform
description: 回答「这次创作走什么链、按什么顺序」的唯一导演入口；按 references/<环节>/SKILL.md 加载环节规则
---

# Recut 导演技能（recut-director）

本技能是 Recut 全局导演知识的**唯一入口**，只回答一个决策问题：**这次创作走什么链、按什么顺序？** 其余导演决策以 **9 个子技能**形式内联在本技能内。输入是创作意图、内容类型与素材条件；输出是一条建议的技能链与环节顺序，供各 App 落为各自的介质实现。

## 如何使用（导航协议）

1. **定链**：用下面的 Mode 表与子技能索引确定环节与顺序，不展开环节内配方。
2. **加载环节**：链中每个环节 = 一个子技能；用 `recut.skills.reference(appId="recut.platform", skillId="recut-director", path="references/<环节>/SKILL.md")` 读取它的决策规则。
3. **按需加载**：只加载当前环节需要的那一个，不并列预读。本技能为拍平结构——每个环节一篇，内部不再有深树。
4. **落介质**：本技能是介质中性的决策层；各 App 的薄适配层把决策译为 timeline op / 组件 / 生成提示词。落介质前不叠加视觉/听觉润色层（见流程纪律）。

## 一、内容类型 Mode 表与建议链

链是建议起点，按任务增删；默认从左到右执行，箭头表示依赖顺序。

| 内容类型 | 建议链 | 触发信号 |
|---|---|---|
| **口播 / 访谈** | `story → shot → editing → platform` | 有说话人实拍或访谈素材，核心是"该留哪句话"（shot 含 A-roll 语音取舍与 B-roll 摆放） |
| **知识解说** | `story → shot → editing → sound → generation-prompt` | 以知识/概念解释为主，需动画与旁白承载（shot 含元素动效） |
| **剧情 / 短剧** | `story → assets → plan → shot → generation-prompt → qc` | 有人物、世界观、对白与戏剧冲突（story 含短剧生产编排与六种合同） |
| **故事视频 / 分镜驱动** | `story → assets → plan → shot → generation-prompt` | 以视频故事与脚本为核心，先出一图 N 宫格分镜表作 `storyboard` 参考（默认直用，按需逐格展开） |
| **爆款仿拍 / 长转短** | `platform → editing → qc` | 输入是已有视频或爆款链接，目标是仿拍或长转短（platform 含 remix 反推与选段） |
| **种草 / 带货** | `platform → story → shot → editing` | 以转化与种草为目标，需强钩子与平台合规（editing 含 0–3 秒钩子，platform 含规格红线） |

未命中上表时，按"驱动力"再路由：个人经历驱动走口播/访谈链；知识解释驱动走知识解说链；现实证据/演示驱动走种草链；人物行动与冲突驱动走剧情链；已有视频驱动走仿拍链。无法判断时直接问用户"驱动力是个人经历、知识解释、现实证据，还是人物冲突"。

## 二、子技能索引（唯一权威清单，9 个）

每个环节只回答一个决策问题；路径均相对本技能根。**已做合并**：`shot` = 镜头语法与分镜 + 语音取舍（A-roll）+ 画面素材摆放（B-roll）+ 元素动效；`editing` = 剪辑节奏与转场 + 字幕上屏 + 开场钩子与留存；`story` = 故事因果与结构 + 剧情类生产编排；`platform` = 平台规格与审核 + 长转短/爆款拆解。

| 环节 | 读取路径 | 唯一决策问题 | 产出物形状 |
|---|---|---|---|
| `story` | `references/story/SKILL.md` | 讲什么、怎么编排；剧情类怎么编排生产 | 结构节拍表、因果链、六种生产合同 |
| `assets` | `references/assets/SKILL.md` | 生成要用的参考锚点怎么备齐 | 角色卡/场景图/道具图/色卡/声线/分镜表锚点 |
| `plan` | `references/plan/SKILL.md` | 这部片子怎么排产 | 场次→镜头 计划（用料/参数/成本） |
| `shot` | `references/shot/SKILL.md` | 一个镜头怎么拍、画面放什么、元素怎么动、说话留哪些 | 分镜表、首尾帧、调度/版式、动效与语音取舍清单 |
| `editing` | `references/editing/SKILL.md` | 怎么剪到一起、字怎么上屏、开场怎么留人结尾怎么收 | 段落节拍与切点/转发表、字幕样式、钩子与留存脊 |
| `platform` | `references/platform/SKILL.md` | 发给谁/什么规格/什么雷区；如何从已有视频反推 | 平台规格与审核清单、选段/迁移决策 |
| `sound` | `references/sound/SKILL.md` | 旁白/BGM/SFX 如何分层与避让 | 声音分层方案 |
| `generation-prompt` | `references/generation-prompt/SKILL.md` | 生成提示词怎么写（风格冻结、参考锚定、多镜连续段、声画与负面合同） | 提示词骨架与参考锚点 |
| `qc` | `references/qc/SKILL.md` | 哪里坏了、怎么修、是否可进下一环节 | F-code 诊断与门禁结果 |

## 三、流程纪律

1. **先定结构，再定时序，后做润色。** 当链中会新建或改变结构时（story 的取舍与重排、shot 的语音取舍），定稿前不叠加任何视觉/听觉润色层（动效/字幕/音乐/素材装饰）；结构一变，下游对齐全部重做。
2. **逐环节确认，不打包。** 每完成一个环节即与用户确认，再进入下一环节。
3. **每环节未过 qc 门禁不进下一环节。** 各环节结束时以 `references/qc/SKILL.md` 的三道门禁自检（生成前 → 渲染前 → 交付前）；任一门禁不通过即打回；`qc` 的 F-code 与门禁编号为唯一依据。
4. **链可增删，不可逆序。** 允许按任务增删环节，但不逆序执行（不可先 editing 再 shot）。
5. **真实素材先看懂再剪。** 涉及实拍/B-roll/复用素材时，链中必须含"审阅→选段→落位"三步，不以时长或轨道空缺为由自动堆料。

## 四、能力边界声明

- 本技能与全部子技能均**不冒充未验证能力**；仅当某 Mode/链已完成真实作品验证并得到用户确认后才标记为已验证。
- 用户要求尚未建立专属 Mode 的视频类型（如音乐视频等）时，**如实告知**"当前缺少该类型的专属链与验证作品"，可与用户共同定义目标、输入、结构、素材策略与验证门槛，但**不得静默套用**知识解说或口播链冒充完成。
- 声音是链中的创作选择，不是身份边界。

## 五、导演 Mode 文档路由（references/modes/）

已落地并验证的端到端 Mode 工作流；先读本节定位 Mode，再按子技能索引加载对应环节规则。不把 A Mode 的旁白结构、字数、分镜或封面流程默认套用到其他 Mode。

| 遇到什么问题 | 去读哪个文件 | 它解决什么 |
|---|---|---|
| 了解知识解说类已验证链的写作、拆段、Prompt、封面全流程 | `references/modes/animated-explainer/workflow.md` | Animated Explainer 端到端工作流与产物形状，已验证 |
| 写知识解说的旁白与拆段 | `references/modes/animated-explainer/narration-script-guide.md` | 旁白长度、语速段间均衡与改稿纪律 |
| 写知识解说的生成 Prompt | `references/modes/animated-explainer/video-prompt-guide.md` | 镜头/动作/运镜的模型无关措辞与 Prompt 结构 |
| 做知识解说的封面（仅该 Mode 已验证） | `references/modes/animated-explainer/video-cover-image-guide.md` | 封面约束与生成流程 |
| 了解个人经历动画的重构链与人物资产纪律 | `references/modes/storytime-animation/workflow.md` | Storytime Animation 工作流与讲述者人物锚点 |
| 了解剧情/短剧的拍摄与连续性生产链 | `references/modes/cinematic-drama/workflow.md` | Cinematic Drama 的世界观→剧本→分镜→生成链 |
| 做剧情的人物/场景/道具/声音参考与连续性资产 | `references/modes/cinematic-drama/reference-development-guide.md` | 主角/配角/路人分级、三视图、换装、关键道具与音色参考 |
| 写剧情的视频 Prompt | `references/modes/cinematic-drama/video-prompt-guide.md` | 剧情 Prompt 的连续性与镜头措辞 |

## 六、介质中性声明 + 版本与来源

本文件为中文决策路由层，不出现任何 App 工具调用、时间线操作或代码语法。搬运源：`s1dashu/director`（MIT，本地审阅副本 `.executor-tasks/sources/`）；短剧编排源自 `62656456/ai-film-skills`（Apache-2.0）。深树已拍平为"每环节一篇"，完整源码与许可声明保留在 `.executor-tasks/sources/`。
