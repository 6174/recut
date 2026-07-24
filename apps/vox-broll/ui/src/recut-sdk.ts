/**
 * [INPUT]: 依赖 Host 注入的 MessageChannel
 * [OUTPUT]: 对外提供 iframe React UI 的 recut UI SDK 与项目事件订阅
 * [POS]: vox-broll 的 UI 通信边界；业务 UI 不直接 fetch、访问终端或 SQLite，实时事件由宿主转发
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
type Request = { id: string; type: "state.query" | "background.call" | "agent.send"; input: Record<string, unknown> };
let port: MessagePort | null = null;
const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();

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
  events: { subscribe: (listener: (event: unknown) => void) => {
    const receive = (event: Event) => listener((event as CustomEvent<unknown>).detail);
    window.addEventListener("recut-project-event", receive);
    return () => window.removeEventListener("recut-project-event", receive);
  } },
};
