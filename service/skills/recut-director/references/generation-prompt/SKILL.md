---
name: references/generation-prompt
appId: recut.platform
description: 回答「一条交给图片/视频生成模型的生产级提示词怎么写」——冻结固定风格、声明 typed 参考锚点、编排多镜连续段与声画合同。
---

# Recut 全局生成提示词技能（references/generation-prompt）

本技能只回答一个决策问题：**一条交给图片/视频生成模型的生产级提示词怎么写？** 输入是已确认的镜头意图、场景/人物资产与参考素材，输出是一条可直接提交的提示词（含固定风格块、参考锚点表、多镜连续段、声画与负面约束），以及机器可校验的参考绑定。

它是 `references/shot`（模型中性镜头意图）与各 App 模型方言之间的**落格层**：把「怎么拍」翻译成「模型读得懂的提示词形状」，但不写 provider 参数语法。

## 边界声明

| 归属 | 内容 | 说明 |
|---|---|---|
| **本技能** | 生成提示词的形状与锚定 | STYLE LOCK、typed 参考锚点、多镜连续段、声画与负面合同、提示词自检 |
| **references/shot** | 镜头意图 | 景别/角度/焦段/运动/调度/分镜连续性；本技能消费其结论，不重写镜头决策 |
| **references/story / hooks / editing / captions / sound / platform** | 故事、钩子、剪辑、字幕、声音、平台 | 各归其口；本技能只在提示词需要时引用其结论 |
| **各 App 适配层** | provider 方言 | `modeType`、负面词字段、`ratio/resolution` 传参、别名模板；本技能只写意图与引用，不写技术参数 |
| **references/qc** | 失败诊断与门禁 | 本技能产出自检；成片验收走 qc 的 F-code 与门禁 |

未验证的 provider 能力不冒充支持；本技能不出现任何 App 工具调用、时间线 op 或代码语法。

## 输入前置（缺一不写）

1. **已冻结的视觉风格**：来自立项模板 `styleTemplate.visualPrompt`、`LIGHT_INVARIANT` 或导演风格文件的稳定视觉语言。若没有，先回到立项/视觉设定阶段冻结，**不允许每镜临时重写风格**。
2. **场景的镜头意图**：景别、机位、主导运动、起止构图（来自 `references/shot` 的分镜表）。
3. **参考素材与角色**：每条引用有稳定 `id`、`kind`、`role`、`label`（见《参考锚点表达规则》）。**世界语境为硬前置**：先 `recut.worlds.get({ worldId })` 读 `references[]`；画面会出现主角色时必须带该角色参考图（`role="character"`），世界已有场景/风格/色卡锚点按 role 带入；只有明确不出现任何角色的纯空场景才可无参考。
4. **声音资产**：对白逐字文本、音色参考 id、环境/SFX 清单。
5. **画幅与时长**：由项目配置/宿主传参决定，**不写进提示词正文**。

## 提示词固定结构

每条提示词按同一顺序构造，段落之间空行分隔：

```text
[STYLE LOCK]
<冻结的视觉风格全文，逐字复用，全片所有镜头一致>

参考锚定表
<每行一条：<reference id kind role label /> 作为 <role 中文名> 锚定>

音轨
<环境底声 / 动作触发音效 / 对白位置与可懂度 / BGM 有无>

<段落/镜头序列>
第 N 镜，约 X 秒。<景别/机位>。<主体动作与因果>。<运镜起止>。<结束状态>。

[负面约束]
<本片/本镜真实可能出现的风险项，名字具体、数量约 4–6 类>
```

- 顺序不是装饰：先生成条件（风格、参考）后内容（动作），负面最后；与 `keyframe-prompt-template` 的九槽位同源。
- **一镜一主导运动**；复合运动必须写清阶段顺序与衔接点（见 `references/shot`）。
- 段落切换默认 HARD CUT；写清每镜结束状态 = 下一镜起始状态（首尾帧合同）。

## 参考锚点表达规则

引用一律用统一的 `<reference>` 标签（属性、role 词表与提交编号规则见本节）：

```xml
<reference id="asset_a1" kind="image" role="pov"        label="执明视角" />
<reference id="asset_a8" kind="image" role="color-card" label="整段色卡" />
<reference id="asset_a6" kind="audio" role="voice"      label="执明音色" />
```

