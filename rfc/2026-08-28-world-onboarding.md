<!--
 * [INPUT]: 依赖 Creation Worlds 三份既有 RFC（2026-08-12 产品 / 2026-08-12 技术设计 / 2026-08-14 产品重构）与 PGC RFC（2026-08-28）的 WorldStore、revision、brief、Evidence 双源、world.md 技能模型；service/worlds.go 的模板 seed 实现、worlds_mcp.go 工具面、web/app/worlds 创建弹框与详情页、service/skills/recut/SKILL.md 的 Worlds 章节铁律
 * [OUTPUT]: 定义 World 创建后的场景化引导（Onboarding）：场景蓝图（scenario blueprint）+ Readiness 完备度模型 + 素材注入（上传/链接/口述）+ Agent research/generate 协作循环 + 候选审视确认写回；移除空壳模板实体的完成假象
 * [POS]: rfc 的 Worlds 创建后体验与 Agent 完善工作流决策；在 08-14 重构（类型化编辑/brief）与 08-28 PGC（world.md/evidence 双源）之上补齐"世界从 0 到可用"这一段，获批后指导 service、web、平台 Skill 与文案
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: World Onboarding——场景化引导 + AI Research/Generate 完善循环

- 状态：部分实施（P0 全量 + P1 web 引导/场景选择 + P2 Agent 工作流已落地：创建去空壳、readiness 计算/HTTP/MCP、brief.missing 同源、详情页引导卡、创建弹框场景选择、SKILL.md onboard 工作流与 references/world-onboarding.md、平台 skill 的 skills.read/reference 虚拟解析；提案审视画廊与四条注入路径的完整向导待后续迭代）
- 作者：Recut
- 日期：2026-08-28
- 关联：[Creation Worlds 初版 RFC](./2026-08-12-creation-worlds.md)、[技术设计](./2026-08-12-creation-worlds-technical-design.md)、[产品重构](./2026-08-14-creation-worlds-product-reframe.md)、[PGC 平台 World 内容层](./2026-08-28-pgc-platform-worlds.md)、[Agent Work Surface Context](./2026-08-16-agent-work-surface-context.md)
- 决策范围：World 创建后的引导体验、场景蓝图与完备度模型、素材注入路径、Agent 完善 World 的标准工作流、候选素材的确认写回、空壳模板实体的退场
- 非决策范围：propose_change/apply_change 服务端门禁（08-14 Phase 2，本 RFC v1 用 UI 确认前置替代）、团队协作、World 模板市场

## 摘要

当前 `recut.worlds.create` 按类型写入一个**全空字段的模板实体**（角色 IP 类型 seed 出 appearance/personality/voice 全为空串的「主角角色」），用户创建后面对的是空卡片和五个空 Tab——不知道该填什么、按什么顺序填、填到什么程度算"可用于创作"。Agent 侧虽然有"不主动写 Canon"的正确铁律，却**没有被邀请时的标准动作**：用户说"帮我完善这个世界"时，AI 没有可遵循的工作流，也没有候选素材的安全审视场所。

本 RFC 的核心立场：**创建 World 的正确起点不是空表单，而是"你手里有什么"。** 用户几乎从不是从零思考一个世界——他们手里有一本小说、一个 IP 社媒账号、一套已成形的风格表达、一份品牌手册。Onboarding 的职责是：

1. **场景蓝图替用户思考结构**：每种起点场景（小说改编 / IP 账号 / 风格体系 / 品牌指南 / 从零开始）声明这个世界的目标形态——需要哪些实体、什么证据、world.md 该长什么样。用户选场景，不猜结构。
2. **AI research + generate 替用户填充**：Agent 拿到场景蓝图与用户素材（文本/链接/上传/口述）后，走标准工作流：读 brief → 算 missing → research（消化文本/抓取链接/检索资料）→ generate（生成候选参考图）→ 提出 proposal。
3. **确认写回是唯一写入路径**：AI 的一切产出先以 proposal + 候选呈现，用户在审视面板确认后才落 Canon。生成结果绝不自动成为证据。

