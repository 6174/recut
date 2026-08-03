/*
 * [INPUT]: 依赖 Zustand 全局 service 状态、endpoint 配置、Radix Popover 及 service 的 health、system status、self-update 与 restart HTTP API
 * [OUTPUT]: 对外提供 Header 内的 service 状态、版本、启动时间、非阻塞的醒目升级入口与重启确认浮层，并初始化唯一连接状态
 * [POS]: web/components 的跨页面 service 控制入口；由 HeaderActions 挂载，浮层经 Portal 脱离 Header 堆叠上下文
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { CheckCircle2, ChevronDown, CircleAlert, Download, FileText, RotateCw, Server, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isDefaultServiceEndpoint, isLocalWorkspace } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";

const latestVersion = process.env.NEXT_PUBLIC_RECUT_SERVICE_VERSION ?? "dev";
type Action = "restart" | "update" | null;

export function ServiceControl() {
  const service = useServiceStore((state) => state.service);
  const apiBase = useServiceStore((state) => state.endpoint);
  const refreshService = useServiceStore((state) => state.refresh);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<Action>(null);
  const [working, setWorking] = useState<Action>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refreshService();
    const timer = window.setInterval(() => void refreshService(), 5000);
    return () => window.clearInterval(timer);
  }, [apiBase, refreshService]);

  const online = service.phase === "online";
  const localEndpoint = isDefaultServiceEndpoint(apiBase);
  const updateAvailable = online && localEndpoint && isOlderVersion(service.version, latestVersion);
  const developmentService = service.version === "dev";
  async function run(action: Exclude<Action, null>) {
    setWorking(action); setMessage("");
    try {
      const response = await fetch(`${apiBase}/v1/system/${action}`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setConfirm(null);
      setMessage(action === "update" ? "已下载更新，正在确认 service 重启。" : "正在确认 service 重启。");
      const startedAt = await waitForRestart(apiBase, service.startedAt);
      if (!startedAt) throw new Error("15 秒内未确认 service 已重启");
      await refreshService();
      setMessage(`service 已于 ${formatStartedAt(startedAt)} 重启。`);
    } catch (cause) {
      setMessage(`${messageOf(cause)}。请将此信息交给 Codex、Claude Code 或 OpenCode 诊断。`);
    } finally { setWorking(null); }
  }

  const triggerClassName = updateAvailable
    ? "flex h-8 items-center gap-1.5 rounded-xs bg-primary px-2.5 font-sans text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring"
    : "flex h-8 items-center gap-2 rounded-xs px-2 font-mono text-[10px] text-muted-foreground transition hover:bg-muted hover:text-foreground";
  return <Popover onOpenChange={setOpen} open={open}>
    <PopoverTrigger asChild>
      <button aria-label={updateAvailable ? `升级本地 service 至 v${latestVersion}` : "管理 service"} className={triggerClassName} title={updateAvailable ? `发现 v${latestVersion} 更新` : undefined} type="button">
      <span className={online ? "size-1.5 rounded-full bg-success" : service.phase === "checking" ? "size-1.5 animate-pulse rounded-full bg-muted-foreground" : "size-1.5 rounded-full bg-warning"} />
      {updateAvailable ? <><Download className="size-3.5" /><span>更新 v{latestVersion}</span></> : <><span>{localEndpoint ? "LOCAL" : "REMOTE"} SERVICE {online ? service.version : service.phase === "checking" ? "CONNECTING" : "OFFLINE"}</span><ChevronDown className="size-3" /></>}
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" aria-label="service 管理" className="w-80 p-4 font-sans text-xs">
      <div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Server className="size-4" /></span><div><p className="font-medium">{localEndpoint ? "本地 service" : "远程 service"}</p><p className="mt-1 leading-4 text-muted-foreground">{online ? `当前版本 v${service.version}` : service.phase === "checking" ? "正在检查 service。" : isLocalWorkspace ? "本地工作台与 service 必须一同运行；请刷新页面或检查 service 日志。" : "尚未连接。可在设置中改为已有的远程地址。"}</p></div></div>
      <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground" title={apiBase}>{apiBase}</p>
      {online && service.startedAt && <p className="mt-1 text-[10px] text-muted-foreground">服务启动于 {formatStartedAt(service.startedAt)}</p>}
      {online ? <div className="mt-4 space-y-3 border-t pt-4"><a className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground" href={`${apiBase}/v1/system/logs`} rel="noreferrer" target="_blank"><FileText className="size-3.5" />查看 service 诊断日志</a>{!localEndpoint ? <p className="leading-4 text-muted-foreground">远程 service 的更新与重启由服务器管理员管理。</p> : developmentService ? <p className="flex gap-1.5 leading-4 text-muted-foreground"><Wrench className="mt-0.5 size-3 shrink-0" />开发模式由 <code>make service-dev</code> 管理，网页不能重启或升级。</p> : <><StatusRow active={!updateAvailable} label={updateAvailable ? `发现 v${latestVersion} 更新` : "已是当前发布版本"} /><div className="flex gap-2"><Button className="flex-1" disabled={!service.selfRestart || Boolean(working)} onClick={() => setConfirm("restart")} type="button" variant="outline"><RotateCw className="size-3.5" />重启</Button><Button className="flex-1" disabled={!updateAvailable || !service.selfUpdate || Boolean(working)} onClick={() => setConfirm("update")} type="button"><Download className="size-3.5" />升级</Button></div></>}</div> : service.phase === "offline" && localEndpoint && !isLocalWorkspace ? <div className="mt-4 border-t pt-4"><code className="block rounded-xs bg-muted p-2 text-[11px]">curl -fsSL https://recut.video/install.sh | sh</code></div> : null}
      {confirm && <div className="mt-4 rounded-xs border border-warning/35 bg-warning/10 p-3"><p className="font-medium">{confirm === "update" ? "确认升级本地 service？" : "确认重启本地 service？"}</p><p className="mt-1 leading-4 text-muted-foreground">{confirm === "update" ? "会下载已校验的发布包、替换 binary 并短暂重启服务。" : "会短暂中断本地 API，项目与数据不会丢失。"}</p><div className="mt-3 flex justify-end gap-2"><Button onClick={() => setConfirm(null)} type="button" variant="ghost">取消</Button><Button disabled={Boolean(working)} onClick={() => void run(confirm)} type="button">确认{confirm === "update" ? "升级" : "重启"}</Button></div></div>}
      {message && <p className="mt-3 flex gap-1.5 leading-4 text-muted-foreground"><Wrench className="mt-0.5 size-3 shrink-0" />{message}</p>}
    </PopoverContent>
  </Popover>;
}

function StatusRow({ active, label }: { active: boolean; label: string }) {
  const Icon = active ? CheckCircle2 : CircleAlert;
  return <p className={active ? "flex items-center gap-1.5 text-success" : "flex items-center gap-1.5 text-warning"}><Icon className="size-3.5" />{label}</p>;
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

async function waitForRestart(apiBase: string, previousStartedAt?: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    try {
      const response = await fetch(`${apiBase}/health`, { cache: "no-store" });
      const health = await response.json() as { startedAt?: string };
      if (response.ok && health.startedAt && health.startedAt !== previousStartedAt) return health.startedAt;
    } catch { /* 重启窗口内无法连接是预期状态。 */ }
  }
  return undefined;
}

function formatStartedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", hour12: false }).format(date);
}
