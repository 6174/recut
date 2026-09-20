---
name: recut-director
appId: recut.platform
description: 回答「这次创作走什么链、按什么顺序」的唯一导演入口；加载后再按 references/<子技能>/SKILL.md 深读
references: references/story/SKILL.md, references/hooks/SKILL.md, references/shot/SKILL.md, references/motion/SKILL.md, references/a-roll/SKILL.md, references/b-roll/SKILL.md, references/editing/SKILL.md, references/captions/SKILL.md, references/sound/SKILL.md, references/platform/SKILL.md, references/remix/SKILL.md, references/short-drama/SKILL.md, references/generation-prompt/SKILL.md, references/qc/SKILL.md, references/director-router-origin.md
---

# Recut 导演技能（recut-director）

本技能是 Recut 全局导演知识的**唯一入口**，只回答一个决策问题：**这次创作走什么链、按什么顺序？** 其余导演决策（故事、镜头、动效、剪辑、字幕、声音、平台、短剧编排、失败诊断等）都是它的**子技能**，以 references 文档形式内联在本技能内。

输入是用户的创作意图、内容类型与素材条件；输出是一条建议的技能链与环节顺序，供各 App 再落为各自的介质实现。

## 如何使用（导航协议）

1. **定链**：用本 SKILL.md 的 Mode 表与子技能索引确定环节与顺序，不展开环节内的配方。
2. **加载环节**：链中每个环节 = 一个子技能。用 `recut.skills.reference(appId="recut.platform", skillId="recut-director", path="references/<环节>/SKILL.md")` 读取它的决策规则。
3. **按需深读**：子技能内部还会指向它自己的深化文档；这些路径**已经统一为相对本技能根**，继续用同一个 `recut.skills.reference` 调用即可，不要预读、不要整包加载。
4. **落介质**：本技能是介质中性的决策层；各 App 的薄适配层负责把决策译为 timeline op / Remotion 代码 / 生成提示词。落介质前不叠加视觉/听觉润色层（见流程纪律）。

## 一、内容类型 Mode 表与建议链

链是建议起点，按任务增删；默认从左到右执行，箭头表示依赖顺序。

| 内容类型 | 建议链 | 触发信号 |
|---|---|---|
| **口播 / 访谈** | `a-roll → b-roll → editing → captions` | 有说话人实拍或访谈素材，核心是“该留哪句话” |
| **知识解说** | `story → motion → editing → captions` | 以知识/概念/人物思想解释为主，需动画承载 |
| **剧情 / 短剧** | `story → script → short-drama → shot` | 有人物、世界观、对白与戏剧冲突，需分镜与连续性 |
| **故事视频 / 分镜驱动** | `story → script → shot → generation-prompt` | 以视频故事与脚本为核心，先出一图 N 宫格分镜表再逐格展开 |
| **爆款仿拍 / 长转短** | `remix → hooks → editing` | 输入是已有视频或爆款链接，目标是仿拍或长转短 |
| **种草 / 带货** | `hooks → story → b-roll → platform` | 以转化与种草为目标，需强钩子与平台合规 |

未命中上表时，按“驱动力”再路由：个人经历驱动走口播/访谈链；知识解释驱动走知识解说链；现实证据/演示驱动走种草链；人物行动与冲突驱动走剧情链；已有视频驱动走仿拍链。无法判断时直接询问用户“驱动力是个人经历、知识解释、现实证据，还是人物冲突”。

## 二、子技能索引（唯一权威清单）

每个环节只回答一个决策问题；只加载当前环节需要的那一个，不要并列加载多个。读取路径均相对本技能根，经 `recut.skills.reference` 使用。

