<!--
 * [INPUT]: 依赖现有 Creation Worlds RFC、WorldStore/HTTP/MCP/Agent 实现与工作台 Worlds 页面审计结果
 * [OUTPUT]: 定义面向创作者的 Creation Worlds 产品重构、AI 可达性契约、渐进数据迁移与验收标准
 * [POS]: rfc 的 Worlds 产品决策；在实现前冻结用户语言、完整生命周期与 Agent 写入授权模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: Creation Worlds 产品重构——让 AI 真正记住创作设定

- 状态：部分实施（多模态 Evidence 基座与创作者界面已落地；WorldBrief / Agent 提议写回待实施）
- 作者：Recut
- 日期：2026-08-14
- 关联：[Creation Worlds 初版 RFC](./2026-08-12-creation-worlds.md)、[技术设计](./2026-08-12-creation-worlds-technical-design.md)
- 决策范围：World 的用户体验、信息模型、Agent/MCP 契约、完整生命周期与迁移

## 摘要

Creation Worlds 的方向是正确的：它把“角色、风格、规则和素材参考”从一次性 Prompt 变成可追溯的长期上下文。当前实现却把**内部 Canon 引擎**直接暴露成用户产品：`entity`、`revision`、`sha256`、`resolve`、`assetId`、JSON 编辑器构成了主要交互。用户被迫理解数据库如何存储，AI 则要在多个低层工具之间自行拼装正确操作。

本 RFC 将 World 重构为一个创作者可读写的**多模态创作设定本**：图像、文本、视频和声音共同构成世界的可信记忆，角色、故事、场景、风格与规则只是组织这些记忆的语义骨架。AI 读取一份面向生成的世界简报，并通过“提议 → 用户确认 → 写入”的受控变更模型维护它。现有 revision、canonical hash 与通用 JSON 可继续作为内部实现，但不再是默认界面或公开 Agent 写入模型。

产品主张保持不变，但把承诺做实：**让 AI 记住你正在创造什么，也让你一眼知道它记住了什么。**

实施注记（2026-08-14）：第一刀已经落在不变量上。现有 `world_asset_refs` 的物理表保留以避免迁移风险，但其产品/API 模型已升级为 **World Evidence**：服务端从 Asset 真相推导模态和内容哈希，写入用途、主次、集合与音视频片段，并将其纳入 revision。工作台不再用文件名列表表达 Canon，而是直接预览图片、视频与声音。`worlds.brief`、模型能力降级和 Agent 变更提议仍属于后续阶段，不能被这次界面优化假装已经完成。

## 基本原则修订：World 是多模态记忆，不是文字设定加附件

一张角色正面图、三张不同表情图、一段角色声线、一条走路的视频、一个镜头节奏参考、一份人物小传，表达的是同一个角色的不同可感知维度。任何一个单独字段都不能替代其他证据。World 的正确模型不是：

```text
文字 Canon + 若干可选 Reference
```

而是：

```text
多模态证据（图像 / 文字 / 视频 / 声音）
       + 明确的语义、范围、主次与冲突处理
       = 可被人审阅、可被 AI 消费的 World Canon
```

因此，本 RFC 的所有“素材”“参考”“Context”表述都按以下规则解释：

1. **图、文、视频、声音都是一等 Canon。** 它们不应被收纳在末尾的“灵感素材”Tab，也不能只以裸 `assetId` 出现在 API 中。
2. **同一设定可有多份同模态证据。** 一个角色可拥有正侧背三视图、表情组、不同服装、多个声线 take、行动视频和文本小传；系统不能偷懒地只选“第一张图”。
3. **素材必须有可读语义。** 每份证据需说明它证明什么、适用于谁/什么、在什么创作目的下使用、是主参考/补充/反例还是已经弃用。
4. **媒体能力差异不能造成信息丢失。** 图片模型不支持音频输入时，系统应明确把声音证据转换为可用的声音描述、转写或声线约束；不能静默忽略。视频、文本和声音同理。
5. **固定版本必须固定证据选择。** 一个 Project 或生成任务引用的是某份 World revision 中的“多模态证据包”，包含 Asset 内容哈希、必要的 video/audio 时间段与文本片段，而不仅是可变的 Asset ID。

