/*
 * [INPUT]: 依赖 overlays/types（OverlaySubject 等）、canvas-media（modalityOfAssetKind）、
 *          @/app/media/media-types（Asset，type-only）、@/lib/recut-worlds-client（WorldCanvasElement/WorldEntity，type-only）
 * [OUTPUT]: 对外提供 isAiGeneratedAsset（AI 生成判定）、mediaModalityOfElement（元素 → modality）、
 *          generationSubjectOf（blockId + 快照 → OverlaySubject）、composerEligible（输入框资格：空内容 || AI 生成）
 * [POS]: worlds/[worldID]/canvas/overlays 的纯函数解析层；无 React/无 I/O，可单测（RFC 2026-10-07 §3.4）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Asset } from "@/app/media/media-types";
import type { WorldCanvasElement, WorldEntity } from "@/lib/recut-worlds-client";
import { modalityOfAssetKind } from "../canvas-media";
import type { MediaGenerationSubject, OverlayModality, OverlaySubject } from "./types";

export type SubjectState = {
  elements: WorldCanvasElement[];
  entities: WorldEntity[];
  assets: Record<string, Asset | undefined>;
};

// AI 生成判定：proposed 一律视为 AI 内容；generated/motion-graphic 出处；或带生成配方（proposal/modelId）。
export function isAiGeneratedAsset(asset?: Asset | null): boolean {
  if (!asset) return false;
  if (asset.status === "proposed") return true;
  if (asset.origin === "generated" || asset.origin === "motion-graphic") return true;
  const metadata = asset.metadata ?? {};
  return Boolean(metadata.generation || metadata.modelId);
}

// 媒体元素 → modality：素材真源 kind 优先，其次 props.modality（media）/props.media（attr）。
export function mediaModalityOfElement(element: WorldCanvasElement, asset?: Asset | null): OverlayModality | null {
  const fromAsset = asset?.kind ? modalityOfAssetKind(asset.kind) : null;
  if (fromAsset) return fromAsset;
  const raw = element.kind === "media" ? element.props?.modality : element.kind === "attr" ? element.props?.media : null;
  return raw === "image" || raw === "video" || raw === "audio" ? raw : null;
}

// 可生成媒体主体：独立媒体元素或属性媒体卡（含 image/video/audio）。
function mediaSubjectOf(element: WorldCanvasElement, asset?: Asset | null): MediaGenerationSubject | null {
  if (element.kind !== "media" && element.kind !== "attr") return null;
  const modality = mediaModalityOfElement(element, asset);
  if (!modality) return null;
  const assetId = String(element.props?.assetId ?? "");
  const url = String(element.props?.url ?? "");
  const owningEntityId = element.props?.entityId ? String(element.props.entityId) : undefined;
  const attrLabel = element.props?.label ? String(element.props.label) : undefined;
  return {
    kind: "media-element",
    blockId: element.id,
    elementId: element.id,
    element,
    modality,
    assetId,
    url,
    ...(asset ? { asset } : {}),
    empty: !assetId && !url,
    aiGenerated: isAiGeneratedAsset(asset),
    ...(owningEntityId ? { owningEntityId } : {}),
    ...(attrLabel ? { attrLabel } : {}),
  };
}

// 由 pomelo block id + store 快照解析 subject；无法解析返回 null。
// - 实体卡 blockId = `entity:<entityId>`（元素投影 id 为 `shape:<entityId>`）
// - 媒体/属性卡 blockId = 元素 id
export function generationSubjectOf(state: SubjectState, blockId: string | null | undefined): OverlaySubject | null {
  if (!blockId) return null;
  if (blockId.startsWith("entity:")) {
    const entityId = blockId.slice("entity:".length);
    const entity = state.entities.find((item) => item.id === entityId);
    return entity ? { kind: "entity", blockId, entityId, entity } : null;
  }
  const element = state.elements.find((item) => item.id === blockId);
  if (!element) return null;
  const assetId = String(element.props?.assetId ?? "");
  const asset = assetId ? state.assets[assetId] : undefined;
  return mediaSubjectOf(element, asset);
}

// 输入框资格：空内容 || 已是 AI 生成内容（手动上传且非空 → 不显示）。
export function composerEligible(subject: OverlaySubject | null): subject is MediaGenerationSubject {
  if (!subject || subject.kind !== "media-element") return false;
  return subject.empty || subject.aiGenerated;
}
