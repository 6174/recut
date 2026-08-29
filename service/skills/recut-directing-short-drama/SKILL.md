---
name: recut-directing-short-drama
appId: recut.platform
description: 回答「剧情类怎么编排生产？」的唯一决策问题，为 AI 短剧/漫剧/剧情短视频从故事意图到可控生产链的编排与合同管理提供权威判断标准。
---

# Recut 全局导演技能：短剧生产编排（recut-directing-short-drama）

本技能是 Recut 平台 App 无关的全局导演技能，**只回答一个问题：剧情类怎么编排生产？** 适用范围为 AI 短剧、漫剧、剧情短视频等强剧情内容的生产组织——把一个故事意图编为可检验、可传递、可回写的控制合同链，再交付生成。所有关于“先做哪步、谁对接谁、什么状态才能生成”的编排判断，以本技能为准。

> 介质中性：本文件仅给出“怎么判断、怎么排期、怎么合同化、怎么验收”的导演编排决策，不包含任何 App 工具调用、时间线操作、代码或模型控制面语法。各 App 的适配层自行将本技能的合同映射为自身实现。

## 边界声明

**本技能只管生产编排合同；以下交界处的决策归属其它技能——**

| 归属 | 内容 | 说明 |
|---|---|---|
| **recut-directing-story** | 故事因果与剧本写作 | 人物目标/阻力/行动/变化、因果链、状态引擎、人物弧光、对白与节拍写作；本技能只在“怎么把已批准的剧本变成可交付合同”时引用其结论，不重写故事 |
| **recut-directing-shot** | 单个镜头怎么拍 | 景别/角度/焦段/运动、调度几何、轴线与视线、分镜表与首尾帧连续性；本技能只负责“镜头应在什么合同约束下生成”，不决定镜头美学本身 |
| **各 App 适配层** | 生成模型 prompt 适配 | 把本技能的合同意图翻译为 Veo/Kling/即梦等具体模型的 prompt 形状、控制面与负面词；全局层只写意图，不写模型语法 |
| **recut-directing-short-drama（本技能）** | 生产编排合同 | 剧本节拍合同、资产库、场面调度图、布光图、动作账本、草图转镜头六种可控性合同的建账、流转与门禁；十段式装配与生成前 QC 的唯一编排来源 |

未验证的剧集类型或超出本技能合同覆盖的创作（如纯口播、纯图文动效），不得冒充为已验证路径。

## 六种可控性合同速览

> 以下为中文路由层概述：一句说清每种合同“管什么、长什么样、缺了会怎样”，完整字段与 JSON 模板以 `references/` 原文为准。

### 1. 剧本节拍合同（narrative_beat_contract）

管“故事是否可被画面执行”。把钩子、want/obstacle/strategy_shift/power_turn/cost/cliffhanger 写成画面或台词可观察的事实，并记录观众信息差、人物进出状态差、情绪曲线与视觉概念引用。写“反转很强”不计数，能拍出“掌权者伸手索要证据却看到自己罪证”的具体动作才计数。缺此合同即无法回答“这场戏到底变了什么”。详见 `references/ai-short-drama-production/references/control-contracts.md#1` 与 `references/ai-short-drama-production/SKILL.md#3.1`。

### 2. 资产库合同（asset_registry）

管“外观是否可被复现”。资产库不是文件夹，是已批准 Cxx/Sxx/Pxx 的索引账：每条含 asset_id、版本、状态、参考图、锁定特征、可变状态、来源镜头、最后审阅日期；版本以 `C01b` 后缀演进，绝不覆盖已批准版本。所有后续合同只引用已审资产，不以“再抽一次视频”替代。详见 `control-contracts.md#2` 与 `SKILL.md#3.2`。

### 3. 场面调度图（blocking_map）

管“空间是否可被画在同一张纸上”。每图固定画面朝向、左/中/右与前/中/后锚点、A/B 位置与面向、道具初末位、行动路径、进出画与遮挡、摄影机位与朝向、180°轴及权力几何。移动用 `T0→T1→T2` 编号阶段，而非一句“走过去”。调度先于机位：先让走位与物件关系承担变化，再选摄影机怎么看。详见 `control-contracts.md#3` 与 `SKILL.md#3.3`。

### 4. 布光图（lighting_plan）

管“光是否有来源、是否服务叙事”。每镜列主光/补光/轮廓·背景光的画内来源、方向、色温、强度或光比及照亮区域，并记录开镜/尾帧是否连续。资产图以可读性标准光为准，剧情镜以叙事光为准，禁止无来源泛光、死黑或滤镜替代布光。光色服务已定的视点、权力与信息显露顺序。详见 `control-contracts.md#4` 与 `SKILL.md#3.4`。

