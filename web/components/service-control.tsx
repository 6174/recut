/*
 * [INPUT]: 依赖本地 service 的 health、system status、self-update 与 restart HTTP API
 * [OUTPUT]: 对外提供固定在工作台右上角的 service 状态、版本、升级与重启确认 popover
 * [POS]: web/components 的跨页面本地 service 控制入口；由根布局挂载，不能依赖任一业务页面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { CheckCircle2, ChevronDown, CircleAlert, Download, RotateCw, Server, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
const latestVersion = process.env.NEXT_PUBLIC_RECUT_SERVICE_VERSION ?? "dev";
type ServiceState = { online: boolean; version: string; selfUpdate: boolean; selfRestart: boolean };
type Action = "restart" | "update" | null;

export function ServiceControl() {
  const [service, setService] = useState<ServiceState>({ online: false, version: "—", selfUpdate: false, selfRestart: false });
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<Action>(null);
  const [working, setWorking] = useState<Action>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadService(setService);
    const timer = window.setInterval(() => void loadService(setService), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const updateAvailable = service.online && isOlderVersion(service.version, latestVersion);
  async function run(action: Exclude<Action, null>) {
    setWorking(action); setMessage("");
    try {
      const response = await fetch(`${apiBase}/v1/system/${action}`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setMessage(action === "update" ? "已下载更新，service 正在重启。" : "service 正在重启。");
      setConfirm(null);
      window.setTimeout(() => void loadService(setService), 1800);
    } catch (cause) {
      setMessage(`${messageOf(cause)}。请将此信息交给 Codex 或 Claude Code 诊断。`);
    } finally { setWorking(null); }
  }

  return <div className="fixed right-16 top-3 z-40 font-mono text-[10px]">
    <button aria-expanded={open} aria-haspopup="dialog" className="flex h-8 items-center gap-2 rounded-xs border bg-card px-2.5 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground" onClick={() => setOpen((current) => !current)} type="button">
      <span className={service.online ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-warning"} />
      <span>LOCAL SERVICE {service.online ? service.version : "OFFLINE"}</span><ChevronDown className="size-3" />
    </button>
    {open && <div aria-label="本地 service 管理" className="absolute right-0 top-10 w-80 rounded-sm border bg-card p-4 font-sans text-xs shadow-[var(--shadow-overlay)]" role="dialog">
      <div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Server className="size-4" /></span><div><p className="font-medium">本地 service</p><p className="mt-1 leading-4 text-muted-foreground">{service.online ? `当前版本 v${service.version}` : "尚未连接。安装后项目与素材会保留在本机。"}</p></div></div>
      {service.online ? <div className="mt-4 space-y-3 border-t pt-4"><StatusRow active={!updateAvailable} label={updateAvailable ? `发现 v${latestVersion} 更新` : "已是当前发布版本"} /><div className="flex gap-2"><Button className="flex-1" disabled={!service.selfRestart || Boolean(working)} onClick={() => setConfirm("restart")} type="button" variant="outline"><RotateCw className="size-3.5" />重启</Button><Button className="flex-1" disabled={!updateAvailable || !service.selfUpdate || Boolean(working)} onClick={() => setConfirm("update")} type="button"><Download className="size-3.5" />升级</Button></div></div> : <div className="mt-4 border-t pt-4"><code className="block rounded-xs bg-muted p-2 text-[11px]">curl -fsSL https://recut.video/install.sh | sh</code></div>}
      {confirm && <div className="mt-4 rounded-xs border border-warning/35 bg-warning/10 p-3"><p className="font-medium">{confirm === "update" ? "确认升级本地 service？" : "确认重启本地 service？"}</p><p className="mt-1 leading-4 text-muted-foreground">{confirm === "update" ? "会下载已校验的发布包、替换 binary 并短暂重启服务。" : "会短暂中断本地 API，项目与数据不会丢失。"}</p><div className="mt-3 flex justify-end gap-2"><Button onClick={() => setConfirm(null)} type="button" variant="ghost">取消</Button><Button disabled={Boolean(working)} onClick={() => void run(confirm)} type="button">确认{confirm === "update" ? "升级" : "重启"}</Button></div></div>}
      {message && <p className="mt-3 flex gap-1.5 leading-4 text-muted-foreground"><Wrench className="mt-0.5 size-3 shrink-0" />{message}</p>}
    </div>}
  </div>;
}

function StatusRow({ active, label }: { active: boolean; label: string }) {
  const Icon = active ? CheckCircle2 : CircleAlert;
  return <p className={active ? "flex items-center gap-1.5 text-success" : "flex items-center gap-1.5 text-warning"}><Icon className="size-3.5" />{label}</p>;
}

async function loadService(setService: (state: ServiceState) => void) {
  try {
    const [health, status] = await Promise.all([fetch(`${apiBase}/health`, { cache: "no-store" }), fetch(`${apiBase}/v1/system/status`, { cache: "no-store" })]);
    if (!health.ok) throw new Error();
    const healthBody = await health.json() as { version?: string };
    const statusBody = status.ok ? await status.json() as { selfUpdate?: boolean; selfRestart?: boolean } : {};
    setService({ online: true, version: healthBody.version ?? "unknown", selfUpdate: Boolean(statusBody.selfUpdate), selfRestart: Boolean(statusBody.selfRestart) });
  } catch { setService({ online: false, version: "—", selfUpdate: false, selfRestart: false }); }
}

function isOlderVersion(installed: string, latest: string) {
  if (!installed || installed === "dev" || latest === "dev") return false;
  const parse = (value: string) => value.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(installed); const expected = parse(latest);
  for (const index of [0, 1, 2]) { if (current[index] < expected[index]) return true; if (current[index] > expected[index]) return false; }
  return false;
}

async function responseMessage(response: Response) { const body = await response.json().catch(() => ({})) as { error?: string }; return body.error ?? `请求失败（${response.status}）`; }
function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : "未知错误"; }