产品主张：**你带来素材和意图，场景和结构交给蓝图，填充和研究交给 AI，拍板权始终在你手里。**

## 问题

### P0：创建即空壳，且空壳伪装成完成

`service/worlds.go` 的 `templateEntities` 在创建时 seed 一个内容全空的实体。三个后果：

1. **完成假象**：详情页出现"主角角色"卡片，实际 `resolve` 出来全是空串——08-14 重构已点名"空白模板不会被标记为就绪"，但至今未实施。
2. **学习成本倒置**：用户第一个看到的是五个空 Tab（角色/故事/场景/风格/规则）+ 空字段表单，被迫先理解"世界由什么组成"才能开始，而这正是产品应该替他们回答的。
3. **AI 无法接手**：空字段的实体在 brief 里是"存在但无事实"，Agent 无法区分"用户没想好"和"这个实体是系统垃圾"。

### P0：没有完备度模型，"可用"无定义

brief 的 `missing` 字段 v1 恒为空数组。用户和 Agent 都无法回答：这个世界现在能用来创作吗？还差什么？哪一件事最值得先做？08-14 重构规划的 completeness 只停留在字段 schema 层面，没有上升到"世界级就绪度"。

### P0：用户的世界几乎都有既有来源，产品却没有入口

用户访谈语境中的三类典型起点（本 RFC 的一等场景）：

| 场景 | 用户手里有什么 | 期望得到的世界 |
| --- | --- | --- |
| **小说 / 故事改编** | 一部小说（文本/文档/链接） | 故事世界：角色群、场景、世界观规则、故事线 |
| **IP 社媒账号** | 一个账号（链接）+ 已发布内容 | 内容账号世界：人设、内容风格、语言规范、视觉资产 |
| **风格表达**（如小黑） | 一套风格：示例图、风格文档、生产方法 | 风格生产世界：风格 DNA、规则集、示例证据、world.md 工作流 |

当前产品对这三类来源零支持：粘贴链接无处可用、上传文本无处落地、AI 没有消化它们的标准动作。用户只能把小说章节手工拆成一个个字段——成本高到放弃。

### P1：Agent 被"铁律"锁死在被动位

平台 SKILL.md 规定"不调用写工具除非用户明确要求"——这是正确的安全边界，但边界内没有动作库。用户明确说"帮我完善"之后，AI 该按什么顺序做什么、research 到什么程度、生成物如何交到用户手里，全靠模型即兴。缺一个 skill 层的标准工作流。

### P1：生成候选没有安全场所

"不得自动将生成结果写入 Canon" 是既有规则，但反面是：AI 生成了 6 张角色参考图后，除了在聊天里贴 assetId 深链，没有结构化的"候选 → 审视 → 采纳"通道。

