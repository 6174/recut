/*
 * [INPUT]: 依赖 service endpoint、GET /v1/mcp/tools 的按来源分组工具快照、工作台 Button/Badge 原子与 i18n 字典
 * [OUTPUT]: 对外提供 Recut MCP 的全部工具列表：平台能力归入全局分组，App 声明的 mcp 操作按归属 App 分组展示
 * [POS]: web/components 的全局设置子面板；只读展示本机 MCP Host 提供的工具，不产生任何调用或副作用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { LoaderCircle, Plug, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { recutHeaders } from "@/lib/service-endpoint";

type MCPTool = { name: string; description: string; inputSchema?: Record<string, unknown> };
type MCPAppGroup = { appId: string; name: string; kind: string; description: string; tools: MCPTool[] };
type MCPToolsStatus = { global: MCPTool[]; apps: MCPAppGroup[] };

export function RecutMCPSettings({ apiBase }: { apiBase: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MCPToolsStatus | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBase}/v1/mcp/tools`, { cache: "no-store", headers: recutHeaders(), signal: AbortSignal.timeout(8000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("mcp.load.failed"));
      setStatus(body);
    } catch (cause) {
      const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
      setMessage(timedOut ? t("mcp.timeout") : cause instanceof Error ? cause.message : t("mcp.load.failed"));
    } finally { setWorking(false); }
  }, [apiBase]);

  useEffect(() => { void load(); }, [load]);

  if (!status && !message) return <div className="grid min-h-80 place-items-center"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div>;
  if (!status) return <section className="max-w-2xl pt-6"><div className="border border-destructive/35 bg-destructive/5 p-4 text-xs text-destructive">{message}<Button className="mt-3" onClick={() => void load()} type="button" variant="outline">{t("mcp.retry")}</Button></div></section>;

  const globalCount = status.global.length;
  const appToolCount = status.apps.reduce((total, app) => total + app.tools.length, 0);
  return <section className="max-w-2xl space-y-5 pt-6">
    <div className="border bg-muted/20 p-5">
      <div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Plug className="size-4" /></span><div><div className="flex items-center gap-2"><p className="text-sm font-medium">{t("mcp.title")}</p><Badge>{globalCount + appToolCount} TOOLS</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{interpolate(t("mcp.desc"), { code: `surfaces: ["mcp"]` })}</p></div></div>
      <div className="mt-4 flex justify-end"><Button disabled={working} onClick={() => void load()} type="button" variant="ghost"><RefreshCw className={`size-3.5 ${working ? "animate-spin" : ""}`} />{t("mcp.refresh")}</Button></div>
    </div>

    <div className="border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3"><div><p className="text-sm font-medium">{t("mcp.platform")}</p><p className="mt-1 text-[11px] text-muted-foreground">{t("mcp.platform.desc")}</p></div><span className="text-[11px] text-muted-foreground">{interpolate(t("mcp.tool.count"), { count: globalCount })}</span></div>
      {status.global.length ? <div className="divide-y">{status.global.map((tool) => <ToolRow key={tool.name} tool={tool} />)}</div> : <div className="px-4 py-8 text-center text-xs text-muted-foreground">{t("mcp.platform.empty")}</div>}
    </div>

    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2"><p className="text-sm font-medium">{t("mcp.app.title")}</p><span className="text-[11px] text-muted-foreground">{interpolate(t("mcp.app.summary"), { apps: status.apps.length, tools: appToolCount })}</span></div>
      {status.apps.length ? status.apps.map((app) => <div className="border bg-card" key={app.appId}>
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-medium">{app.name}</p><Badge>{app.kind === "project" ? "PROJECT" : "STANDALONE"}</Badge></div><code className="mt-1 block font-mono text-[10px] text-muted-foreground">{app.appId}</code></div><span className="shrink-0 text-[11px] text-muted-foreground">{interpolate(t("mcp.tool.count"), { count: app.tools.length })}</span></div>
        <p className="border-b px-4 py-2.5 text-[11px] leading-4 text-muted-foreground">{app.description}</p>
        <div className="divide-y">{app.tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)}</div>
      </div>) : <div className="grid min-h-40 place-items-center border border-dashed p-6 text-center"><p className="text-xs text-muted-foreground">{interpolate(t("mcp.app.empty"), { code: "mcp" })}</p></div>}
    </div>
    {message && <p className="text-xs leading-5 text-muted-foreground" role="status">{message}</p>}
  </section>;
}

function ToolRow({ tool }: { tool: MCPTool }) {
  return <div className="px-4 py-3"><code className="font-mono text-xs">{tool.name}</code><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{tool.description}</p></div>;
}