## 多模态审计：当前缺失什么

### P0：`world_asset_refs` 只有标签，没有证据模型

现有表只有 `world_id / entity_id / asset_id / role / label / sort_order`；MCP 也只接受六种 role（character、voice、location、style、story、brand reference）。这使它无法表示：

- 一个素材的模态、时长、分辨率、文本内容、转写、视频关键片段或音频片段；
- “角色正面图”“侧面图”“表情组”“行走视频”“声线 take A”这一组内部的顺序和集合；
- 素材是**主参考、补充参考、反例、已弃用**中的哪一种；
- 一个视觉参考只对服装有效，还是对整个角色有效；一段声音只对语气有效，还是角色身份声线；
- 两张主参考图发生矛盾时，应由谁优先，或必须询问用户；
- 何时从视频/音频中取哪一个时间段，何时从长文/转写中取哪一个片段。

更严重的是，`AttachReference` 只校验 Asset 已完成，不校验 `role` 与 `kind/mimeType` 是否匹配。图像可被误标为声音参考；Agent 也没有足够信息发现这一错误。

### P0：当前 Context 只输出 ID + role，无法让生产能力正确消费

`CreationContext.references` 仅包含 `assetId / role / label / entityId`。它没有每份素材的 kind、优先级、范围、片段和派生物状态。消费者只能自行猜测：

- 图片/视频/声音哪个可传给当前模型？
- 该传几份、以什么顺序、哪一份比另一份更可信？
- 没有多模态输入能力时如何把资料转成约束？
- 用户选择某个角色时，相关的 world-level 风格、声音或场景证据是否也应进入本次创作？

现有 `assetRoles` 也不足以表达“角色 A 的外貌图 + 角色 A 的声线 + 故事 B 的节奏视频 + World 级调色参考”这样一个真实创作包。它是按角色名筛选，不是按可消费证据包选择。

### P0：删除 Asset 会绕开 World revision

素材库删除会直接删除 `world_asset_refs`，却不经 WorldStore 产生新 revision。于是当前 World head 的真实引用和最近 Canon snapshot 可能不一致，历史 Project 也无法得知一份证据为什么消失。多模态 Canon 的基本不变量应是：**证据的增删、归档、替换与主次变化都是语义变更，必须进入 World 历史。**

### P1：产品界面仍把多模态降级为文本列表

当前“灵感素材”只显示素材名称、用途与备注；没有图片缩略图、视频封面与关键片段、音频播放器/波形、文本阅读卡、集合排序、主次标记、冲突提示或跨设定浏览。它保留了 Asset，但没有让用户看见“这个 World 的视觉和声音是什么”。

### P1：缺少多模态摄取与生成回写路径

用户无法在创建 World 时一次选择多张图、视频、声音、文档/转写并说明用途；也无法把一次生成的多份候选主动收录为 World 证据集。生成结果只能手工附加，且缺少“这只是候选，不要污染 Canon”的安全状态。

## 多模态 Canon 模型

### Evidence 是独立的一等对象

将现有 `world_asset_refs` 演进为 `world_evidence`。它仍只引用全局 Asset，不复制二进制，但必须记录可消费的语义与版本锚点：

```text
WorldEvidence
  id
  worldId
  scope: world | settingId
  assetId
  assetContentHash                 # 固定其内容版本
  modality: image | video | audio | text | research
  purpose: identity | appearance | wardrobe | voice | motion |
           scene | mood | visual_style | sound_style | narrative | rule_evidence
  status: primary | supporting | counterexample | archived
  collectionId?                    # 例如“小满 · 角色外观 v2”
  order                            # collection 内稳定顺序
  segment?: { startSec, endSec }   # 音视频范围
  excerpt?: { partId, start, end } # 文档/转写范围
  note                             # 用户可读说明
  createdAt / archivedAt
```

`purpose` 不是“文件类型”：一段视频可以是动作证据、场景证据或镜头节奏证据；一张图可以是角色身份、服装或颜色风格证据。`modality` 从 Asset 真相推导，不接受用户伪造。一个 Evidence 可被多个 collection 或 scope 引用时，创建新的引用记录，不复制 Asset。