## 核心决策

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 创建流程 | 弹框升级为"名称 + 类型 + **起点场景** + 可选素材"，创建后直接进入 Onboarding，不再 seed 空实体 | 起点决定结构；空壳是负资产 |
| 场景模型 | **Scenario Blueprint**：每种场景是一份声明式蓝图（目标实体清单、证据期望、world.md 骨架、research 策略），平台内置、随类型推荐 | "辅助用户思考"= 结构由产品给，内容由用户/AI 给 |
| 完备度 | **Readiness** 是服务端计算的投影（非持久化用户事实）：ready / draft / skeleton 三档 + 有序 missing 列表（每项含原因与建议动作） | UI 与 Agent 同源；与 08-14"completeness 从字段计算"一致 |
| 注入路径 | 四条：上传文件 / 粘贴链接（AI research）/ 素材库选择 / 纯口述（AI 追问）。全部收敛到 Agent 的 onboard 工作流 | 不做表单解析魔法；文本与链接的消化是 LLM 的活 |
| AI 写回 | v1 不新增写工具门禁：onboarding UI 中用户的确认动作 = "明确要求"，Agent 据此调用既有 `entities.upsert` / `evidence.attach` / `worlds.update(skillMd)`；候选生成物先呈现后采纳 | propose/apply 服务端门禁留给 08-14 Phase 2；v1 用"确认前置 + 面板审视"把风险关在 UI 层 |
| Agent 工作流 | 平台 SKILL.md Worlds 章节新增 **onboard 标准动作**（references/world-onboarding.md）：brief → missing → research → generate → propose → confirmed write | 铁律不变，边界内补动作库 |
| Onboarding 状态 | 不新建后端 session 表：步骤状态由 Readiness + 前端本地态推导；写回走既有 revision 机制 | 引导是流程编排不是持久业务对象；避免又一张没人维护的表 |
| 平台/Fork 世界 | 非 local 世界不进 Onboarding（它们本来就完整）；Fork 副本提供"裁剪 Onboarding"（沿用同一蓝图算 missing） | PGC 世界开箱即用是既有验收；Fork 后的世界可能被删减 |

## 场景蓝图（Scenario Blueprint）

蓝图是本 RFC 的产品核心：**用户选场景，蓝图回答"这个世界该长成什么样"。** v1 内置五份蓝图，声明式存储于 service（与 world 类型解耦——同一类型可选不同场景，如 character_ip 类型可走"风格表达"也可走"从零开始"）：

```text
ScenarioBlueprint {
  id                  # novel-adaptation | ip-account | style-system | brand-guide | blank
  label / description
  appliesToTypes      # 推荐的 world type（不强制）
  intake              # 期望的素材形态: text|url|assets|conversation
  targetShape {
    entities          # [{ kind, titleHint, required, fields[] }]  目标实体清单
    evidence          # [{ purpose, modality, minCount, note }]    证据期望
    skillMdOutline    # world.md 的章节骨架（该世界的生产工作流模板）
  }
  researchStrategy    # Agent 消化素材时的关注点（如小说: 提取角色群/场景/世界观铁律）
  interview           # 口述路径的追问清单（3-5 个问题）
}
```

### 五份 v1 蓝图

**1. novel-adaptation（小说 / 故事 → 故事世界）** `intake: text/url`

- 目标形态：2-6 个角色（主角必填 appearance/personality/voice + 不可变特征）、1-3 条故事线、主要场景、世界观规则（always/never）
- research 策略：通读文本 → 提取角色卡（外貌/性格/说话方式，**只依据原文，不脑补**）→ 场景与氛围 → 世界观硬约束 → 冲突与故事线摘要
- world.md 骨架：改编口径（忠于原著的程度）、角色出场规范、场景视觉基调、禁止项
- 证据期望：可选（用户上传的插图/影视化剧照作为 supporting）

**2. ip-account（IP / 社媒账号 → 内容账号世界）** `intake: url/text/assets`

- 目标形态：1 个人设实体（人格/语气/人设边界）、1 个内容风格实体（选题域、语言规范、句式偏好）、规则（内容红线、平台规范）、视觉资产证据（头像/封面/代表作截图）
- research 策略：抓取账号链接（webfetch/create_reference 登记）→ 归纳语气与选题域 → 从高互动内容提炼语言规范 → 输出人设卡初稿
- world.md 骨架：内容生产工作流（选题 → 起草 → 按语气规范复核）、语言 DO/DON'T
- 证据期望：≥3 张代表作或视觉资产（purpose: visual_style）

**3. style-system（风格表达 → 风格生产世界，小黑同款）** `intake: assets/text`

