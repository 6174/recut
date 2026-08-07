/*
 * [INPUT]: 依赖 service endpoint、Recut Skill 状态、安全软链接与 Agent MCP 注册 HTTP API、工作台 Button 原子
 * [OUTPUT]: 对外提供 Recut Skill 的安装位置、Agent 链接/MCP 状态及按需启用操作面板
 * [POS]: web/components 的全局设置子面板；只展示 daemon 管理的唯一 Skill 来源，绝不在浏览器写入用户目录或配置
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, Link2, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type SkillTarget = { id: string; name: string; path: string; status: "available" | "linked" | "conflict" | "broken" | "unavailable"; mcp: "configured" | "not-configured" | "not-applicable" | "unavailable" };
type SkillStatus = { id: string; version: string; source: string; targets: SkillTarget[] };

const statusLabel: Record<SkillTarget["status"], string> = {
  available: "未链接",
  linked: "已链接",
  conflict: "已有其他内容",
  broken: "链接已失效",
  unavailable: "无法读取",
};

function canLink(target: SkillTarget) { return target.status === "available" || target.status === "broken"; }
function needsSetup(target: SkillTarget) { return canLink(target) || (target.status === "linked" && target.mcp === "not-configured"); }

export function RecutSkillSettings({ apiBase }: { apiBase: string }) {
  const [status, setStatus] = useState<SkillStatus | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(`${apiBase}/v1/skills/recut`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "无法读取 Recut Skill 状态");
      setStatus(body);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "无法读取 Recut Skill 状态"); }
  }, [apiBase]);

  useEffect(() => { void load(); }, [load]);

  async function link(targets: string[], key: string) {
    setWorking(key); setMessage("");
    try {
      const response = await fetch(`${apiBase}/v1/skills/recut/links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targets }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "无法创建软链接");
      setStatus(body);
      setMessage(targets.length > 1 ? "Skill 已链接，并已为支持的 Agent 注册 Recut MCP。新开 Agent 会话后即可使用。" : "Skill 已链接，并已注册 Recut MCP。新开 Agent 会话后即可使用。");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "无法创建软链接"); } finally { setWorking(null); }
  }

  if (!status && !message) return <div className="grid min-h-80 place-items-center"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div>;
  if (!status) return <section className="max-w-2xl pt-6"><div className="border border-destructive/35 bg-destructive/5 p-4 text-xs text-destructive">{message}<Button className="mt-3" onClick={() => void load()} type="button" variant="outline">重试</Button></div></section>;

  const setupTargets = status.targets.filter(needsSetup);
  return <section className="max-w-2xl space-y-5 pt-6">
    <div className="border bg-muted/20 p-5">
      <div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Link2 className="size-4" /></span><div><div className="flex items-center gap-2"><p className="text-sm font-medium">Recut Skill <span className="font-mono text-xs text-muted-foreground">v{status.version}</span></p></div><p className="mt-1 text-xs leading-5 text-muted-foreground">Skill 由本机 service 管理。每次 service 启动和更新都会原子同步最新正文；其他 Agent 通过软链接共享它，不会产生漂移副本。</p></div></div>
      <div className="mt-4 border bg-background px-3 py-2.5"><p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">已安装位置</p><code className="mt-1 block break-all text-xs">{status.source}</code></div>
    </div>

    <div className="border bg-card"><div className="flex items-center justify-between border-b px-4 py-3"><div><p className="text-sm font-medium">链接并启用 Agent</p><p className="mt-1 text-[11px] text-muted-foreground">Codex、Claude Code 和 OpenCode 会同时注册 Recut MCP；不会覆盖已有的非 Recut Skill。</p></div><div className="flex gap-2"><Button disabled={working !== null} onClick={() => void load()} type="button" variant="ghost"><RefreshCw className={`size-3.5 ${working === "refresh" ? "animate-spin" : ""}`} />刷新</Button><Button disabled={working !== null || setupTargets.length === 0} onClick={() => void link(setupTargets.map((target) => target.id), "all")} type="button"><Link2 className="size-3.5" />全部启用</Button></div></div>
      <div className="divide-y">{status.targets.map((target) => <div className="flex items-center gap-3 px-4 py-3" key={target.id}><span className={`grid size-7 shrink-0 place-items-center rounded-full ${target.status === "linked" ? "bg-primary/10 text-primary" : target.status === "conflict" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{target.status === "linked" ? <Check className="size-3.5" /> : target.status === "conflict" ? <TriangleAlert className="size-3.5" /> : <Link2 className="size-3.5" />}</span><div className="min-w-0 flex-1"><p className="text-xs font-medium">{target.name}</p><code className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={target.path}>{target.path}</code><p className="mt-1 text-[10px] text-muted-foreground">{target.mcp === "configured" ? "Recut MCP 已注册" : target.mcp === "not-configured" ? "Recut MCP 尚未注册" : target.mcp === "unavailable" ? "无法读取 MCP 配置" : "使用该 Agent 自己的 MCP 配置方式"}</p></div><span className="hidden text-[11px] text-muted-foreground sm:block">{statusLabel[target.status]}</span>{needsSetup(target) ? <Button disabled={working !== null} onClick={() => void link([target.id], target.id)} type="button" variant="outline">{working === target.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}{target.status === "broken" ? "修复并启用" : target.status === "linked" ? "启用 MCP" : "链接并启用"}</Button> : null}</div>)}</div>
    </div>
    {message && <p className="text-xs leading-5 text-muted-foreground" role="status">{message}</p>}
  </section>;
}