### Evidence Collection：多份素材必须是有意义的一组

Collection 是用户可见的证据组，不是文件夹：

- **小满 · 角色外观**：正面、侧面、背面、表情与服装；其中“正面”为 primary，其余为 supporting。
- **小满 · 声线**：自然说话、情绪激动、低声独白三段音频，可附转写和声线说明。
- **雨后街道 · 场景氛围**：地点照片、雨声、光影视频与文字描写。
- **频道 · 视觉与节奏**：颜色板、参考视频片段、字幕节奏和音乐样本。

Collection 支持多份素材、稳定排序、封面、用途和冲突状态。一个 scope 对同一 purpose 最多有一个 primary collection；多个 primary 产生明确冲突提示，不能由 Agent 静默随机选择。

### Multimodal Brief：给 AI 的不是文件列表

`recut.worlds.brief` 取代低层 `resolve` 作为默认消费入口，并新增：

```text
MultimodalWorldBrief {
  facts, constraints, selection,
  evidence: EvidenceCollection[],
  actionableInputs: {
    image: MediaInput[], video: MediaInput[], audio: MediaInput[], text: TextInput[]
  },
  adaptations: Adaptation[],
  conflicts: Conflict[],
  missing: MissingEvidence[]
}
```

`actionableInputs` 只放当前模型与当前目的可直接消费的内容；`adaptations` 显式说明其余证据如何保留语义，例如“这段声线音频不可直接传给图片模型，使用其转写、声线描述和语速约束”；无可靠派生物时标记为 `needs_user_or_agent_review`，绝不悄悄丢弃。

图片、视频、声音、文本的选择受模型 `inputModes` 和引用数量上限约束；裁剪/抽帧/转写等派生物本身也作为可追溯 Asset/part 记录来源，不能在调用时临时失忆。

## 多模态产品表面

### World 首页与设定详情

“灵感素材”更名为 **世界素材**，但不再是一个孤立末级 Tab：

- 每张角色、故事、场景、风格卡都显示自己的视觉、文本、视频、声音证据组，以及缺失模态提示。
- World 首页展示“世界感官板”：主视觉、主声线、代表片段、文字基调；它让用户一眼感到这个 World，而不是读到属性表。
- 媒体以原生形态预览：图片缩略图；视频封面、时长与关键片段；音频播放/波形与转写；文字/研究资料的摘要和摘录。复用现有 AssetPreview，不重新发明播放器。
- “添加证据”支持从素材库多选、拖拽、上传和生成结果回收；选择后为每份素材填写用途、主次、适用范围和备注，而不是只选一个 role。
- “候选素材”与“已纳入设定”分开。生成的候选不能自动成为 Canon，用户确认后才提升为 supporting 或 primary。

### 创作范围与预览

用户点击“开始创作”时，预览必须按模态列出将被使用的具体证据组：

```text
这次会使用
  角色：小满
    图像：角色外观 v2（4 张，主参考为正面图）
    声音：声线（3 段，使用自然说话与低声独白）
  场景：雨后街道
    视频：光影节奏（00:12–00:20）
    声音：雨声环境（00:00–00:18）
  规则：保持低饱和、不要夸张表情
```

若当前生成模型不能使用某一模态，预览显示“保留为约束 / 需要转写 / 此模型不支持”，并允许用户调整；不能把视觉或声音静默从本次创作中移除。

## 多模态生命周期与验收补充

所有 Evidence 与 Collection 必须有 attach/read/update/reorder/archive/restore/detach；视频/音频还要有 segment 更新，文本还要有 excerpt 更新。所有这些操作都创建 World revision。删除底层 Asset 时，平台应先标记关联 Evidence 为 `source_unavailable`，通知用户处理；既不能直接改写 World head，也不能破坏已绑定 Project 的历史证据包。

新增验收标准：

- 一个角色可同时保存不少于 4 张图、3 段音频、1 条视频和多段文本，且 UI、MCP brief 与绑定 Project 均保留其集合、顺序、用途和主次。
- Agent 不会在多个 primary 证据冲突时自行挑选；它必须请求选择或按用户设置的优先级工作。
- 任意生成任务可报告“直接使用了哪些 Asset/片段”“哪些被转为文字约束”“哪些因模型限制未能直接输入”。
- 删除 Asset 不会静默篡改 World 的语义历史。

