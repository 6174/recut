---
name: recut-directing-story
appId: recut.platform
description: 回答「讲什么、怎么编排？」——故事因果、人物行动、对话与结构节拍的导演决策。
---

# Recut 全局故事与结构技能（recut-directing-story）

本技能只回答一个决策问题：**讲什么、怎么编排？**

输入是选题、人物与约束，输出是可被拍摄/可被剪辑的结构——谁要什么、为何现在行动、因果怎么闭环、对话如何推动关系、节拍如何分布。所有镜头怎么拍、0–3 秒怎么留人、生产如何编排，都由其他技能承接；本技能只负责让故事本身成立。

## 边界声明

| 归属 | 内容 | 本技能是否负责 |
|---|---|---|
| **本技能 recut-directing-story** | 故事因果、人物目标与行动链、对话目的与潜台词、结构与节拍、场景交易与转折、主题的行动化承载 | 是，唯一决策口 |
| **recut-directing-hooks** | 0–3 秒钩子与留存/完播机制 | 否。本技能定结构位置与五段式中的 hook 占位，hooks 定开场的三层执行与话术落格 |
| **recut-directing-short-drama** | 短剧/剧情类的生产编排合同（节拍表、资产库、调度图、布光图、动作账本、草图转镜头与生成前门禁） | 否。故事则是 short-drama 的上游输入 |
| **recut-directing-shot** | 镜头怎么拍（景别/角度/运动/调度/分镜连续性） | 否。接收本技能的节拍与场景交易，再落为镜头方案 |
| **recut-directing-editing / motion / b-roll / sound 等** | 剪辑节奏、动效、画面素材摆放、声音设计 | 否。仅在节拍需要时被引用 |

未验证的长片类型、未锁定的世界规则、未授权的生成模型适配，不在本技能冒充支持；介质语法（时间线 op、Remotion 代码、生成接口参数）不在此出现。

## 核心决策规则

### 1. 因果链五问（故事是否成立的唯一标尺）

每一场、每一节拍、每一句关键对白，落格前必答五问；任一问答不出，即回上游重写，不以视听装饰掩盖：

1. **谁要什么？** 主体是谁，当前想要的是否可被看见/可被拍摄（要钱、要钥匙、要一句道歉，而非"要成长"）？
2. **为何现在行动？** 什么压力、时限、代价或机会迫使此刻不动不行？能等的事不是戏。
3. **什么阻碍？** 人、制度、环境或自身恐惧中，哪一个在当下可被对手感知并抵抗？无阻碍即无场景。
4. **做了什么导致什么？** 以 `先决条件 → 人物行动/有意拒绝 → 直接结果 → 状态改变 → 迫使/封堵下一步` 闭环；仅用"然后"连接的为伪因果，必须补条件或删节拍。
5. **为何不选更安全的替代？** 若存在更便宜、更安全、更直接的路径却未被尝试，故事即为作者便利；必须在文本中让该路径不可用、代价更高或已被尝试且失败。时效、空间、已知信息改变时，重跑此问。

五问穿透三层检验：情节层（事件链与转折）、人物层（目标/策略/权力位移）、观众层（何时感到压力、释放与代价）。

### 2. 人物行动与对话即行为

- **行动先于情绪标签**：不写"愤怒地"，而写可被摄影机捕捉的可玩动词——逼问、包庇、试探、拖延、羞辱、乞求、撤退。情绪由行为与倾听对象推导。
- **策略必有触发**：人物改变战术必须由新刺激、失败、代价变化或选项集改变触发；无触发的转变为断裂。
- **对话是战术**：每句有目的（索取/隐瞒/测试/安抚/要挟/暴露/撤回），有听者的反应与权力/信息差变化；两句同一战术无升级即需删一或升级。
- **潜台词与可说性**：表面话与真实目的可分离；允许打断、重复、误听、沉默与未完句，但必须有可追踪的听者效应。遮住说话人标签仍可区分声音，否则重写。
- **去生成腔**：拒绝对称的金句、主题直述、每物必有回响的整洁闭环；保留与情境共生的摩擦、迟滞与无用行为。

### 3. 结构节拍（本技能定位置，hooks 定执行）

**三幕与短片压缩**：
- 长结构：建置（人、压、场、视觉规则）→ 转折（发现或选择改变压力）→ 兑现（后果落在可视的代价与新状态）。
- 短片（<3 分钟）：一地、一核心冲突、一重大转折；迟进早出，道具与场所在当下即做故事功，背景故事仅当改变当下选择时才出现。

**五段式 hook–pain–turn–value–cta**：
- 本技能负责在全片结构中**定位**五段的占位、节拍功能与因果衔接；每段必须有状态改变，否则可删。
- `recut-directing-hooks` 负责其中 **hook 段（0–3 秒）的执行**——三层钩子（视觉/口播/文字）的落格与原型选型。本技能不写钩子话术，只写"此处需要一个结果前置型钩子，因后续将兑现代价"。

