/*
 * [INPUT]: 依赖 service 的独立 App workspace scope、manifest UI 入口、App API 与 Agent Session HTTP API
 * [OUTPUT]: 对外提供独立 App iframe 容器、宿主通信和工作区级 Agent 对话侧栏
 * [POS]: workspace-app/[appID] 的客户端工作台；复用项目级安全 scope，但不显示或创建用户项目
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { HeaderActions } from "@/components/header-actions";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";
import { useServiceStore } from "@/lib/service-store";

type WorkspaceScope = { id: string; name: string; appId: string; appVersion: string };
type App = { manifest: { id: string; name: string; version: string; type: "standalone" | "project"; ui: { standaloneView?: string } } };

function appIDFromLocation(routeID: string) {
  const queryID = new URLSearchParams(window.location.search).get("id");
  if (queryID) return queryID;
  const match = window.location.pathname.match(/^\/workspace-app\/([^/]+)\/?$/);
  return match?.[1] === "app" ? routeID : match?.[1] ?? routeID;
}

function operationError(payload: unknown, fallback: string) {
  const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as { error?: unknown } : null;
  return typeof value?.error === "string" && value.error.trim() ? value.error : fallback;
}

export default function StandaloneAppClient() {
  const { appID: routeID } = useParams<{ appID: string }>();
  const [appID, setAppID] = useState("");
  const [scope, setScope] = useState<WorkspaceScope | null>(null);
  const [app, setApp] = useState<App | null>(null);
  const apiBase = useServiceStore((state) => state.endpoint);
  const online = useServiceStore((state) => state.service.phase === "online");
  const appFrame = useRef<HTMLIFrameElement>(null);
  const { handlePointerDown, isDragging, layoutRef, panelWidth } = useResizableSidePanel({ storageKey: "recut.workspace-app-agent-panel-width" });

  useEffect(() => { setAppID(appIDFromLocation(routeID)); }, [routeID]);
  useEffect(() => {
    if (!appID || !online) return;
    let active = true;
    void (async () => {
      const [scopeResponse, appsResponse] = await Promise.all([fetch(`${apiBase}/v1/apps/${encodeURIComponent(appID)}/workspace`), fetch(`${apiBase}/v1/apps`)]);
      if (!active || !scopeResponse.ok || !appsResponse.ok) return;
      const nextApp = (await appsResponse.json() as App[]).find((item) => item.manifest.id === appID) ?? null;
      if (!nextApp || nextApp.manifest.type !== "standalone") return;
      setScope(await scopeResponse.json() as WorkspaceScope);
      setApp(nextApp);
    })().catch(() => { if (active) { setScope(null); setApp(null); } });
    return () => { active = false; };
  }, [apiBase, appID, online]);

  useEffect(() => {
    if (!scope) return;
    const eventsURL = new URL("/v1/events", apiBase);
    eventsURL.protocol = eventsURL.protocol === "https:" ? "wss:" : "ws:";
    const events = new WebSocket(eventsURL);
    events.addEventListener("open", () => events.send(JSON.stringify({ type: "subscribe", projectId: scope.id })));
    events.addEventListener("message", (message) => {
      const payload = JSON.parse(message.data) as { type?: string; event?: unknown };
      if (payload.type === "project.event") appFrame.current?.contentWindow?.postMessage({ type: "recut.project.event", event: payload.event }, apiBase);
    });
    return () => events.close();
  }, [apiBase, scope]);

  const connectUI = () => {
    if (!scope || !appFrame.current) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = async (event) => {
      const request = event.data;
      const reply = (result?: unknown, error?: string) => channel.port1.postMessage({ id: request.id, result, error });
      try {
        if (request.type === "state.query" || request.type === "background.call") {
          const { name, ...input } = request.input;
          const response = await fetch(`${apiBase}/v1/projects/${scope.id}/apps/${scope.appId}/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.type === "state.query" ? {} : input) });
          const payload = await response.json();
          reply(payload, response.ok ? undefined : operationError(payload, "后台调用失败"));
        } else if (request.type === "agent.send") {
          const sessionsResponse = await fetch(`${apiBase}/v1/agent-sessions?projectId=${encodeURIComponent(scope.id)}`);
          if (!sessionsResponse.ok) throw new Error("无法读取 Agent 对话");
          const sessions = await sessionsResponse.json() as { id: string }[];
          let sessionID = sessions[0]?.id;
          if (!sessionID) {
            const createResponse = await fetch(`${apiBase}/v1/agent-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: scope.id, runtime: "codex" }) });
            if (!createResponse.ok) throw new Error("无法创建 Agent 对话");
            sessionID = (await createResponse.json() as { id: string }).id;
          }
          const turnResponse = await fetch(`${apiBase}/v1/agent-sessions/${sessionID}/turns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: request.input.prompt }) });
          if (!turnResponse.ok) throw new Error("无法发送给 Agent");
          reply({ delivery: "agent-session", sessionId: sessionID });
        }
      } catch (cause) { reply(undefined, cause instanceof Error ? cause.message : "Recut Host 通信失败"); }
    };
    appFrame.current.contentWindow?.postMessage({ type: "recut.ui.connect" }, apiBase, [channel.port2]);
  };

  const view = app?.manifest.ui.standaloneView;
  const uiURL = scope && app && view ? `${apiBase}/v1/apps/${encodeURIComponent(app.manifest.id)}/ui/${view}?projectId=${encodeURIComponent(scope.id)}&appVersion=${encodeURIComponent(app.manifest.version)}` : null;
  return <main className="flex h-screen min-w-[1024px] flex-col overflow-hidden bg-background">
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-5"><div className="flex min-w-0 items-center gap-4"><Link aria-label="返回应用目录" className="flex shrink-0 items-center gap-2" href="/apps"><ArrowLeft className="size-4" /><AppWindow className="size-4" /><strong className="text-sm tracking-tight">RECUT</strong></Link><div aria-hidden="true" className="h-5 w-px bg-border" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{app?.manifest.name ?? "工作区 App"}</p><p className="truncate font-mono text-[10px] text-muted-foreground">WORKSPACE APP · 不创建项目</p></div></div><HeaderActions /></header>
    <div className="relative grid min-h-0 flex-1 overflow-hidden [grid-template-columns:minmax(0,1fr)_var(--side-panel-width)]" ref={layoutRef} style={{ "--side-panel-width": `${panelWidth}px` } as CSSProperties}><section className="min-h-0 min-w-0 overflow-hidden border-r bg-card">{uiURL ? <iframe className="block h-full w-full border-0" onLoad={connectUI} ref={appFrame} src={uiURL} title={app?.manifest.name ?? "Recut App"} /> : <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">正在准备独立 App 工作区…</div>}</section>{isDragging && <div aria-hidden="true" className="absolute inset-0 z-[5] cursor-col-resize" />}<button aria-label="拖动调整 Agent 面板宽度" className="group absolute inset-y-0 z-10 w-2 cursor-col-resize border-0 bg-transparent p-0 focus:outline-none [left:calc(100%_-_var(--side-panel-width)_-_0.25rem)]" onPointerDown={handlePointerDown} type="button"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-foreground group-focus:w-0.5 group-focus:bg-foreground" /></button><ProjectAgentPanel apiBase={apiBase} online={online} projectID={scope?.id ?? null} /></div>
  </main>;
}
