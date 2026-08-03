/**
 * [INPUT]: 依赖宿主注入的 MessageChannel 与独立 App workspace scope
 * [OUTPUT]: 对外提供 App operation、平台素材选择与右侧 Agent 请求的 iframe SDK
 * [POS]: ui/src 的宿主通信边界；组件不直接读写 App SQLite 或执行本机命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
type RequestType = "state.query" | "background.call" | "agent.send" | "media.pick";
let port: MessagePort | null = null;
let sequence = 0;
const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: Error) => void }>();

function call(type: RequestType, input: Record<string, unknown>) {
  return new Promise<any>((resolve, reject) => {
    if (!port) return reject(new Error("Recut Host 尚未连接"));
    const id = `depth-${Date.now().toString(36)}-${++sequence}`;
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
  background: { call: (name: string, input: Record<string, unknown> = {}) => call("background.call", { name, ...input }) },
  agent: { send: (prompt: string) => call("agent.send", { prompt }) },
  media: { pick: (kinds: string[]) => call("media.pick", { kinds }) },
  events: { subscribe: (listener: (event: unknown) => void) => { const handler = (event: Event) => listener((event as CustomEvent).detail); window.addEventListener("recut-project-event", handler); return () => window.removeEventListener("recut-project-event", handler); } },
};
