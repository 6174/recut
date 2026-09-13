/*
 * [INPUT]: 依赖 useWorldCanvasStore（persistGeometry，供 fitElementToAsset）、recut-worlds-client 类型
 * [OUTPUT]: 对外提供媒体元素（kind='media'）辅助：mediaSource（assetId/url → 可渲染 URL）、
 * modalityOfKind/assetModality（文件类型 → modality）、fitElementToAsset（图片采纳后卡片按
 * naturalWidth/Height 适配纵横比，media-editor 与 AttrCreatorPanel 建卡共用）。
 * 统一 Entity 模型（RFC 2026-09-09）后 evidence 写通道退役（evidence.attach/update 已移除），
 * 实体素材 = media 属性；旧的 defaultEvidencePurpose/evidencePurposeLabels 随之删除
 * [POS]: worlds/[worldID]/canvas 的媒体层共享辅助（store/面板/对话框共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export type MediaModality = "image" | "video" | "audio";

import { resolveMediaPropsSrc } from "@/lib/world-media";
import { useWorldCanvasStore } from "./canvas-store";

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

// 图片素材采纳后卡片自适应比例：读 naturalWidth/Height，按比例重排宽高（宽锚 240，
// 高夹 [120, 420]，竖图缩宽），左上角不动；非 image 保持默认卡。
// （media-editor 面板采纳与 AttrCreatorPanel 建卡统一走这里，保证「图片属性」生成即预览）
export function fitElementToAsset(elementId: string, apiBase: string, assetId: string, modality: MediaModality) {
  if (modality !== "image") return;
  const image = new Image();
  image.onload = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const ratio = image.naturalWidth / image.naturalHeight;
    let width = 240;
    let height = Math.round(width / ratio);
    if (height > 420) {
      height = 420;
      width = Math.round(height * ratio);
    } else if (height < 120) {
      height = 120;
      width = Math.round(height * ratio);
    }
    void useWorldCanvasStore.getState().persistGeometry(elementId, { width, height });
  };
  image.src = mediaSource(apiBase, { assetId });
}
