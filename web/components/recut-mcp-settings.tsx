/*
 * [INPUT]: 依赖 service endpoint、GET /v1/mcp/tools 的按来源分组工具快照、工作台 Button/Badge 原子与 i18n 字典
 * [OUTPUT]: 对外提供 Recut MCP 的全部工具列表：无描边布局（列表行默认浅填充底、悬停加深以区分块，分组边界用留白区分，无外框/分割线），摘要行（工具数徽标 + 内联刷新）+ 平台/App 两个分组；工具列表双栏排布（sm 以下单栏）填满内容区，分组头合并名称、归属与数量并展示描述，组标题 15px 加粗，工具行悬停高亮、绿色标记点，说明文字统一 12px 高对比
 * [POS]: web/components 的全局设置子面板；只读展示本机 MCP Host 提供的工具，不产生任何调用或副作用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { recutHeaders } from "@/lib/service-endpoint";

type MCPTool = { name: string; description: string; inputSchema?: Record<string, unknown> };
type MCPAppGroup = { appId: string; name: string; kind: string; description: string; tools: MCPTool[] };
type MCPToolsStatus = { global: MCPTool[]; apps: MCPAppGroup[] };

const countChip = "shrink-0 rounded-xs bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground";
// 说明性文字统一 foreground 85%，12px 小字号下保证可读对比度。
const descText = "text-xs leading-5 text-foreground/85";

// 两栏独立流（各自 space-y，不共用 divide 线），描述行数不一致时互不影响；sm 以下折成单栏。
function TwoColumnList<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  if (items.length <= 1) return <div className="py-3">{items.map(render)}</div>;
  const mid = Math.ceil(items.length / 2);
  return <div className="grid gap-x-8 gap-y-2 py-3 sm:grid-cols-2">
    <div className="space-y-2">{items.slice(0, mid).map(render)}</div>
    <div className="space-y-2">{items.slice(mid).map(render)}</div>
  </div>;
}

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
  if (!status) return <section className="max-w-2xl pt-1"><div className="rounded-md bg-destructive/10 p-4 text-xs text-destructive">{message}<Button className="mt-3" onClick={() => void load()} type="button" variant="outline">{t("mcp.retry")}</Button></div></section>;

  const globalCount = status.global.length;
  const appToolCount = status.apps.reduce((total, app) => total + app.tools.length, 0);
  return <section className="space-y-8 pt-1">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="text-[15px] font-semibold">{t("mcp.title")}</p><Badge className="border-primary/30 bg-primary/10 text-primary">{globalCount + appToolCount} TOOLS</Badge></div>
        <p className={`mt-1 ${descText}`}>{interpolate(t("mcp.desc"), { code: `surfaces: ["mcp"]` })}</p>
      </div>
      <Button className="shrink-0" disabled={working} onClick={() => void load()} type="button" variant="ghost"><RefreshCw className={`size-3.5 ${working ? "animate-spin" : ""}`} />{t("mcp.refresh")}</Button>
    </div>

    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-[15px] font-semibold">{t("mcp.platform")}</p><p className={`mt-1 ${descText}`}>{t("mcp.platform.desc")}</p></div>
        <span className={countChip}>{interpolate(t("mcp.tool.count"), { count: globalCount })}</span>
      </div>
      {status.global.length ? <TwoColumnList items={status.global} render={(tool) => <ToolRow key={tool.name} tool={tool} />} /> : <div className="px-4 py-8 text-center text-xs text-foreground/70">{t("mcp.platform.empty")}</div>}
    </section>

    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3"><p className="text-[15px] font-semibold">{t("mcp.app.title")}</p><span className={countChip}>{interpolate(t("mcp.app.summary"), { apps: status.apps.length, tools: appToolCount })}</span></div>
      {status.apps.length ? <div className="space-y-8">{status.apps.map((app) => <section key={app.appId}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2"><p className="truncate text-[15px] font-semibold">{app.name}</p><Badge>{app.kind === "project" ? "PROJECT" : "STANDALONE"}</Badge><code className="hidden truncate rounded-xs bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block" title={app.appId}>{app.appId}</code></div>
          <span className={countChip}>{interpolate(t("mcp.tool.count"), { count: app.tools.length })}</span>
        </div>
        <p className={`mt-1.5 ${descText}`}>{app.description}</p>
        <TwoColumnList items={app.tools} render={(tool) => <ToolRow key={tool.name} tool={tool} />} />
      </section>)}</div> : <div className="grid min-h-40 place-items-center p-6 text-center"><p className="text-xs text-foreground/70">{interpolate(t("mcp.app.empty"), { code: "mcp" })}</p></div>}
    </div>
    {message && <p className="text-xs leading-5 text-muted-foreground" role="status">{message}</p>}
  </section>;
}

function ToolRow({ tool }: { tool: MCPTool }) {
  return <div className="flex gap-3 rounded-md bg-foreground/5 px-4 py-2.5 transition-colors hover:bg-foreground/9">
    <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/50" />
    <div className="min-w-0">
      <code className="block truncate font-mono text-xs font-medium" title={tool.name}>{tool.name}</code>
      <p className={`mt-1 ${descText}`}>{tool.description}</p>
    </div>
  </div>;
}