- 目标形态：1 个风格 DNA 实体（guidance + body 全文）、可选 1 个角色/IP 实体、3-5 条规则（颜色克制、禁止项、格式约束）、示例图证据集（collection 归组）
- research 策略：从示例图归纳视觉共性（构图/配色/线条）→ 从风格文档提取硬规则 → 起草 world.md 生产工作流（shot list → 逐张生成 → 质检 → 交付）
- world.md 骨架：核心定位、生产工作流、提示词模板、生成后检查、**资源口径**（PGC RFC 已确立的证据使用契约）
- 证据期望：≥4 张示例图（status: supporting，仅作低频视觉校准）

**4. brand-guide（品牌手册 → 品牌世界）** `intake: assets/text/url`

- 目标形态：视觉系统实体（色板/字体/logo 用法）、文案语气实体、规则（禁用组合、留白规范）、logo 与 VI 证据
- research 策略：消化上传的品牌手册 PDF/图片 → 提取可执行规则（prefer/never）→ 生成色板与字体清单

**5. blank（从零开始）** `intake: conversation`

- 不给结构假设，走 interview：AI 按 world type 的追问清单问 3-5 个问题（"这个角色永远不能改变的特征是什么？""这个账号绝对不碰什么话题？"），从回答中组装实体草稿。**用户始终可以先跳过**——跳过的世界 readiness 为 skeleton，明确标注"尚未形成 AI 可用设定"，绝不伪造完成。

蓝图的收敛规则：蓝图只是**草稿生成器与 missing 度量器**，不限制用户后续自由增删实体（Canon 始终开放）；蓝图不进入存储，只有它产出的实体/证据/技能进入 revision。

## Readiness：世界就绪度模型

服务端新增纯函数计算（不建表、不持久化），三个消费者同源：详情页引导卡、onboarding 步骤推导、`brief.missing`。

```ts
type WorldReadiness = {
  level: "skeleton" | "draft" | "ready";
  score: number;                       // 0-100，仅供 UI 进度条
  missing: MissingItem[];              // 按建议优先级排序
};
type MissingItem = {
  id: string;                          // 如 "character.primary.appearance"
  kind: "entity" | "field" | "evidence" | "skill" | "identity";
  title: string;                       // "主角的外貌与标志"
  reason: string;                      // "AI 生成时不知道角色长什么样"
  suggestion: string;                  // 动作："上传参考图 / 让 AI 起草 / 手动填写"
};
```

- **skeleton**：无任何有事实的实体（字段全空）→ UI 显示"尚未形成 AI 可用设定"，brief 的 facts 为空并在 missing 中给出首行动作。
- **draft**：核心实体有事实但证据/技能缺失 → 可创作但提示质量风险。
- **ready**：按蓝图（或 blank 场景的最小集）核心项齐备。
- 空壳存量世界的兼容：模板 seed 出的实体若**所有注册字段为空串且从未被编辑**，readiness 视为不存在（不产生 missing 噪音），Onboarding 首屏提供"清理空壳并重新引导"动作（归档空实体，走既有归档语义）。
- `recut.worlds.brief` 的 `missing` 字段由同一计算填充（替换现在的恒空实现），字段结构即 `MissingItem[]`。

## 产品体验

### 1. 创建弹框：加一个起点问题

现有弹框（名称/类型/定位）保留，新增**起点场景**选择器（按类型预推荐，可换）与可选素材位（拖入文件 / 粘贴链接 / 素材库选择，可跳过）。「创建并进入」后直接落地 Onboarding 向导，而不是空的详情页。

### 2. Onboarding 向导：三步一确认

