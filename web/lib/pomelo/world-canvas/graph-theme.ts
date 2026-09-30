/*
 * [INPUT]: 仅依赖 pomelo-vello/op-bridge 的 Rgba 类型（type-only，构建期擦除）
 * [OUTPUT]: 对外提供 world 画布（graph）的全部配色单一真源：GRAPH_COLORS（hex，供 DOM/overlay/CSS 用）
 *           与其派生视图 CARD_FILL / TEXT_PRIMARY / LINK_DEFAULT / PROPOSAL_* / AUDIO_* 等 Rgba 元组（供 vello block 用）、
 *           OVERLAY_*（0xRRGGBB 数值，供 cssColor overlay 用）、语义色映射
 *           （ENTITY_TYPE_COLORS/RELATION_TYPE_COLORS/ATTR_MEDIA_COLORS/RELATION_GROUP_COLORS），
 *           以及排版（GRAPH_TEXT）与低细节阈值（LOW_DETAIL_SCALE）。
 * [POS]: lib/pomelo/world-canvas 的配色/排版单一真源；所有 block、overlay、网格、就地编辑器、面板
 *        一律从此处取色，禁止再在别处硬编码 hex/rgb。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Rgba } from "../pomelo-vello/op-bridge";

/** #rrggbb → Rgba 元组（alpha 0–255）。 */
export function rgba(hex: string, alpha = 255): Rgba {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16) || 0,
    Number.parseInt(value.slice(2, 4), 16) || 0,
    Number.parseInt(value.slice(4, 6), 16) || 0,
    alpha,
  ];
}

/** #rrggbb → 0xRRGGBB（DOM/SVG overlay 的 cssColor 用）。 */
export function hexNumber(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16) || 0;
}

/**
 * 画布 graph 统一配色（唯一定义处）。
 * 中性深灰卡面（去掉旧主题绿偏色），保持中性文字层级，语义色只用于状态/类型点缀。
 */
export const GRAPH_COLORS = {
  /* 卡面 / 瓦片 */
  cardFill: "#242629",
  cardStroke: "#ffffff",
  tileFill: "#2e3033",
  tileStroke: "#4b5563",
  shadow: "#000000",
  /* 自由形状元素 */
  shapeStroke: "#52525b",
  /* 文字层级（title / 副标题 / 提示 / 徽标） */
  textPrimary: "#f4f4f5",
  textSecondary: "#a1a1aa",
  textTertiary: "#71717a",
  caption: "#d4d4d8",
  /* 连线（默认线色 + 标签文字；标签只画文本、不画底） */
  linkDefault: "#555960",
  linkLabelText: "#a1a1aa",
  /* 主题强调（world 光环） */
  worldAccent: "#5d9d75",
  /* 状态态：进行中（生成中）保留蓝、失败保留红；未生成态（提案待确认 / 计划中）统一弱灰，不用琥珀/冷蓝 */
  proposal: "#8b9099",
  pending: "#60a5fa",
  failed: "#ef4444",
  plan: "#8b9099",
  /* 音频 block（画布播放器外观）：与 components/audio-waveform-player 同色系（violet-600 强调 + violet-300 波形） */
  audio: "#7c3aed",
  audioWave: "#c4b5fd",
  /* 屏幕空间 overlay（cssColor 取数值） */
  selection: "#4c8dff",
  snap: "#34d399",
  guide: "#7f858f",
  handle: "#d4d4d8",
  handleFill: "#1c1d22",
  alignmentGuide: "#ff3b8d",
  /* 背景网格点 */
  gridDot: "rgba(255,255,255,0.07)",
} as const;

/* ---------- vello block 用的 Rgba 派生视图 ---------- */

export const CARD_FILL: Rgba = rgba(GRAPH_COLORS.cardFill);
export const CARD_STROKE: Rgba = rgba(GRAPH_COLORS.cardStroke, 20); // 8%
export const CARD_STROKE_STRONG: Rgba = rgba(GRAPH_COLORS.cardStroke, 41); // 16%
export const TILE_FILL: Rgba = rgba(GRAPH_COLORS.tileFill);
export const TILE_STROKE: Rgba = rgba(GRAPH_COLORS.tileStroke);
export const SHAPE_FILL: Rgba = rgba(GRAPH_COLORS.cardStroke, 8);
export const SHAPE_STROKE: Rgba = rgba(GRAPH_COLORS.shapeStroke);
export const SHADOW_FILL: Rgba = rgba(GRAPH_COLORS.shadow, 71);
export const TEXT_PRIMARY: Rgba = rgba(GRAPH_COLORS.textPrimary);
export const TEXT_SECONDARY: Rgba = rgba(GRAPH_COLORS.textSecondary);
export const TEXT_TERTIARY: Rgba = rgba(GRAPH_COLORS.textTertiary);
export const CAPTION_FILL: Rgba = rgba(GRAPH_COLORS.caption);
/** 连线标签文字（也用于需要屏幕恒定的小标签）。 */
export const LABEL_FILL: Rgba = rgba(GRAPH_COLORS.linkLabelText);
/** 无封面实体卡的媒体占位槽（比卡面略深的凹槽）与底部分隔线。 */
export const MEDIA_PLACEHOLDER_FILL: Rgba = rgba(GRAPH_COLORS.shadow, 30);
export const CARD_SEPARATOR: Rgba = rgba(GRAPH_COLORS.cardStroke, 12);
export const LINK_DEFAULT: string = GRAPH_COLORS.linkDefault;