## 现状审计

### 已有基础，值得保留

| 能力 | 现状 | 结论 |
| --- | --- | --- |
| 隔离与版本 | World、实体、素材引用、Project binding 均有明确 `worldId` 和不可变 revision | 保留；这是作品可追溯性的正确基础。 |
| AI 读取 | `recut.worlds.list/get/entities.list/entities.get/resolve` 已可从 MCP 调用；真实 World 可被列出、读取和解析 | 保留，但收敛为更高层的阅读契约。 |
| 素材归属 | World 只引用全局 Asset，不复制二进制 | 保留；素材库仍是文件真相。 |
| App 权限 | `worlds.read`、`worlds.write`、`worlds.bind` 已分层 | 保留并把用户确认变为系统能力。 |
| Project 绑定 | Project 可冻结一个 World revision；Remotion workflow 能读取 `creationContext` | 保留，补齐从任意创作入口绑定的路径。 |

### P0：用户面对的是实现语言，而非创作语言

截图中的 `revision 0682c708`、`sha256`、`resolve`、`Entities`、`References` 都是系统术语，不回答创作者最关心的问题：

- 这个角色长什么样、如何说话、什么绝不能变？
- 这条故事的主人公、场景、情绪与目标是什么？
- AI 这次创作会采用哪些设定和素材？
- 我现在最值得补充的是什么？

空白的“主角角色”卡片还产生了错误的完成感。实际调用 `resolve({ purpose: "agent" })` 会得到 `appearance: ""`、`personality: ""`、`voice: ""`，因此 AI 确实能够读取它，却没有任何有用事实可遵循。

### P0：JSON 是唯一编辑器，内容模型没有产品契约

所有实体共用 `title + summary + content: Record<string, unknown>`，界面把 `content` 直接作为“内容 JSON”文本框。其后果是：

1. 普通用户不能安全地编辑自己的设定；字段名、引号、数组与合法 JSON 都成了学习成本。
2. 每一种实体没有“完整”的定义，创建流程只留下空模板，AI 也无法判断缺少什么。
3. MCP 的 `entities.upsert` 只声明“不同 kind 有不同 JSON 契约”，却没有可机器发现的 schema、字段说明、示例或 completeness 规则。
4. `identity` 同样是自由 JSON，却没有任何界面编辑入口；World 的核心定位实际无法被产品维护。

内部用可扩展 JSON 保存字段不是问题；**把存储格式当成用户和 Agent 的编辑协议**才是问题。

### P0：生命周期不是 CRUD

当前可创建、读取、更新 World/Entity，也可添加 Asset reference；但没有 Entity 或 World 的 archive/delete/restore，没有 reference detach，也没有 relation 的 create/update/delete。`world_relations` 虽能在读取和 Canon 中出现，却没有任何写入路径。

这意味着用户无法修正错误设定，AI 也不能完整执行“移除旧角色关系”“删除错误参考图”“把角色退场”这样的自然指令。revision 只能记录变化，不能替代可恢复的删除语义。

### P0：AI 可达，但不可靠地可操作

当前 Agent 能在带有 World/Entity attachment 时得到 ID 与读取指引；这是正确的最小安全路径。但产品链路不完整：

- `WorldPicker` / `WorldEntityPicker` 已存在却没有被聊天输入或创作入口引用，用户不能自然地把 World 带进对话。
- 页面上下文只说明“当前页面”，不自动附带选中的设定、预览中的创作范围或可执行下一步。
- Agent 读取一个 World 通常需要 `get → list → get* → resolve` 多次调用；大世界会导致遗漏，且没有“本次创作简报”的单一入口。
- 写工具允许直接传任意 JSON。行为约束主要在 tool description 与 prompt 中，系统层没有“先显示拟写入内容、再获得用户确认”的不可绕过门。
- 乐观并发虽存在，详情 UI 保存实体时没有携带 `expectedRevisionId`；并发保护在最常见的人类编辑路径中没有生效。
- 一个 Project 可以被绑定，但“新建项目 / 从素材开始 / 在对话中生成”没有统一的 World 选择、范围选择和绑定确认。