```text
Step 1  确认蓝图
  "你选择了【小说改编】。这个世界的目标是：
   ✓ 2-6 个角色卡（含不可变特征）  ✓ 故事线与场景  ✓ 世界观规则
   [换一个场景] [开始注入素材]"

Step 2  注入素材（按蓝图 intake 呈现）
  [上传文件] [粘贴链接让 AI 研究] [从素材库选择] [先口述，让 AI 追问我]
  已注入：《三体》第一部.pdf (412KB) · https://weibo.com/xxx
  [跳过，直接让 AI 问我] 

Step 3  AI 完善（Agent 工作流接管，进度可见）
  正在消化《三体》第一部… 提取出 4 个角色、3 个场景、2 条世界规则
  正在生成角色参考图候选… 6 张已就绪
  [查看提案]

Step 4  提案审视（确认写回）
  ┌ 拟写入 ────────────────────────────┐
  │ 角色 ×4：叶文洁（外貌/性格/声音/不可变特征…）      [预览] │
  │ 场景 ×3 · 规则 ×2 · world.md（改编工作流）        [预览] │
  │ 参考图候选 ×6：勾选 3 张采纳为角色证据                [画廊] │
  └──────────────────────────────┘
  [全部采纳] [逐项勾选] [先不写入]
```

关键交互约束：

- **每一步都可跳过**，跳过后的世界停留在对应 readiness 档位，详情页保留"继续完善"入口与 missing 清单。
- **提案是文档不是通知**：写入前列出每一条实体/证据/技能的完整内容预览，用户逐项勾选或全选；"先不写入"后提案留在聊天记录中，世界状态不变。
- **候选画廊**：AI 生成的图片在提案面板中以画廊呈现（assetId 已完成即可预览），勾选采纳 → `evidence.attach`（purpose/status 由蓝图建议，用户可改）；未勾选的候选只是素材库里的普通资产，不进 Canon。

### 3. 详情页：Onboarding 不是一次性弹窗

详情页顶部常驻**引导卡**（readiness < ready 时）：

```text
这个世界还可以更完整                    ██░░ draft 62%
最值得先做：为主角补充外貌与标志（AI 生成时还不知道他长什么样）
[让 AI 帮我完善]  [手动填写]  [查看全部 3 项缺失]
```

「让 AI 帮我完善」按钮发出结构化 onboard 请求（携带 worldId + missing 项 + 已注入素材引用）到 Agent 面板——这是用户明确授权，Agent 据此走标准工作流。

### 4. Agent 面板内的循环

用户也可以直接在聊天里说"帮我完善 @未来城市"。Agent 走同一工作流，proposal 以结构化卡片（复用 tool-result-assets 渲染）呈现，用户回复"采纳角色部分"→ Agent 执行对应写回。聊天路径与向导路径共享同一 Skill 工作流，只是入口不同。

## 服务与 MCP 契约

### 变更 1：创建不再 seed 空实体

`recut.worlds.create` 删除 `templateEntities` 调用：创建只写 world 行 + identity + 初始 revision（reason 不变）。MCP 工具描述补充："创建后世界为空壳，引导用户走 Onboarding 或调用 readiness 获取首行动作。" 该变更使"空壳伪装完成"从源头消失。

### 变更 2：`recut.worlds.readiness`（新增只读工具）

```text
recut.worlds.readiness
  input:  { worldId, scenarioId? }
  output: WorldReadiness（missing 含 reason/suggestion）
```

- `scenarioId` 缺省时按 world type + 已有实体形态自动猜测最接近蓝图；显式提供时按该蓝图度量。
- HTTP: `GET /v1/worlds/{id}/readiness?scenario=`；纯计算，无副作用，可高频调用。
- `brief.missing` 改为同函数填充（v1 即实施，替换恒空数组）。

### 变更 3：写回仍走既有工具（不新增写面）

Agent 确认后的写回 = 既有 `entities.upsert`（批量按 proposal 逐条）/ `evidence.attach` / `worlds.update(skillMd)`。乐观并发用 `expectedRevisionId`（提案生成时快照；冲突时 Agent 重新读取并刷新提案，不静默覆盖）。propose_change/apply_change 服务端门禁维持 08-14 Phase 2 排期，本 RFC 不重复建设。

## Agent 契约（平台 SKILL.md Worlds 章节增补）

新增子文档 `references/world-onboarding.md`（经 `recut.skills.reference` 读取），规定 onboard 标准动作：

