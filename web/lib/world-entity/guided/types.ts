/*
 * [INPUT]: 依赖 recut-worlds-client 的 EntityKind/WorldEntity 类型（type-only）
 * [OUTPUT]: 对外提供引导提示操作的类型契约：GuidedActionCategory（九类）、GuidedActionOutput（四种产出）、
 *   GuidedAiAction、GuidedPromptContext（实体/媒体两种 subject）、MediaRef、MediaPurpose、GenerationRefRole
 * [POS]: web/lib/world-entity/guided 的类型根；纯类型、无运行时依赖（RFC 2026-09-15-world-entity-guided-ai-actions）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { EntityKind, WorldEntity } from "@/lib/recut-worlds-client";

// 生成链路 role 受控词表（与 generation-reference-protocol / canvas-proposal.PROPOSAL_ROLES 对齐）
export type GenerationRefRole =
  | "pov"
  | "color-card"
  | "environment"
  | "character"
  | "prop"
  | "style-ref"
  | "motion-ref"
  | "voice"
  | "sfx"
  | "music";

export type MediaModality = "image" | "video" | "audio";

// 九类动作（RFC §3.1）
export type GuidedActionCategory =
  | "sheet" // 整合锚定：把散落设定/素材合成一张权威参考图
  | "derive" // 派生素材：生成配套的图 / 音 / 视频
  | "text" // 文本创作
  | "structure" // 结构整理
  | "plan" // 策划编排
  | "qc" // 质量检查
  | "transform" // 转换改写
  | "research" // 资料研究
  | "sound"; // 声音设计

// 四种产出（RFC §3.1.1）
export type GuidedActionOutput =
  | { kind: "media"; modality: MediaModality; gate: "direct" | "proposal" }
  | { kind: "text" }
  | { kind: "canon-proposal" }
  | { kind: "canvas-proposal" };

// 一条可引用素材（来自实体 media 属性或媒体元素自身）
export type MediaRef = {
  assetId?: string;
  url?: string;
  label: string;
  kind: string;
  role?: GenerationRefRole;
};

// 由属性名/元素名/素材名推断出的媒体语义（RFC §5.8.1）
export type MediaPurpose = {
  id: string;
  role?: GenerationRefRole;
  confidence: number;
  matched: string;
  source: "attr-label" | "element-name" | "asset-name" | "fallback";
};

export type GuidedEntitySubject = {
  kind: "entity";
  entity: WorldEntity;
  typeLabel: string;
  mediaRefs: MediaRef[];
};

export type GuidedMediaSubject = {
  kind: "media";
  modality: MediaModality;
  assetId?: string;
  /** 属性媒体卡的属性名（props.label）——语义推断第一依据 */
  attrLabel?: string;
  elementName?: string;
  assetName?: string;
  inferred: MediaPurpose;
  references: MediaRef[];
  /** 该媒体若挂在某实体属性上，带出所属实体（写回/上下文用） */
  owningEntity?: WorldEntity;
};

export type GuidedSubject = GuidedEntitySubject | GuidedMediaSubject;

export type GuidedPromptContext = {
  locale: "zh" | "en";
  worldId: string;
  worldName: string;
  subject: GuidedSubject;
  styleLock?: string;
};

export type GuidedAiAction = {
  /** 稳定 id（如 "character.sheet" / "media.asSheet"），用于埋点与 key */
  id: string;
  subject: "entity" | "media";
  category: GuidedActionCategory;
  output: GuidedActionOutput;
  icon: string;
  label: string;
  desc?: string;
  labelEn?: string;
  descEn?: string;
  /** 实体动作适用类型；缺省 = 全部实体类型 */
  typeIds?: EntityKind[];
  /** 通用兜底动作排除的类型（这些类型已有更具体的同名动作，避免重复） */
  excludeTypeIds?: EntityKind[];
  /** 媒体动作适用 purpose id；缺省 = 全部 purpose（"*" 用缺省表达） */
  purposes?: string[];
  /** 媒体动作适用模态；缺省 = 全部模态（如「生成人物卡」只对 image 有意义） */
  modalities?: MediaModality[];
  requires?: (ctx: GuidedPromptContext) => { ok: boolean; reason?: string };
  priority?: (ctx: GuidedPromptContext) => number;
  build: (ctx: GuidedPromptContext) => string;
};
