/*
 * [INPUT]: 依赖 service endpoint、App 安装状态、Radix Popover、App 单个或批量 fast-forward 升级 HTTP API 与工作台 i18n 字典
 * [OUTPUT]: 对外提供 App 版本徽标、单应用升级与按可升级条目聚合的一键更新确认交互
 * [POS]: web/components 的 App 版本交互原子；供项目 Header、应用目录与详情复用，避免浮层受 Header 堆叠上下文影响
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t, useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { useLocaleStore } from "@/lib/i18n/locale-store";
import { recutHeaders } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";

export type ManagedApp = { package: string; manifest: { id: string; name: string; author: string; description: string; repository?: string; version: string; type: "project" | "standalone" }; dirty: boolean; updateAvailable: boolean; manageable: boolean; status?: string };
type AppUpdateResult = { updated: ManagedApp[]; failed: { package: string; error: string }[] };

export function AppVersionControl({ app, onUpdated }: { app: ManagedApp; onUpdated?: () => void }) {
  const { t: text } = useI18n();
  const apiBase = useServiceStore((state) => state.endpoint);
  const [confirm, setConfirm] = useState(false); const [working, setWorking] = useState(false); const [message, setMessage] = useState("");
  async function update() {
    setWorking(true); setMessage("");
    try { const response = await fetch(`${apiBase}/v1/apps/${encodeURIComponent(app.package)}/update`, { method: "POST", headers: recutHeaders() }); if (!response.ok) throw new Error(await responseMessage(response)); setConfirm(false); onUpdated?.(); } catch (cause) { setMessage(`${messageOf(cause)}${t("workspace", useLocaleStore.getState().locale, "appstore.version.errorJoiner")}${t("workspace", useLocaleStore.getState().locale, "service.diag.suffix")}`); } finally { setWorking(false); }
  }
  return <span className="inline-flex flex-wrap items-center justify-end gap-1"><Badge>v{app.manifest.version}</Badge>{app.updateAvailable && <Popover onOpenChange={setConfirm} open={confirm}><PopoverTrigger asChild><Button className="h-6 px-2 text-[10px]" disabled={app.dirty || !app.manageable} type="button" variant="outline"><RefreshCw className="size-3" />{app.dirty ? text("version.remote") : text("version.update")}</Button></PopoverTrigger><PopoverContent align="end" className="w-64 p-3 text-left text-xs"><strong>{interpolate(text("version.confirm.title"), { name: app.manifest.name })}</strong><span className="mt-1 block leading-4 text-muted-foreground">{text("version.confirm.desc")}</span><span className="mt-3 flex justify-end gap-2"><Button onClick={() => setConfirm(false)} type="button" variant="ghost">{text("version.cancel")}</Button><Button disabled={working} onClick={() => void update()} type="button">{text("version.confirm")}</Button></span>{message && <span className="mt-2 block text-warning">{message}</span>}</PopoverContent></Popover>}{app.dirty && <span className="flex items-center gap-1 text-[10px] text-warning"><TriangleAlert className="size-3" />{text("version.localmod")}</span>}</span>;
}

export function AppUpdateAllControl({ apps, onUpdated }: { apps: ManagedApp[]; onUpdated: () => void | Promise<void> }) {
  const { t: text } = useI18n();
  const apiBase = useServiceStore((state) => state.endpoint);
  const [confirm, setConfirm] = useState(false); const [working, setWorking] = useState(false); const [message, setMessage] = useState("");
  const updateable = apps.filter((app) => app.manageable && !app.dirty && app.updateAvailable);
  if (!updateable.length) return null;
  async function updateAll() {
    setWorking(true); setMessage("");
    try {
      const response = await fetch(`${apiBase}/v1/apps/update`, { method: "POST", headers: recutHeaders() });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json() as AppUpdateResult;
      if (result.failed.length) setMessage(interpolate(text("version.all.result"), { updated: result.updated.length, failed: result.failed.length })); else setConfirm(false);
      await onUpdated();
    } catch (cause) { setMessage(`${messageOf(cause)}${t("workspace", useLocaleStore.getState().locale, "appstore.version.errorJoiner")}${t("workspace", useLocaleStore.getState().locale, "service.diag.suffix")}`); } finally { setWorking(false); }
  }
  return <Popover onOpenChange={setConfirm} open={confirm}><PopoverTrigger asChild><Button className="h-9" type="button"><RefreshCw className="size-4" />{interpolate(text("version.all.button"), { count: updateable.length })}</Button></PopoverTrigger><PopoverContent align="end" className="w-72 p-3 text-left text-xs"><strong>{interpolate(text("version.all.title"), { count: updateable.length })}</strong><span className="mt-1 block leading-4 text-muted-foreground">{text("version.all.desc")}</span><span className="mt-3 flex justify-end gap-2"><Button onClick={() => setConfirm(false)} type="button" variant="ghost">{text("version.cancel")}</Button><Button disabled={working} onClick={() => void updateAll()} type="button">{working ? text("version.all.updating") : text("version.all.confirm")}</Button></span>{message && <span className="mt-2 block text-warning">{message}</span>}</PopoverContent></Popover>;
}

async function responseMessage(response: Response) { const body = await response.json().catch(() => ({})) as { error?: string }; return body.error ?? interpolate(t("workspace", useLocaleStore.getState().locale, "store.request.failed"), { status: response.status }); }
function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : t("workspace", useLocaleStore.getState().locale, "service.unknownError"); }
