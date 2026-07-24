/**
 * [INPUT]: 依赖 Host 注入的 MessageChannel
 * [OUTPUT]: 对外提供 iframe React UI 的 recut UI SDK
 * [POS]: vox-broll 的 UI 通信边界；业务 UI 不直接 fetch、访问终端或 SQLite
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
type Request = { id: string; type: "state.query" | "background.call" | "agent.send"; input: Record<string, unknown> };
let port: MessagePort | null = null;
const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();

window.addEventListener("message", (event) => {
  if (event.data?.type !== "recut.ui.connect" || !event.ports[0]) return;
  port = event.ports[0];
  port.onmessage = (message) => {
    const request = pending.get(message.data?.id);
    if (!request) return;
    pending.delete(message.data.id);
    if (message.data.error) request.reject(new Error(message.data.error)); else request.resolve(message.data.result);
  };
  port.start();
  window.dispatchEvent(new Event("recut-sdk-ready"));
});

function call(type: Request["type"], input: Record<string, unknown>) {
  return new Promise<any>((resolve, reject) => {
    const id = crypto.randomUUID();
    if (!port) return reject(new Error("Recut Host 尚未连接"));
    pending.set(id, { resolve, reject });
    port.postMessage({ id, type, input } satisfies Request);
  });
}

export const recut = {
  state: { query: (name: string) => call("state.query", { name }) },
  background: { call: (name: string, input: Record<string, unknown>) => call("background.call", { name, ...input }) },
  agent: { send: (input: { prompt: string }) => call("agent.send", input) },
};