| 环节 | 读取路径 | 唯一决策问题 | 产出物形状 | 何时加载 |
|---|---|---|---|---|
| `story` | `references/story/SKILL.md` | 讲什么、怎么编排故事与结构 | 故事前提、结构节拍表、桥段顺序 | 链中出现 story |
| `short-drama` | `references/short-drama/SKILL.md` | 剧情如何可控生产、节拍与资产如何合同化 | 节拍/资产库/调度/布光/动作合同 | 链中出现 short-drama |
| `shot` | `references/shot/SKILL.md` | 一个镜头/一场怎么拍、镜头如何承接连续性 | 分镜表、首尾帧、连续性圣经 | 链中出现 shot |
| `motion` | `references/motion/SKILL.md` | 元素怎么动、呼吸与落定如何 | 动效嗓音与落定清单 | 链中出现 motion |
| `a-roll` | `references/a-roll/SKILL.md` | 说话留哪句、删哪口癖与停顿 | 可编辑文稿与留删清单 | 链中出现 a-roll |
| `b-roll` | `references/b-roll/SKILL.md` | 画面放什么素材、以何版式摆、是否裁切安全 | 素材选段与版式落位方案 | 链中出现 b-roll |
| `editing` | `references/editing/SKILL.md` | 在哪里切、切多快、以什么转场与卡点组装 | 段落节拍与切点/转发表 | 链中出现 editing |
| `captions` | `references/captions/SKILL.md` | 字怎么上屏、是否可读与可懂 | 字幕样式与安全区落位 | 链中出现 captions |
| `hooks` | `references/hooks/SKILL.md` | 0–3 秒怎么留人、如何收口与留存 | 6–10 个钩子比稿与留存脊 | 链中出现 hooks |
| `remix` | `references/remix/SKILL.md` | 从已有视频反推什么公式、选哪段或如何迁移 | 拆解报告与公式/选段清单 | 链中出现 remix |
| `platform` | `references/platform/SKILL.md` | 发给谁、什么画幅时长、哪些红线必避 | 平台规格与审核清单 | 链中出现 platform |
| `sound` | `references/sound/SKILL.md` | 旁白/BGM/SFX 如何分层与避让 | 声音分层方案 | 链中出现 sound |
| `generation-prompt` | `references/generation-prompt/SKILL.md` | 生成提示词怎么写（风格冻结、参考锚定、多镜连续段） | 提示词骨架与参考锚点 | 需把镜头意图落成图片/视频生成提示词 |
| `qc` | `references/qc/SKILL.md` | 哪里坏了、怎么修、是否可进下一环节 | F-code 诊断与门禁结果 | 每环节结束时 |

子技能交界处的“留话 vs 盖画面”等归属已由各子技能自己的边界声明划清，本技能不重复它们的配方与检查清单。

## 三、流程纪律

1. **先定结构，再定时序，后做润色。** 当链中会新建或改变结构时（a-roll/story 的取舍与重排），定稿前不叠加任何视觉/听觉润色层（motion/captions/sound/b-roll 装饰）；结构一变，下游对齐全部重做。
2. **逐环节确认，不打包。** 每完成一个环节的决策即与用户确认，再进入下一环节；不把多个结构检查点打包进一条回复。
3. **每环节未过 qc 门禁不进下一环节。** 各环节结束时以 `references/qc/SKILL.md` 的三道门禁自检：生成前门禁（定义与连续性）→ 渲染前门禁（选片与瑕疵筛查）→ 交付前门禁（全片通看与硬门禁）。任一门禁不通过即打回，不进入下一环节；`qc` 的 F-code 与门禁编号为唯一依据。
4. **链可增删，不可逆序。** 链是建议起点，允许按任务增删环节（如口播链中无 B-roll 触发则跳过 b-roll），但不逆序执行（不可先 captions 再 a-roll）。
5. **真实素材先看懂再剪。** 涉及实拍/B-roll/remix 时，链中必须包含“审阅→选段→落位”三步，不以时长或轨道空缺为由自动堆料。

## 四、能力边界声明

- 本技能与全部子技能均**不冒充未验证能力**。仅当某 Mode/链已完成真实作品验证并得到用户确认后，才标记为已验证；未验证的类型不在本技能的建议链中默认出现。
- 用户要求尚未建立专属 Mode 的视频类型（如音乐视频等）时，**如实告知**“当前缺少该类型的专属链与验证作品”，可与用户共同定义目标、输入、结构、素材策略与验证门槛，但**不得静默套用**知识解说或口播链冒充完成。
- 声音是链中的创作选择，不是本技能的身份边界；链中是否需要统一旁白、对白或稳定声音身份，由该 Mode 的下游环节决定。

## 五、导演 Mode 文档路由（references/modes/）

已落地并验证的端到端 Mode 工作流；先读本节定位 Mode，再按子技能索引加载对应环节规则。不把 A Mode 的旁白结构、字数、分镜或封面流程默认套用到其他 Mode。