### P1：信息架构把创作流拆散

标签按底层 kind 横向排列，用户需要先猜测一条内容该放 `Stories`、`Rules` 还是 `References`，再在不同标签之间拼回一个故事。World 首页没有“下一步创作”“正在使用的设定”“变更历史”或“设定健康度”。`解析当前选区` 是调试操作，不是用户动作；它既没有解释选择了什么，也不产生可创作结果。

### P1：现有测试覆盖存储正确性，未覆盖产品承诺

现有测试很好地覆盖了跨 World 隔离、Asset 完成态、revision hash、绑定固定版本和权限门。但尚未覆盖：用户可完成所有生命周期操作、表单内容能投影为正确 Context、Agent proposal 必须确认、attachment picker 真正可达、Project/生成链路会消费 binding、以及空白模板不会被标记为“就绪”。

## 目标与非目标

### 目标

1. 任何非技术创作者可在不见 JSON、ID、hash 或 `resolve` 的情况下建立和维护一个可用 World。
2. 每种设定有明确、可编辑、可验证的字段；用户能看见“AI 已知 / 仍缺少什么”。
3. World、设定、关系、素材引用和绑定均有 create/read/update/archive/restore 的完整路径。
4. AI 有一个低歧义、可检索、固定版本的读取入口，以及需要确认的自然语言写入入口。
5. 每次创作前，用户清楚知道 AI 将使用哪些设定、规则和参考素材；每次写回前，用户清楚知道将改变什么。
6. 保持现有 World isolation、Asset 单一事实源、revision 可追溯和 App permission 的架构边界。

### 非目标

- 不把 World 做成百科、Notion 或任意图数据库。
- 不在本 RFC 中实现团队协作、分支合并、复杂时间线、关系图画布或自动从互联网抽取事实。
- 不要求所有一次性创作先绑定 World。
- 不让 AI 未经确认把生成结果、推断或偏好写成 Canon。

## 核心决策

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 对外产品名 | 主界面使用“创作设定”，保留 Worlds 作为全局入口品牌 | 用户理解“我在维护什么”；World 是平台概念而不是任务。 |
| 用户对象 | 角色、故事、场景、风格、创作规则、灵感素材 | 用创作语言替换 Entity/Location/Reference，不丢失现有语义。 |
| 编辑方式 | 类型化表单 + 自然语言 AI 辅助；不展示 JSON | 结构由产品保证，内容仍由用户掌控。 |
| 内部存储 | 保留 canonical/revision 和可扩展属性存储；新增版本化 `schemaVersion` 与字段注册表 | 不为每个 kind 过早拆表，同时消除无契约的任意对象。 |
| AI 写入 | 两阶段 `propose_change` / `apply_change`，apply 必须带一次性用户确认 token | Prompt 不是授权边界；必须由系统保证。 |
| 删除 | 默认 archive，可恢复；永久删除只在 World 设置中进行并校验绑定 | 保护已绑定 Project 与历史作品，又允许用户纠错。 |
| AI 读取 | `worlds.brief` 成为单一默认入口，`resolve` 降为内部/高级 API | Agent 应读“创作简报”，不是遍历数据库。 |

## 产品体验

### 1. 创建：从创作意图开始，而不是从数据类型开始

新建 World 只问三件事：

1. **你想持续创作什么？** 角色 IP、内容账号、品牌内容、故事宇宙、自由设定。
2. **它叫什么，给谁看？** 名称、一句话定位、可选封面或一张参考图。
3. **从哪里开始？** “告诉 AI 几句话”“填写一张角色/品牌卡”“从现有素材开始”。

创建后进入一个小型引导，而不是塞入空的“主角角色”。引导明确显示首个可完成动作，例如“描述主角”“添加第一条内容风格”“写下这条故事想表达什么”。用户可以跳过，跳过后的 World 显示“尚未形成 AI 可用设定”，绝不伪造已完成实体。

### 2. World 首页：一页回答状态和下一步

页面结构：

