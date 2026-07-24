/*
 * [INPUT]: 依赖项目/App manifest API、Agent Session HTTP API 与 Next.js 路由参数
 * [OUTPUT]: 对外提供通用项目 App UI 容器、项目事件转发与结构化 Agent 请求转交
 * [POS]: web 的 Extension Host 页面；将平台事件转发给 iframe，不包含任何具体 App UI 业务逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeft, Clapperboard } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
type Project = { id: string; name: string; appId: string; appVersion: string; createdAt: string };
type App = { manifest: { id: string; name: string; version: string; ui: { projectView?: string } } };

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [app, setApp] = useState<App | null>(null);
  const [online, setOnline] = useState(false);
  const appFrame = useRef<HTMLIFrameElement>(null);
  const { handlePointerDown, isDragging, layoutRef, panelWidth } = useResizableSidePanel({ storageKey: "recut.project-agent-panel-width" });

  useEffect(() => {
    void (async () => {
      const projectResponse = await fetch(`${apiBase}/v1/projects/${id}`);
      if (!projectResponse.ok) return;
      const nextProject = await projectResponse.json();
      setProject(nextProject);
      const appsResponse = await fetch(`${apiBase}/v1/apps`);
      if (appsResponse.ok) setApp((await appsResponse.json()).find((item: App) => item.manifest.id === nextProject.appId) ?? null);
      setOnline(true);
    })();
  }, [id]);

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
  }, [project]);

  const connectUI = () => {
    if (!appFrame.current || !project) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = async (event) => {
      const request = event.data; const reply = (result?: unknown, error?: string) => channel.port1.postMessage({ id: request.id, result, error });
      try {
        if (request.type === "state.query") {
          const response = await fetch(`${apiBase}/v1/projects/${project.id}/apps/${project.appId}/api/${request.input.name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          reply(await response.json(), response.ok ? undefined : "状态读取失败");
        } else if (request.type === "background.call") {
          const { name, ...input } = request.input; const response = await fetch(`${apiBase}/v1/projects/${project.id}/apps/${project.appId}/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
          reply(await response.json(), response.ok ? undefined : "后台调用失败");
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
        <div className="min-w-0"><p className="truncate text-sm font-medium">{project?.name ?? "加载项目…"}</p><p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{project ? `${app?.manifest.name ?? project.appId} · v${project.appVersion} · ${project.id}` : "正在读取项目元信息"}</p></div>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-2"><Badge>{app?.manifest.id ?? project?.appId ?? "APP"}</Badge><Badge>{online ? "LOCAL" : "OFFLINE"}</Badge></div>
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
