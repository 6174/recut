/*
 * [INPUT]: 依赖 recut-worlds-client（WorldEntity/WorldEvidence 类型）
 * [OUTPUT]: 对外提供 evidenceSource（证据 → 可渲染 URL；url 行经 /v1/files/remote 同源代理，
 * 让画布纹理等受 CORS 限制的消费者也能加载）、entityImageUrls（参考素材图片 → URL 列表，封面规则
 * B.6/B.9：identity 优先，其次 primary/appearance；archived 排除）、entityCoverMedia（头图解析：
 * 参考素材图片优先 → content 媒体属性兜底，kind=image|video）与 entityPhotoUrls（资料网格 URL，
 * 剔除已被用作头图的那张）
 * [POS]: worlds/[worldID]/canvas 的画布图片辅助（canvas-pomelo.tsx 组装 attrs，EntityCardBlock 渲染）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { WorldEntity, WorldEvidence } from "@/lib/recut-worlds-client";

// url 行经同代理端点回源（RemoteFileCache 校验公网地址并缓存，内容寻址幂等）
export function remoteProxySource(apiBase: string, url: string): string {
  return `${apiBase}/v1/files/remote?url=${encodeURIComponent(url)}`;
}

// 证据双源解析为可渲染 URL（asset 行走媒体库 content 流，url 行走同源代理）
export function evidenceSource(apiBase: string, item: WorldEvidence): string {
  if (item.source === "url" || (!item.assetId && item.url)) return item.url ? remoteProxySource(apiBase, item.url) : "";
  return item.assetId ? `${apiBase}/v1/media/assets/${encodeURIComponent(item.assetId)}/content` : "";
}

// 实体图片证据 → URL 列表（封面规则 B.6/B.9：identity 优先，其次 primary/appearance；archived 排除）
export function entityImageUrls(apiBase: string, entity: WorldEntity): string[] {
  const images = (entity.references ?? []).filter(
    (item) => item.modality === "image" && item.status !== "archived" && evidenceSource(apiBase, item),
  );
  const rank = (item: WorldEvidence) =>
    (item.purpose === "identity" ? 0 : 10) + (item.status === "primary" ? 0 : 1) * 2 + (item.purpose === "appearance" ? 0 : 1);
  return images.sort((a, b) => rank(a) - rank(b)).map((item) => evidenceSource(apiBase, item));
}

// 头图媒体：image | video（video 走视频纹理加载）
export type CoverMedia = { url: string; kind: "image" | "video" };

// content 媒体属性值（AssetFieldRow 约定 {assetId,name,kind}）→ 头图媒体；容错兼容 url 字段
function contentCoverMedia(apiBase: string, value: unknown): CoverMedia | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const assetId = typeof record.assetId === "string" ? record.assetId : "";
  const url = typeof record.url === "string" ? record.url : "";
  const kind = record.kind === "video" ? "video" : record.kind === "image" ? "image" : null;
  if (!kind) return null;
  const source = assetId
    ? `${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}/content`
    : url
      ? remoteProxySource(apiBase, url)
      : "";
  return source ? { url: source, kind } : null;
}

// 实体卡资料网格 URL：参考素材图片去掉已被用作头图的那张；头图来自属性兜底时保留全部
export function entityPhotoUrls(apiBase: string, entity: WorldEntity): string[] {
  const cover = entityCoverMedia(apiBase, entity);
  const urls = entityImageUrls(apiBase, entity);
  if (cover && cover.kind === "image") return urls.filter((url) => url !== cover.url);
  return urls;
}

// 实体头图解析：① 参考素材图片（identity/primary 优先）② content 媒体属性（image 先于 video）。
// 参考素材可能随时被移除，属性兜底保证卡片头图稳定（B.6 封面规则扩展）。
export function entityCoverMedia(apiBase: string, entity: WorldEntity): CoverMedia | null {
  const [firstImage] = entityImageUrls(apiBase, entity);
  if (firstImage) return { url: firstImage, kind: "image" };
  const fromContent: CoverMedia[] = [];
  for (const value of Object.values(entity.content ?? {})) {
    const media = contentCoverMedia(apiBase, value);
    if (media) fromContent.push(media);
  }
  return fromContent.find((item) => item.kind === "image") ?? fromContent[0] ?? null;
}