```text
封面 / 名称 / 一句话定位                         [开始创作]
AI 已了解什么：3 项已就绪 · 2 项待补充             [让 AI 帮我完善]

本次创作会使用
  已选故事、角色、规则、风格、参考素材               [调整范围]

继续建立设定
  角色 | 故事 | 场景 | 风格 | 创作规则 | 灵感素材

最近创作 / 最近变更
  “为小满添加声音特征” · “将短片《雨后》绑定到此设定”
```

用户默认看到的是进度、内容与行动。revision、hash、实体计数、可用类型与内部 ID 移入“设定历史 / 高级信息”，仅供诊断和支持使用。`解析当前选区` 改为用户可理解的 **“查看 AI 将使用的设定”**，在可读预览中显示实际文字和素材缩略图。

### 3. 设定编辑：每种对象都有自己的语言

所有字段都可直接填写；长文本支持“让 AI 根据这段描述整理”，但 AI 的整理结果先以 diff 展示。

| 用户对象 | 必填或建议字段 | AI 投影 |
| --- | --- | --- |
| 角色 | 名称；身份/关系；外貌；性格与行为；声音与说话方式；不可改变的特征；参考图/声音 | `characters[]`，并把“不变特征”提升为 constraints。 |
| 故事 | 标题；这次想讲什么；主角；场景；冲突/转折；情绪；时长或内容形式 | `story` + 关联角色/场景/风格。 |
| 场景 | 名称；地点与时间；视觉元素；氛围；可用/不可用元素；参考图 | `locations[]` + references。 |
| 风格 | 适用范围；视觉；文案/语言；镜头与节奏；音乐/声音；正反例参考 | `styles[]` + 可执行的 prefer/never。 |
| 创作规则 | 规则文本；适用对象；强度（必须/不要/尽量）；原因 | `constraints.always/never/prefer`。 |
| 灵感素材 | 从素材库选择；用途；附注；关联设定 | 有缩略图和用途，输出真实 `assetId`。 |

关系不是隐藏表：在角色、故事和场景的“关联”区可选择“谁与谁”“扮演什么关系/发生在哪里”，支持编辑和归档。第一期用表单与列表呈现，不做图编辑器。

### 4. 创作：范围是显式、可见、可修改的

在 World 内点击“开始创作”时，先出现一个简洁的“创作范围”面板：选择故事、角色、风格、规则及参考素材，系统生成一张 **本次 AI 创作简报**。用户可：

- 继续在对话中创作；World attachment 与 selection 一起传入；
- 创建项目并冻结当前版本；
- 生成图片、声音或视频并把生成任务绑定到此版本；
- 保存为草稿范围，之后复用。

创作完成后，产物显示“使用了《春日小满》设定的版本 2026-08-14 16:20”；用户不需要看到 hash。若 World 后来改变，旧作品仍指向原版本，新创作则提醒“设定已有更新，是否采用最新版”。

## AI 与 MCP 契约

### 读取：一份适合模型的 World Brief

新增只读默认入口：

```text
recut.worlds.brief({ worldId, selection?, purpose })
```

它返回固定 revision 的 `WorldBrief`，包含：世界定位、适用创作范围、已选对象的可读字段、强制/禁止/偏好规则、素材的用途与真实 assetId、缺失信息、来源 revision。它不返回内部 hash 或任意 `content` 容器。模型面对的字段是稳定且按重要度排序的；用户没有明确 selection 时，只取 world-level rules、标记为默认的风格和最多 N 个高优先级设定，避免大世界把上下文撑爆。

`list/get/search` 仍保留用于发现，`entity.get` 改名或兼容为 `setting.get`。`resolve` 保留为 App/运行时内部投影，不再作为主 UI 的按钮或 Agent 的首选步骤。

### 写入：提议不是写入，确认才是写入

新增受控命令模型：

```text
recut.worlds.propose_change({ worldId, request, baseRevisionId? })
  -> ChangeProposal { summary, operations[], userFacingDiff, confirmationToken, warnings[] }

recut.worlds.apply_change({ confirmationToken })
  -> ChangeResult { revision, affectedSettings[], archivedItems[] }
```