| 遇到什么问题 | 去读哪个文件 | 它解决什么 |
|---|---|---|
| 理解本技能的源头与原始路由、Mode、style、工具三分层定义 | `references/director-router-origin.md` | 原始 `director` 顶层路由的完整决策与边界原文（含 Mode 选择、style 归属、工具路由、共享片段规则、质量门禁） |
| 了解知识解说类已验证链的写作、拆段、Prompt、封面全流程 | `references/modes/animated-explainer/workflow.md` | Animated Explainer 端到端工作流与产物形状，已验证 |
| 写知识解说的旁白与拆段（15 秒约 60 汉字/32 词、段间均长） | `references/modes/animated-explainer/narration-script-guide.md` | 旁白长度、语速段间均衡与改稿纪律 |
| 写知识解说的生成 Prompt（物理动词、分镜时序、反形容词汤） | `references/modes/animated-explainer/video-prompt-guide.md` | 镜头/动作/运镜的模型无关措辞与 Prompt 结构 |
| 做知识解说的封面（仅该 Mode 已验证） | `references/modes/animated-explainer/video-cover-image-guide.md` | 封面约束与生成流程，不套用到其他 Mode |
| 查知识解说各 style 的视觉语言（7 个 style 逐文件） | `references/modes/animated-explainer/styles/cinematic-3d-animation.md` | 电影感 3D 动画的材质与运镜 |
|  | `references/modes/animated-explainer/styles/clean-line-crayon-animation.md` | 清爽线描蜡笔的线条与色彩 |
|  | `references/modes/animated-explainer/styles/dopamine-cute-3d-animation.md` | 多巴胺萌趣 3D 的造型与运动 |
|  | `references/modes/animated-explainer/styles/melancholic-blue-simple-line-animation.md` | 忧郁蓝调简笔画的色调与笔触 |
|  | `references/modes/animated-explainer/styles/neo-naive-doodle-animation.md` | Neo-naive Doodle 新朴拙涂鸦（候选，待验证） |
|  | `references/modes/animated-explainer/styles/painterly-naive-lyrical-animation.md` | 朴拙绘画感抒情动画（候选，待验证） |
|  | `references/modes/animated-explainer/styles/soft-colored-pencil-cute-animation.md` | 柔和彩铅萌趣的材质与色彩 |
| 了解个人经历动画的重构链与人物资产纪律 | `references/modes/storytime-animation/workflow.md` | Storytime Animation 工作流与讲述者人物锚点 |
| 选 Storytime 的人物形象（仅该 Mode 的形象库） | `references/modes/storytime-animation/characters/character-library.md` | 已确认讲述者形象库的总表与选用纪律 |
|  | `references/modes/storytime-animation/characters/blond-heavy-man-v1/character.md` | 人物 blond-heavy-man-v1 的形象定义 |
|  | `references/modes/storytime-animation/characters/blond-young-white-avatar-v1/character.md` | 人物 blond-young-white-avatar-v1 的形象定义 |
| 查 Storytime 的 style（清爽白色圆身） | `references/modes/storytime-animation/styles/clean-white-character-storytime-animation.md` | 该 Mode 唯一的已验证 style |
| 了解剧情/短剧的拍摄与连续性生产链 | `references/modes/cinematic-drama/workflow.md` | Cinematic Drama 的世界观→剧本→分镜→生成链 |
| 做剧情的人物/场景/道具/声音参考与连续性资产 | `references/modes/cinematic-drama/reference-development-guide.md` | 主角/配角/路人分级、三视图、换装、关键道具与音色参考 |
| 写剧情的视频 Prompt（镜头意图、连续性圣经落位） | `references/modes/cinematic-drama/video-prompt-guide.md` | 剧情 Prompt 的连续性与镜头措辞指南 |
| 查剧情的 style（2 个 style 逐文件） | `references/modes/cinematic-drama/styles/semi-realistic-3d-chinese-animation-film.md` | 半写实 3D 国产动画电影 |
|  | `references/modes/cinematic-drama/styles/semi-realistic-eastern-dark-fantasy-3d-film.md` | 半写实东方奇幻暗黑 3D 电影 |

## 六、介质中性声明

本文件为中文决策路由层，不出现任何 App 工具调用、时间线操作或代码语法；所有链与职责以可观察的产出物与验收标准表达，由各 App 适配层再译为各自实现。`references/` 中他人原文保留原貌，仅在文件头加来源注记。

## 七、版本与来源

- 搬运源：`s1dashu/director`（MIT，本地审阅副本 `.executor-tasks/sources/director-router`）
- 原始文件与许可见 `LICENSE-NOTICE.md`，搬运日期 2026-08-29
- 本技能为全局唯一入口：14 个子技能以 `references/<环节>/` 内联，深化文档路径统一相对本技能根；后续新增 Mode 时在 `references/modes/<mode>/` 增量搬运并更新本文件的路由表与能力边界，不改路由纪律
