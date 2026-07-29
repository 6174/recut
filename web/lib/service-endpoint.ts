/*
 * [INPUT]: 依赖浏览器 localStorage 与构建时的默认 Daemon 地址
 * [OUTPUT]: 对外提供 service endpoint 的读取、校验、保存与重置能力
 * [POS]: web/lib 的 service 连接配置边界；所有 HTTP、SSE 与 WebSocket 调用从此取得同一个地址
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

const storageKey = "recut.service-endpoint";
const defaultEndpoint = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";

export function getServiceEndpoint() {
  if (typeof window === "undefined") return defaultEndpoint;
  return window.localStorage.getItem(storageKey) ?? defaultEndpoint;
}

export function normalizeServiceEndpoint(value: string) {
  const endpoint = new URL(value.trim());
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("仅支持 http 或 https 地址");
  if (endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("请输入 service 根地址，例如 https://recut.example.com");
  return endpoint.origin;
}

export function saveServiceEndpoint(value: string) {
  const endpoint = normalizeServiceEndpoint(value);
  window.localStorage.setItem(storageKey, endpoint);
  return endpoint;
}

export function resetServiceEndpoint() {
  window.localStorage.removeItem(storageKey);
  return defaultEndpoint;
}

export function isDefaultServiceEndpoint(endpoint = getServiceEndpoint()) {
  return endpoint === defaultEndpoint;
}