`request` 允许自然语言或结构化意图；返回的 `operations` 由平台生成并严格验证。只有用户在当前会话明确确认展示的 proposal 后，前端才暴露 `apply_change`。confirmation token 绑定 World、base revision、操作摘要、会话和短时 TTL；revision 变化后立即失效。

高频、表单驱动的人类编辑可直接调用同一领域服务，但同样携带 `baseRevisionId`；冲突时展示“有人已更新设定，请比较后重试”，不能静默覆盖。

### 完整生命周期动词

| 用户意图 | 平台命令 | 备注 |
| --- | --- | --- |
| 建立/修改设定 | `propose_change` / `apply_change` | 覆盖 World 与所有 setting 类型。 |
| 删除错误内容 | `archive_setting` / `restore_setting` | archive 从新版本移除，不抹去历史 revision。 |
| 管理素材 | `attach_asset` / `detach_asset` | 用用户可读的用途，不暴露裸 role。 |
| 管理关系 | `link_settings` / `update_link` / `unlink_settings` | 关系必须有写入和读取闭环。 |
| 管理 World | `archive_world` / `restore_world` | 有 active binding 时先解释影响并二次确认。 |
| 使用在创作中 | `create_selection` / `bind_target` / `unbind_target` | binding 是明确可见的用户动作。 |

永久删除不在 Agent 常规工具集中；只在设置页执行，且不得删除仍被绑定或被作品历史引用的原始记录。

### Attachment 与发现

聊天输入的“引用资源”升级为“引用创作上下文”，其中可选择素材、World 或具体设定。`WorldPicker` 和 `WorldEntityPicker` 必须接入实际 composer，而不是孤立组件。attachment 存储 `{ worldId, selection, revisionMode: "latest" | "pinned" }`；发送时平台物化为 WorldBrief，而非要求模型记住下一步该调用哪些低层工具。

当用户在 World 页面发起对话，页面上下文包含当前 World 与当前 selection；当用户只浏览页面时不偷偷把整个 World 注入每次对话，避免无关上下文和隐私惊喜。

## 数据与兼容策略

### 领域 schema，而不是专用表爆炸

保留单一 `world_settings`（由现有 `world_entities` 迁移）和 versioned document 存储，但将无约束的 `content_json` 升级为：

```text
kind + schema_version + fields_json + completeness + priority + archived_at
```

- `fields_json` 只允许注册 schema 中的字段，未知字段进入显式的 `notes` 扩展区；不能静默影响 Canon。
- `schema_version` 允许未来演进和迁移；每个 `kind` 有平台维护的显示标签、字段定义、投影函数、验证和缺失检查。
- `completeness` 从字段计算，不持久化为用户可修改事实；显示为“可用于创作 / 建议补充 / 草稿”。
- 原 `world_relations` 增加 lifecycle 字段和关系类型注册；原 Asset reference 增加用户可见的用途标签与可选说明。

这保留 JSON 的扩展性与 Canon 的稳定性，但 JSON 成为内部表示，而非产品合同。

### 兼容与迁移

1. 新 schema 以 additive migration 加入；现有表和 revision 不重写。
2. 读取旧实体时由 adapter 映射到对应 setting schema：例如 character 的 `appearance/personality/voice` 映射到角色字段；未知键只在“补充笔记”中保留。
3. 首次打开旧 World 时显示“设定需要整理”，用户可一键接受 AI/规则生成的字段草稿；绝不自动改写 Canon。
4. 新版创建与编辑只写 schema 化数据；旧 `entities.upsert(content)` 保持一个发布周期兼容，并在服务端映射/记录警告。
5. 新版 `WorldBrief` 与旧 `CreationContext` 同时由同一 revision 产生。Remotion 等现有消费者继续读取 `CreationContext`，直到迁移完成。
6. 所有 archive/restore 都创建新 revision；旧 Project binding 继续解析其固定 revision，永不被新归档破坏。

## 实施阶段

### Phase 0：先修完整性与可见性

- 移除默认空“主角角色”的完成假象，改为引导任务和草稿状态。
- 接入 World/Setting attachment picker 到 composer；在 World 页传递当前选择。
- UI 保存一律传 `expectedRevisionId`，冲突可读地处理。
- 补齐 archive/restore、detach reference、relation CRUD 与其 HTTP/MCP/SDK/test。
- 将 `revision/hash/resolve/entity` 从默认用户界面移除或改名。

