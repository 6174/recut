/*
 * [INPUT]: 依赖全局 Zustand service 状态、service endpoint、项目/App manifest API、Agent Session HTTP API 与 Next.js 浏览器路由参数
 * [OUTPUT]: 对外提供通用项目 App UI 容器、项目事件转发与结构化 Agent 请求转交，并透传 App API 的失败原因
 * [POS]: projects/[id] 的客户端交互层；由 page.tsx 服务端壳承载，共享根级 service 状态，隔离 useParams、WebSocket 与 iframe，不能吞没后台诊断
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeft, Clapperboard } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AppVersionControl, type ManagedApp } from "@/components/app-version-control";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { HeaderActions } from "@/components/header-actions";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";
import { useServiceStore } from "@/lib/service-store";

type Project = { id: string; name: string; appId: string; appVersion: string; createdAt: string };
type App = { manifest: { id: string; name: string; version: string; ui: { projectView?: string } } };

function operationError(payload: unknown, fallback: string) {
  const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as { error?: unknown } : null;
  return typeof value?.error === "string" && value.error.trim() ? value.error : fallback;
}

function projectIDFromLocation(routeID: string) {
  const queryID = new URLSearchParams(window.location.search).get("id");
  if (queryID) return queryID;
  const match = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/);
  return match?.[1] === "app" ? routeID : match?.[1] ?? routeID;
}

export default function ProjectDetailClient() {
  const { id: routeID } = useParams<{ id: string }>();
  const [id, setID] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [app, setApp] = useState<App | null>(null);
  const [installation, setInstallation] = useState<ManagedApp | null>(null);
  const apiBase = useServiceStore((state) => state.endpoint);
  const online = useServiceStore((state) => state.service.phase === "online");
  const appFrame = useRef<HTMLIFrameElement>(null);
  const { handlePointerDown, isDragging, layoutRef, panelWidth } = useResizableSidePanel({ storageKey: "recut.project-agent-panel-width" });

  useEffect(() => { setID(projectIDFromLocation(routeID)); }, [routeID]);
  useEffect(() => {
    if (!id || !online) return;
    void (async () => {
      const projectResponse = await fetch(`${apiBase}/v1/projects/${id}`);
      if (!projectResponse.ok) return;
      const nextProject = await projectResponse.json();
      setProject(nextProject);
      const appsResponse = await fetch(`${apiBase}/v1/apps`);
      if (appsResponse.ok) setApp((await appsResponse.json()).find((item: App) => item.manifest.id === nextProject.appId) ?? null);
      const installationResponse = await fetch(`${apiBase}/v1/apps/installed`);
      if (installationResponse.ok) setInstallation((await installationResponse.json()).find((item: ManagedApp) => item.manifest.id === nextProject.appId) ?? null);
    })();
  }, [apiBase, id, online]);

  useEffect(() => {
    if (!project) return;
    const eventsURL = new URL("/v1/events", apiBase);
    eventsURL.protocol = eventsURL.protocol === "https:" ? "wss:" : "ws:";
    const events = new WebSocket(eventsURL);
    events.addEventListener("open", () => events.send(JSON.stringify({ type: "subscribe", projectId: project.id })));
    events.addEventListener("message", (message) => {
      const payload = JSON.parse(message.data);
      if (payload.type !== "project.event") return;
      appFrame.current?.contentWindow?.postMessage({ type: "recut.project.event", event: payload.event }, apiBase);
    });
    return () => events.close();
  }, [apiBase, project]);

  const connectUI = () => {
    if (!appFrame.current || !project) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = async (event) => {
      const request = event.data; const reply = (result?: unknown, error?: string) => channel.port1.postMessage({ id: request.id, result, error });
      try {
        if (request.type === "state.query") {
          const response = await fetch(`${apiBase}/v1/projects/${project.id}/apps/${project.appId}/api/${request.input.name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const payload = await response.json();
          reply(payload, response.ok ? undefined : operationError(payload, "状态读取失败"));
        } else if (request.type === "background.call") {
          const { name, ...input } = request.input; const response = await fetch(`${apiBase}/v1/projects/${project.id}/apps/${project.appId}/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
          const payload = await response.json();
          reply(payload, response.ok ? undefined : operationError(payload, "后台调用失败"));
        } else if (request.type === "agent.send") {
          const sessionsResponse = await fetch(`${apiBase}/v1/agent-sessions?projectId=${encodeURIComponent(project.id)}`);
          if (!sessionsResponse.ok) throw new Error("无法读取 Agent 对话");
          const sessions = await sessionsResponse.json();
          let sessionID = sessions[0]?.id;
          if (!sessionID) {
            const createResponse = await fetch(`${apiBase}/v1/agent-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, runtime: "codex" }) });
            if (!createResponse.ok) throw new Error("无法创建 Agent 对话");
            sessionID = (await createResponse.json()).id;
          }
          const turnResponse = await fetch(`${apiBase}/v1/agent-sessions/${sessionID}/turns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: request.input.prompt }) });
          if (!turnResponse.ok) throw new Error("无法发送给 Agent");
          reply({ delivery: "agent-session", sessionId: sessionID });
        }
      } catch { reply(undefined, "Recut Host 通信失败"); }
    };
    appFrame.current.contentWindow?.postMessage({ type: "recut.ui.connect" }, apiBase, [channel.port2]);
  };

  const view = app?.manifest.ui.projectView;
  const uiURL = project && view ? `${apiBase}/v1/apps/${encodeURIComponent(project.appId)}/ui/${view}?projectId=${encodeURIComponent(project.id)}&appVersion=${encodeURIComponent(app?.manifest.version ?? "")}` : null;

  return <main className="flex h-screen min-w-[1024px] flex-col overflow-hidden bg-background">
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-5">
      <div className="flex min-w-0 items-center gap-4">
        <Link aria-label="返回项目列表" className="flex shrink-0 items-center gap-2" href="/"><ArrowLeft className="size-4" /><Clapperboard className="size-4" /><strong className="text-sm tracking-tight">RECUT</strong></Link>
        <div aria-hidden="true" className="h-5 w-px bg-border" />
        <div className="min-w-0"><p className="truncate text-sm font-medium">{project?.name ?? "加载项目…"}</p><p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{project ? `${app?.manifest.name ?? project.appId} · v${app?.manifest.version ?? project.appVersion} · ${project.id}` : "正在读取项目元信息"}</p></div>
      </div>
      <HeaderActions>{installation && <AppVersionControl app={installation} onUpdated={() => window.location.reload()} />}</HeaderActions>
    </header>
    <div className="relative grid min-h-0 flex-1 overflow-hidden [grid-template-columns:minmax(0,1fr)_var(--side-panel-width)]" ref={layoutRef} style={{ "--side-panel-width": `${panelWidth}px` } as CSSProperties}>
      <section className="min-h-0 min-w-0 overflow-hidden border-r bg-card">
        {uiURL ? <iframe className="block h-full w-full border-0" onLoad={connectUI} ref={appFrame} src={uiURL} title={`${project?.name ?? "Recut"} App`} /> : <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">这个 App 没有声明项目 UI。</div>}
      </section>
      {isDragging && <div aria-hidden="true" className="absolute inset-0 z-[5] cursor-col-resize" />}
      <button aria-label="拖动调整 Agent 面板宽度" className="group absolute inset-y-0 z-10 w-2 cursor-col-resize border-0 bg-transparent p-0 focus:outline-none [left:calc(100%_-_var(--side-panel-width)_-_0.25rem)]" onPointerDown={handlePointerDown} type="button"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-foreground group-focus:w-0.5 group-focus:bg-foreground" /></button>
      <ProjectAgentPanel apiBase={apiBase} online={online} projectID={project?.id ?? null} />
    </div>
  </main>;
}