**节拍纪律**：
- 每节拍一功能（want / resistance / discovery / cost / image），一情绪转向，一可视锚点；跨节拍的状态（事实、知情、关系、权力、道具位置与持有者）必须继承，不得重置。
- 成功也必须改变后续条件（开启、迫使、堵塞、定价或重框选项），否则为装饰性节拍。
- 符号与母题仅当改变选择、权力或物理可能性时才算兑现；重复不是兑现。

### 4. 验证即交付的一部分

- 故事写完先做**无声行动脊**检验：遮住对白，场景是否仍有一条可被复述的行动与状态改变链。
- 再跑**状态引擎**：事实单源、知识继承、沉默行动脊、对话回应链、道具/信息生命周期，五层自检不过不交付。
- 最后做**独立 cold-read**：只给生文本与锁定约束的fresh reader 能复述"谁做了什么、为何这么做、每句关键话在让对方做什么"，否则回到最早断裂层重修。

## References 路由表

> 按"需要时再读"加载；不要为"随便写"预载全库。director-agent 的路由逻辑为权威分流，本表为其中文转写。

### A. 总纲与分流（先读分流，再按任务深入）

| 文件 | 何时读 | 用途 |
|---|---|---|
| `references/director-agent/SKILL.md` | 任何故事/剧本/导演分析任务的入口 | 总决策脑：区分"剧本模式 vs 导演模式"，给出五问、导演路径、可用性与反惰性合同的顶层路由 |
| `references/director-agent/references/verified-director-logic.md` | 做导演分析或分镜前设计，且需要理论支点时 | 七大逻辑支柱（导演构想、形式、技术、表演、剪辑、声音、信息、物理化）与反默认检验 |
| `references/director-agent/references/director-thinking-spine.md` | 需要十二维导演思维的精炼流程时 | 十二维（剧作解读/导演路径/可视化/场面调度/镜头语言/蒙太奇/时间/情绪节奏/声音/色彩/表演/主题）与操作流 |
| `references/director-agent/references/anti-laziness-contract.md` | 任何多单元长任务交付前 | 覆盖账本、单元完成标准、续写锚 `▶ CONTINUE FROM`、禁用的笼统话术过滤 |

### B. 剧本创作与改写（写/改/修场景与对白）

| 文件 | 何时读 | 用途 |
|---|---|---|
| `references/director-agent/references/screenplay-writing-core.md` | 写剧本、改剧本、修场景、修对白时**必读首位** | A3 知识卡路由、纯语言故事先行、明显替代检验、行动建场、对话即行为、去生成腔与校准流程 |
| `references/director-agent/references/screenplay-state-engine.md` | 上述写作完成后的**验证层** | 单源真相、因果脊、人物状态机、场景状态卡、沉默行动脊、对话回应链、信息/道具/母题生命周期与冷读门禁 |
| `references/director-agent/references/screenplay-cold-read-protocol.md` | 独立审稿、交付前验收 | 冷读协议：重建因果链、复述测试、明显替代测试、阻断/重大失败分级、独立 verdict（LOGIC/STORY） |
| `references/director-agent/references/screenplay-exemplar-benchmarks.md` | 要求"完整/优秀/高质量"剧本时 | 以《寄生虫》《逃出绝命镇》《社交网络》真实剧本做机制校准，禁抄情节/人物/对白 |
| `references/screenplay-and-scene-writing/SKILL.md` | 写单场戏、节拍、情感转向与可视行动时 | 场景交易、节拍即动作、视角与信息差、Fountain 输出与压缩改写 |
| `references/screenplay-and-scene-writing/references/scene_construction.md` | 搭场景结构时 | 场景五问与六步节拍（入场→首战术→抵抗→升级/揭示→承压选择→退场新状态）及可视写作 |
| `references/screenplay-and-scene-writing/references/dialogue_and_subtext.md` | 修对白与潜台词时 | 对白的战术、施压与关系距离变化；每行战术标注与合并规则 |
| `references/screenplay-and-scene-writing/references/screenplay_format.md` | 需标准剧本格式时 | 场景标题、动作行与角色对白的规范，以及交接块（视觉锚/连续性/镜头候选） |
| `references/screenplay-and-scene-writing/references/fountain_workflow.md` | 需 Fountain 纯文本可导入稿时 | Fountain 语法、AI 辅助起草规则、页/时长与分镜交接纪律 |
| `references/screenplay-and-scene-writing/templates/beat_sheet.md` | 落节拍表时 | 节拍表模板 |
| `references/screenplay-and-scene-writing/templates/screenplay_scene.md` | 写场景初稿时 | 场景模板 |
| `references/screenplay-and-scene-writing/templates/fountain_scene.md` | 输出 Fountain 时 | Fountain 场景模板 |
| `references/screenplay-and-scene-writing/templates/dialogue_pass.md` | 专项对白轮次时 | 对白轮次模板 |
| `references/screenplay-and-scene-writing/checklists/scene_quality_checklist.md` | 场景自检时 | 场景质量清单 |
| `references/screenplay-and-scene-writing/examples/scene_to_screenplay_excerpt.md` | 需要范例对照时 | 场景到剧本摘录示例 |
| `references/screenplay-and-scene-writing/tests/screenplay_scene_tests.md` | 验收场景稿时 | 场景测试用例 |

