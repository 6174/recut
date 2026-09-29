/*
 * [INPUT]: 依赖 world-media（resolveMediaPropsSrc）、recut-worlds-client 类型
 * [OUTPUT]: 对外提供媒体元素（kind='media'）辅助：mediaSource（assetId/url → 可渲染 URL）、
 * modalityOfKind/assetModality/modalityOfAssetKind（文件或素材 kind → modality）。
 * 图片/视频块的按比例定尺收敛在 canvas-store.fitMediaVisualElement（测量/尺寸在 media-visual-metrics）。
 * 统一 Entity 模型（RFC 2026-09-09）后 evidence 写通道退役（evidence.attach/update 已移除），
 * 实体素材 = media 属性；旧的 defaultEvidencePurpose/evidencePurposeLabels 随之删除
 * [POS]: worlds/[worldID]/canvas 的媒体层共享辅助（store/面板/对话框共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export type MediaModality = "image" | "video" | "audio";

import { resolveMediaPropsSrc } from "@/lib/world-media";

// 媒体元素 props → 可渲染 URL（统一走 world-media 解析：asset 走媒体库 content 流；url 直连或同源代理）
export function mediaSource(apiBase: string, props: { assetId?: string; url?: string }): string {
  return resolveMediaPropsSrc(apiBase, props);
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

// 素材真源 kind（image/video/audio 已是同一词表）→ modality；非视听素材（transcript/document）返回 null。
// 用于 props.modality 缺失/错标时按素材真源纠正，避免音频/视频被当图片交给渲染器。
export function modalityOfAssetKind(kind: string): MediaModality | null {
  return kind === "image" || kind === "video" || kind === "audio" ? kind : null;
}

