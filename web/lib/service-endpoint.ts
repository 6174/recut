/*
 * [INPUT]: 依赖构建时的工作台模式、默认 Daemon 端口与浏览器地址，以及 i18n 的 locale 真相（Accept-Language 传递）
 * [OUTPUT]: 对外提供 service endpoint 的默认值、工作台模式、格式校验、短请求隔离的事件流地址能力、统一请求头与 JSON 包装（204 等空 body 成功响应返回 null）
 * [POS]: web/lib 的 service 连接配置边界；嵌入模式固定同源，LAN 开发模式使用当前主机的 service 端口，Cloudflare 模式可持久化本地或远程 service；recutHeaders/fetchRecutJSON 为全部 /v1 请求附加 Accept-Language
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useLocaleStore } from "./i18n/locale-store";
import { t } from "./i18n/index";
import { interpolate } from "./i18n/workspace-dict";

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
  const locale = useLocaleStore.getState().locale;
  const endpoint = new URL(value.trim());
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error(t("workspace", locale, "endpoint.error.protocol"));
  if (endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error(t("workspace", locale, "endpoint.error.format"));
  return endpoint.origin;
}

// 统一请求头：为全部 /v1 请求附加当前工作台语言的 Accept-Language（D8 的 service 端入口）。
export function recutHeaders(localeOverride?: import("./i18n/locales").Locale): Record<string, string> {
  const locale = localeOverride ?? useLocaleStore.getState().locale;
  return { "Accept-Language": locale };
}

export type RecutRequestOptions = {
  // 失败时按此 label 生成本地化「{label}读取失败（{status}）」并保留服务端原因。
  labelKey?: string;
  // 失败时直接使用此本地化信息作为前缀，并保留服务端原因。
  messageKey?: string;
};

// 轻量 JSON 包装：自动附加 Accept-Language，禁用缓存；失败时本地化消息并保留服务端原因。204 等空 body 的成功响应返回 null。
export async function fetchRecutJSON<T>(endpoint: string, path: string, init?: RequestInit, options?: RecutRequestOptions): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    cache: "no-store",
    ...init,
    headers: { ...recutHeaders(), ...(init?.headers ?? {}) },
  });
  if (response.ok) {
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  const locale = useLocaleStore.getState().locale;
  const body = await response.json().catch(() => ({})) as { error?: string };
  const reason = body.error ?? response.statusText ?? t("workspace", locale, "store.noReason");
  let base: string;
  if (options?.messageKey) base = t("workspace", locale, options.messageKey);
  else if (options?.labelKey) base = interpolate(t("workspace", locale, "store.read.failed"), { label: t("workspace", locale, options.labelKey), status: response.status });
  else base = interpolate(t("workspace", locale, "store.request.failed"), { status: response.status });
  throw new Error(`${base}：${reason}`);
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
