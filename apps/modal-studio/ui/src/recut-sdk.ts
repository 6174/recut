/**
 * [INPUT]: 依赖宿主注入的 MessageChannel 与独立 App workspace scope
 * [OUTPUT]: 对外提供 App operation 调用（background.call）、状态查询、右侧 Agent 输入回填、全局素材选择/图片全屏预览（media.pick / media.preview）、UI 语言读取与深链 taskId 读取的 iframe SDK
 * [POS]: ui/src 的宿主通信边界；组件不直接读写 App SQLite 或执行本机命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useState } from "react";

type RequestType = "state.query" | "background.call" | "agent.compose" | "media.pick" | "image.preview";

export type Locale = "zh" | "en";

export function getRecutLocale(): Locale {
  const fromURL = new URLSearchParams(location.search).get("locale");
  if (fromURL === "zh" || fromURL === "en") return fromURL;
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function useRecutLocale(): Locale {
  const [locale] = useState<Locale>(getRecutLocale);
  return locale;
}

// 深链：宿主在 iframe URL 上带 ?taskId= 时（素材库「生成任务」入口），
// App 首屏应直接选中该任务记录；无则返回空串，保持既有恢复/空态行为。
export function getRecutTaskId(): string {
  return new URLSearchParams(location.search).get("taskId") ?? "";
}

export function isRecutConnected(): boolean {
  return port !== null;
}

let port: MessagePort | null = null;
let sequence = 0;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();

function call(type: RequestType, input: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    if (!port) return reject(new Error("Recut Host 尚未连接"));
    const id = `modal-${Date.now().toString(36)}-${++sequence}`;
    pending.set(id, { resolve, reject });
    port.postMessage({ id, type, input });
  });
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "recut.project.event") {
    window.dispatchEvent(new CustomEvent("recut-project-event", { detail: event.data.event }));
    return;
  }
  if (event.data?.type !== "recut.ui.connect" || !event.ports[0]) return;
  port = event.ports[0];
  port.onmessage = (message) => {
    const request = pending.get(message.data?.id);
    if (!request) return;
    pending.delete(message.data.id);
    message.data.error ? request.reject(new Error(message.data.error)) : request.resolve(message.data.result);
  };
  port.start();
  window.dispatchEvent(new Event("recut-sdk-ready"));
});

export const recut = {
  state: { query: (name: string) => call("state.query", { name }) },
  background: { call: (operation: string, input: Record<string, unknown> = {}) => call("background.call", { operation, ...input }) },
  agent: { compose: (prompt: string) => call("agent.compose", { prompt }) },
  media: {
    pick: (kinds: string[], options: { multiple?: boolean; selectedIDs?: string[] } = {}) => call("media.pick", { kinds, ...options }),
    preview: (url: string, options: { name?: string } = {}) => call("image.preview", { url, ...options }),
  },
  events: {
    subscribe: (listener: (event: unknown) => void) => {
      const handler = (event: Event) => listener((event as CustomEvent).detail);
      window.addEventListener("recut-project-event", handler);
      return () => window.removeEventListener("recut-project-event", handler);
    },
  },
};