规则：

1. **role 受控**：`pov / color-card / environment / character / prop / style-ref / storyboard / motion-ref / voice / sfx / music`。生成链路每条引用必须有 role。**本表是 AI 侧唯一权威**；运行期镜像在 `canvas-proposal.ts` 的 `PROPOSAL_ROLES`，`recut.worlds.get.references[].role` 也用它，三处必须同步。
2. **格式与提交分离**：正文用 `<reference id …>`（身份、可由 Agent 校验）；提交给模型时由 resolver 改写为**组内编号别名**（`参考图1..N`、`音频1..N`，可配 `{{Mixed n}}`），并把同序 `referenceIds` 一并提交。
3. **id 不进模型串**：模型不是 Agent，看不到也不该看到 assetId；它只看到别名 + 按顺序附着的媒体。
4. **一图一 role**：需要一图多义时用 `label` 说明，不叠 role。
5. **role↔kind 必须匹配**：`voice/sfx/music` 只能 audio，`color-card` 只能 image。
6. **每个 role 在正文有且只有一次声明**；后续镜头以「同参考图{n}」提及，不重复声明。
7. **禁止幻觉锚点**：正文出现的每个 token 必须有真实绑定；未绑定即拒绝提交，不做静默丢弃。
8. 只引用本片段真实需要的参考，不为「可能有帮助」堆料。

## 多镜连续段规则

1. **一镜一信息变化**：镜头变长时增加镜头，不拉长单镜。
2. **首尾帧即合同**：每镜写清起始状态 → 单一可见变化 → 结束状态；下一镜起始 = 上一镜结束。
3. **HARD CUT 显式标注**；跨镜的人物/道具/光位/环境用同一世界状态推导，不重建房间。
4. **方向与屏幕位置不混写**：人物自身左/右与画面左/右分开描述；跨镜保持世界坐标一致。
5. **运镜克制、物理路径明确**：不做无意义漂移或随机抖动；手持/机械臂等质感与人物状态形成对照时说明。
6. **可生成性预算**：高风险镜（多人交手、快速位移、复杂复合运镜）在纸面先给拆分预案。

## 一图分镜表锚定（storyboard）

当分镜先以**一张 N 宫格分镜表**（storyboard sheet，见 `references/shot` 的宫格压缩法）压缩生成时：

1. 整张 sheet 是一张 image，作 `role="storyboard"`；它承载整段的构图与调度连续性，不是成片帧。
2. 逐格细化时，把该格切出的单格图作 `role="storyboard"`，**只锚定该格**的构图/动作/调度；再叠 `character`（角色身份）/`environment`（场景）/`style-ref`（风格）。
3. 提示词要求「去掉宫格边框与坐标编号、提升分辨率、保持角色/服装/道具/光位与相邻格一致」——sheet 只当草图锚点，成片关键帧必须重生成，不放大草图。
4. 一格里已冻结的起止状态即该镜的首尾帧合同；相邻格用世界状态推导，不重建房间。

## 声画规则

- **对白逐字保留**，位于声音前景、清晰可懂；用引号标明，不改写、不节选。
- **音色引用**说明「仅用于参考音色」；当前台词语义只由本片文本决定，不带入参考样本原台词。
- **动作声与画面因果对齐**：接触先于位移、受力先于反应、实体声源先于环境反馈。
- **环境底声**（房间/滴水/木结构）与**动作触发声**（击打/衣料/脚步）分层；无 BGM 时明确写出。
- 声音约束只写用户/项目明确要求的，不堆叠冗长负面词。

## 负面约束写法

- 名字具体、不用类别：写「无现代塑料制品、无腕表」，不写「无现代物品」。
- 数量约 4–6 类，随片/随镜裁剪，不整墙复制。
- 通用固定项：无文字/字幕/签名/水印/UI/图标/电量/时间（除非用户明确要求画内文字）。
- 本镜自身风险项（当镜特有的漂移风险）优先占位。

## 常见误用