export const PROPOSAL_ACCENT: Rgba = rgba(GRAPH_COLORS.proposal);
export const PROPOSAL_FILL: Rgba = rgba(GRAPH_COLORS.proposal, 28);
export const PENDING_ACCENT: Rgba = rgba(GRAPH_COLORS.pending);
export const PENDING_FILL: Rgba = rgba(GRAPH_COLORS.pending, 30);
export const FAILED_ACCENT: Rgba = rgba(GRAPH_COLORS.failed);
export const FAILED_FILL: Rgba = rgba(GRAPH_COLORS.failed, 28);
export const PLAN_ACCENT: Rgba = rgba(GRAPH_COLORS.plan);
export const PLAN_FILL: Rgba = rgba(GRAPH_COLORS.plan, 28);

/* ---------- 音频 block（画布播放器外观）---------- */

/** 播放钮底色 / 波形强调。 */
export const AUDIO_ACCENT: Rgba = rgba(GRAPH_COLORS.audio);
/** 已解码的真实波形柱色。 */
export const AUDIO_WAVE: Rgba = rgba(GRAPH_COLORS.audioWave);
/** 波形尚未就绪（解码中）/ 解码失败时的骨架柱色。 */
export const AUDIO_SKELETON: Rgba = rgba(GRAPH_COLORS.audioWave, 70);
/** 播放钮上的播放三角等前景（画在强调色圆底上）。 */
export const AUDIO_ON_ACCENT: Rgba = rgba(GRAPH_COLORS.textPrimary);

/* ---------- overlay（cssColor 数值）与网格 ---------- */

export const OVERLAY_SELECTION = hexNumber(GRAPH_COLORS.selection);
export const OVERLAY_SNAP = hexNumber(GRAPH_COLORS.snap);
export const OVERLAY_GUIDE = hexNumber(GRAPH_COLORS.guide);
export const OVERLAY_HANDLE = hexNumber(GRAPH_COLORS.handle);
export const OVERLAY_HANDLE_FILL = hexNumber(GRAPH_COLORS.handleFill);
export const OVERLAY_ALIGNMENT_GUIDE = hexNumber(GRAPH_COLORS.alignmentGuide);
export const GRID_DOT = GRAPH_COLORS.gridDot;

/* ---------- 排版（world 单位，随视口缩放） ---------- */

export const GRAPH_TEXT = {
  /** 实体卡标题（footer 主行）。 */
  entityTitle: 17,
  /** 实体卡描述（footer 副行）。 */
  entitySummary: 12,
  /** 卡片外元素徽标（屏幕像素恒定）。 */
  caption: 11,
  /** 连线标签（屏幕像素恒定）。 */
  linkLabel: 10,
} as const;

/** 视口缩放低于该值时进入「低细节」：只画 shape 背景，隐藏所有文字（连线标签直接消失）。 */
export const LOW_DETAIL_SCALE = 0.1;

/* ---------- 语义色（类型 / 关系 / 属性媒体） ---------- */

/** 实体 kind → 描边色。 */
export const ENTITY_TYPE_COLORS: Record<string, string> = {
  character: "#e879f9",
  object: "#fbbf24",
  location: "#60a5fa",
  story: "#f59e0b",
  script: "#22d3ee",
  style: "#34d399",
  rule: "#a78bfa",
  reference: "#94a3b8",
};

/** relationType → 连线色（只表达类型语义，不承载方向）。 */
export const RELATION_TYPE_COLORS: Record<string, string> = {
  belongs_to: "#d946ef", // 家庭/师门
  friend: "#3b82f6",
  references: "#10b981",
  appears_in: "#f97316",
  located_in: "#e11d48",
  father: "#d946ef",
  mother: "#d946ef",
  enemy: "#ef4444",
};

/** 属性边颜色：文本/图片/音频/视频（「+」引导创建的属性节点连线）。 */
export const ATTR_MEDIA_COLORS: Record<string, string> = {
  attr_text: "#38bdf8",
  attr_image: "#a78bfa",
  attr_audio: "#34d399",
  attr_video: "#f59e0b",
};

/** 关系分组色：people/world/story/video 四组 + 其他灰。 */
export const RELATION_GROUP_COLORS: Record<string, string> = {
  people: "#e879f9",
  world: "#60a5fa",
  story: "#f59e0b",
  video: "#a78bfa",
  other: "#94a3b8",
};
