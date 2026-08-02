/*
 * [INPUT]: 依赖 service endpoint、App 安装状态、Radix Popover 与 App fast-forward 升级 HTTP API
 * [OUTPUT]: 对外提供 App 版本徽标、可升级提示与经 Portal 呈现的确认式升级浮层
 * [POS]: web/components 的 App 版本交互原子；供项目 Header 和 Apps 目录复用，避免浮层受 Header 堆叠上下文影响
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useServiceStore } from "@/lib/service-store";

export type ManagedApp = { package: string; manifest: { id: string; name: string; author: string; description: string; repository?: string; version: string; type: "project" | "standalone" }; dirty: boolean; updateAvailable: boolean; manageable: boolean; status?: string };

export function AppVersionControl({ app, onUpdated }: { app: ManagedApp; onUpdated?: () => void }) {
  const apiBase = useServiceStore((state) => state.endpoint);
  const [confirm, setConfirm] = useState(false); const [working, setWorking] = useState(false); const [message, setMessage] = useState("");
  async function update() {
    setWorking(true); setMessage("");
    try { const response = await fetch(`${apiBase}/v1/apps/${encodeURIComponent(app.package)}/update`, { method: "POST" }); if (!response.ok) throw new Error(await responseMessage(response)); setConfirm(false); onUpdated?.(); } catch (cause) { setMessage(`${messageOf(cause)}。请交给 Codex 或 Claude Code 诊断。`); } finally { setWorking(false); }
  }
  return <span className="inline-flex items-center gap-1"><Badge>v{app.manifest.version}</Badge>{app.updateAvailable && <Popover onOpenChange={setConfirm} open={confirm}><PopoverTrigger asChild><Button className="h-6 px-2 text-[10px]" disabled={app.dirty || !app.manageable} type="button" variant="outline"><RefreshCw className="size-3" />升级</Button></PopoverTrigger><PopoverContent align="end" className="w-64 p-3 text-left text-xs"><strong>确认升级 {app.manifest.name}？</strong><span className="mt-1 block leading-4 text-muted-foreground">只会执行安全的 Git fast-forward；若有本地修改将拒绝覆盖。</span><span className="mt-3 flex justify-end gap-2"><Button onClick={() => setConfirm(false)} type="button" variant="ghost">取消</Button><Button disabled={working} onClick={() => void update()} type="button">确认升级</Button></span>{message && <span className="mt-2 block text-warning">{message}</span>}</PopoverContent></Popover>}{app.dirty && <span className="flex items-center gap-1 text-[10px] text-warning"><TriangleAlert className="size-3" />本地修改</span>}</span>;
}

async function responseMessage(response: Response) { const body = await response.json().catch(() => ({})) as { error?: string }; return body.error ?? `请求失败（${response.status}）`; }
function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : "未知错误"; }
