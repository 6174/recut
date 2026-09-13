/*
 * [INPUT]: 依赖 recut-worlds-client（WorldEntity/WorldEvidence 类型）与 canvas/entity-attrs 辅助
 * [OUTPUT]: 对外提供 remoteProxySource（远程 URL 同源代理）、evidenceSource（旧证据 → 可渲染 URL，
 * references 为 legacy 只读投影仍可渲染）、entityImageUrls（旧证据图片 URL，B.6 封面规则）、
 * entityMediaUrls（media 属性 assetId → URL 列表）、entityCoverMedia（头图解析：显式 background media
 * 属性优先 → 其余 media 属性 kind=image → kind=video）与 entityPhotoUrls（资料网格 URL，
 * 头图取自非 background 属性时剔除那张）
 * [POS]: worlds/[worldID]/canvas 的画布图片辅助（canvas-pomelo.tsx 组装 attrs，EntityCardBlockV 渲染）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { WorldEntity, WorldEvidence } from "@/lib/recut-worlds-client";
import { attrMediaValueOf, attrOf, entityMediaAttrs } from "./entity-attrs";

// url 行经同代理端点回源（RemoteFileCache 校验公网地址并缓存，内容寻址幂等）
export function remoteProxySource(apiBase: string, url: string): string {
  return `${apiBase}/v1/files/remote?url=${encodeURIComponent(url)}`;
}

// 旧证据双源解析为可渲染 URL（asset 行走媒体库 content 流，url 行走同源代理；references 为 legacy 只读）
export function evidenceSource(apiBase: string, item: WorldEvidence): string {
  if (item.source === "url" || (!item.assetId && item.url)) return item.url ? remoteProxySource(apiBase, item.url) : "";
  return item.assetId ? `${apiBase}/v1/media/assets/${encodeURIComponent(item.assetId)}/content` : "";
}

// 旧证据图片 → URL 列表（legacy 只读投影；identity 优先，其次 primary/appearance；archived 排除）
export function entityImageUrls(apiBase: string, entity: WorldEntity): string[] {
  const images = (entity.references ?? []).filter(
    (item) => item.modality === "image" && item.status !== "archived" && evidenceSource(apiBase, item),
  );
  const rank = (item: WorldEvidence) =>
    (item.purpose === "identity" ? 0 : 10) + (item.status === "primary" ? 0 : 1) * 2 + (item.purpose === "appearance" ? 0 : 1);
  return images.sort((a, b) => rank(a) - rank(b)).map((item) => evidenceSource(apiBase, item));
}

// media 属性值 → 可渲染 URL（assetId 走媒体库 content 流）
export function mediaAttrSource(apiBase: string, assetId: string): string {
  return `${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}/content`;
}

// media 属性 assetId → URL 列表（统一 Entity 模型：实体素材 = media 属性）
export function entityMediaUrls(apiBase: string, entity: WorldEntity): string[] {
  return entityMediaAttrs(entity)
    .map((attr) => attrMediaValueOf(entity, attr.key))
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .map((value) => mediaAttrSource(apiBase, value.assetId));
}

// 头图媒体：image | video（video 走视频纹理加载）
export type CoverMedia = { url: string; kind: "image" | "video" };

// 实体卡资料网格 URL：头图取自非 background 属性时剔除那张；background 封面不占资料格
export function entityPhotoUrls(apiBase: string, entity: WorldEntity): string[] {
  const cover = entityCoverMedia(apiBase, entity);
  const background = attrOf(entity, "background");
  const urls = entityMediaUrls(apiBase, entity);
  if (cover && cover.kind === "image" && !background) return urls.filter((url) => url !== cover.url);
  return urls;
}

// 实体头图解析（统一 Entity 模型）：① 显式 background media 属性 ② 其余 media 属性（image 先于 video）。
// TODO(RFC 背景): 卡片背景默认以实体 media 属性（image/video）做 6–8s 慢轮播、background 属性覆盖为
// 静态单图；轮播需要 EntityCardBlockV 提供 ticker/时间驱动重绘，当前 render 契约为静态单次绘制，
// 故先落 cover fallback + 资料格，轮播在 EntityCardBlockV.renderBlock 的头图段接入。
export function entityCoverMedia(apiBase: string, entity: WorldEntity): CoverMedia | null {
  const background = attrMediaValueOf(entity, "background");
  const values = entityMediaAttrs(entity)
    .map((attr) => attrMediaValueOf(entity, attr.key))
    .filter((value): value is NonNullable<typeof value> => value !== null);
  if (background) values.unshift(background);
  const pick = (kind: "image" | "video") => values.find((value) => value.kind === kind);
  const chosen = pick("image") ?? pick("video");
  if (!chosen) {
    // legacy 兜底：旧证据图片（references 只读投影随时可能被移除）
    const [firstImage] = entityImageUrls(apiBase, entity);
    return firstImage ? { url: firstImage, kind: "image" } : null;
  }
  return { url: mediaAttrSource(apiBase, chosen.assetId), kind: chosen.kind === "video" ? "video" : "image" };
}
