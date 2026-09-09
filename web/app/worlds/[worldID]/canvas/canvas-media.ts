/*
 * [INPUT]: 依赖 recut-worlds-client 类型
 * [OUTPUT]: 对外提供媒体元素（kind='media'）辅助：mediaSource（assetId/url → 可渲染 URL）、
 * defaultEvidencePurpose（挂接默认用途，B.9：image→appearance / audio→voice / video→motion /
 * 世界级→scene）、evidencePurposeLabels（11 项全量中文）、modalityOfKind（文件类型 → modality）
 * [POS]: worlds/[worldID]/canvas 的媒体层共享辅助（T8；store/面板/对话框共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { WorldEvidence, WorldEvidencePurpose } from "@/lib/recut-worlds-client";

export type MediaModality = "image" | "video" | "audio";

// 媒体元素 props → 可渲染 URL（与 evidenceSource 同一约定：asset 行走媒体库 content 流）
export function mediaSource(apiBase: string, props: { assetId?: string; url?: string }): string {
  if (props.url) return props.url;
  return props.assetId ? `${apiBase}/v1/media/assets/${encodeURIComponent(props.assetId)}/content` : "";
}

export function defaultEvidencePurpose(modality: string, hasEntity: boolean): WorldEvidencePurpose {
  if (!hasEntity) return "scene";
  switch (modality) {
    case "image":
      return "appearance";
    case "audio":
      return "voice";
    case "video":
      return "motion";
    default:
      return "narrative";
  }
}

// B.9 purpose 用户语言（11 项全量）
export const evidencePurposeLabels: Record<WorldEvidencePurpose, string> = {
  identity: "身份图",
  appearance: "外貌",
  wardrobe: "服装",
  voice: "声音",
  motion: "动作",
  scene: "场景",
  mood: "氛围",
  visual_style: "视觉风格",
  sound_style: "声音风格",
  narrative: "叙事",
  rule_evidence: "规则依据",
};

export const evidencePurposeOrder: WorldEvidencePurpose[] = [
  "identity", "appearance", "wardrobe", "voice", "motion", "scene",
  "mood", "visual_style", "sound_style", "narrative", "rule_evidence",
];

// 文件 MIME → modality（上传拖放入口用）
export function modalityOfKind(kind: string): MediaModality | null {
  if (kind.startsWith("image/")) return "image";
  if (kind.startsWith("video/")) return "video";
  if (kind.startsWith("audio/")) return "audio";
  return null;
}

// 媒体素材（/v1/media/assets 行）→ modality（素材库网格过滤用）
export function assetModality(kind: string): MediaModality | null {
  return modalityOfKind(kind);
}

export function evidenceOfId(evidence: WorldEvidence[] | undefined, id?: string): WorldEvidence | undefined {
  return (evidence ?? []).find((item) => item.id === id);
}