```text
触发：用户明确要求完善/填充/搭建某个 local 世界（onboarding 请求、
      "让 AI 帮我完善"、详情页引导卡按钮），或创建弹框携带素材。

工作流（顺序固定）：
1. recut.worlds.readiness({ worldId })  — 取 missing 与蓝图建议
2. 消化用户素材：
   - 链接 → recut.media.create_reference 登记 + webfetch 消化正文
   - 文本 → 直接消化；长文分段处理，只依据原文，不脑补
   - 图片 → 作为 evidence 候选呈现，不臆断内容
3. research 补全：仅限用户素材明确覆盖的范围；素材未覆盖的字段
   标记"需要你补充"，绝不编造 Canon 事实
4. generate（仅蓝图期望且用户同意时）：
   recut.image.generate 生成参考图候选（角色三视图/风格示例等）；
   产物是候选，不得调用 evidence.attach
5. 提案：输出结构化 proposal（拟写入实体/证据/技能Md 的完整内容
   + 候选画廊 + 未覆盖项清单），等待用户确认
6. 确认后写回：逐条 entities.upsert / evidence.attach /
   worlds.update(skillMd)，携带 expectedRevisionId；冲突即停并刷新提案

边界（不变）：
- 无用户明确请求绝不写 World；onboarding UI 的确认动作即明确请求
- 生成结果永不自动成为证据；候选未勾选 = 未发生
- 非 local 世界只读：先提议 fork，在副本上走本工作流
```

SKILL.md 主文档 Worlds 章节追加三行摘要并链接该 reference。

## Web 实现要点

- **创建弹框**（`worlds-client.tsx` 内联对话框）：新增场景选择与素材位组件；i18n 进 `workspace-worlds-dict.ts`（`worlds.create.scenario.*`、`worlds.onboard.*` 约二十个词条，zh/en）。
- **Onboarding 向导**：新组件 `world-onboarding.tsx`，纯前端状态机（`create → intake → agent → propose → done | skipped`），步骤推导自 `readiness`，不新建持久状态。
- **引导卡**：详情页（`world-detail-client.tsx`）顶部条件渲染，消费 `GET /v1/worlds/{id}/readiness`。
- **提案审视面板**：复用 `asset-preview-dialog` / `AssetPreview` 渲染候选画廊；实体预览复用详情页既有字段表单（只读态）。
- **Agent 面板联动**：引导卡按钮经 composer 发出携带 `creation_world` attachment 的结构化请求（复用 08-16 work surface context 的 attachment 语义）。

## 分阶段交付

- **P0 止血（去空壳 + 就绪度）**：创建删 seed；`readiness` 计算 + HTTP + MCP；`brief.missing` 真实填充；详情页引导卡（只读展示 + 手动入口）；存量空壳实体的 readiness 忽略规则。全程可独立发布，无 UI 依赖。
- **P1 向导与注入**：创建弹框场景选择；Onboarding 向导三步；四条注入路径；i18n；存量世界"清理空壳并重新引导"。
- **P2 Agent 工作流**：`references/world-onboarding.md` + SKILL.md 增补；提案审视面板（画廊勾选 + 逐项写回）；「让 AI 帮我完善」全链路 E2E（小说 / 账号链接 / 风格图集三条路径真实验收）。
- **P3 场景深化**：brand-guide 蓝图；interview 追问路径打磨；Fork 裁剪 Onboarding；事件与漏斗（`world.onboard.started/completed`，仅 ID 与场景，不含 Canon 内容）。

## 测试矩阵

