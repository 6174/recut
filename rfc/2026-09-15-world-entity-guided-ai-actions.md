<!--
 * [INPUT]: 依赖统一 Entity 模型（world_entity_types 预设类型/attrs/media 属性）、World Canvas 详情面板
 *   （canvas-detail-panel / panel/entity-panel / panel/element-panel / panel/media-editor /
 *   components/world-entity/entity-editor）、form 宿主（world-detail-client / EntitySettingsPanel）、
 *   全局 Agent 输入框交接契约（lib/agent-panel-context.setDraft + WorkSurface/WorkFocus，见
 *   world-onboarding、iframe agent.compose）、generation-reference-protocol（<reference> + role 受控词表 +
 *   提案 gate）、recut-worlds skill 与 recut-directing-generation-prompt skill
 * [OUTPUT]: 定义 World 详情面板的「引导提示操作」产品方案：① 按预设实体类型的能力动作；② 按媒体元素
 *   （图片/视频/音频）属性名称推断语义后的动作；统一为类型作用域的动作注册表、九类动作分类与四种产出
 *   （素材/文本/Canon 提案/画布提案）、点击 → 组装提示词 → 交全局 AI 输入框（绝不自动发送）、
 *   锚定参考板（Reference Sheet）产出约定、完整动作目录与预填示例、属性名→语义（purpose/role）推断词表、
 *   数据契约、里程碑与验收
 * [POS]: rfc 的 World 详情面板 AI 引导决策；把「分散设定 + 既有素材 + 媒体属性名」显式编排成可点击的
 *   AI 动作，交现有全局 Agent 会话执行，不改 Canon/生成门禁与 @/reference 协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# World 详情面板的引导提示操作（Guided AI Actions for World Entities & Media）

