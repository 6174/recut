/*
 * [INPUT]: 依赖本地 App 安装状态与 App fast-forward 升级 HTTP API
 * [OUTPUT]: 对外提供 App 版本徽标、可升级提示与确认式升级 popover
 * [POS]: web/components 的 App 版本交互原子；供项目 Header 和 Apps 目录复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
export type ManagedApp = { package: string; manifest: { id: string; name: string; version: string }; dirty: boolean; updateAvailable: boolean; manageable: boolean; status?: string };

export function AppVersionControl({ app, onUpdated }: { app: ManagedApp; onUpdated?: () => void }) {
  const [confirm, setConfirm] = useState(false); const [working, setWorking] = useState(false); const [message, setMessage] = useState("");
  async function update() {
    setWorking(true); setMessage("");
    try { const response = await fetch(`${apiBase}/v1/apps/${encodeURIComponent(app.package)}/update`, { method: "POST" }); if (!response.ok) throw new Error(await responseMessage(response)); setConfirm(false); onUpdated?.(); } catch (cause) { setMessage(`${messageOf(cause)}。请交给 Codex 或 Claude Code 诊断。`); } finally { setWorking(false); }
  }
  return <span className="relative inline-flex items-center gap-1"><Badge>v{app.manifest.version}</Badge>{app.updateAvailable && <Button className="h-6 px-2 text-[10px]" disabled={app.dirty || !app.manageable} onClick={() => setConfirm(true)} type="button" variant="outline"><RefreshCw className="size-3" />升级</Button>}{app.dirty && <span className="flex items-center gap-1 text-[10px] text-warning"><TriangleAlert className="size-3" />本地修改</span>}{confirm && <span className="absolute right-0 top-8 z-30 w-64 rounded-xs border bg-card p-3 text-left text-xs shadow-[var(--shadow-overlay)]"><strong>确认升级 {app.manifest.name}？</strong><span className="mt-1 block leading-4 text-muted-foreground">只会执行安全的 Git fast-forward；若有本地修改将拒绝覆盖。</span><span className="mt-3 flex justify-end gap-2"><Button onClick={() => setConfirm(false)} type="button" variant="ghost">取消</Button><Button disabled={working} onClick={() => void update()} type="button">确认升级</Button></span>{message && <span className="mt-2 block text-warning">{message}</span>}</span>}</span>;
}

async function responseMessage(response: Response) { const body = await response.json().catch(() => ({})) as { error?: string }; return body.error ?? `请求失败（${response.status}）`; }
function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : "未知错误"; }
