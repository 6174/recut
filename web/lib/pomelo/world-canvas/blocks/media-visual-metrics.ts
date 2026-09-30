/*
 * [INPUT]: 无外部依赖（浏览器 Image/Video 仅在被调用时创建）
 * [OUTPUT]: 对外提供「视觉媒体块」（图片 / 视频：独立 media 元素与 attr 属性卡）的尺寸策略单一真源：
 *           MEDIA_VISUAL_WIDTH / MEDIA_VISUAL_HEIGHT / MEDIA_VISUAL_SIZE（空媒体固定 16:9 = 240×135）、
 *           isMediaVisualModality / isMediaVisualRecord（判定图片/视频块）、
 *           mediaVisualSizeForRatio（按素材长宽比定尺：最长边锚 240，横竖同一缩放因子），
 *           measureMediaVisualRatio（从可渲染 URL 读 naturalWidth / videoWidth 得到长宽比）。
 *           图片/视频块不支持 resize（白名单见 world-canvas/resize-policy），尺寸只由素材比例或空态 16:9 决定。
 * [POS]: lib/pomelo/world-canvas/blocks 的视觉媒体块尺寸策略（渲染器无关；canvas-store / resize-policy / 宿主共用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export const MEDIA_VISUAL_WIDTH = 240;
export const MEDIA_VISUAL_HEIGHT = 135; // 16:9
export const MEDIA_VISUAL_SIZE = { width: MEDIA_VISUAL_WIDTH, height: MEDIA_VISUAL_HEIGHT };

export type MediaVisualModality = "image" | "video";

/** 是否图片/视频模态（音频/文本不是视觉媒体，各有自己的固定尺寸）。 */
export function isMediaVisualModality(modality: unknown): modality is MediaVisualModality {
  return modality === "image" || modality === "video";
}

type RecordLike = { type?: string; attrs: Record<string, unknown> };

/** 是否视觉媒体块：独立媒体元素（type=media, modality=image|video）或媒体属性卡（free-element, elementKind=attr, attrMedia=image|video）。 */
export function isMediaVisualRecord(record: RecordLike | null | undefined): boolean {
  if (!record) return false;
  if (record.type === "media") return isMediaVisualModality(record.attrs.modality ?? "image");
  if (record.type === "free-element") {
    return String(record.attrs.elementKind ?? "") === "attr" && isMediaVisualModality(record.attrs.attrMedia);
  }
  return false;
}

/** 按素材长宽比定尺：最长边锚 240，横竖共用同一缩放因子（240 / max(素材宽, 素材高)）。
 *  旧策略「宽锚 240 + 高夹 [120,420]」对同分辨率的横竖素材给出不同缩放：1920×1080 → 240×135（0.125）、
 *  1080×1920 → 236×420（0.219），竖屏内容在画布上看起来大 1.7 倍；最长边锚定后横竖都是 240×135 / 135×240，
 *  同分辨率下缩放一致，混合比例的画布浏览起来大小才齐（空素材 16:9 = 240×135 即最长边 240，与之一致）。 */
export const MEDIA_VISUAL_LONG_SIDE = MEDIA_VISUAL_WIDTH;

export function mediaVisualSizeForRatio(ratio: number): { width: number; height: number } {
  if (ratio >= 1) return { width: MEDIA_VISUAL_LONG_SIDE, height: Math.max(1, Math.round(MEDIA_VISUAL_LONG_SIDE / ratio)) };
  return { width: Math.max(1, Math.round(MEDIA_VISUAL_LONG_SIDE * ratio)), height: MEDIA_VISUAL_LONG_SIDE };
}

/** 从可渲染 URL 读素材长宽比（图片 naturalSize / 视频 videoSize）；加载失败或尺寸未知返回 null。 */
export function measureMediaVisualRatio(src: string, modality: MediaVisualModality): Promise<number | null> {
  return new Promise((resolve) => {
    if (!src || typeof document === "undefined") {
      resolve(null);
      return;
    }
    if (modality === "image") {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : null);
      image.onerror = () => resolve(null);
      image.src = src;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => resolve(video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : null);
    video.onerror = () => resolve(null);
    video.src = src;
  });
}