- 状态：M0/M1 已实施（2026-09-15）；M2+ 待排期
- 日期：2026-09-15
- 关联：[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、[生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)、[递归世界画布](./2026-09-07-recursive-world-canvas.md)、[富文本上下文输入协议](./2026-09-14-rich-context-composer-protocol.md)、[统一上下文引入面板](./2026-09-14-unified-context-mention-panel.md)、[World Canvas PRD v2](../docs/world-canvas-prd-v2.md)、`service/skills/recut-worlds/SKILL.md`、`service/skills/recut-directing-generation-prompt/SKILL.md`

## 0. 摘要

World 详情面板今天是一块**纯手工编辑器**：名称、简介、正文、字段、媒体属性、关系全靠人一行行填。它的问题不是能力不足，而是**没有把「这个类型天生要做的事」告诉用户**——人物要出角色板、场景要出环境板、风格要出母版，这些是创作域里高度可复用的生产动作，却要用户自己想清楚再白手起家地向 AI 描述。

本 RFC 给出一个方案：在详情面板按**预设实体类型**渲染一组**引导提示操作（Guided Prompt）**。点击一个动作时：

1. 用**该实体真实数据**（attrs / intro / detail / media 属性）+ 世界语境**组装一段可直接发送的指令**；
2. 通过 `useAgentPanelContext.setDraft` **交到全局 AI 输入框**（与 Onboarding「让 AI 帮我完善」、iframe `agent.compose` 同一契约）；
3. Agent 已有 WorkSurface（world）与 WorkFocus（实体），**用户只需审阅/微调后点发送**。

**绝不自动发送、绝不自动写 Canon**。动作只是把「意图 + 数据 + 参考 + role 锚定」一次性编排好，把最强大但也最白纸的全局 Agent 变成有类型意识的创作入口。

动作**不限于生成素材**：同一套机制同时承载文本创作、结构整理、策划编排、质量检查、转换改写、资料研究与声音设计（§3.1.1 的 `output`），并统一遵守既有门禁（视频只落提案、`text` 不改数据、`canon-proposal` 需确认）。

旗舰能力是**锚定参考板（Reference Sheet）**：把一张设定卡里散落的设定文本与已有素材，合成**一张**权威锚定图（人物角色板 / 场景设定板 / 物件设计板 / 风格母版），写回该实体的 media 属性，成为后续所有生成的首选 `role` 锚点。

本方案同时覆盖**媒体元素详情面板**（`ElementPanel` 的独立媒体元素与 `kind=attr` 媒体属性卡）：`media-editor.tsx` 只按模态提供「生成配方」（低层、逐张、直连 capability）；而媒体卡往往带着一个**属性名称**（如「外貌与标志」「服装」「场景全局图」「色卡」），这本身就是最强的风格语义线索。方案据属性名（及元素名/素材名）**推断 purpose 与 role**，再给出对应的引导动作（把这张并进角色板、补齐表情/三视图/换装、扩展为多机位、由色卡生成完整风格板……）。

## 1. 背景与问题

### 1.1 现状：详情面板只有「手」，没有「招」

- 画布详情面板按选中对象路由到 `WorldPanel / EntityPanel / RelationPanel / ElementPanel`（`web/app/worlds/[worldID]/canvas/canvas-detail-panel.tsx:100`）。
- 实体态是共享 `EntityEditor` 的薄壳（`web/app/worlds/[worldID]/canvas/panel/entity-panel.tsx:38`），身份区 + 字段区 + 关系区全部即改即存（`web/components/world-entity/entity-editor.tsx`）；form 视图的 `EntitySettingsPanel` 复用同一组件。
- 媒体态（独立媒体元素 / 属性媒体卡）路由到 `MediaElementEditor`（`web/app/worlds/[worldID]/canvas/panel/element-panel.tsx:124` → `panel/media-editor.tsx`），只有「换素材 / 生成配方 / 素材历史」，**不认识自己叫什么属性**。
- 能力完整、但没有一个「我该拿这个人物/场景/这张图做什么」的入口。用户面对几个空字段或一张孤图，不知道下一步最有价值的是什么。

### 1.2 现有 AI 入口分散且无类型意识

| 入口 | 位置 | 类型意识 | 交接方式 |
|---|---|---|---|
| 用描述添加设定 | `canvas-ai-dialog.tsx`（创建菜单） | 只产候选实体，不产素材 | 直连 `/ai/suggest-entities`（501 占位） |
| 媒体元素生成 | `canvas/panel/media-editor.tsx` | 只对单个 media 元素 | 直连 image/video capability + 提案 gate |
| Onboarding「让 AI 帮我完善」 | `world-onboarding.tsx:66` | 世界级 readiness，无类型 | `setDraft` 预填全局输入框 |
| 全局 Agent 会话 | `project-agent-panel.tsx` | 有 WorkSurface/WorkFocus，但**空白起点** | 用户自带提示词 |

问题：真正好用的只有全局会话，但它不告诉用户「对一个人物，专业流程会先做一张角色板」；而各种按钮要么只服务创建、要么只服务单个素材，互不相通。

### 1.3 用户的直接诉求

> 1. 人物类型：AI 一键生成人物造型 / 角色板——把人物设定、avatars、表情、半身、全身、衣服细节都整合到**一张图**里当参考图。
> 2. 场景类型：把场景设定文本、场景细节、场景全局图放到**一张图**里，方便给 AI 参考。
> 3. 交互：点击这些 AI 功能，最终**交给全局 AI 输入框，让用户提交**。
> 4. 补充：图片元素（媒体属性卡/独立图片）的详情，也能**根据它的属性名称猜测**、给出对应的 AI 操作引导。
> 5. 引导**不限于生成新图/新视频**：写文本、整理结构、出策划、做检查、转换改写、资料研究、声音设计等各类 AI 引导都应纳入。

这些诉求指向同一个抽象：**主体（类型/属性名）→ 意图 → 数据/参考 → 预填全局输入框**。

## 2. 目标与非目标

### 目标

1. 在实体详情面板（画布 + form 两个宿主）按 `typeId` 渲染一组**引导提示操作**，并随实体数据（缺什么、有什么参考图）**自适应排序/置灰**。
2. 点击 = 组装一段可发送的提示词并交全局 AI 输入框；**不自动发送、不自动写 Canon**。
3. 定义**锚定参考板**的产出约定：整合多视图/多设定到一张图，写回 media 属性并成为首选锚点。
4. 与既有协议零冲突：动作产生的引用走 `generation-reference-protocol` 的 `role` 词表；视频仍**只落提案**；写回仍走 `recut.worlds.entity` 的 Canon 门禁。
5. **动作产出不限于生成素材**：文本创作 / 结构整理 / 策划编排 / 质量检查 / 转换改写 / 资料研究 / 声音设计都有一等位置（§3.1.1 的 `output`）。
6. **覆盖媒体元素详情**：按媒体属性名称推断 `purpose`/`role`，给出对应的生成类与非生成类动作（§5.8）。
7. 纯前端即可上线（M1），并预留类型级 schema（M3）承载自定义类型与 PGC World 的推荐动作。

### 非目标

- 不做画布内生成浮层或独立对话；不新增第二套 Agent 通道。
- 不做真正的「无确认直出」（生成成本与 Canon 写都需要人闸门；「一键」= 一键备好 + 一次发送）。
- 不改 `recut.worlds.*` 工具面、不改 WorkSurface/WorkFocus 语义、不改 `media-editor` 的提案流程。
- 不在 M1 支持自定义类型自定义动作（先用通用兜底动作）。
- 不做图像编辑（裁剪/局部重绘）与跨实体批量生成。

## 3. 核心概念：引导提示（GuidedPrompt）

### 3.1 定义

一条**引导提示** = 一个声明式动作。**动作的产出不限于「生成新图/新视频」**：它可以是文本建议、结构改造提案、策划方案、质检报告、转换改写等。因此动作声明里的核心字段是**产出类型（output）**与**所属类别（category）**：

```ts
type GuidedActionCategory =
  | "sheet"      // 整合锚定：把散落设定/素材合成一张权威参考图
  | "derive"     // 派生素材：生成配套的图 / 音 / 视频
  | "text"       // 文本创作：扩写 / 精简 / 命名 / 对白 / 文案 / 世界观补全
  | "structure"  // 结构整理：关系建议 / 归类 / 层级 / 标签 / 子设定拆分
  | "plan"       // 策划编排：分镜 / 镜头表 / 发布计划 / 封面与标题钩子 / 节奏
  | "qc"         // 质量检查：一致性 / 连续性 / 规则冲突 / 素材可用性 / 缺口报告
  | "transform"  // 转换改写：翻译 / 语气 / 风格改写 / 格式转换（shotlist / SRT / 配方提取）
  | "research"   // 资料研究：从链接/资料提取设定提案（复用 Onboarding research）
  | "sound";     // 声音设计：音色 / BGM / SFX / 对白与配音方案

/** 产出类型决定「Agent 生成什么」与「是否需要用户确认才写 Canon」 */
type GuidedActionOutput =
  | { kind: "media"; modality: "image" | "video" | "audio"; gate: "direct" | "proposal" }
  | { kind: "text" }            // 只输出文本建议 / 报告，不改任何数据
  | { kind: "canon-proposal" }  // 建议写实体/关系/类型，须用户确认后由 Agent 写 Canon
  | { kind: "canvas-proposal" }; // 落画布便签 / 提案元素（不产 revision、不花钱）

type GuidedAiAction = {
  /** 稳定 id，形如 "character.sheet" / "media.asSheet"，用于 i18n key 与埋点 */
  id: string;
  subject: "entity" | "media" | "both";
  category: GuidedActionCategory;
  output: GuidedActionOutput;
  icon: string;
  /** 适用条件：实体动作看 typeId；媒体动作看推断出的 purpose；"both" 两者皆可 */
  applies: (ctx: GuidedPromptContext) => boolean;
  /** 数据不足时置灰并给出原因（如 needsMedia / needsAttr） */
  requires?: (ctx: GuidedPromptContext) => { ok: boolean; reason?: string };
  /** 是否把动作排在前面（缺什么、有什么决定推荐顺序） */
  priority?: (ctx: GuidedPromptContext) => number;
  /** 组装预填文本（纯函数，可单测） */
  build: (ctx: GuidedPromptContext) => string;
};

type GuidedPromptContext = {
  locale: "zh" | "en";
  worldId: string;
  worldName: string;
  /** 动作主体：实体 或 媒体元素 */
  subject:
    | { kind: "entity"; entity: WorldEntity; typeLabel: string; mediaRefs: MediaRef[] }
    | {
        kind: "media";
        modality: "image" | "video" | "audio";
        assetId?: string;
        /** 属性媒体卡的「属性名称」（props.label）——媒体语义推断的第一依据 */
        attrLabel?: string;
        elementName?: string;
        assetName?: string;
        inferred: MediaPurpose;
        references: MediaRef[];
        /** 该媒体若挂在某实体属性上，带出所属实体（写回/上下文用） */
        owningEntity?: WorldEntity;
      };
  /** STYLE LOCK 来源（风格实体 / world.md），M2 接入；M1 可空 */
  styleLock?: string;
};

type MediaRef = { assetId: string; label: string; kind: string; role?: GenerationRefRole };

/** 由属性名/元素名/素材名推断的媒体语义（见 §5.8） */
type MediaPurpose = {
  id: string;                 // appearance / expression / wardrobe / environment / color-card / …
  role?: GenerationRefRole;   // 对应 generation-reference-protocol 的 role（可空）
  confidence: number;         // 0–1，关键词命中强度
  matched: string;            // 命中的关键词（供 UI 解释「为什么推荐这个」）
  source: "attr-label" | "element-name" | "asset-name" | "fallback";
};
```

注册表放在纯前端 `web/lib/world-entity/guided-actions.ts`（实体）与 `guided-media-actions.ts`（媒体，内含推断词表），均无 React 依赖、`build` 可单测；标签/描述走 i18n（`worlds.ai.<actionId>.label|desc`）。

### 3.1.1 产出类型：AI 引导不止「生成素材」

点击引导动作**永远只是预填全局输入框**；真正「生成什么」由 `output` 决定，且都遵守既有门禁：

| output.kind | Agent 可以做什么 | 门禁 |
|---|---|---|
| `media` + `direct` | 直接 `recut.image.generate` / `recut.speech.generate` | 成本低，可直接生成 |
| `media` + `proposal` | 只落画布 `props.proposal.status="pending"` | 视频等高价：**用户确认才生成** |
| `text` | 输出建议/报告文本；**不改任何数据** | 无（只读） |
| `canon-proposal` | 先给提案（字段/关系/子实体/草稿实体），确认后 `recut.worlds.entity`/`relation` 写入 | 写 Canon 需用户明确授权（点击发送即授权这次写） |
| `canvas-proposal` | 落便签/提案元素 | 画布元素不产 revision、不花钱 |

举例（同一「人物」上，除了生成角色板，还可以是）：
- `text`「为这个人物写 3 版一句话人设（logline）」；
- `text`「根据已有素材，补齐性格与不可变特征，先给我改动建议」；
- `structure`「建议与其它人物/场景的关系，列成清单让我挑」；
- `plan`「把这个人物拆成 5 个出场镜头，输出镜头表」；
- `qc`「检查 3 张参考图与『不可变特征』是否矛盾」；
- `transform`「把这段人设从中文改写成英文 prompt-ready 描述」；
- `sound`「为这个人物设计音色方向（音域/语速/口音/情绪基调）」；
- `research`「从这条角色设定资料链接里提取可并入的字段」。

### 3.2 为什么落在详情面板

- 实体详情面板是用户「正在看某一个具体对象」的地方，天然知道 `typeId` 与全部 attrs/media——这是动作最精准的触发点。
- 面板已由 `EntityEditor` 统一两个宿主（画布 `EntityPanel` 与 form `EntitySettingsPanel`），一处实现两处生效。
- 媒体详情面板是用户「正在看某一张具体素材」的地方，天然知道 `props.label`（属性名）、元素名、素材名与模态——这是**语义推断**最精准的触发点；且 `ElementPanel` 已持有 `entities` 与属性边，能带出 `owningEntity` 做写回与上下文。
- 与 PRD v2 的「详情面板 = 编辑主场」一致：AI 不是另开一面，而是编辑主场的「推荐下一步」。

### 3.3 交接契约：点击 → 全局 AI 输入框

```ts
function invokeGuidedAction(action: GuidedAiAction, ctx: GuidedPromptContext) {
  const text = action.build(ctx);
  const subjectId = ctx.subject.kind === "entity" ? ctx.subject.entity.id : ctx.subject.assetId ?? "media";
  useAgentPanelContext.getState().setDraft({
    id: `guided-${action.id}-${subjectId}-${Date.now()}`,
    text,
  });
  // WorkSurface(world) 由 /worlds/[worldID] 路由上报；
  // WorkFocus：实体 → world_entity，媒体元素 → world_canvas_element（canvas/index.tsx 已上报）
}
```

- **复用既有契约**：`setDraft` 已被 Onboarding（`world-onboarding.tsx:66`）与 iframe `agent.compose`（`project-detail-client.tsx:147`）使用，语义是「预填、绝不自动提交」。
- **绑定不依赖用户手速**：`WorkSurface`（world）与 `WorkFocus`（实体 `world_entity` / 媒体元素 `world_canvas_element`）随会话自动挂载（`canvas/index.tsx:100-108`、`world-detail-client.tsx:129`）。M2 进一步在正文内联一条 `<reference kind="entity" …/>`（媒体则 `<reference kind="image" id="{assetId}">`）chip，使绑定落在正文里、即使用户中途切换选中也成立（发送时 `project-agent-panel.tsx:472` 的 `extractRefs` 会把它物化为 context）。
- **人闸门保留**：用户可改提示词、可加 @ 参考、可放弃；发送即「用户明确请求」，同时构成对该次写回（若有）的授权。

### 3.4 与既有 AI 入口的关系

| 入口 | 关系 |
|---|---|
| 创建菜单「用描述添加设定」 | 保留；回答「无中生有」。引导提示回答「已有实体怎么深化」，二者互补 |
| `media-editor` 单素材生成 | 保留；它是「换/生成这一张图」的底部能力，引导提示是它上层的一次性意图编排 |
| Onboarding「让 AI 帮我完善」 | 世界级；引导提示是实体级，二者共用 `setDraft` |
| 全局 Agent 会话 | 是唯一执行面；引导提示只负责把它「预填好」 |

## 4. 锚定参考装配：Reference Sheet

### 4.1 为什么需要「一张图」

生成模型对「多张零散参考图 + 长文字」的权重分配不稳定（见 generation-reference-protocol §1）。把角色的设定、头像、表情、半身、全身、服装细节**先合成一张权威设定板**，再以 `role=character` 单一锚点喂给后续镜头，一致性显著更好；场景同理（一张环境板 = 全景 + 机位 + 光影 + 细节 + 色卡）。

### 4.2 产出与写回约定

1. Agent 读 `recut.worlds.brief` 取该实体 attrs、media 属性派生的 `references[]`、世界风格（STYLE LOCK）。
2. 按 `recut-directing-generation-prompt` 生成一张**设定板**；图片可直接生成，视频相关只落提案。
3. 生成结果写回该实体的一条 **media 属性**（`{assetId, name, kind:"image"}`），label 采用约定名：`角色设定板 / 场景设定板 / 物件设计板 / 风格母版`。
4. 该属性成为后续生成的**首选锚定**：`role` 建议 `character / environment / prop / style-ref`；色卡可另存 `color-card`。
5. 只新增这一条属性，不改动其它设定；世界只读（platform/published）时先提议 Fork。

### 4.3 与生成协议对齐

- 动作产出的模型侧提交串使用 generation-reference-protocol 的别名与 `role` 声明；`id` 只在 Agent/sidecar 侧存在。
- 设定板本身也是一次生成：其 `references`（该实体已有素材）与 role 记录在素材配方里，支持回溯与再生成（`canvas-proposal.ts` 的 `references[]` 同构）。

### 4.4 设定板动作的预填示例

**`character.sheet`**：

```
为世界《{{worldName}}》的人物「{{name}}」生成一张角色设定板（character sheet），作为后续所有画面的权威人物锚定参考图。

人物设定（来自该设定卡）：
- 外貌与标志：{{appearance}}
- 性格：{{personality}}
- 声音：{{voice}}
- 不可变特征（必须严格保持）：{{invariants}}
- 简介：{{intro}}

已有素材：{{mediaRefs}}（作为一致性参考，优先复用外观特征）。
这一张图需同时包含：① 头部正面特写；② 3–4 种表情；③ 正面半身；④ 全身三视图（正/侧/背）；⑤ 服装与材质细节 + 配色板。
风格沿用世界风格（STYLE LOCK 逐字复用）。

产出后写回该实体的一条 media 属性，label「角色设定板」（role=character），并记录本次参考绑定；只新增这一条素材，不改其它设定。世界只读时先提议 Fork。
```

**`location.sheet`**：

```
为世界《{{worldName}}》的场景「{{name}}」生成一张场景设定板（environment sheet），作为后续所有镜头的环境锚定参考图。

场景设定：
- 描述：{{description}}
- 氛围：{{atmosphere}}
- 简介：{{intro}}

已有素材：{{mediaRefs}}（已有场景全局图作为主视角锚定）。
这一张图需同时包含：① 主视角全景（establishing）；② 2–3 个机位/角度（含一个反打）；③ 光影/时间变化（如白天/黄昏/夜晚）；④ 关键细节与道具特写；⑤ 色卡（整场调色锚定）。
风格沿用世界风格。

产出后写回该实体的一条 media 属性，label「场景设定板」（role=environment）；色卡如需单独保存另记 role=color-card。只新增素材，不改其它设定。
```

## 5. 动作目录

分类（§3.1 的 9 类）：`sheet` 整合锚定 · `derive` 派生素材 · `text` 文本创作 · `structure` 结构整理 · `plan` 策划编排 · `qc` 质量检查 · `transform` 转换改写 · `research` 资料研究 · `sound` 声音设计。

> 表中「产出」列用 §3.1.1 的 `output` 简写：`img/vid/aud`（gate 见标注）、`text`、`canon`、`canvas`。**非生成类动作与生成类同等重要**——它们是「AI 帮你思考和整理」，往往比多出一张图更解决用户卡点。

### 5.1 人物 character

| id | 名称 | 类别 | 产出 | 说明 |
|---|---|---|---|---|
| `character.sheet` | 生成角色设定板 | sheet | img / direct | 一张图：头像特写 + 3–4 表情 + 半身 + 全身三视图 + 服装/材质细节 + 配色板 |
| `character.expressions` | 生成表情表 | derive | img / direct | 6–9 格情绪表情，同一角色 |
| `character.turnaround` | 生成三视图 | derive | img / direct | 正/侧/背，比例与服装一致 |
| `character.outfits` | 生成换装/服装细节板 | derive | img / direct | 多套服装 + 配件 |
| `character.voice` | 生成音色试听 | derive | aud / direct | 从「声音」设定 + 已有音频；`role=voice` |
| `character.motion` | 生成表演/动作参考 | derive | vid / proposal | 角色动作与表演，`role=motion-ref` |
| `character.consistency` | 参考图一致性检查 | qc | text | 对比多张图与「不可变特征」，列出偏差 |
| `character.logline` | 写 3 版一句话人设 | text | text | 供简介/宣发/立项复用 |
| `character.expand` | 补全性格与不可变特征 | text | canon | 给改动建议，确认后写回字段 |
| `character.arc` | 设计人物弧光/成长线 | text | text | 供故事编排参考 |
| `character.relations` | 建议与其它人物/场景的关系 | structure | canon | 先列清单，用户挑选后建 `relation` |
| `character.voiceDesign` | 设计音色方向 | sound | text | 音域/语速/口音/情绪基调 |
| `character.dialogue` | 生成标志性对白/口播 | text | text | |
| `character.translate` | 人设转英文 prompt-ready | transform | text | 便于跨语种生成 |
| `character.shot` | 由此角色生成镜头 | plan | vid / proposal | 落提案，等用户确认 |

### 5.2 场景 location

| id | 名称 | 类别 | 产出 | 说明 |
|---|---|---|---|---|
| `location.sheet` | 生成场景设定板 | sheet | img / direct | 一张图：主视角全景 + 2–3 机位 + 光影/时间变化 + 关键细节 + 色卡 |
| `location.angles` | 生成多机位场景图 | derive | img / direct | 建立镜头/中景/近景、四方向 |
| `location.mood` | 生成氛围/时间变体 | derive | img / direct | 日/夜/黄昏/雨雪 |
| `location.details` | 生成场景细节板 | derive | img / direct | 材质、道具、招牌、纹理特写 |
| `location.colorCard` | 生成场景色卡 | derive | img / direct | 整场调色锚定，`role=color-card` |
| `location.consistency` | 多图一致性/连续性检查 | qc | text | 同一场景不同素材是否串味 |
| `location.plan` | 设计机位表 | plan | text | 含镜头意图（景别/角度/运动） |
| `location.lighting` | 光影/时间方案 | plan | text | 各时段光源方向与色温 |
| `location.relations` | 建议与人物/故事的关系 | structure | canon | 确认后建 `relation` |
| `location.translate` | 描述转英文 prompt-ready | transform | text | |
| `location.shot` | 在此场景中生成镜头 | plan | vid / proposal | |

### 5.3 物件 object

| id | 名称 | 类别 | 产出 | 说明 |
|---|---|---|---|---|
| `object.sheet` | 生成物件设计板 | sheet | img / direct | 正/侧/背 + 材质细节 + 尺寸参照 + 磨损/使用状态，`role=prop` |
| `object.details` | 生成关键细节特写 | derive | img / direct | 材质、纹样、铭文 |
| `object.states` | 生成状态变体 | derive | img / direct | 崭新/陈旧/损坏/重要时刻 |
| `object.lore` | 设计来历与重要时刻故事 | text | canon | 填补 `origin` / `moment` |
| `object.relations` | 建议归属人物/场景 | structure | canon | 确认后建 `relation` |

### 5.4 故事 story

| id | 名称 | 类别 | 产出 | 说明 |
|---|---|---|---|---|
| `story.storyboard` | 生成分镜表 | sheet | img / direct | `premise/moment/emotion` → 一张 25 宫格分镜草图表（含 `R{r}C{c}` 坐标 + 格清单） |
| `story.shotlist` | 输出镜头表 | plan | text | 景别/角度/时长/台词/参考锚点的结构化清单 |
| `story.script` | 展开为视频脚本 | text | canon | 把故事转为 `script`（视频脚本）实体（logline/beats/vo/duration/aspectRatio/platform） |
| `story.dialogue` | 生成关键对白 | text | text | |
| `story.hooks` | 起开场钩子与标题 | plan | text | 5 版钩子 + 标题 |
| `story.beats` | 扩写故事结构 | text | text | 前提 → 场景/人物/冲突清单 |
| `story.relations` | 连成人物/场景关系网 | structure | canon | 批量建议关系 |
| `story.keyframes` | 生成关键帧/镜头提案 | derive | vid / proposal | 把 `moment` 转成镜头提案 |
| `story.publish` | 发布计划/平台适配 | plan | text | 画幅/时长/封面/节奏建议 |

### 5.5 风格 style

| id | 名称 | 类别 | 产出 | 说明 |
|---|---|---|---|---|
| `style.board` | 生成风格母版板 | sheet | img / direct | `visual/guidance/avoid` + 示例图 → 多图拼贴风格板，`role=style-ref` |
| `style.colorCard` | 生成色卡 | derive | img / direct | `role=color-card` |
| `style.sample` | 生成风格样片 | derive | vid / proposal | 一段镜头验证风格 |
| `style.naming` | 给风格起名与关键词 | text | text | |
| `style.promptKit` | 生成风格提示词工具包 | transform | text | STYLE LOCK + 正面/负面词 |
| `style.qc` | 素材是否符合风格/avoid | qc | text | 扫描世界内素材，列出偏离项 |
| `style.extract` | 从示例图反推风格文本 | transform | text | 填充 `visual/guidance/avoid` |

### 5.6 规则 rule

| id | 名称 | 类别 | 产出 | 说明 |
|---|---|---|---|---|
| `rule.draft` | 从世界描述生成规则草案 | text | canon | 确认后写规则实体 |
| `rule.conflict` | 规则/设定冲突检查 | qc | text | 跨实体扫描矛盾 |
| `rule.constraints` | 规则转生成约束 | transform | text | STYLE LOCK 片段 / 负面词清单 |

### 5.7 通用/自定义类型（`subject: "entity"`，`applies: "*"`）

| id | 名称 | 类别 | 产出 | 说明 |
|---|---|---|---|---|
| `generic.fill` | 补全这张设定 | text | canon | readiness 驱动，补齐缺失字段/简介 |
| `generic.name` | 起名 / 整理命名 | text | text | 一批候选名 + 理由 |
| `generic.subentity` | 拆分子设定 | structure | canon | 把一段长文拆成子实体草稿 |
| `generic.tags` | 生成标签/关键词 | structure | canon | 便于检索与复用 |
| `generic.consistency` | 与世界观一致性检查 | qc | text | |
| `generic.translate` | 翻译字段 | transform | text | |
| `generic.research` | 从资料链接提取设定 | research | canon | 复用 Onboarding research 路径 |
| `generic.missingRef` | 为缺失参考生成一张 | derive | img / direct | 该实体尚无 media 属性时高亮 |
| `generic.shot` | 基于此设定生成镜头提案 | plan | vid / proposal | |

### 5.8 媒体元素：按属性名称推断的动作

媒体元素（独立图片/视频/音频，或 `kind=attr` 属性媒体卡）没有 `typeId`，但**属性名称本身就是语义**。`ElementPanel` 的媒体分支（`isMediaElement || isAttrCard`）在渲染 `MediaElementEditor` 之前，先取 `props.label`（属性名）/ 元素名 / 素材名，用词表推断 `MediaPurpose`，再筛出对应动作。

#### 5.8.1 属性名 → purpose / role 推断词表

| purpose id | 关键词（属性名/元素名/素材名；中英、忽略大小写与空白） | role | 典型后续动作 |
|---|---|---|---|
| `appearance` | 外貌/外观/形象/立绘/容貌/脸/头像/半身/全身 | character | 并进角色设定板、生成表情表/三视图/换装 |
| `expression` | 表情/情绪/神态/face | character | 生成完整表情表（以这张为基准）、补齐 9 格 |
| `wardrobe` | 服装/穿搭/服饰/造型/配饰/衣服 | character | 生成换装板、生成服装材质细节、并入角色板 |
| `turnaround` | 三视图/转身/比例/正侧背 | character | 生成规范三视图（以这张为比例基准） |
| `hair` | 发型/发色 | character | 生成发型细节与变体 |
| `detail` | 细节/特写/局部/手/纹样 | prop | 生成更多细节特写 |
| `environment` | 场景/环境/地点/全局图/全景/空镜/背景 | environment | 生成场景设定板、多机位、氛围变体、细节板 |
| `color-card` | 色卡/配色/调色/palette | color-card | 扩成风格板、生成明暗阶、校验其它素材与色卡一致 |
| `prop` | 道具/物件/饰品/武器/设计 | prop | 生成物件设计板、状态变体、细节 |
| `material` | 材质/纹理/面料 | — | 生成材质细节与光照表现 |
| `lighting` | 光影/灯光/打光 | environment | 生成不同时间/光源版本 |
| `style-ref` | 风格/画风/参考/美术/mood | style-ref | 生成风格母版板、风格样片、反推风格文本 |
| `motion` | 动作/表演/动态/运动 | motion-ref | 生成更多表演参考（video 提案） |
| `voice` | 音色/声音/配音/台词 | voice | 生成同音色更多台词、创建声音角色 |
| `music` | 音乐/配乐/BGM/主题曲 | music | 生成配乐方案（文本 + 音频） |
| `sfx` | 音效/环境音/拟音 | sfx | 生成音效清单与样例 |
| `unknown` | 未命中 | — | 通用媒体动作（见下） |

推断规则：优先 `attr-label`，其次 `element-name`，再次 `asset-name`，最后 `unknown`；命中多个取最长关键词；`confidence` 供 UI 决定是否隐藏高分动作、或把「未识别」提示给用户。

#### 5.8.2 媒体动作目录（`subject: "media"`）

| id | 名称 | applies（purpose） | 类别 | 产出 | 说明 |
|---|---|---|---|---|---|
| `media.card.character` | 生成人物卡 | 任意（永远靠前） | sheet | img / direct | 信息栏 + 主视觉 + 三视图 + 细节/表情/剪影研究（版式见 `cards.ts`） |
| `media.card.environment` | 生成环境卡 | 任意（永远靠前） | sheet | img / direct | 信息栏 + 全景 + 机位 + 细节 + 光影 + 色卡 |
| `media.card.object` | 生成物体卡 | 任意（永远靠前） | sheet | img / direct | 信息栏 + 多角度 + 细节 + 尺寸参照 + 状态变体 |
| `media.asSheet` | 并进 / 扩成设定板 | appearance/expression/wardrobe/turnaround/environment/prop/style-ref/color-card | sheet | img / direct + canon | 以这张为锚，补齐同类视图成一张设定板 |
| `media.siblings` | 补齐同实体缺失的同类参考 | 已知 `owningEntity` 且缺失 | plan | img / direct | 如「有外貌缺服装」→ 生成服装参考 |
| `media.variation` | 生成变体 | 任意 | derive | img / direct | 同主体不同方案（3 版） |
| `media.angles` | 生成多机位/多角度 | environment/prop | derive | img / direct | |
| `media.mood` | 氛围/时间变体 | environment | derive | img / direct | |
| `media.style` | 换风格 | 任意 | derive | img / direct | 用风格实体作 `style-ref` 锚定 |
| `media.series` | 补同系列配套 | 任意 | derive | img / direct | 与其他素材成套 |
| `media.motion` | 生成动态/表演参考 | motion/任意 | derive | vid / proposal | |
| `media.moreLines` | 同音色更多台词 | voice | derive | aud / direct | 走 `speech.generate` |
| `media.shot` | 以此图为准生成镜头 | 任意 | plan | vid / proposal | |
| `media.reverse` | 由图反推设定文本 | appearance/environment/prop/style-ref | transform | canon | 写回 `owningEntity` 对应字段 |
| `media.qc` | 与实体设定/色卡一致性 | 任意 | qc | text | 对比 `invariants`、色卡、STYLE LOCK |
| `media.caption` | 生成图注/替代文本 | 任意 | text | text | 便于检索与无障碍 |
| `media.rename` | 属性名/命名建议 | 任意 | text | canon | 建议更规范的 `label`，确认后改名 |
| `media.promptExtract` | 反推可复用提示词/配方 | 有生成来源的图 | transform | text | 输出 prompt + role 锚定，便于复用 |
| `media.translate` | 图内文字/注释翻译 | 任意 | transform | text | |
| `media.cover` | 封面/缩略图建议 | 任意 | plan | text | 世界封面、项目封面候选 |

> 未识别（`unknown`）时只展示 `media.variation` / `media.style` / `media.qc` / `media.caption` 等与语义无关的通用动作，并附一行「想要更精准的建议？给这个属性改个更具体的名字」。

#### 5.8.3 预填示例

**属性名「外貌与标志」上的图 →「并进角色设定板」**：

```
这张图的属性名是「外貌与标志」，属于人物「{{name}}」。请把它作为角色外貌的锚定，生成一张完整的角色设定板：
在保留这张图人物特征的前提下，补齐 ① 头部正面特写；② 3–4 种表情；③ 正面半身；④ 全身三视图；⑤ 服装与材质细节 + 配色板。
沿用世界风格。产出写回该人物的 media 属性（label「角色设定板」，role=character），并记录参考绑定；只新增素材，不改其它设定。
```

**属性名「场景全局图」上的图 →「生成场景设定板」**：

```
这张图的属性名是「场景全局图」，属于场景「{{name}}」。请以它为环境锚定，生成一张场景设定板：
① 保留主视角全景；② 补 2–3 个机位/角度（含反打）；③ 光影/时间变化（白天/黄昏/夜晚）；④ 关键细节与道具特写；⑤ 色卡。
产出写回该场景的 media 属性（label「场景设定板」，role=environment）；色卡另存 role=color-card。
```

### 5.9 跨类型的非生成引导（通用模式）

任何类型都可挂载以下「非生成」通用动作模板（实体侧取 `subject.entity`，媒体侧取 `subject.media`）：

| 类别 | 通用动作模板 | 产出 | 例子 |
|---|---|---|---|
| `text` | 扩写 / 精简 / 改写 / 起名 / 对白 / logline | text | 「把这段简介压成一句话」 |
| `structure` | 关系建议 / 归类 / 层级 / 标签 / 拆子设定 | canon | 「建议它和谁有关系」 |
| `plan` | 分镜 / 镜头表 / 出场计划 / 发布计划 / 封面钩子 | text | 「排一个 30 秒短片镜头表」 |
| `qc` | 一致性 / 连续性 / 冲突 / 缺口 / 可用性 | text | 「哪些设定还自相矛盾」 |
| `transform` | 翻译 / 语气 / 风格改写 / 格式转换 / 配方提取 | text | 「转成 SRT 用字幕文本」 |
| `research` | 从链接/资料提取设定 | canon | 「从这条链接补全设定」 |
| `sound` | 音色 / BGM / SFX / 对白配音方案 | text / aud | 「给这个场景配一段氛围 BGM 方案」 |

> 这些动作同样只预填全局输入框；`canon` 类先给提案，用户确认后由 Agent 写入。

## 6. 交互与呈现

### 6.1 位置

在 `EntityEditor` **最顶部**（名称之前）插入一个动作区：「用 AI 完善（N）」。默认展开、chip 行式布局（图标 + 名称 + 次级说明 tooltip），最多显示 6 个主推动作 + 「更多」。**三类「设定卡」（人物卡 / 环境卡 / 物体卡）永远排在最前**——它们是 AI 生成里最常见的产出，不依赖类型/purpose 推断（见 §5.8.2）。

- 画布宿主（`EntityPanel`）与 form 宿主（`EntitySettingsPanel`）都获得，无需各自实现。
- **媒体宿主**：在 `ElementPanel` 的 `isMediaElement || isAttrCard` 分支里、`MediaElementEditor` **之上**插入同一套 chip 行（媒体视图中把「按属性名推断」的结果显示成「已识别为：外貌参考 · character」一行，命中关键词可解释）。`media-editor` 的生成配方保留在其下——**引导在上（意图/编排/问答），配方在下（低层逐张生成）**，二者不重复。
- 只读世界（`readOnly`）仍显示动作（浏览/提案是只读安全），但点击后提示「平台/发布世界只读，将先提议 Fork」。

### 6.2 点击行为与反馈

1. 组装文本 → `setDraft`；
2. 输入框获得焦点/滚动进视野（md+ 面板常驻；窄屏见 §6.5）；
3. 动作 chip 短暂显示「已填入输入框」；
4. 用户修改/发送。埋点记录动作 id、是否被编辑、是否发送。

### 6.3 可用性条件（requires）

- `needsMedia`：该实体没有任何 media 属性时，`qc`/`reverse` 类置灰并提示「先添加/生成一张参考图」。
- `hasField`：字段为空时，`sheet`/`derive` 类仍可用（正需要生成）；`qc`/`transform` 类提示「补充文本后可用」。
- `needsAttr`（媒体）：独立媒体元素（非属性卡）没有 `attrLabel` 时，推断回退到元素名/素材名；仍无法识别时不显示语义动作，只给通用动作并提示「给属性起个更具体的名字」。
- `priority`：按输出类型与缺口排序——缺参考图时把 `*.sheet` / `generic.missingRef` 排前；有图缺文本时把 `qc`/`text` 排前；媒体命中强 purpose 时把对应 `derive`/`asSheet` 排前——与 `world-panel` 的「待关注」和 readiness 同源排序思路。

### 6.4 只读世界

动作不隐藏；点击照常预填并附一句「非 local 世界只读，请先 Fork 再写回」。Agent 侧遵循 `recut-worlds` 的 `WORLD_READ_ONLY` 门禁。

### 6.5 窄屏/无面板

全局 Agent 面板在 `md` 以下隐藏（`agent-panel-host.tsx:50`）。窄屏策略（M2）：动作改为打开移动端对话抽屉并预填；M1 可先隐藏动作区并给一行提示，避免「填了看不见」。

## 7. 数据契约与实现

### 7.1 分层

| 层 | 位置 | 职责 |
|---|---|---|
| 纯逻辑（实体） | `web/lib/world-entity/guided-actions.ts` | `GuidedAiAction` 注册表（实体动作）、`buildGuidedPrompt()`、`applicableActions(ctx)`、`rankActions(ctx)`；无 React/无 I/O，可单测 |
| 纯逻辑（媒体） | `web/lib/world-entity/guided-media-actions.ts` | `inferMediaPurpose()`、关键词词表（§5.8.1）、媒体动作注册表、`mediaRefsFromEntity()` |
| 纯逻辑（装配） | `web/lib/world-entity/guided-context.ts` | 由 `WorldEntity` / 媒体元素构造 `GuidedPromptContext`（mediaRefs、owningEntity、styleLock 注入） |
| 呈现 | `web/components/world-entity/guided-ai-section.tsx` | chip 行渲染、requires 置灰、推断结果解释、点击调用 `invokeGuidedAction` |
| 装配（实体） | `web/components/world-entity/entity-editor.tsx` | 新增可选 prop `enableAi?: boolean`；为 true 时渲染 `GuidedAiSection` |
| 装配（媒体） | `panel/element-panel.tsx`（`isMediaElement \|\| isAttrCard` 分支） | 在 `MediaElementEditor` 之上渲染媒体 `GuidedAiSection` |
| 宿主 | `panel/entity-panel.tsx`、`world-detail-settings.tsx` | 传 `enableAi`（画布默认开；form 视图可开） |
| i18n | `web/lib/i18n/workspace-worlds-dict.ts` | `worlds.ai.<actionId>.label|desc`、`worlds.ai.purpose.<purposeId>` |

保持 `EntityEditor`「不依赖 store」：`GuidedAiSection` 内部调用 `useAgentPanelContext.getState().setDraft`，不把 store 依赖渗透进编辑器本体。媒体侧需要 `owningEntity` 时通过 `GuidedContext` 由 `element-panel` 注入（它已有 `entities` 与属性边映射），不让 `media-editor` 反向依赖 store 拓扑。

### 7.2 与后端的关系

- **M1 纯前端**：动作目录与推断词表硬编码在纯函数注册表；`build` 只读客户端已有的 `entity`/`element`/`worldId`/`typeLabel`；`mediaRefs` 从 `entity.attrs` 里 `type==="media"` 派生。零服务端改动。
- **M3 类型级 schema**：`world_entity_types` 增加可选 `ai_actions_json`（或复用 `fields_json` 同级），让自定义类型与 PGC World 在 `world.json` 声明推荐动作与 purpose 词表扩展；注册表优先级：类型自定义 > 平台预设 > 通用兜底。
- 可选（M3）：把 `inferMediaPurpose` 的命中结果作为**只读推断字段**随 `recut.worlds.brief.references[]` 返回（当前 `roleInferred` 已有类似机制），让 Agent 侧也能拿到同一推断，前后端一致。
- 不改 `recut.worlds.*` 工具面；写回仍是 `recut.worlds.entity` op=`update`（含媒体属性、字段、关系）；`text`/`qc`/`plan` 类只产出文本，不触发写。

### 7.3 与 Skill 的契约

引导提示只负责「预填」，执行归 Agent。Agent 侧依赖既有技能，并按 `output.kind` 分流：

- `recut-worlds`：读 brief、写 media 属性/字段/关系、视频只落提案、Canon 需授权；`structure`/`text` 类产出的提案须等用户确认再写。
- `recut-directing-generation-prompt`：STYLE LOCK + typed `role` 锚定 + 设定板提示词骨架。
- 平台 `recut` skill 与 `recut-directing-*` 系列：`plan`/`qc`/`sound` 类动作（分镜、镜头表、发布计划、一致性检查、音色/BGM 方案）复用各自领域技能，不另造。

建议在 `recut-worlds` 加一小节「引导提示动作的预期产出」（设定板 label 约定、`role` 建议、`output.kind → 写回位置` 对照、`text` 类不写 Canon），使预填文案与 Agent 行为闭环。

## 8. Agent 侧预期行为（点击发送后）

1. 读 `recut.worlds.brief({ worldId })`：主体实体（或媒体所属实体）attrs、`references[]`、world.md/风格。
2. 按 `output.kind` 分流：
   - `media` + `direct`：图片/语音直接生成（如设定板、色卡、音色）；`media` + `proposal`：视频**只落 `props.proposal.status="pending"`**，等用户确认（`canvas-proposal.ts` gate）。
   - `text`：只输出建议/报告，**不写任何数据**（如一致性检查、logline、镜头表、音色方向）。
   - `canon-proposal`：先给提案文本，用户确认后用 `recut.worlds.entity`/`relation` 写入（如补全字段、建议关系、拆子设定、由媒体反推文本）。
   - `canvas-proposal`：落便签/提案元素（不产 revision、不花钱）。
3. 若动作为 `*.sheet` / `media.asSheet`：按骨架生成设定板提示词，参考锚定主体已有素材；产出写回 media 属性（约定 label + `role`）；`references` 记入素材配方。
4. 媒体路径：以被选中的媒体元素为**锚定主体**（`role` 用推断值），生成结果默认写回同一实体（有 `owningEntity`）的 media 属性或画布媒体元素。
5. 收尾告知用户「已写入 / 已提案 / 仅建议」，不擅自扩大改动。

## 9. 里程碑

| 阶段 | 交付 | 验收 |
|---|---|---|
| M0 | 本 RFC + `guided-actions.ts` / `guided-media-actions.ts` / `inferMediaPurpose` 纯函数与单测（build 输出稳定、requires/rank/推断正确） | 单测通过 |
| M1 | `GuidedAiSection` 挂进 `EntityEditor`；character/location 两类的生成 + 非生成动作 + 通用兜底；`setDraft` 交接 | 画布与 form 两宿主点击 → 输入框预填；不自动发送 |
| M2 | 媒体元素接入（推断词表 + 媒体动作 + owningEntity）；补齐 object/story/style/rule 全部动作；STYLE LOCK 注入；正文内联实体 chip | 人物/场景设定板端到端产出并写回；媒体属性名能推断并给出动作 |
| M3 | 类型级 `ai_actions_json` + PGC World 声明；brief `references[].roleInferred` 前后端一致；窄屏抽屉 | 自定义类型可自定义动作；`worlds-check` 通过 |
| M4 | 埋点与模板迭代（动作使用率 / 编辑率 / 发送率 / 放弃率 / 各类别占比） | 数据看板 |

## 10. 可测试点

- **单测（build）**：给定实体 + world，各动作输出非空、包含实体名与关键字段；`mediaRefs` 为空时不出现悬空参考；媒体动作输出包含被选中的 assetId 与推断 `role`。
- **单测（推断）**：`inferMediaPurpose` 对「外貌与标志/服装/场景全局图/色卡/表情/三视图/英文 outfit」等命中预期 purpose 与 role；无命中回退 `unknown`；命中冲突取最长关键词。
- **单测（applicable/rank）**：类型过滤、`requires` 置灰原因、`priority` 排序，且按 `output.kind` 分流正确。
- **组件测试**：点击 chip → `useAgentPanelContext.draft.text` 变化、id 唯一、`enableAi=false` 不渲染；媒体视图显示「已识别为：…」解释。
- **端到端（M2）**：人物「生成角色设定板」→ 发送 → Agent 产出图片 → 实体 media 属性出现「角色设定板」→ 后续镜头生成以 `role=character` 引用它；媒体属性「场景全局图」→ 推断 environment → 生成场景板并写回。
- **端到端（非生成）**：`text` 类动作只产出文本、**不改数据**；`canon-proposal` 类动作在确认前不写入。
- **门禁**：视频动作不直接生成；只读世界动作不写 Canon。

## 11. 未决问题

1. **设定板成为「首选锚定」的机制**：复用 `background` 属性、约定固定 label、还是给 media attr 增加 `preferredAnchor` 标记？倾向前端约定 label + role 推断，暂不加 schema。
2. **提示词语言**：动作文案 i18n 为 zh/en，但生成提示词与 `role` 声明默认中文；是否随 locale 输出英文别名，待 provider 实测。
3. **是否允许「一键直出」**：图片成本低，是否给 `direct` 动作一个「不经过输入框、直接生成」的快捷路径？与用户「交输入框」诉求冲突，倾向保持一致、不做。
4. **动作去重与幂等**：连续点击同一动作是否覆盖草稿（当前 `setDraft` 覆盖）；是否需要「已生成设定板」后把 `sheet` 动作降级为「重新生成」。
5. **与 readiness 的耦合深度**：`rankActions` 是否直接消费 readiness 的 missing 列表，还是仅用本地实体数据推导。
6. **自定义类型的动作声明**：M3 放 `world_entity_types` 还是 `world.json` 源格式（影响 `worlds-publish.mjs` 与物化）。
7. **是否引入 `recut.directing.*` 之外的动作分类词表**，以便未来跨类型统一渲染与埋点。
8. **推断词表如何维护与扩展**：中英关键词、自定义类型、用户纠正反馈（「不是这个 purpose」）是否回流；是否随 PGC World 下发。
9. **推断结果的权威位置**：M1 纯前端推断；M3 是否把 `roleInferred` 统一到 `brief.references[]`（服务端）以避免前后端两套词表漂移。
10. **非生成动作的领域技能路由**：`plan`/`qc`/`sound` 类应指向 `recut-directing-*` 的哪一个技能、还是由 `recut-worlds` 汇总转交；prompt 里是否显式点名技能。
11. **`canon-proposal` 的确认交互**：确认写 Canon 是在 Agent 回复卡片里做（复用提案卡片），还是回到详情面板高亮 diff 再确认。

## 12. 实施记录（2026-09-15，M0/M1 + 媒体推断）

纯内核收敛在一个文件夹下管理：`web/lib/world-entity/guided/`

| 文件 | 内容 |
|---|---|
| `types.ts` | `GuidedActionCategory` / `GuidedActionOutput` / `GuidedAiAction` / `GuidedPromptContext` / `MediaRef` / `MediaPurpose` / `GenerationRefRole` |
| `media-purpose.ts` | `MEDIA_PURPOSE_LEXICON` 词表 + `inferMediaPurpose`（分源优先级 + 最长关键词） |
| `context.ts` | `buildEntityContext` / `buildMediaContext` / `mediaRefsFromEntity` / `attrText` / `refsLine` |
| `entity-actions.ts` | `ENTITY_ACTIONS`：character/location/object/story/style/rule + 通用（现约 50 条，覆盖九类） |
| `media-actions.ts` | `MEDIA_ACTIONS`：按推断 purpose 的生成 + 非生成动作（16 条） |
| `registry.ts` | `actionsFor` / `rankActions` / `isActionEnabled` / `draftIdFor` / `purposeExplanation` |
| `index.ts` | 统一出口 |
| `*.test.ts` | 推断 + 注册表单测（已纳入 `npm test` 的 `lib/world-entity/**/*.test.ts` glob） |

呈现与接线：

- `web/components/world-entity/guided-ai-section.tsx`：动作 chip 区（requires 置灰 + 原因、媒体推断解释、点击 `setDraft` + 「已填入输入框」反馈）。
- `entity-editor.tsx` 新增 `guided?: { worldId; worldName; styleLock? }` prop，在身份区之后渲染；画布 `EntityPanel`（取 store 的 worldId/worldName）与 form `EntitySettingsPanel`（新增 `worldName` prop，由 `world-detail-client` 传 `detail.name`）两宿主已接。
- `element-panel.tsx` 媒体分支（`isMediaElement || isAttrCard`）在 `MediaElementEditor` 之上渲染同一组件，并由 `props.entityId` / 属性边解析 `owningEntity`。

验证：`npx tsc --noEmit` 零错；`npm test` 30/30 通过。

### 12.1 补充（同日迭代）

- **三类设定卡置顶**：新增 `cards.ts`（人物卡/环境卡/物体卡版式常量）与 `media.card.character|environment|object` 三条动作，**不依赖推断、priority 最高**（人物卡参照真实生产版式：信息栏 + 主视觉 + 三视图 + 细节/表情/剪影研究 + 引线标注）；`character.sheet` / `location.sheet` / `object.sheet` 同步改为「生成人物卡 / 环境卡 / 物体卡」并复用同一套版式。解决「未识别属性用途」时媒体面板只有通用动作的问题。
- **内联 XML 引用**：新增 `refs.ts`（`mediaTag` / `entityTag` / `primaryTag`，复用 `rich-composer/protocol/xml` 的 `serializeAttributes`），`refsLine` 与媒体动作主体引用输出 `<media type assetid name />`；`buildActionText` 在动作正文末尾补主体锚点 `<creation_entity …/>`（已内联则不重复）。预填文本因此与富文本 @ 出来的结果**完全同构**，编辑器会渲染成 chip，发送时经 `extractRefs` 物化为 contexts。
- **位置**：`GuidedAiSection` 从「身份区之后」移到 `EntityEditor` **最顶部**（名称之前），保证进入面板即可见；位于最顶部时不画分隔线；动作上限展示 6 个 + 更多，展开态按「生成 / 策划整理 / 文本检查」三组呈现。
- **设计修正**：媒体动作新增 `modalities` 门禁——人物卡/环境卡/物体卡只对 `image`，`moreLines` 只对 `audio`，纯视觉动作不出现在音频上；三类卡按推断 purpose 排序（命中组优先，如「场景全局图」→ 环境卡居首），未命中时按 人物卡 > 环境卡 > 物体卡 兜底。
- 验证：`npx tsc --noEmit` 零错；`npm test` 36/36 通过（新增卡片靠前 + XML 标记 + 模态门禁 + 去重 + STYLE LOCK 断言）。

### 12.2 设计收敛（review 后）

- **单一版式来源**：三类设定卡的版式只存在于 `web/lib/world-entity/guided/cards.ts` 一处；预填文案已把版式内嵌进用户 prompt，`recut-directing-generation-prompt` 技能**不重复定义**卡片版式（避免双真相）。如未来 world.md 需要覆盖，应以「覆盖版式」而非「再写一份」的方式表达。
- **去重**：`GuidedAiAction` 新增 `excludeTypeIds`；通用兜底动作在已有类型专属动作时不再出现（`generic.consistency` 排除 character/location/style/rule，`generic.translate` 排除 character/location）。注册表 `matches` 统一处理。
- **STYLE LOCK 接线**：`styleLockFromEntities()` 从世界内的「风格」实体（`visual` + `guidance`）派生 STYLE LOCK，画布 `EntityPanel`、`ElementPanel`（媒体）与 form `EntitySettingsPanel` 均注入；卡动作的 `${stylePreamble}` 因此有真实内容（M2 起可由 Agent 侧统一覆盖）。
- **命名白话化**：「并进 / 扩成设定板」→「合成一张设定板」，「补同系列配套」→「补齐同系列参考图」。
- **禁用可解释**：置灰 chip 改为 `aria-disabled`（点击即提示不可用原因），解决触屏无 hover 看不到原因的问题。
- **窄屏与埋点**：动作区 `hidden md:block`（`<md` 时全局 Agent 面板隐藏，避免「填了看不见」）；点击上报 `recut_guided_action_invoked` / `recut_guided_action_blocked`（含 actionId/category/outputKind/subject/typeId/purpose）。
- **其余详情面板同策略**：实体（`EntityEditor`：身份 / 字段 / 关系）、关系（类型 / 方向 / 范围）、世界（身份 / 世界快照 / 待关注）、画布元素（元素 / 内容 / 属性 / 连接 / 关系）与实体面板的「子设定」全部改用 `PanelSection`；「用 AI 完善」不再用主色强调，与普通分组完全一致。
- **顺带修复 vello 崩溃**：`runtime.register_image` / `render_atomic_chunk` 对**同一 image id** 重注册时会 `unregister_texture(old)`，而 WASM 按 chunk 缓存了引用旧 `ImageData` 的 `Scene` → backing 渲染时 panic「invalid empty image」，并把 wasm 对象留在借用态（后续报「recursive use of an object」）。改为：升档（`pomelo-vello-adapter.upgradeImage`）与 atomic chunk 重渲（`vello-rasterizer.drawChunk`）都用**新 id** 注册、不注销旧纹理，旧场景保持有效。


- **媒体详情面板 IA 重排（对齐 Figma 属性面板）**：解决「AI 入口互相打架、分区混在一起」。引入通用 `PanelSection`（`web/components/panel-section.tsx`）：**整宽分隔线不留 padding**（`-mx-4`，贴面板左右边缘）、**header 不加背景色**，靠「标题 `text-xs font-semibold text-foreground` + 整宽分隔线 + 间距」与内容区（muted 小标签）区分、标题与内容左对齐、**折叠开关 `＋/－` 放最右侧**、分组可折叠且默认展开，首组用 `-mt-4` 抵消容器顶部 padding（贴住面板标题栏）。顺序为 ①**预览**（置顶：预览图 + 「素材库 / 本地上传 / 清除」来源操作合并为此一组）→ ②**名称**（独立分组；`FieldRow hideLabel` 去掉行内重复标签）→ ③**用 AI 完善**（`tone="section"`，与普通分组同款、不特殊化颜色）→ ④**素材历史**（默认收起）→ ⑤**手动生成** → ⑥删除。元素「类型」不再显示（画布节点本身已标出）；原「AI 生成」磁贴与引导动作语义重复已移除。媒体元素经 `MediaElementEditor.identity` 插槽把名称放在预览之后。

未做（M2+）：object/story/style/rule 之外的更多动作、STYLE LOCK 注入、正文内联实体 chip、类型级 `ai_actions_json`、窄屏抽屉、brief `references[].roleInferred` 前后端统一。



[PROTOCOL]: 变更时更新此头部，然后检查 README.md