| 层 | 必测 |
| --- | --- |
| 创建 | 新建 world 零实体；revision 仍产出；list/统计对空世界的显示正确；旧消费方（resolve/brief/bind）对空世界无报错 |
| readiness | 五蓝图各档位（skeleton/draft/ready）判定；空壳存量实体被忽略；missing 排序稳定；brief.missing 与 readiness 同源一致；scenarioId 显式与猜测两态 |
| 写回 | proposal 确认前零写调用；确认后逐条 upsert/attach 带 expectedRevisionId；revision 冲突 → 停止并重读，绝不静默覆盖；候选未勾选 → 无 evidence 行 |
| E2E（真实会话） | 小说路径：粘贴三章文本 → readiness draft → 提案含角色/场景/规则/world.md → 采纳 → brief facts 非空；账号路径：微博链接 → create_reference + 消化 → 人设卡；风格路径：上传 4 图 + 风格文档 → 蓝图对齐小黑形态 → world.md 含资源口径章节 |
| Web | 向导每步可跳过且状态正确；引导卡 readiness 渲染；画廊勾选采纳后 evidence 出现在详情页；zh/en 词条完整 |
| 回归 | 平台世界（pgc.xiaohei）不出现引导卡；fork 副本可进裁剪 Onboarding；既有 world CRUD/绑定/revision 测试全绿 |

## 验收标准

1. 新用户从"创建"到得到一个 readiness=draft 的可用世界，全程只做三次决定（选场景、给素材、点采纳），不见任何空字段表单，全程不接触 JSON/ID/hash。
2. 小说路径 E2E：粘贴文本 → AI 提案的角色卡内容可追溯到原文，未覆盖字段明确标注"需要你补充"而非编造。
3. 任何生成图片在用户勾选前不出现在 evidence；勾选后出现的证据 purpose/status 与提案一致。
4. 跳过一切引导的世界在列表与详情页明确显示"尚未形成 AI 可用设定"，brief 不伪造事实。
5. Agent 在无用户请求时对 World 的写调用为零（沿用既有铁律回归）。

## 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 蓝图变成新的"填表清单"，用户感到被考问 | 蓝图只在向导首屏展开一次；此后只以"最值得先做的一件事"呈现；跳过永远可用 |
| AI 消化长小说成本高 / 质量差 | 分段消化 + 只依据原文纪律；提案逐项可否决；P3 评估按章增量注入 |
| v1 无服务端 proposal 门禁，确认靠 UI 前置 | UI 确认 + MCP 描述铁律 + 测试断言"确认前零写调用"；propose/apply 门禁仍归 08-14 Phase 2，接口不冲突 |
| 蓝图与自由 Canon 冲突（用户加了蓝图外实体） | readiness 按"最接近蓝图"度量，蓝图外实体不产生 missing 噪音也不被惩罚 |
| 链接 research 依赖宿主 webfetch 能力 | 无该能力的宿主降级为"请粘贴正文"；create_reference 登记不依赖抓取 |

## 开放问题

1. 蓝图是否应随 PGC 世界一起可发布（`worlds/<slug>/` 携带 blueprint 供 fork 裁剪用）？建议 P3 评估，v1 平台内置五份足够。
2. interview（口述追问）在聊天面板与向导内的形态是否统一？建议向导内直接内嵌最小聊天框，避免两套追问 UI。
3. `readiness.score` 是否对外暴露数字？建议只用于进度条，不进入 brief（Agent 按 missing 项工作，不追分数）。
4. 候选画廊的生成时机：Agent 主动生成（快但浪费）还是提案确认后再生成（省但多一轮）？建议 v1 跟随提案（先 2-3 张样张），确认后补全。

## 结论

World 的空壳问题不是缺一个表单，而是缺"从用户已有的东西出发"的入口。场景蓝图把结构思考从用户转移到产品，research/generate 工作流把填充从用户转移到 AI，提案审视把拍板权留在用户手里——三者合起来，Onboarding 才能兑现 08-14 重构定下的验收："新用户可在 5 分钟内从一句话建立一个可用于创作的设定"。本 RFC 与 brief（读取入口）、world.md（实践维度）、evidence 双源（资源真相）互补，补齐 World 故事的最后一环：**世界怎么从零长出来。**

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