### Phase 1：类型化编辑与 World Brief

- 建立 schema registry 与角色、故事、场景、风格、规则、素材六种表单。
- 建立 completeness/优先级计算和“AI 已了解什么”首页。
- 实现 `worlds.brief`、selection editor 和人类可读的 AI 使用预览。
- 打通任意 Project、聊天和媒体任务的 binding 入口。

### Phase 2：安全的 Agent 写回

- 实现 proposal/diff/confirmation-token/apply 服务端门禁与对话 UI。
- 让 Agent 在发现信息缺失时提出问题或 proposal，而非填空猜测。
- 支持变更历史、恢复、来源与“本作品采用的设定”展示。

### Phase 3：扩大消费者与质量回路

- 将 WorldBrief 接入所有申请 `worlds.read` / `worlds.bind` 的生产 App。
- 对不同 World 类型提供领域模板、导入和健康检查。
- 基于匿名、本地可选的产品事件评估创建完成、绑定和返工率；不上传 Canon 内容。

## 验收标准

### 用户体验

- 新用户可在 5 分钟内从一句话建立一个“可用于创作”的角色或品牌设定，全程不接触 JSON、ID、hash、revision 或 `resolve`。
- 用户可在一个页面完成角色信息、参考图、规则和一条故事的建立，并能删除/恢复每一项。
- 点击“开始创作”前，用户能读到 AI 将使用的设定和素材；生成后的 Project/Asset 可反查该设定版本。
- 空白模板被明确标记为草稿，不会在 AI Brief 中伪装成事实。

### AI 与平台

- 带 World attachment 的 Agent 可用一次 `worlds.brief` 获得当前任务所需事实、constraints、references 和缺失项；大 World 的输出有确定的尺寸预算与排序。
- Agent 无法绕过 confirmation token 写入 World；无确认时只能输出 proposal。
- 每个用户生命周期动作均有 API、MCP、SDK、UI、权限校验和回归测试；不再出现“数据库有表但产品没有动词”。
- 人类和 Agent 写入均使用 base revision；冲突不会静默覆盖。
- 旧 Project/Artifact 在 World 更新、archive 或 schema 迁移后仍能解析原始 Context。

## 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 类型化 schema 限制创作自由 | 保留 `notes` 与受控 custom blocks，但只有注册字段可影响默认生成 Context。 |
| proposal 增加一次交互 | 只对 Agent 写回要求确认；用户直接表单保存保持直接。高风险变更可批量确认。 |
| WorldBrief 太长 | selection、优先级、字段预算和按 purpose 的投影共同限制；需要全量研究时 Agent 再显式检索。 |
| 历史表迁移复杂 | 使用 adapter 与双读双写阶段，不重写已有 revision。 |
| 名称变化造成文档混乱 | 对内继续使用 `world/entity/revision`；对用户文案固定为“创作设定/设定项/设定历史”。 |

## 开放问题

1. 是否将“素材参考”作为独立 tab，还是在各设定卡内优先显示并提供全局汇总？建议两者兼有，但只维护一份 Asset relation。
2. 一条故事是否应成为可复用的“创作简报模板”？建议 Phase 2 评估，避免 Phase 1 扩大对象模型。
3. 是否允许多个 World 同时绑定一个 Project？现有 primary binding 足够；Phase 1 仅允许一个主设定和若干只读参考，不开放多主 Canon。
4. 对现有 `custom` World，是否提供 schema 生成器？建议先提供“自由设定 + 笔记/规则/素材”，不让 AI 即时生成不可维护的新 schema。

## 结论

当前 Worlds 不是“设计稍显 geek”，而是把正确的底层架构直接当成了产品。revision、canonical hash、显式 selection、Asset ID 和通用 JSON 是工程上有价值的边界；它们不应成为创作者建立世界的语言。

本 RFC 的核心不是删掉结构化或牺牲可追溯性，而是在其上建立一个完整的用户模型：**人编辑可理解的设定，AI 消费可验证的简报，任何写回都先让人看见并确认。**

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