### 5. 动作账本（action_ledger）

管“打戏/追逐/抢夺是否可被生成”。按交换单元拆为 `起势→位移→接触/落空→反应→定格尾帧`，每单元写清发力主体、起点/路径/终点与受力反应，武器·手脚与镜头方向同时写入正/负约束。动作密度由“因果环节数×持续时间×人物数量×镜头运动”判定，超预算即拆镜或改为画外暗示。默认每镜只装 1–2 个可读因果节拍。详见 `control-contracts.md#5` 与 `SKILL.md#3.5`。

### 6. 草图转镜头（sketch_to_shot_brief）

管“草图是继承关系而非复刻外观”。只锁构图与关系（构图/地平线/机位/人物占比/视线/主光方向），人物脸、服装纹理与成片风格必须由资产/类型 Skill 补齐。先标记可继承与必须回填项，再生成关键帧，防止“草图脸”覆盖批准资产。详见 `control-contracts.md#6` 与 `SKILL.md#3.6`。

## 固定生产顺序

本技能的编排是线性闸门：前一步未通过，不进入下一步；回炉按归属定向返回，禁止“再生成一次”绕过。

1. **剧本三层读法**：先用本技能编排的 `ai-storyboard-director` 完成剧本理解→调度→镜头句的镜头设计，再落为可检验的开场钩子、目标/阻力、策略或权力转折、结尾钩子。对应 `references/ai-storyboard-director/references/shot-design-engine.md` 与 `production-contract.md`。
2. **资产库**：调用已批准的 `character-asset / scene-asset / prop-asset` 建 Cxx/Sxx/Pxx，先人工审核，再进入分镜。不以视频抽卡替代资产。
3. **调度**：对每镜建立 `blocking_map`，人物/道具/摄影机与轴线必须能在同一平面图上互证。
4. **类型参数**：用主类型 Skill 给镜头、色彩、材质参数；类型只供参数，不改已审核外观（类型色彩来源见 `references/ai-short-drama-production/references/SOURCE-LEDGER.md`）。
5. **专项合同**：仅在需要时叠加草图转镜头、布光、动作；字段见 `control-contracts.md`。
6. **装配**：由既有十段式装配规则把所有合同装进六大模块视频提示词，单 AG-CLIP 只含一个连续机位与一个主导运动（见 `SKILL.md#4` 十段式注入表）。
7. **QC 门禁**：按 `SKILL.md#5 生成前门禁` 八项清单核验实际画面与合同一致性，失败按归属回炉至 01/02/03/04/06，不以“漂亮单帧”当通过。

## 与 Recut Creation Worlds 的对接说明

本技能的资产合同与 Recut Creation Worlds 的实体模型同构，**这不是工具调用，只是映射说明**，供各 App 适配层在落库时对齐：

| 本技能合同 | Recut Creation Worlds 实体 | 约束 |
|---|---|---|
| `Cxx` 角色资产 | `character` 实体 | 外观锁定特征、状态变体与审查版本对应角色的 `appearance / wardrobe / identity` 证据；`C01b` 版本演进对应 World revision |
| `Sxx` 场景资产 | `scene / location` 实体 | 世界位置、通道、门窗、家具、光源方位对应场景的空间与光源证据 |
| `Pxx` 道具资产 | `prop`（挂于 character/scene 的关联证据） | 持有人、位置、状态与来源镜头对应道具证据 |
| `blocking_map` 的世界坐标 | Worlds 的世界地图 | 人物/道具/摄影机的世界位置与轴线复用同一世界坐标系 |
| `lighting_plan` 的实体光源 | Worlds 的光源证据 | 光源的世界位置/方向/色温需能在 Worlds 中找到实体依据 |

各 App 在执行时自行决定如何读写 Worlds；本技能只要求合同内容与 Worlds 的已批准事实一致，不规定读写路径。

## References 路由表

