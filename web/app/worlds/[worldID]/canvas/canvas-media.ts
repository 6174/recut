/*
 * [INPUT]: 依赖 recut-worlds-client 类型
 * [OUTPUT]: 对外提供媒体元素（kind='media'）辅助：mediaSource（assetId/url → 可渲染 URL）与
 * modalityOfKind/assetModality（文件类型 → modality）。
 * 统一 Entity 模型（RFC 2026-09-09）后 evidence 写通道退役（evidence.attach/update 已移除），
 * 实体素材 = media 属性；旧的 defaultEvidencePurpose/evidencePurposeLabels 随之删除
 * [POS]: worlds/[worldID]/canvas 的媒体层共享辅助（store/面板/对话框共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export type MediaModality = "image" | "video" | "audio";

// 媒体元素 props → 可渲染 URL（与 evidenceSource 同一约定：asset 行走媒体库 content 流）
export function mediaSource(apiBase: string, props: { assetId?: string; url?: string }): string {
  if (props.url) return props.url;
  return props.assetId ? `${apiBase}/v1/media/assets/${encodeURIComponent(props.assetId)}/content` : "";
}

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