### C. 短片/短故事开发（从生想法到可拍概念包）

| 文件 | 何时读 | 用途 |
|---|---|---|
| `references/short-film-development/SKILL.md` | 从生想法起步、做概念/梗概/结构时 | 创意意图层、发散选路、logline、概念包与结构选型 |
| `references/short-film-development/references/story_development_workflow.md` | 做概念发散时 | 创意吸纳、概念扩张四定义（承诺/压力/矛盾/影像引擎）与短片形态 |
| `references/short-film-development/references/ai_storytelling_workflow.md` | 用 AI 协作写故事时 | 九要素检验、AI 协作流程、结构选项（统一效果/危机曲线等）与 AI 腔风险 |
| `references/short-film-development/references/screenplay_structure.md` | 定短片三幕/微结构时 | 微三幕、节拍类型与压缩规则（迟进早出、道具做功） |
| `references/short-film-development/references/continuity_handoff.md` | 开发结束交接时 | 交给剧本/分镜/生成的连续性锚点（人物/地点/道具/视觉基调/场景清单） |
| `references/short-film-development/templates/idea_intake.md` | 吸纳生想法时 | 想法吸纳模板 |
| `references/short-film-development/templates/logline.md` | 写 logline 时 | Logline 模板与检验 |
| `references/short-film-development/templates/story_premise.md` | 写前提与人物引擎时 | 前提、主题问、人物引擎与影像引擎模板 |
| `references/short-film-development/templates/short_film_treatment.md` | 写梗概时 | 梗概模板 |
| `references/short-film-development/templates/short_story_plan.md` | 写短故事计划时 | 短故事计划模板 |
| `references/short-film-development/templates/beat_sheet.md` | 概念阶段的节拍表 | 节拍表模板（概念版） |
| `references/short-film-development/templates/story_revision_audit.md` | 做修订计划时 | 修订审计模板 |
| `references/short-film-development/checklists/concept_quality_checklist.md` | 概念自检时 | 概念质量清单 |
| `references/short-film-development/examples/idea_to_logline.md` | 需要 logline 范例时 | 想法到 logline 示例 |
| `references/short-film-development/examples/logline_to_outline.md` | 需要大纲范例时 | Logline 到大纲示例 |
| `references/short-film-development/tests/output_format_tests.md` | 验收输出格式时 | 输出格式测试 |
| `references/short-film-development/tests/routing_tests.md` | 校验路由时 | 路由测试 |

### D. 长片/多场景与工作台（规模化协作）

| 文件 | 何时读 | 用途 |
|---|---|---|
| `references/director-agent/references/director-workbench-protocol.md` | 多场景/短片/短剧/全片/跨会话协作时 | 分阶段工作台（覆盖账本/项目卡/导演室/编剧室/制片约束/资产圣经/场景板/节奏检查/交接包）与续写锚 |
| `references/director-agent/references/local-knowledge-map.md` | 需按 A3 卡精确路由时 | 本地 A3 知识库映射（A3-00 至 A3-21 的按需加载表），不视为运行时强依赖 |
| `references/director-agent/references/github-project-watchlist.md` | 需复核外部项目模式时 | 已验证的 GitHub 项目观察清单与可借用模式 |
| `references/director-agent/references/research-update-protocol.md` | 涉及真实导演/影片/史实/教材或模型能力主张时 | 联网核验与知识更新工作流，无法核验时标 `待查证` |
| `references/director-agent/agents/openai.yaml` | 宿主 Agent 适配参考 | 原 skill 的宿主 Agent 配置（保留原文，不作执行依据） |

## 使用时机

- 用户问"讲什么、怎么写、怎么编、这场戏不成立怎么办、这句对白为何无力、结构怎么摆、五段式怎么分"时加载本技能。
- 已有概念包时直接进场景与对白；无概念时先走短片开发工作流补 logline/前提/节拍，不跳过因果直接给镜头。
- 交付前必跑状态引擎与 cold-read；长任务必建覆盖账本与续写锚。

## 常见误用

- 以视听、音乐或金句掩盖断裂的因果：先修五问，再谈视听。
- 每场都让人物做主题陈述：主题必须落在行动、物件、空间或沉默上，不落在台词概括上。
- 让对话替作者解释：可被看见的行为不进对白；对白只做战术，不做说明。
- 以清单或账本拼出故事：账本只验故事，不生故事；先有可复述的人与行动链，再建账。
- 把 hook 话术当结构：hook 是结构中的位置，本技能定位置，hooks 定话术；二者不互替。

## 介质中性声明

本技能不出现任何 App 工具调用、时间线 op、代码或模型控制面语法；所有决策以可观察的人物行动、状态改变与可复述的因果表达，由各 App 适配层再译为各自实现。references 中他人原文可保留原貌。