| 搬运文件 | 何时读 | 解决什么 |
|---|---|---|
| `references/ai-short-drama-production/SKILL.md` | 需看短剧生产的完整编排契约与生产顺序时 | 导演判断→资产→调度→镜头/光/动作→十段式→QC 的总链路；本技能的编排正文 |
| `references/ai-short-drama-production/references/control-contracts.md` | 需落合同字段或写入 `shots.json` 时 | 六种合同的 JSON 模板与 QC 对照顺序；唯一可执行的合同结构 |
| `references/ai-short-drama-production/references/SOURCE-LEDGER.md` | 需追溯类型色彩与专题参数来源时 | 色值/导演参考/转化规则/错误库的权威来源与已核验条目，以及公开抖音专题索引 |
| `references/ai-short-drama-production/agents/openai.yaml` | 需看原 Skill 的代理展示信息时 | 原 Skill 的 display_name / prompt（无编排规则，仅作溯源） |
| `references/ai-storyboard-director/SKILL.md` | 已有可用剧本需拆分镜或写视频提示词时 | 本技能调用的分镜总路由：人读分镜+六大模块的交付形态、模式判定与必须执行的流程 |
| `references/ai-storyboard-director/references/shot-design-engine.md` | 需从剧本推导调度与镜头句时 | 5.4.2 镜头设计引擎：剧本理解→调度→镜头句→景别/机位逻辑→复合运镜构造与失败模式 |
| `references/ai-storyboard-director/references/production-contract.md` | 需保证空间/物理连续性时 | 5.4.1 生产合同：交付结构、人读分镜、六大模块与数字 10 十段式、场景世界状态与换机位重算 |
| `references/ai-storyboard-director/references/delivery-mode-guard.md` | 需判定应交付分镜表还是完整提示词时 | 5.4.2 交付模式门：默认同轮交付分镜+提示词的硬门与可复制判定 |
| `references/ai-storyboard-director/agents/openai.yaml` | 需看分镜 Skill 的代理展示信息时 | 原 Skill 的展示信息（仅溯源） |
| `references/ai-storyboard-director/versions/5.4.1/SKILL.snapshot.md` | 需回退或审阅 5.4.1 基线时 | 5.4.1 原始快照（按哈希完整回退的依据） |
| `references/ai-storyboard-director/versions/5.4.1/production-contract.snapshot.md` | 需核对 5.4.1 合同原文时 | 5.4.1 生产合同快照 |
| `references/ai-storyboard-director/versions/5.4.2-candidate/SKILL.snapshot.md` | 需审阅 5.4.2 候选时 | 5.4.2 候选快照（本次正式化的回退证据） |
| `references/ai-storyboard-director/versions/5.4.2-candidate/shot-design-engine.snapshot.md` | 需比对引擎变更时 | 5.4.2 候选引擎快照 |

> 搬运说明：以上文件均从 `62656456/ai-film-skills`（Apache-2.0）原样搬运，保留原文语言与结构，仅在文件头加一行 `> 来源: 62656456/ai-film-skills (Apache-2.0)`，并去除宿主工具专属内容中的工具无关保留。

## 常见误用与规避

- **把形容词当节拍**：写“情绪很燃、反转炸裂”不计数；必须写成“她把信封拍在桌上，掌权者伸手去拿时信封自动播放罪证录音”这类可观察动作与后果。
- **用视频抽卡替代资产库**：未审资产直接进分镜会导致全片脸/衣/场景漂移；资产库必须先审后用，版本以 `C01b` 递进，不覆盖已批准版。
- **调度写成散文**：把 `T0→T1→T2` 的位置/朝向/遮挡写成“两人走近对峙”是不可检验的；必须能在平面图上标出每个阶段的左/中/右与前/中/后。
- **无来源泛光**：为“高级感”加柔光滤镜却找不到画内光源；每束光必须能在画面中找到台灯/窗/火等实体来源。
- **动作密度超限不拆镜**：单镜塞入 3 个以上因果节拍（起势+位移+接触+反应）必糊；超预算即拆镜或改画外暗示。
- **草图脸覆盖资产脸**：把草图的关键帧直接当成片用，导致身份与服装纹理被草图锁定；草图只继承构图与关系，外观仍回资产。

## 产出自检（交付前）

- [ ] 叙事钩子、目标、阻力与结尾钩子均可画面观察，不含空泛形容词
- [ ] 补充事实已标 `assumed`，信息差与权力转折有导演判断依据
- [ ] 全部 Cxx/Sxx/Pxx 存在、版本一致且已人工审核
- [ ] 每张调度图能解释人物、道具、摄影机与 180°轴，无空间矛盾
- [ ] 布光能在画内找到来源，未遮蔽关键叙事信息
- [ ] 每步动作有起点/路径/终点与反应，密度在预算内
- [ ] 草图仅继承允许字段，外观仍引用批准资产
- [ ] 每段 AG-CLIP 无隐藏硬切，尾帧可接下一镜

## 介质中性声明

本技能 `SKILL.md` 不出现任何 App 工具调用/op/代码；`references/` 中他人原文可保留原貌。各 App 适配层自行将合同映射为自身操作。

## 版本与来源

- 搬运来源：`62656456/ai-film-skills`（Apache-2.0），本地审阅副本 `.executor-tasks/sources/ai-film-skills-full/`，搬运日期 2026-08-29
- 详见 `LICENSE-NOTICE.md`
