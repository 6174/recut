/*
 * [INPUT]: 依赖 guided/types、guided/context（mediaOf/mediaLabel/refsLine）
 * [OUTPUT]: 对外提供 MEDIA_ACTIONS：媒体元素（图片/视频/音频）按推断 purpose 的引导提示动作注册表，
 *   含生成类（variation/asSheet/siblings/angles/mood/style/…）与非生成类（reverse/qc/caption/rename/…）
 * [POS]: web/lib/world-entity/guided 的媒体动作数据层；applies 由 registry 按 inferred.purpose 过滤（RFC §5.8.2）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { mediaLabel, mediaOf, refsLine } from "./context";
import { CHARACTER_CARD_LAYOUT, ENVIRONMENT_CARD_LAYOUT, OBJECT_CARD_LAYOUT, stylePreamble } from "./cards";
import { mediaTag } from "./refs";
import type { GuidedAiAction, GuidedMediaSubject, GuidedPromptContext } from "./types";

const SHEET_PURPOSES = [
  "appearance",
  "expression",
  "wardrobe",
  "turnaround",
  "environment",
  "prop",
  "style-ref",
  "color-card",
  "detail",
  "material",
  "lighting",
];

// 三类设定卡与 purpose 的匹配组：命中的卡排在未命中的卡之前（避免给场景图推「人物卡」当首选）
const CHARACTER_PURPOSES = ["appearance", "expression", "wardrobe", "turnaround", "hair"];
const ENVIRONMENT_PURPOSES = ["environment", "lighting"];
const PROP_PURPOSES = ["prop", "detail", "material"];

function inferredId(ctx: GuidedPromptContext): string {
  return ctx.subject.kind === "media" ? ctx.subject.inferred.id : "";
}

function cardPriority(ctx: GuidedPromptContext, group: string[], base: number): number {
  return group.includes(inferredId(ctx)) ? 80 : base;
}

// 主体素材的内联引用标记（无 assetId 时退回名称文本），与 @ 面板 chip 同构
function subjectRef(ctx: GuidedPromptContext): string {
  const s = mediaOf(ctx);
  const tag = mediaTag({
    ...(s.assetId ? { assetId: s.assetId } : {}),
    label: mediaLabel(ctx),
    kind: s.modality,
    ...(s.inferred.role ? { role: s.inferred.role } : {}),
  });
  return tag ?? `「${mediaLabel(ctx)}」`;
}

function writebackLine(s: GuidedMediaSubject, label: string, role: string): string {
  return s.owningEntity
    ? `产出写回「${s.owningEntity.name}」的 media 属性（label「${label}」，role=${role}），并记录参考绑定；只新增素材，不改其它设定。`
    : `产出作为新的 media 元素（label「${label}」，role=${role}）；只新增素材。`;
}

export const MEDIA_ACTIONS: GuidedAiAction[] = [
  // 三类「设定卡」是 AI 生成里最常见的产出：不依赖推断，永远靠前（人物卡 / 环境卡 / 物体卡）
  {
    id: "media.card.character",
    subject: "media",
    category: "sheet",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "sparkles",
    label: "生成人物卡",
    desc: "一张图：信息栏 + 主视觉 + 三视图 + 细节/表情/剪影研究",
    modalities: ["image"],
    priority: (ctx) => cardPriority(ctx, CHARACTER_PURPOSES, 62),
    build: (ctx) => {
      const s = mediaOf(ctx);
      return `生成一张人物卡（character card）。参考素材 ${subjectRef(ctx)}。

${CHARACTER_CARD_LAYOUT}

${stylePreamble(ctx.styleLock)}
${writebackLine(s, "人物卡", "character")}`;
    },
  },
  {
    id: "media.card.environment",
    subject: "media",
    category: "sheet",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "mountain-snow",
    label: "生成环境卡",
    desc: "一张图：信息栏 + 全景 + 机位 + 细节 + 光影 + 色卡",
    modalities: ["image"],
    priority: (ctx) => cardPriority(ctx, ENVIRONMENT_PURPOSES, 61),
    build: (ctx) => {
      const s = mediaOf(ctx);
      return `生成一张环境卡（environment card）。参考素材 ${subjectRef(ctx)}。

${ENVIRONMENT_CARD_LAYOUT}

${stylePreamble(ctx.styleLock)}
${writebackLine(s, "环境卡", "environment")}`;
    },
  },
  {
    id: "media.card.object",
    subject: "media",
    category: "sheet",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "package",
    label: "生成物体卡",
    desc: "一张图：信息栏 + 多角度 + 细节 + 尺寸参照 + 状态变体",
    modalities: ["image"],
    priority: (ctx) => cardPriority(ctx, PROP_PURPOSES, 60),
    build: (ctx) => {
      const s = mediaOf(ctx);
      return `生成一张物体卡（object card）。参考素材 ${subjectRef(ctx)}。

${OBJECT_CARD_LAYOUT}

${stylePreamble(ctx.styleLock)}
${writebackLine(s, "物体卡", "prop")}`;
    },
  },
  {
    id: "media.asSheet",
    subject: "media",
    category: "sheet",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "sparkles",
    label: "合成一张设定板",
    desc: "以这张为锚，补齐同类视图成一张设定板",
    modalities: ["image"],
    purposes: SHEET_PURPOSES,
    priority: () => 50,
    build: (ctx) => {
      const s = mediaOf(ctx);
      const owner = s.owningEntity?.name;
      return `参考素材 ${subjectRef(ctx)}：它的属性名是「${mediaLabel(ctx)}」${owner ? `，属于角色/设定「${owner}」` : ""}，推断 role=${s.inferred.role ?? "—"}。
请把它作为视觉锚定，生成一张完整的设定板：在保留这张图特征的前提下，补齐同类视图/细节（人物：头像+表情+半身+全身三视图+服装细节+配色板；场景：全景+多机位+光影变体+细节+色卡）。
沿用世界风格${s.owningEntity ? `；产出写回该设定的 media 属性（label 采用约定名，role=${s.inferred.role ?? "按类型推断"}）` : "；产出作为新的 media 元素"}，并记录参考绑定；只新增素材，不改其它设定。`;
    },
  },
  {
    id: "media.siblings",
    subject: "media",
    category: "plan",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "plus-circle",
    label: "补齐同设定缺失的同类参考",
    desc: "如「有外貌缺服装」→ 生成服装参考",
    modalities: ["image"],
    requires: (ctx) => {
      const s = mediaOf(ctx);
      return s.owningEntity ? { ok: true } : { ok: false, reason: "这张图未挂在某个设定上" };
    },
    build: (ctx) => {
      const s = mediaOf(ctx);
      return `设定「${s.owningEntity?.name}」现有参考素材：${refsLine(s.references)}。
请对照其字段，指出还缺哪些参考图（如外貌/服装/表情/场景/色卡…），并生成缺失的那一张；不要重复已有的。`;
    },
  },
  {
    id: "media.variation",
    subject: "media",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "shuffle",
    label: "生成变体",
    desc: "同主体不同方案（3 版）",
    modalities: ["image", "video"],
    priority: () => 10,
    build: (ctx) => {
      const s = mediaOf(ctx);
      return `以参考素材 ${subjectRef(ctx)} 为准，生成 3 版变体：主体与风格不变，在构图/细节/光影上给出不同方案。${s.owningEntity ? `产出写回「${s.owningEntity.name}」的 media 属性或新的 media 元素。` : ""}`;
    },
  },
  {
    id: "media.angles",
    subject: "media",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "camera",
    label: "生成多机位 / 多角度",
    desc: "",
    modalities: ["image"],
    purposes: ["environment", "prop"],
    build: (ctx) => `以这张「${mediaLabel(ctx)}」为准，生成多机位/多角度版本（建立/中景/近景 + 反向），保持空间与材质一致。`,
  },
  {
    id: "media.mood",
    subject: "media",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "sun-moon",
    label: "氛围 / 时间变体",
    desc: "日/夜/黄昏/雨雪",
    modalities: ["image"],
    purposes: ["environment", "lighting"],
    build: (ctx) => `以这张「${mediaLabel(ctx)}」为环境，生成时间/氛围变体（白天、黄昏、夜晚、雨），保持结构一致。`,
  },
  {
    id: "media.style",
    subject: "media",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "palette",
    label: "换风格",
    desc: "用风格实体作 style-ref 锚定",
    modalities: ["image", "video"],
    build: (ctx) => `把这张「${mediaLabel(ctx)}」按世界《${ctx.worldName}》的风格实体重绘（STYLE LOCK 逐字复用，role=style-ref），保持主体与构图。`,
  },
  {
    id: "media.series",
    subject: "media",
    category: "derive",
    output: { kind: "media", modality: "image", gate: "direct" },
    icon: "layers",
    label: "补齐同系列参考图",
    desc: "与其他素材成套",
    modalities: ["image"],
    build: (ctx) => `以这张「${mediaLabel(ctx)}」为准，补齐同系列配套素材（同一风格/主体的其它图），与已有素材成套。`,
  },
  {
    id: "media.motion",
    subject: "media",
    category: "derive",
    output: { kind: "media", modality: "video", gate: "proposal" },
    icon: "film",
    label: "生成动态 / 表演参考",
    desc: "视频提案，等确认",
    modalities: ["image", "video"],
    purposes: ["motion", "appearance", "environment"],
    build: (ctx) => `以这张「${mediaLabel(ctx)}」为锚定（role=${mediaOf(ctx).inferred.role ?? "motion-ref"}），设计一段 3–5 秒动态/表演参考，落成视频提案等我确认，不要直接生成。`,
  },
  {
    id: "media.moreLines",
    subject: "media",
    category: "derive",
    output: { kind: "media", modality: "audio", gate: "direct" },
    icon: "audio-lines",
    label: "同音色更多台词",
    desc: "走 speech.generate",
    modalities: ["audio"],
    purposes: ["voice"],
    build: (ctx) => `以这段音色「${mediaLabel(ctx)}」为参考（role=voice），用同一音色生成更多台词试听（3 句，不同情绪）。产出写回对应角色/设定的 media 属性。`,
  },
  {
    id: "media.shot",
    subject: "media",
    category: "plan",
    output: { kind: "media", modality: "video", gate: "proposal" },
    icon: "clapperboard",
    label: "以此图为准生成镜头",
    desc: "视频提案，等确认",
    modalities: ["image", "video"],
    build: (ctx) => `以这张「${mediaLabel(ctx)}」为锚定（role=${mediaOf(ctx).inferred.role ?? "pov"}），设计 1 个约 5 秒镜头，给出提示词与参考锚定，落成视频提案等我确认。`,
  },
  {
    id: "media.reverse",
    subject: "media",
    category: "transform",
    output: { kind: "canon-proposal" },
    icon: "scan",
    label: "由图反推设定文本",
    desc: "写回所属设定的对应字段",
    modalities: ["image"],
    purposes: ["appearance", "environment", "prop", "style-ref"],
    build: (ctx) => {
      const s = mediaOf(ctx);
      return `观察参考素材 ${subjectRef(ctx)}，反推可用于设定的文本描述${s.owningEntity ? `，建议写入「${s.owningEntity.name}」的对应字段（外貌/描述/氛围等）` : ""}。先给提案，我确认后再写回。`;
    },
  },
  {
    id: "media.qc",
    subject: "media",
    category: "qc",
    output: { kind: "text" },
    icon: "shield-check",
    label: "与设定 / 色卡一致性",
    desc: "对比不可变特征、色卡、STYLE LOCK",
    modalities: ["image", "video", "audio"],
    build: (ctx) => {
      const s = mediaOf(ctx);
      return `检查这张「${mediaLabel(ctx)}」是否与${s.owningEntity ? `设定「${s.owningEntity.name}」的不可变特征/字段` : "所属设定"}及世界风格/色卡一致，列出偏差与修复建议。只输出报告。`;
    },
  },
  {
    id: "media.caption",
    subject: "media",
    category: "text",
    output: { kind: "text" },
    icon: "text",
    label: "生成图注 / 替代文本",
    desc: "便于检索与无障碍",
    modalities: ["image"],
    build: (ctx) => `为这张「${mediaLabel(ctx)}」生成一句图注与一段无障碍替代文本（alt）。只输出文本。`,
  },
  {
    id: "media.rename",
    subject: "media",
    category: "text",
    output: { kind: "canon-proposal" },
    icon: "pencil",
    label: "属性名 / 命名建议",
    desc: "建议更规范的 label，确认后改名",
    build: (ctx) => {
      const s = mediaOf(ctx);
      return `这张图的属性名是「${mediaLabel(ctx)}」（推断 purpose=${s.inferred.id}${s.inferred.matched ? `，命中「${s.inferred.matched}」` : ""}）。请建议更规范、可复用的属性名（3 个候选 + 理由）${s.owningEntity ? `，我确认后把它改到「${s.owningEntity.name}」的这个属性上` : ""}。只给建议。`;
    },
  },
  {
    id: "media.promptExtract",
    subject: "media",
    category: "transform",
    output: { kind: "text" },
    icon: "wrench",
    label: "反推可复用提示词 / 配方",
    desc: "输出 prompt + role 锚定",
    modalities: ["image", "video"],
    build: (ctx) => {
      const s = mediaOf(ctx);
      return `根据参考素材 ${subjectRef(ctx)} 的画面，反推一段可复用的生成提示词与参考锚定（role 建议），便于我复制到其它生成里。只输出文本。`;
    },
  },
  {
    id: "media.translate",
    subject: "media",
    category: "transform",
    output: { kind: "text" },
    icon: "languages",
    label: "图内文字 / 注释翻译",
    desc: "",
    modalities: ["image"],
    build: (ctx) => `识别这张「${mediaLabel(ctx)}」中的文字/招牌/注释并翻译（中英对照）。只输出文本。`,
  },
  {
    id: "media.cover",
    subject: "media",
    category: "plan",
    output: { kind: "text" },
    icon: "image",
    label: "封面 / 缩略图建议",
    desc: "世界封面、项目封面候选",
    modalities: ["image", "video"],
    build: (ctx) => `把这张「${mediaLabel(ctx)}」作为封面候选评估：给出裁剪方式、安全区、标题文案位置与平台适配建议。只输出文本。`,
  },
];
