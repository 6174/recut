/*
 * [INPUT]: 依赖 Zustand 全局 service 状态、endpoint 配置、service 的 health、system status、self-update 与 restart HTTP API、工作台 i18n 字典
 * [OUTPUT]: 对外提供设置内 Service 状态内容（状态、版本、启动时间、诊断日志、本地重启/升级确认）与共享的 service 状态读取、更新判断与连接轮询
 * [POS]: web/components 的 service 状态展示层；由 SettingsPanel 的 Service 分类渲染，状态轮询与更新判断同时供 Header 设置入口与状态页复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { CheckCircle2, CircleAlert, Download, FileText, RotateCw, Server, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { t, useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { useLocaleStore } from "@/lib/i18n/locale-store";
import { isDefaultServiceEndpoint, isLocalWorkspace, recutHeaders } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";

export const latestVersion = process.env.NEXT_PUBLIC_RECUT_SERVICE_VERSION ?? "dev";
type Action = "restart" | "update" | null;

// service 状态的唯一连接轮询入口：设置入口与状态页共用，挂载一次即维持 endpoint 的刷新节奏。
export function useServicePolling() {
  const apiBase = useServiceStore((state) => state.endpoint);
  const refreshService = useServiceStore((state) => state.refresh);
  useEffect(() => {
    void refreshService();
    const timer = window.setInterval(() => void refreshService(), 30000);
    return () => window.clearInterval(timer);
  }, [apiBase, refreshService]);
}

export function useServiceStatus() {
  const service = useServiceStore((state) => state.service);
  const apiBase = useServiceStore((state) => state.endpoint);
  const online = service.phase === "online";
  const localEndpoint = isDefaultServiceEndpoint(apiBase);
  return {
    service,
    apiBase,
    online,
    localEndpoint,
    updateAvailable: online && localEndpoint && isOlderVersion(service.version, latestVersion),
    developmentService: service.version === "dev",
  };
}

export function ServiceStatusSettings() {
  const { t } = useI18n();
  const { service, apiBase, online, localEndpoint, updateAvailable, developmentService } = useServiceStatus();
  const refreshService = useServiceStore((state) => state.refresh);
  const [confirm, setConfirm] = useState<Action>(null);
  const [working, setWorking] = useState<Action>(null);
  const [message, setMessage] = useState("");

  async function run(action: Exclude<Action, null>) {
    setWorking(action); setMessage("");
    try {
      const response = await fetch(`${apiBase}/v1/system/${action}`, { method: "POST", headers: recutHeaders() });
      if (!response.ok) throw new Error(await responseMessage(response));
      setConfirm(null);
      setMessage(action === "update" ? t("service.updated.restarting") : t("service.restarting"));
      const startedAt = await waitForRestart(apiBase, service.startedAt);
      if (!startedAt) throw new Error(t("service.restart.timeout"));
      await refreshService();
      setMessage(interpolate(t("service.restarted.at"), { time: formatStartedAt(startedAt) }));
    } catch (cause) {
      setMessage(`${messageOf(cause)}。${t("service.diag.suffix")}`);
    } finally { setWorking(null); }
  }

  return <section className="max-w-2xl rounded-md bg-foreground/5 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Server className="size-4" /></span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{localEndpoint ? t("service.local") : t("service.remote")}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-foreground/70" title={apiBase}>{apiBase}</p>
          {online ? service.startedAt && <p className="mt-1 text-[11px] text-foreground/70">{interpolate(t("service.startedAt"), { time: formatStartedAt(service.startedAt) })}</p>
            : <p className="mt-1 text-xs leading-5 text-foreground/70">{service.phase === "checking" ? t("service.checking") : isLocalWorkspace ? t("service.offline.local") : t("service.offline.remote")}</p>}
        </div>
      </div>
      <StatusPill online={online} phase={service.phase} version={service.version} />
    </div>
    {online && <div className="mt-4 space-y-3">
      <a className="flex items-center gap-1.5 text-xs text-foreground/80 transition-colors hover:text-foreground" href={`${apiBase}/v1/system/logs`} rel="noreferrer" target="_blank"><FileText className="size-3.5" />{t("service.logs")}</a>
      {!localEndpoint ? <p className="text-xs leading-5 text-foreground/70">{t("service.remoteManaged")}</p>
        : developmentService ? <p className="flex gap-1.5 text-xs leading-5 text-foreground/70"><Wrench className="mt-0.5 size-3 shrink-0" />{interpolate(t("service.devManaged"), { code: "make service-dev" })}</p>
        : <><StatusRow active={!updateAvailable} label={updateAvailable ? interpolate(t("service.upgrade.title"), { version: latestVersion }) : t("service.version.current")} /><div className="flex flex-wrap gap-2"><Button disabled={!service.selfRestart || Boolean(working)} onClick={() => setConfirm("restart")} type="button" variant="outline"><RotateCw className="size-3.5" />{t("service.restart")}</Button><Button disabled={!updateAvailable || !service.selfUpdate || Boolean(working)} onClick={() => setConfirm("update")} type="button"><Download className="size-3.5" />{t("service.upgrade")}</Button></div></>}
    </div>}
    {confirm && <div className="mt-4 rounded-xs border border-warning/35 bg-warning/10 p-3"><p className="text-xs font-medium">{confirm === "update" ? t("service.update.confirm.title") : t("service.restart.confirm.title")}</p><p className="mt-1 text-xs leading-5 text-foreground/80">{confirm === "update" ? t("service.update.confirm.desc") : t("service.restart.confirm.desc")}</p><div className="mt-3 flex justify-end gap-2"><Button onClick={() => setConfirm(null)} type="button" variant="ghost">{t("service.cancel")}</Button><Button disabled={Boolean(working)} onClick={() => void run(confirm)} type="button">{confirm === "update" ? t("service.confirm.update") : t("service.confirm.restart")}</Button></div></div>}
    {message && <p className="mt-3 flex gap-1.5 text-xs leading-5 text-foreground/80" role="status"><Wrench className="mt-0.5 size-3 shrink-0" />{message}</p>}
  </section>;
}

function StatusPill({ online, phase, version }: { online: boolean; phase: "checking" | "online" | "offline"; version: string }) {
  const { t } = useI18n();
  const tone = online ? "bg-success/10 text-success" : phase === "checking" ? "bg-foreground/10 text-foreground/70" : "bg-warning/10 text-warning";
  const dot = online ? "bg-success" : phase === "checking" ? "animate-pulse bg-muted-foreground" : "bg-warning";
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ${tone}`}><span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />{online ? t("service.status.online") : phase === "checking" ? t("service.status.checking") : t("service.status.offline")}{online && <span className="font-mono font-normal opacity-75">v{version}</span>}</span>;
}

function StatusRow({ active, label }: { active: boolean; label: string }) {
  const Icon = active ? CheckCircle2 : CircleAlert;
  return <p className={active ? "flex items-center gap-1.5 text-xs text-success" : "flex items-center gap-1.5 text-xs text-warning"}><Icon className="size-3.5" />{label}</p>;
}

export function isOlderVersion(installed: string, latest: string) {
  if (!installed || installed === "dev" || latest === "dev") return false;
  const parse = (value: string) => value.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(installed); const expected = parse(latest);
  for (const index of [0, 1, 2]) { if (current[index] < expected[index]) return true; if (current[index] > expected[index]) return false; }
  return false;
}

async function responseMessage(response: Response) { const body = await response.json().catch(() => ({})) as { error?: string }; return body.error ?? interpolate(t("workspace", useLocaleStore.getState().locale, "store.request.failed"), { status: response.status }); }
function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : t("workspace", useLocaleStore.getState().locale, "service.unknownError"); }

async function waitForRestart(apiBase: string, previousStartedAt?: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    try {
      const response = await fetch(`${apiBase}/health`, { cache: "no-store", headers: recutHeaders() });
      const health = await response.json() as { startedAt?: string };
      if (response.ok && health.startedAt && health.startedAt !== previousStartedAt) return health.startedAt;
    } catch { /* 重启窗口内无法连接是预期状态。 */ }
  }
  return undefined;
}

function formatStartedAt(value: string) {
  const date = new Date(value);
  const locale = useLocaleStore.getState().locale;
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "medium", hour12: false }).format(date);
}
