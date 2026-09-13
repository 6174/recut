/*
 * [INPUT]: 依赖 recut-worlds-client 的 EntityAttrMediaValue（{assetId|url} 双源 + recipe）
 * [OUTPUT]: 对外提供世界媒体引用的唯一解析点：resolveMediaSrc(apiBase, ref) → 可渲染 src
 *           （asset 走媒体库 content 流；应用内 url 走 /v1/files/remote 同源代理保纹理可读；官网无 service 时直连），
 *           以及 remoteProxySource / resolveMediaPropsSrc 辅助。
 * [POS]: web/lib 的世界媒体适配层（canvas 渲染、详情面板、实体卡、官网预览共用）；数据→render 边界只在此解析一次，
 *        pomelo block 与 vello adapter 只接收已解析好的 URL。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { EntityAttrMediaValue } from "./recut-worlds-client";

/** 远程 URL 同源代理端点：公网资源 → 本地同源可加载（RemoteFileCache 校验 + 内容寻址缓存）。 */
export function remoteProxySource(apiBase: string, url: string): string {
  return `${apiBase}/v1/files/remote?url=${encodeURIComponent(url)}`;
}

/** 回环地址：本地验证用的静态 CDN（127.0.0.1/localhost）——同源直连，不走会拒绝内网的代理。 */
function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * 把世界媒体引用解析为可渲染 src。约定：
 * - assetId → 媒体库 content 流（依赖 service 运行）；
 * - url + 应用内 service → 同源代理（RemoteFileCache 校验/缓存，规避 canvas 纹理 CORS）；
 * - url 为回环/同源（本地验证）或无 service（官网静态）→ 直连（本地静态服务与 CDN 均带 CORS）；
 * - 无有效引用 → ""。
 */
export function resolveMediaSrc(apiBase: string | undefined, ref: EntityAttrMediaValue | null | undefined): string {
  if (!ref) return "";
  if (ref.url) {
    if (!apiBase) return ref.url;
    if (isLoopbackUrl(ref.url)) return ref.url;
    if (typeof window !== "undefined" && ref.url.startsWith(window.location.origin)) return ref.url;
    return remoteProxySource(apiBase, ref.url);
  }
  if (ref.assetId && apiBase) {
    return `${apiBase}/v1/media/assets/${encodeURIComponent(ref.assetId)}/content`;
  }
  return "";
}

/** 画布元素 props（{assetId|url}）→ 可渲染 src。 */
export function resolveMediaPropsSrc(apiBase: string | undefined, props: { assetId?: string; url?: string } | null | undefined): string {
  if (!props) return "";
  return resolveMediaSrc(apiBase, { assetId: props.assetId, url: props.url });
}