- **每镜重写风格**：STYLE LOCK 必须逐字复用；改一个形容词就是另一部片子。
- **把 id 写进提交串**：模型无法解析，等于噪声，还会挤掉描述预算。
- **只有顺序没有 role**：`referenceIds` 是数组，模型不知道第几张负责什么。
- **世界语境不带参考图**：不先读 `references[]` 就纯文本直出，主角色会漂、场景/风格会串；画面可能出现主角色却无 `role="character"` 引用时不得提交，只有明确无角色的纯空场景才可省略。
- **一图多 role 或 role 冲突**：无法校验，生成时语义互相打架。
- **用形容词代替可执行描述**：「压迫感」「电影感」不可执行，应写为可观察的动作、光位与材质。
- **把 `ratio/resolution/时长` 写进正文**：这是 App 适配层传参，写进正文会诱发内部黑边或语义漂移。
- **重播已完成的动作**：相邻镜头提供新信息，不重启上一镜的推近/抬头/开门。

## 产出自检（提交前）

- [ ] STYLE LOCK 逐字复用，全片一致，未被本镜改写
- [ ] 每条引用有 `id/kind/role/label`，role↔kind 匹配，全部真实绑定
- [ ] 世界语境已先读 `references[]`；画面含主角色则必有 `role="character"` 引用（纯空场景除外）
- [ ] 正文 token 与 `referenceIds` 顺序一致，编号组内连续
- [ ] 每个 role 只声明一次，后续用编号复指
- [ ] 每镜一信息变化、一起止状态、一主导运动；HARD CUT 已标
- [ ] 对白逐字、音色「仅作参考」、声音层次与因果正确
- [ ] 负面项具体、约 4–6 类、随片裁剪
- [ ] 正文不含 `ratio/resolution/时长/modeType` 等技术参数
- [ ] 不含无绑定锚点，不含类别式负面词，不含空泛质量词

## References 路由表

| 问题 | 读什么 | 用途 |
|---|---|---|
| 生成提示词的多镜分镜意图 | `references/shot/SKILL.md` + `references/shot/references/cinematic-language.md` | 景别/角度/焦段/运动/调度/轴线 |
| 首尾帧与连续性锚点怎么写 | `references/shot/assets/keyframe-prompt-template.md`、`references/shot/references/continuity-bible.md` | 九槽位、invariant 串、状态账本 |
| 抽象词→可观察行为、负面词库 | `references/shot/references/prompt-lexicon.md` | 措辞与 token 经济 |
| 六模块/十段式的详细模板 | `references/short-drama/references/ai-storyboard-director` | 生成任务/主体/场景/情绪/风格/分段脚本 |
| 参考图职责与人物参考 | `references/modes/*/video-prompt-guide.md` | 各 Mode 的 `参考图N` 声明与素材连接纪律 |
| `<reference>` 标签属性、role 词表、编号与提交规则 | 本 SKILL.md《参考锚点表达规则》+ `references/generation-prompt/assets/generation-prompt-template.md` | 标签属性、role、编号与提交形态 |
| 世界内的生成（world.md 世界技能） | `recut.worlds.get({ worldId })` 读取 `skillMd` 与 `references[]`与 `references[]` | 该世界的 STYLE LOCK、可引用项与建议 role、资源口径；本技能是其通用底座 |
| 世界/画布里的生成怎么调工具 | `recut-worlds` 技能 | `recut.worlds.*` 操作与「读世界 → 写提示词 → 生成 → 落位」流程 |
| 失败症状与门禁 | `references/qc` | F-code 与验收门禁 |

## 介质中性声明

本技能不出现任何 App 工具调用、时间线 op、代码或 provider 参数语法；所有内容以可观察的画面、声音与引用语义表达，由各 App 适配层再译为各自实现。

## 版本与来源

- 自有存量：`references/shot/SKILL.md`（镜头意图与措辞）、`references/short-drama/references/ai-storyboard-director`（六大模块）、`references/modes/` 各 Mode 的 video-prompt-guide（参考图声明纪律）
- 新增协议：仓库设计文档 `rfc/2026-09-15-generation-reference-protocol.md`（统一 `<reference>` + role + resolver；本 SKILL.md 已内联其规则要点，不依赖该文档可达）
- 搬运（MIT / Apache-2.0）内容以来源注记的原文为准，本文件只做融合与收敛。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
