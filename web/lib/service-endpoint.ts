/*
 * [INPUT]: 依赖构建时的工作台模式、默认 Daemon 端口与浏览器地址
 * [OUTPUT]: 对外提供 service endpoint 的默认值、工作台模式、格式校验与短请求隔离的事件流地址能力
 * [POS]: web/lib 的 service 连接配置边界；嵌入模式固定同源，LAN 开发模式使用当前主机的 service 端口，Cloudflare 模式可持久化本地或远程 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const workspaceMode = process.env.NEXT_PUBLIC_RECUT_WORKSPACE_MODE ?? "cloud";
export const isLocalWorkspace = workspaceMode === "local";
export const isLANWorkspace = workspaceMode === "lan";

const localOrigin = typeof window === "undefined" ? "" : window.location.origin;
const servicePort = process.env.NEXT_PUBLIC_RECUT_API_PORT ?? "17373";
const lanServiceOrigin = localOrigin ? new URL(localOrigin) : null;
if (lanServiceOrigin) lanServiceOrigin.port = servicePort;
export const defaultServiceEndpoint = isLocalWorkspace && localOrigin ? localOrigin
  : isLANWorkspace && lanServiceOrigin ? lanServiceOrigin.origin
    : process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";

export function normalizeServiceEndpoint(value: string) {
  const endpoint = new URL(value.trim());
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("仅支持 http 或 https 地址");
  if (endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("请输入 service 根地址，例如 https://recut.example.com");
  return endpoint.origin;
}

export function isDefaultServiceEndpoint(endpoint: string) {
  return endpoint === defaultServiceEndpoint;
}

// 本机 service 把 SSE/WebSocket 放到相邻端口，避免浏览器的 HTTP/1.1
// 长连接占满 API origin 的连接池。远程或自定义端口保持原地址，兼容已有部署。
export function streamServiceEndpoint(endpoint: string) {
  const streamEndpoint = new URL(endpoint);
  if (streamEndpoint.port === "17373") streamEndpoint.port = "17374";
  return streamEndpoint.origin;
}
