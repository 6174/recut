/*
 * [INPUT]: 依赖构建时的默认 Daemon 地址
 * [OUTPUT]: 对外提供 service endpoint 的默认值、校验与本地地址判断能力
 * [POS]: web/lib 的 service 连接配置边界；持久化与运行时状态统一由 service-store 管理
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const defaultServiceEndpoint = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";

export function normalizeServiceEndpoint(value: string) {
  const endpoint = new URL(value.trim());
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("仅支持 http 或 https 地址");
  if (endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("请输入 service 根地址，例如 https://recut.example.com");
  return endpoint.origin;
}

export function isDefaultServiceEndpoint(endpoint: string) {
  return endpoint === defaultServiceEndpoint;
}
