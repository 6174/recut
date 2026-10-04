---
name: generation-prompt
appId: recut.platform
description: 回答「一条交给图片/视频生成模型的生产级提示词怎么写」——固定七段 schema（CAMERA LOCK / STYLE LOCK / 参考锚定 / 镜头基调 / 声音设计 / 镜头序列 / 负面约束）+ 逐段规则 + Criticality 视觉风险预算与提交自检。
---

# Recut 全局生成提示词技能（references/generation-prompt）

本技能只回答：**一条交给图片/视频生成模型的生产级提示词怎么写？** 输入是镜头意图、资产与参考；**产物是一条可直接提交的提示词正文**，不是分镜、分析或标签。它是 `references/shot`（镜头意图）与各 App 方言之间的落格层，不写 provider 参数；镜头意图归 `shot`，故事/声音/平台/门禁各归其口，provider 参数（`modeType`/`ratio`）归各 App 适配层。

## 输出 Schema

恒定七段，顺序不可换、不得增删，段间空行：

```text
[CAMERA LOCK]   用什么拍：机身/胶片 + 焦段 + 光圈景深 + 稳定方式 + 畸变呼吸（全片一套，逐字复用）
[STYLE LOCK]    视觉风格全文（冻结、逐字复用）
参考锚定表      每条 <reference id kind role label /> 一行，只列真实用到的锚点
镜头基调        全段镜头纪律，声明一次
声音设计        全段底声（一次）+ 每镜旁白/对白与背景声
镜头序列        按 [起~止s] 逐镜写完整画面与声音，区间连续相接、总和即片长
[负面约束]      本片/本镜真实风险项，约 4–6 类
```

## 输入前置

1. **STYLE LOCK 来源**：世界取 `world.identity.style` / world.md（`worlds.get.skillMd`）视觉语言 + `references[]` 的 `style-ref`/`color-card`；否则取立项模板 `styleTemplate.visualPrompt` / `LIGHT_INVARIANT` / 导演风格文件。先冻结，不每镜重写。
2. **镜头意图**：世界取生产层 `scene.detail`（本场拍摄设计，提示词几乎全取自这里）/ `shot.detail` / `scene.storyboard`；否则取 `references/shot` 分镜表。
3. **参考与角色**：世界先读 `references[]`——主角色 `character`（`character_reference`）、场景 `environment`、道具 `prop`、台词 `voice`（用了就必带、用该声线）；只有纯空场景可无参考。克隆/仿拍连真实锚点 `style-ref`/`motion-ref`/`storyboard`。
   > 读法：`worlds.get`（world.md + facts + `references[]`）→ `worlds.production`（作品 → 脚本 → 场次 → 镜头）；叙事/规格取 `script.detail` 与 meta。
4. **声音资产**：对白/旁白逐字、音色、环境/SFX。
5. **画幅与时长**由宿主传参、不写正文；片段长度按内容定，正文标 `[起~止s]`。

## 逐段规则

### [CAMERA LOCK] — 摄影机与镜头选型

AI 主动选**一套**并全片逐字复用：机身或胶片 + 镜头焦段 + 光圈景深 + 稳定方式 + 畸变与呼吸；非写实媒介写等效光学与质感。`ratio/resolution/时长` 是适配层传参，不写这里。

### [STYLE LOCK]

风格全文逐字冻结、全片一致；改一个形容词就是另一部片子。

### 参考锚定表 — 参考锚点表达规则

用统一 `<reference id kind role label />` 标签：

- **role 受控**：`pov / color-card / environment / character / prop / style-ref / storyboard / motion-ref / voice / sfx / music`；role↔kind 匹配，一图一 role，每个 role 只声明一次（后续用「同参考图N」复指）。本表是 AI 侧唯一权威，运行期镜像 `canvas-proposal.ts` 的 `PROPOSAL_ROLES` 必须同步。
- **正文用 id、提交用别名**：正文 `<reference id…>`；提交时改写为组内编号 `参考图1..N` / `音频1..N` 并同序提交 `referenceIds`；id 不进模型串。
- 只引用本片段真实需要的参考；正文每个 token 必须有真实绑定，未绑定即拒。

### 镜头基调

声明一次：允许的机位与运动、轴线与主体屏幕位置、**一镜一主导运动**、禁止无意义漂移；复合运动写清阶段顺序。

### 声音设计

- **全段底声（一次）**：持续环境底声 + 有无 BGM 与气质；底声不因切镜重置。
- **逐镜声音**：① 旁白/对白——逐字、标时间、引号标注、不改写（有台词必带 `role="voice"`）；② 背景声/局部环境声——随场景改写、按因果（接触/受力/声源在前）、对齐区间。

### 镜头序列

每镜一行：`[起~止s] 功能=… ｜ 信息变化=…`（这两个是给作者/自检的标签，**不输出给模型**）→ **景别/机位 → 一个主导运镜（方向/速度/落点）→ 动作起止 → 可见面 → 声音**。功能取建立/关系/揭示/反应/插入/主观/转场/hook 等；区间连续相接、无空档、总和即片长；段内标 HARD CUT，每镜结束状态 = 下一镜起始状态。

