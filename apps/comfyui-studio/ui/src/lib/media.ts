/**
 * [INPUT]: 依赖浏览器 location
 * [OUTPUT]: 对外提供素材内容路径 mediaContentPath、素材内容绝对地址 mediaContentURL 与通用绝对地址 absoluteURL
 * [POS]: ui/src 的媒体地址边界；组件不各自拼 /v1/media 路径，传给宿主的地址必须是绝对地址
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export function mediaContentPath(assetId: string): string {
  return `/v1/media/assets/${encodeURIComponent(assetId)}/content`;
}

export function absoluteURL(path: string): string {
  try {
    return new URL(path, location.href).href;
  } catch {
    return path;
  }
}

export function mediaContentURL(assetId: string): string {
  return absoluteURL(mediaContentPath(assetId));
}
