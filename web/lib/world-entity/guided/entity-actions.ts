/*
 * [INPUT]: 依赖 guided/types、guided/context（attrText/refsLine/entityOf）
 * [OUTPUT]: 对外提供 ENTITY_ACTIONS：按预设类型（人物/场景/物件/故事/风格/规则 + 通用兜底）的引导提示动作注册表，
 *   覆盖 sheet/derive/text/structure/plan/qc/transform/research/sound 九类与四种产出
 * [POS]: web/lib/world-entity/guided 的实体动作数据层；build 为纯函数，预填全局 AI 输入框（RFC §5.1–5.7 / §5.9）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { attrText, entityOf, refsLine } from "./context";
import { CHARACTER_CARD_LAYOUT, ENVIRONMENT_CARD_LAYOUT, OBJECT_CARD_LAYOUT, cardRefsLine, stylePreamble } from "./cards";
import type { GuidedAiAction, GuidedEntitySubject } from "./types";

function hasMedia(s: GuidedEntitySubject): boolean {
  return s.mediaRefs.length > 0;
}

// 通用「非生成」引导模板（任何类型），供各类型复用
function genericActions(): GuidedAiAction[] {
  return [
    {
      id: "generic.fill",
      subject: "entity",
      category: "text",
      output: { kind: "canon-proposal" },
      icon: "sparkles",
      label: "补全这张设定",
      desc: "读现有字段，给出缺失项改动建议，确认后写回",
      build: (ctx) => {
        const s = entityOf(ctx);
        return `请完善世界《${ctx.worldName}》里的${s.typeLabel}「${s.entity.name}」：
- 简介：${s.entity.intro || "（空）"}
- 正文：${s.entity.detail || "（空）"}
- 现有字段：${s.entity.attrs.map((a) => `${a.label}=${typeof a.value === "object" ? "[媒体]" : String(a.value ?? "")}`).join("；") || "（空）"}
先给出建议补齐的字段与内容（不要直接写），我确认后再更新这条设定。`;
      },
    },
    {
      id: "generic.name",
      subject: "entity",
      category: "text",
      output: { kind: "text" },
      icon: "type",
      label: "起名 / 整理命名",
      desc: "给一批候选名与理由",
      build: (ctx) => {
        const s = entityOf(ctx);
        return `为世界《${ctx.worldName}》的${s.typeLabel}「${s.entity.name}」起 5 个候选名称，附一句理由与风格适配说明。只给建议，不要改任何设定。`;
      },
    },
    {
      id: "generic.subentity",
      subject: "entity",
      category: "structure",
      output: { kind: "canon-proposal" },
      icon: "git-branch",
      label: "拆分子设定",
      desc: "把长文拆成子实体草稿",
      build: (ctx) => {
        const s = entityOf(ctx);
        return `阅读世界《${ctx.worldName}》的${s.typeLabel}「${s.entity.name}」正文：
${s.entity.detail || "（空）"}
建议拆成哪些子设定（名称 + 类型 + 一句话简介），先列成清单；我确认后再创建为草稿子设定。`;
      },
    },
    {
      id: "generic.tags",
      subject: "entity",
      category: "structure",
      output: { kind: "canon-proposal" },
      icon: "tag",
      label: "生成标签 / 关键词",
      desc: "便于检索与复用",
      build: (ctx) => {
        const s = entityOf(ctx);
        return `为${s.typeLabel}「${s.entity.name}」生成一组检索标签与关键词（5–10 个），说明每个的用途；确认后再决定是否写入。`;
      },
    },
    {
      id: "generic.consistency",
      subject: "entity",
      category: "qc",
      output: { kind: "text" },
      icon: "shield-check",
      label: "与世界观一致性检查",
      desc: "跨实体扫描矛盾",
      // 这些类型已有更具体的检查动作（character/location.consistency、style.qc、rule.conflict）
      excludeTypeIds: ["character", "location", "style", "rule"],
      build: (ctx) => {
        const s = entityOf(ctx);
        return `以世界《${ctx.worldName}》的整体设定为准，检查${s.typeLabel}「${s.entity.name}」是否存在矛盾、缺口或与其他设定冲突之处。只输出检查结论与建议，不要修改数据。`;
      },
    },
    {
      id: "generic.translate",
      subject: "entity",
      category: "transform",
      output: { kind: "text" },
      icon: "languages",
      label: "翻译字段",
      desc: "中英互译，便于跨语种生成",
      // character/location 已有各自的「转英文 prompt-ready」，通用翻译不再重复
      excludeTypeIds: ["character", "location"],
      build: (ctx) => {
        const s = entityOf(ctx);
        return `把${s.typeLabel}「${s.entity.name}」的简介与字段翻译成英文（prompt-ready，保留专有名词音译建议），以对照表输出。只给文本。`;
      },
    },
    {
      id: "generic.research",
      subject: "entity",
      category: "research",
      output: { kind: "canon-proposal" },
      icon: "search",
      label: "从资料提取设定",
      desc: "复用 Onboarding research 路径",
      build: (ctx) => {
        const s = entityOf(ctx);
        return `我会提供资料链接或文本，请从中提取可用于完善${s.typeLabel}「${s.entity.name}」的字段（如外貌/性格/背景等），先给提案；确认后再写入。`;
      },
    },
    {
      id: "generic.missingRef",
      subject: "entity",
      category: "derive",
      output: { kind: "media", modality: "image", gate: "direct" },
      icon: "image",
      label: "为缺失参考生成一张",
      desc: "该设定尚无媒体属性时高亮",
      requires: (ctx) => {
        const s = entityOf(ctx);
        return hasMedia(s) ? { ok: false, reason: "已有参考素材" } : { ok: true };
      },
      priority: (ctx) => (hasMedia(entityOf(ctx)) ? 0 : 30),
      build: (ctx) => {
        const s = entityOf(ctx);
        return `为世界《${ctx.worldName}》的${s.typeLabel}「${s.entity.name}」生成一张最能代表它的参考图：
- 简介：${s.entity.intro || "（空）"}
- 设定：${s.entity.attrs.map((a) => `${a.label}=${typeof a.value === "object" ? "[媒体]" : String(a.value ?? "")}`).join("；") || "（空）"}
沿用世界风格。产出写回该实体的一条 media 属性（label 描述其用途，role 按类型推断）；只新增素材。`;
      },
    },
    {
      id: "generic.shot",
      subject: "entity",
      category: "plan",
      output: { kind: "media", modality: "video", gate: "proposal" },
      icon: "clapperboard",
      label: "生成镜头提案",
      desc: "基于此设定出视频提案，等确认",
      build: (ctx) => {
        const s = entityOf(ctx);
        return `基于世界《${ctx.worldName}》的${s.typeLabel}「${s.entity.name}」（${s.entity.intro || "无简介"}）设计 1 个约 5 秒的镜头：给出提示词、景别/运动与参考锚定，落成视频生成提案等我确认（不要直接生成）。`;
      },
    },
  ];
}

const characterActions: GuidedAiAction[] = [
  {
    id: "character.sheet",
    subject: "entity",
    category: "sheet",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "sparkles",
    label: "生成人物卡",
    desc: "一张图：信息栏 + 主视觉 + 三视图 + 细节/表情/剪影研究",
    typeIds: ["character"],
    priority: () => 70,
    build: (ctx) => {
      const s = entityOf(ctx);
      return `为世界《${ctx.worldName}》的人物生成一张人物卡（character card）。

人物设定（来自该设定卡）：
- 角色定位：${s.entity.intro || "（未填）"}
- 核心情绪 / 性格：${attrText(s.entity, "personality") || "（未填）"}
- 视觉标志 / 外貌：${attrText(s.entity, "appearance") || "（未填）"}
- 声音：${attrText(s.entity, "voice") || "（未填）"}
- 不可变特征（必须严格保持）：${attrText(s.entity, "invariants") || "（未填）"}

${CHARACTER_CARD_LAYOUT}

${stylePreamble(ctx.styleLock)}
${cardRefsLine(s.mediaRefs)}
产出后写回该实体的一条 media 属性，label「人物卡」（role=character）；只新增素材，不改其它设定。世界只读时先提议 Fork。`;
    },
  },
  {
    id: "character.expressions",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "smile",
    label: "生成表情表",
    desc: "6–9 格情绪表情，同一角色",
    typeIds: ["character"],
    build: (ctx) => {
      const s = entityOf(ctx);
      return `以人物「${s.entity.name}」的外貌（${attrText(s.entity, "appearance") || "见现有参考"}）为准，生成一张表情表：平静/微笑/惊讶/生气/难过/疑惑（6–9 格），保持同一角色一致性。已有素材：${refsLine(s.mediaRefs)}。产出写回该人物的 media 属性（role=character）。`;
    },
  },
  {
    id: "character.turnaround",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "rotate-cw",
    label: "生成三视图",
    desc: "正/侧/背，比例与服装一致",
    typeIds: ["character"],
    build: (ctx) => `以人物「${entityOf(ctx).entity.name}」的现有外观为基准，生成规范三视图（正面/侧面/背面），比例、发型与服装严格一致。产出写回该人物的 media 属性（role=character）。`,
  },
  {
    id: "character.outfits",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "shirt",
    label: "生成换装 / 服装细节板",
    desc: "多套服装 + 配件",
    typeIds: ["character"],
    build: (ctx) => `为人物「${entityOf(ctx).entity.name}」生成换装设定板：同一角色 3 套服装，附材质与配饰细节，保持脸部与体型一致。产出写回该人物的 media 属性。`,
  },
  {
    id: "character.voice",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "audio", gate: "direct" },
    icon: "audio-lines",
    label: "生成音色试听",
    desc: "从「声音」设定生成一段试听",
    typeIds: ["character"],
    build: (ctx) => `根据人物「${entityOf(ctx).entity.name}」的声音设定（${attrText(entityOf(ctx).entity, "voice") || "未填"}）生成一段 5–8 秒试听台词（中性语气），作为音色锚定（role=voice）。产出写回该人物的 media 属性。`,
  },
  {
    id: "character.motion",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "video", gate: "proposal" },
    icon: "person-standing",
    label: "生成表演 / 动作参考",
    desc: "角色动作与表演（视频提案）",
    typeIds: ["character"],
    build: (ctx) => `为人物「${entityOf(ctx).entity.name}」设计一段 3–5 秒的表演/动作参考：给出提示词与参考锚定（role=motion-ref），落成视频生成提案等我确认，不要直接生成。`,
  },
  {
    id: "character.consistency",
    subject: "entity",
    category: "qc",
    output: { kind: "text" },
    icon: "shield-check",
    label: "参考图一致性检查",
    desc: "对比多张图与「不可变特征」",
    typeIds: ["character"],
    requires: (ctx) => (hasMedia(entityOf(ctx)) ? { ok: true } : { ok: false, reason: "先添加或生成参考图" }),
    build: (ctx) => {
      const s = entityOf(ctx);
      return `以「不可变特征：${attrText(s.entity, "invariants") || "（未填）"}」为准，逐张检查人物「${s.entity.name}」现有参考素材（${refsLine(s.mediaRefs)}）是否一致，列出偏差点与修图/重生成建议。只输出报告。`;
    },
  },
  {
    id: "character.logline",
    subject: "entity",
    category: "text",
    output: { kind: "text" },
    icon: "quote",
    label: "写 3 版一句话人设",
    desc: "供简介/宣发复用",
    typeIds: ["character"],
    build: (ctx) => `为人物「${entityOf(ctx).entity.name}」（简介：${entityOf(ctx).entity.intro || "无"}）写 3 版一句话人设（logline），风格分别为「正式」「口语」「悬念」。只给文本。`,
  },
  {
    id: "character.expand",
    subject: "entity",
    category: "text",
    output: { kind: "canon-proposal" },
    icon: "wand-sparkles",
    label: "补全性格与不可变特征",
    desc: "给改动建议，确认后写回字段",
    typeIds: ["character"],
    build: (ctx) => {
      const s = entityOf(ctx);
      return `根据人物「${s.entity.name}」现有设定（外貌：${attrText(s.entity, "appearance") || "未填"}；简介：${s.entity.intro || "无"}）与参考素材（${refsLine(s.mediaRefs)}），建议补全「性格」与「不可变特征」字段内容。先给提案，我确认后再写回。`;
    },
  },
  {
    id: "character.relations",
    subject: "entity",
    category: "structure",
    output: { kind: "canon-proposal" },
    icon: "share-2",
    label: "建议与其它人物/场景的关系",
    desc: "先列清单，挑选后建关系",
    typeIds: ["character"],
    build: (ctx) => `读取世界《${ctx.worldName}》，为人物「${entityOf(ctx).entity.name}」建议与其它人物/场景的关系（类型 + 方向 + 一句理由）。先列成清单，我挑选后再建立语义关系。`,
  },
  {
    id: "character.voiceDesign",
    subject: "entity",
    category: "sound",
    output: { kind: "text" },
    icon: "mic",
    label: "设计音色方向",
    desc: "音域/语速/口音/情绪基调",
    typeIds: ["character"],
    build: (ctx) => `为人物「${entityOf(ctx).entity.name}」设计音色方向：音域、语速、口音、情绪基调与参考风格，并给一句台词示例。只输出文本，不改设定。`,
  },
  {
    id: "character.dialogue",
    subject: "entity",
    category: "text",
    output: { kind: "text" },
    icon: "message-square",
    label: "生成标志性对白",
    desc: "一句能立住人物的台词",
    typeIds: ["character"],
    build: (ctx) => `为人物「${entityOf(ctx).entity.name}」写 3 句标志性对白/口播，体现其性格（${attrText(entityOf(ctx).entity, "personality") || "见简介"}）。只输出文本。`,
  },
  {
    id: "character.translate",
    subject: "entity",
    category: "transform",
    output: { kind: "text" },
    icon: "languages",
    label: "人设转英文 prompt-ready",
    desc: "便于跨语种生成",
    typeIds: ["character"],
    build: (ctx) => `把人物「${entityOf(ctx).entity.name}」的人设改写成英文 prompt-ready 描述（外貌/服装/气质/负面约束分节）。只输出文本。`,
  },
  {
    id: "character.shot",
    subject: "entity",
    category: "plan",
    output: { kind: "media", modality: "video", gate: "proposal" },
    icon: "clapperboard",
    label: "由此角色生成镜头",
    desc: "落视频提案，等确认",
    typeIds: ["character"],
    build: (ctx) => `以人物「${entityOf(ctx).entity.name}」为锚定（role=character），设计 1 个约 5 秒镜头，给出提示词与参考锚定，落成视频提案等我确认。`,
  },
];

const locationActions: GuidedAiAction[] = [
  {
    id: "location.sheet",
    subject: "entity",
    category: "sheet",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "mountain-snow",
    label: "生成环境卡",
    desc: "一张图：信息栏 + 全景 + 机位 + 细节 + 光影 + 色卡",
    typeIds: ["location"],
    priority: () => 70,
    build: (ctx) => {
      const s = entityOf(ctx);
      return `为世界《${ctx.worldName}》的场景生成一张环境卡（environment card）。

场景设定：
- 场景定位 / 描述：${attrText(s.entity, "description") || "（未填）"}
- 氛围：${attrText(s.entity, "atmosphere") || "（未填）"}
- 简介：${s.entity.intro || "（未填）"}

${ENVIRONMENT_CARD_LAYOUT}

${stylePreamble(ctx.styleLock)}
${cardRefsLine(s.mediaRefs)}
产出后写回该实体的一条 media 属性，label「环境卡」（role=environment）；色卡如需单独保存另记 role=color-card。只新增素材，不改其它设定。`;
    },
  },
  {
    id: "location.angles",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "camera",
    label: "生成多机位场景图",
    desc: "建立镜头/中景/近景、四方向",
    typeIds: ["location"],
    build: (ctx) => `以场景「${entityOf(ctx).entity.name}」的描述（${attrText(entityOf(ctx).entity, "description") || "见参考"}）为准，生成多机位图：建立镜头 / 中景 / 近景，以及四个方向，保持空间结构一致。产出写回该场景的 media 属性（role=environment）。`,
  },
  {
    id: "location.mood",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "sun-moon",
    label: "生成氛围 / 时间变体",
    desc: "日/夜/黄昏/雨雪",
    typeIds: ["location"],
    build: (ctx) => `为场景「${entityOf(ctx).entity.name}」生成同一空间的时间/氛围变体（白天、黄昏、夜晚、雨），保持结构与材质一致。产出写回该场景的 media 属性。`,
  },
  {
    id: "location.details",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "scan",
    label: "生成场景细节板",
    desc: "材质、道具、招牌、纹理特写",
    typeIds: ["location"],
    build: (ctx) => `为场景「${entityOf(ctx).entity.name}」生成细节板：材质、道具、招牌/标识、纹理特写，与主视角一致。产出写回该场景的 media 属性。`,
  },
  {
    id: "location.colorCard",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "palette",
    label: "生成场景色卡",
    desc: "整场调色锚定（role=color-card）",
    typeIds: ["location"],
    build: (ctx) => `为场景「${entityOf(ctx).entity.name}」提取并生成一张色卡（5–7 色 + 明暗阶），作为整场调色锚定（role=color-card）。产出写回该场景的 media 属性。`,
  },
  {
    id: "location.consistency",
    subject: "entity",
    category: "qc",
    output: { kind: "text" },
    icon: "shield-check",
    label: "多图一致性 / 连续性检查",
    desc: "同一场景不同素材是否串味",
    typeIds: ["location"],
    requires: (ctx) => (hasMedia(entityOf(ctx)) ? { ok: true } : { ok: false, reason: "先添加或生成场景图" }),
    build: (ctx) => {
      const s = entityOf(ctx);
      return `检查场景「${s.entity.name}」现有素材（${refsLine(s.mediaRefs)}）在结构、材质、光影上是否一致，列出偏差与修复建议。只输出报告。`;
    },
  },
  {
    id: "location.plan",
    subject: "entity",
    category: "plan",
    output: { kind: "text" },
    icon: "list-tree",
    label: "设计机位表",
    desc: "含镜头意图（景别/角度/运动）",
    typeIds: ["location"],
    build: (ctx) => `为场景「${entityOf(ctx).entity.name}」（${attrText(entityOf(ctx).entity, "description") || "无描述"}）设计机位表：每个机位的景别、角度、运动、用途。只输出文本。`,
  },
  {
    id: "location.lighting",
    subject: "entity",
    category: "plan",
    output: { kind: "text" },
    icon: "sun",
    label: "光影 / 时间方案",
    desc: "各时段光源方向与色温",
    typeIds: ["location"],
    build: (ctx) => `为场景「${entityOf(ctx).entity.name}」设计光影方案：各时段的光源方向、色温、阴影质感与情绪。只输出文本。`,
  },
  {
    id: "location.relations",
    subject: "entity",
    category: "structure",
    output: { kind: "canon-proposal" },
    icon: "share-2",
    label: "建议与人物/故事的关系",
    desc: "确认后建关系",
    typeIds: ["location"],
    build: (ctx) => `为场景「${entityOf(ctx).entity.name}」建议与人物/故事的关系（类型 + 方向 + 一句理由），先列清单；我确认后再建立。`,
  },
  {
    id: "location.translate",
    subject: "entity",
    category: "transform",
    output: { kind: "text" },
    icon: "languages",
    label: "描述转英文 prompt-ready",
    desc: "便于跨语种生成",
    typeIds: ["location"],
    build: (ctx) => `把场景「${entityOf(ctx).entity.name}」的描述与氛围改写成英文 prompt-ready 描述（光线/材质/机位分节）。只输出文本。`,
  },
  {
    id: "location.shot",
    subject: "entity",
    category: "plan",
    output: { kind: "media", modality: "video", gate: "proposal" },
    icon: "clapperboard",
    label: "在此场景中生成镜头",
    desc: "落视频提案，等确认",
    typeIds: ["location"],
    build: (ctx) => `以场景「${entityOf(ctx).entity.name}」为环境锚定（role=environment），设计 1 个约 5 秒镜头，落成视频提案等我确认。`,
  },
];

const objectActions: GuidedAiAction[] = [
  {
    id: "object.sheet",
    subject: "entity",
    category: "sheet",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "package",
    label: "生成物体卡",
    desc: "一张图：信息栏 + 多角度 + 细节 + 尺寸参照 + 状态变体",
    typeIds: ["object"],
    priority: () => 70,
    build: (ctx) => {
      const s = entityOf(ctx);
      return `为世界《${ctx.worldName}》的物件生成一张物体卡（object card）。

物件设定：
- 描述：${attrText(s.entity, "description") || "（未填）"}
- 材质：${attrText(s.entity, "material") || "（未填）"}
- 来历：${attrText(s.entity, "origin") || "（未填）"}
- 用途：${attrText(s.entity, "usage") || "（未填）"}

${OBJECT_CARD_LAYOUT}

${stylePreamble(ctx.styleLock)}
${cardRefsLine(s.mediaRefs)}
产出后写回该实体的一条 media 属性，label「物体卡」（role=prop）；只新增素材，不改其它设定。`;
    },
  },
  {
    id: "object.details",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "scan",
    label: "生成关键细节特写",
    desc: "材质、纹样、铭文",
    typeIds: ["object"],
    build: (ctx) => `为物件「${entityOf(ctx).entity.name}」（材质：${attrText(entityOf(ctx).entity, "material") || "见参考"}）生成关键细节特写：材质、纹样、铭文。产出写回该物件的 media 属性。`,
  },
  {
    id: "object.states",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "layers",
    label: "生成状态变体",
    desc: "崭新/陈旧/损坏/重要时刻",
    typeIds: ["object"],
    build: (ctx) => `为物件「${entityOf(ctx).entity.name}」生成状态变体：崭新、陈旧、损坏、重要时刻四种，保持结构一致。产出写回该物件的 media 属性。`,
  },
  {
    id: "object.lore",
    subject: "entity",
    category: "text",
    output: { kind: "canon-proposal" },
    icon: "scroll",
    label: "设计来历与重要时刻",
    desc: "填补 origin / moment",
    typeIds: ["object"],
    build: (ctx) => `为物件「${entityOf(ctx).entity.name}」设计来历与重要时刻故事，建议写入 origin / moment 字段。先给提案，确认后再写回。`,
  },
  {
    id: "object.relations",
    subject: "entity",
    category: "structure",
    output: { kind: "canon-proposal" },
    icon: "share-2",
    label: "建议归属人物/场景",
    desc: "确认后建关系",
    typeIds: ["object"],
    build: (ctx) => `为物件「${entityOf(ctx).entity.name}」建议归属的人物/场景（关系类型 + 理由），先列清单；确认后建立。`,
  },
];

const storyActions: GuidedAiAction[] = [
  {
    id: "story.storyboard",
    subject: "entity",
    category: "sheet",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "layout-grid",
    label: "生成分镜表",
    desc: "前提/时刻/情绪 → N 格分镜草图",
    typeIds: ["story"],
    priority: () => 45,
    build: (ctx) => {
      const s = entityOf(ctx);
      return `为世界《${ctx.worldName}》的故事「${s.entity.name}」生成分镜草图：前提=${attrText(s.entity, "premise") || "未填"}；关键时刻=${attrText(s.entity, "moment") || "未填"}；情绪=${attrText(s.entity, "emotion") || "未填"}。
输出 6–8 格分镜（每格含景别与一句画面说明），沿用世界风格。产出写回该故事的 media 属性。`;
    },
  },
  {
    id: "story.shotlist",
    subject: "entity",
    category: "plan",
    output: { kind: "text" },
    icon: "list-tree",
    label: "输出镜头表",
    desc: "景别/角度/时长/台词/参考锚点",
    typeIds: ["story"],
    build: (ctx) => `把故事「${entityOf(ctx).entity.name}」拆成镜头表：镜号、景别、角度、时长、台词、参考锚点（role）。只输出表格文本。`,
  },
  {
    id: "story.script",
    subject: "entity",
    category: "text",
    output: { kind: "text" },
    icon: "file-text",
    label: "展开为一页剧本/口播稿",
    desc: "",
    typeIds: ["story"],
    build: (ctx) => `把故事「${entityOf(ctx).entity.name}」（前提：${attrText(entityOf(ctx).entity, "premise") || "无"}）展开为一页剧本或口播稿。只输出文本。`,
  },
  {
    id: "story.dialogue",
    subject: "entity",
    category: "text",
    output: { kind: "text" },
    icon: "message-square",
    label: "生成关键对白",
    desc: "",
    typeIds: ["story"],
    build: (ctx) => `为故事「${entityOf(ctx).entity.name}」的关键时刻（${attrText(entityOf(ctx).entity, "moment") || "无"}）写一段关键对白。只输出文本。`,
  },
  {
    id: "story.hooks",
    subject: "entity",
    category: "plan",
    output: { kind: "text" },
    icon: "zap",
    label: "起开场钩子与标题",
    desc: "5 版钩子 + 标题",
    typeIds: ["story"],
    build: (ctx) => `为故事「${entityOf(ctx).entity.name}」写 5 版开场钩子与标题（前 3 秒留人），并说明适用平台。只输出文本。`,
  },
  {
    id: "story.beats",
    subject: "entity",
    category: "text",
    output: { kind: "text" },
    icon: "git-branch",
    label: "扩写故事结构",
    desc: "前提 → 场景/人物/冲突清单",
    typeIds: ["story"],
    build: (ctx) => `把故事「${entityOf(ctx).entity.name}」扩写为结构：涉及的场景、人物、冲突与节拍清单。只输出文本。`,
  },
  {
    id: "story.relations",
    subject: "entity",
    category: "structure",
    output: { kind: "canon-proposal" },
    icon: "network",
    label: "连成人物/场景关系网",
    desc: "批量建议关系",
    typeIds: ["story"],
    build: (ctx) => `为故事「${entityOf(ctx).entity.name}」把相关人物/场景连成关系网（批量建议关系类型与理由），先列清单；确认后建立。`,
  },
  {
    id: "story.keyframes",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "video", gate: "proposal" },
    icon: "clapperboard",
    label: "生成关键帧 / 镜头提案",
    desc: "把 moment 转成镜头提案",
    typeIds: ["story"],
    build: (ctx) => `把故事「${entityOf(ctx).entity.name}」的关键时刻转成关键帧镜头提案（含提示词与参考锚定），落成视频提案等我确认，不要直接生成。`,
  },
  {
    id: "story.publish",
    subject: "entity",
    category: "plan",
    output: { kind: "text" },
    icon: "send",
    label: "发布计划 / 平台适配",
    desc: "画幅/时长/封面/节奏建议",
    typeIds: ["story"],
    build: (ctx) => `为故事「${entityOf(ctx).entity.name}」给出发布计划：目标平台、画幅与时长、封面与标题、节奏建议。只输出文本。`,
  },
];

const styleActions: GuidedAiAction[] = [
  {
    id: "style.board",
    subject: "entity",
    category: "sheet",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "sparkles",
    label: "生成风格母版板",
    desc: "视觉/guidance/avoid + 示例图 → 风格板",
    typeIds: ["style"],
    priority: () => 45,
    build: (ctx) => {
      const s = entityOf(ctx);
      return `为世界《${ctx.worldName}》的风格「${s.entity.name}」生成一张风格母版板（多图拼贴 + 说明）：
视觉=${attrText(s.entity, "visual") || "未填"}；guidance=${attrText(s.entity, "guidance") || "未填"}；避免=${attrText(s.entity, "avoid") || "未填"}。
已有示例图：${refsLine(s.mediaRefs)}。产出写回该风格的 media 属性（role=style-ref）。`;
    },
  },
  {
    id: "style.colorCard",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "palette",
    label: "生成色卡",
    desc: "role=color-card",
    typeIds: ["style"],
    build: (ctx) => `根据风格「${entityOf(ctx).entity.name}」的视觉描述（${attrText(entityOf(ctx).entity, "visual") || "见参考"}）生成一张色卡（主色/辅色/明暗阶），role=color-card。产出写回该风格的 media 属性。`,
  },
  {
    id: "style.sample",
    subject: "entity",
    category: "derive",
    output: { kind: "media", modality: "video", gate: "proposal" },
    icon: "film",
    label: "生成风格样片",
    desc: "一段镜头验证风格（视频提案）",
    typeIds: ["style"],
    build: (ctx) => `以风格「${entityOf(ctx).entity.name}」为 STYLE LOCK，设计一段 3–5 秒样片镜头并落成视频提案，等我确认。`,
  },
  {
    id: "style.naming",
    subject: "entity",
    category: "text",
    output: { kind: "text" },
    icon: "type",
    label: "给风格起名与关键词",
    desc: "",
    typeIds: ["style"],
    build: (ctx) => `为风格「${entityOf(ctx).entity.name}」起名并给出一组风格关键词（中英）。只输出文本。`,
  },
  {
    id: "style.promptKit",
    subject: "entity",
    category: "transform",
    output: { kind: "text" },
    icon: "wrench",
    label: "生成风格提示词工具包",
    desc: "STYLE LOCK + 正面/负面词",
    typeIds: ["style"],
    build: (ctx) => {
      const s = entityOf(ctx);
      return `根据风格「${s.entity.name}」（视觉=${attrText(s.entity, "visual") || "未填"}；避免=${attrText(s.entity, "avoid") || "未填"}）生成一套提示词工具包：一段可逐字复用的 STYLE LOCK，以及正面/负面词清单。只输出文本。`;
    },
  },
  {
    id: "style.qc",
    subject: "entity",
    category: "qc",
    output: { kind: "text" },
    icon: "shield-check",
    label: "素材是否符合风格 / avoid",
    desc: "扫描世界内素材，列出偏离项",
    typeIds: ["style"],
    build: (ctx) => `以风格「${entityOf(ctx).entity.name}」为准，扫描世界《${ctx.worldName}》内的素材是否偏离风格或违反 avoid，列出偏离项与建议。只输出报告。`,
  },
  {
    id: "style.extract",
    subject: "entity",
    category: "transform",
    output: { kind: "text" },
    icon: "scan",
    label: "从示例图反推风格文本",
    desc: "填充 visual/guidance/avoid",
    typeIds: ["style"],
    requires: (ctx) => (hasMedia(entityOf(ctx)) ? { ok: true } : { ok: false, reason: "先添加示例图" }),
    build: (ctx) => `根据风格「${entityOf(ctx).entity.name}」的示例图（${refsLine(entityOf(ctx).mediaRefs)}）反推风格文本，建议填充 visual/guidance/avoid。先给提案。`,
  },
];

const ruleActions: GuidedAiAction[] = [
  {
    id: "rule.draft",
    subject: "entity",
    category: "text",
    output: { kind: "canon-proposal" },
    icon: "scroll",
    label: "从世界描述生成规则草案",
    desc: "确认后写规则实体",
    typeIds: ["rule"],
    build: (ctx) => `阅读世界《${ctx.worldName}》的整体设定，为规则「${entityOf(ctx).entity.name}」生成草案文本（必须坚持/避免/尽量做到）。先给提案，确认后写回。`,
  },
  {
    id: "rule.conflict",
    subject: "entity",
    category: "qc",
    output: { kind: "text" },
    icon: "shield-alert",
    label: "规则 / 设定冲突检查",
    desc: "跨实体扫描矛盾",
    typeIds: ["rule"],
    build: (ctx) => `检查规则「${entityOf(ctx).entity.name}」（${attrText(entityOf(ctx).entity, "text") || "无文本"}）与其它规则/设定是否冲突，列出矛盾点与建议。只输出报告。`,
  },
  {
    id: "rule.constraints",
    subject: "entity",
    category: "transform",
    output: { kind: "text" },
    icon: "wrench",
    label: "规则转生成约束",
    desc: "STYLE LOCK 片段 / 负面词清单",
    typeIds: ["rule"],
    build: (ctx) => `把规则「${entityOf(ctx).entity.name}」转成生成可用的约束：STYLE LOCK 片段与负面词清单。只输出文本。`,
  },
];

export const ENTITY_ACTIONS: GuidedAiAction[] = [
  ...characterActions,
  ...locationActions,
  ...objectActions,
  ...storyActions,
  ...styleActions,
  ...ruleActions,
  ...genericActions(),
];