- **一镜一信息**：一个动作 + 一个信息变化；写清运镜起点/终点与屏上内容；高风险镜先拆分。
- **可见面与画内文字**：每个可见面写清上面是什么；要观众读到的字逐字写死（引号、≤15 字、给位置、载体够大、标时间），不要读才用无字编码并声明无可读文字。
- **表演（情绪只能外化）**：禁心理/文学词（恐惧、悲伤、压迫感、电影感）；转成可观察信号——视线/眨眼/嘴角/下颌/呼吸/手指/重心/步态/停顿/衣料与汗。例：`他很害怕` → `脚步停住、重心移到后脚、视线转向门口、嘴唇微张、胸口两次短促起伏`。
- **物理与动作**：接触先于位移、受力先于反应、光源先于反光、动作先于环境反馈；力按传递写、二级运动派生回落；一个镜头一个主要动作、保清晰轮廓与方向，复杂动作拆镜，接触点用插入镜；动作镜按 `起势→位移→接触/落空→反应→定格` 写（`references/story` 动作账本）。
- **朝向与连续**：载体朝向 = 持握 + 视线（看手机却让屏正对镜头＝方向反了），拍屏/页内容就换机位（近特写/过肩俯拍）；跨镜保视线匹配、屏幕方向、主光方向与人物左右关系（世界坐标一致）。
- **时长与连续段**：一次请求一段，长度由内容定、不机械切片；连续动作优先一次生成；跨镜同一世界状态、不重建房间。
- **一图分镜表**：压成一张 N 宫格（≤3×3）作 `role="storyboard"` 参考，整张占一名额；必要时 `gridSlice` 切格细化。

### [负面约束]

具体对象 4–6 类（不用类别）；通用：水印/角标/图标/时间/无关 UI；**「无文字/无字幕」仅在不需要可读画内文字时写**，要了可读文字就改成文字质量项（无乱码/错别字/重复/溢出）。

## 总规则

### Criticality：视觉风险预算（内部决策，编译进画面，不外露标签）

- **1 个 PRIMARY EXTREME**（构图/透视/纵深/尺度差/运镜/速度/调度/遮挡/负空间/焦段压缩/空间密度/表演/静止/光影反差/环境动态 选一）+ ≤1–2 支撑，其余维度主动压低。
- **强度停在 EDGE**（近失效但可读），不进 COLLAPSE（破坏识别/结构/因果/连续性）。
- **极端必须物理化**：用空间/速度/尺度/遮挡/视差/物理反馈，不用 `extreme/dramatic/epic`。
- **至少 1 个视觉锚点**（脸/眼/手/道具/运动方向/高亮/剪影/消失点/出口）；越界只局部退让。
- 不得覆盖剧情/身份/资产/轴线/因果/End State/Hard Lock。

### 提交自检

- [ ] [CAMERA LOCK] / [STYLE LOCK] 锁定并逐字复用
- [ ] 参考 role↔kind 匹配、真实绑定，正文 token 与 `referenceIds` 同序；世界含主角色必有 `character`
- [ ] 区间连续、总和=片长；每镜一信息/一起止/一主导运动；HARD CUT 已标
- [ ] 每个可见面有内容；文字判支正确；因果顺序与载体朝向自洽
- [ ] 每镜都有旁白/对白与背景声；底声声明一次
- [ ] 正文不含 `ratio/resolution/时长/modeType`、类别式负面词、空泛质量词；Criticality 标签未进提交串

### 导演索引（写提示词时按需查证）

| 你要决定 / 表达什么 | 权威文档 | 回答什么 |
|---|---|---|
| 镜头功能、景别/角度/焦段/运动、构图、覆盖率 | `references/shot`（cinematic-language / shot-library） | 这一镜为什么存在、怎么拍 |
| 调度/走位/入出画、权力与身体关系 | `references/shot`（blocking-and-staging） | 人在空间里怎么动 |
| 连续性与漂移（身份串/服装/道具/屏幕方向/视线/光位） | `references/shot`（continuity-bible） | 跨镜什么绝不能变 |
| 情绪外化的词汇（微表情/动作） | `references/shot`（prompt-lexicon） | 心理词换成可观察动作 |
| 叙事因果、结构节拍、信息差、动作账本 | `references/story` | 讲什么、因果怎么闭环 |
| 开场钩子（0–3s 三层）与留存、切点/转场/卡点、字幕 | `references/editing` | 怎么剪到一起、怎么留人 |
| 声音分层（VO/BGM/SFX、避让、音色） | `references/sound` | 耳朵听到什么 |
| 参考锚点怎么备齐（角色卡/场景图/声线） | `references/assets` | 生成前料齐不齐 |
| 排产（场次→镜头、用料与成本） | `references/plan` | 怎么排产 |
| 平台规格 / 审核红线 / 长转短 | `references/platform` | 发给谁、什么规格、什么雷区 |
| 失败诊断与门禁 | `references/qc` | 哪里坏了、能不能过 |
| 世界读取与生成落位 | `recut-worlds` + `worlds.get` / `worlds.production` | World 里怎么取料、生成、落位 |
| 端到端 Mode 工作流 | `references/modes/*/workflow.md` | 某内容类型已验证的整链 |

### 版本与来源

- 存量：`references/shot` / `references/story` / 各 Mode 的 video-prompt-guide；协议：`rfc/2026-09-15-generation-reference-protocol.md`（已内联）。
- 2026-10-04：重构为「Schema → 逐段规则 → 总规则」，去重收敛并内联动作因果与 Criticality。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
