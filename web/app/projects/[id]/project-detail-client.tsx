/*
 * [INPUT]: 依赖全局 Zustand service 状态、workspace-store 的项目/App/安装状态、平台素材选择器、按 scope 缓存的 Agent Session 列表、全局 Agent 面板上下文与 Next.js 浏览器路由参数
 * [OUTPUT]: 对外提供通用项目 App UI 容器、按 iframe 实际 origin 转发的项目事件、全局素材选择与结构化 Agent 请求转交；App 只能经全局面板上下文回填右侧 Agent 输入草稿（不再提供 agent.send 直发），对话与结果始终在全局 chat 中可见
 * [POS]: projects/[id] 的客户端交互层；由 page.tsx 服务端壳承载，从 workspace-store 读取目录真相，隔离 useParams、WebSocket 与 iframe，通信目标以 iframe URL 为唯一真相源；Agent 面板由根布局全局挂载为单一会话，本页只声明素材上下文与草稿
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AppVersionControl, type ManagedApp } from "@/components/app-version-control";
import { HeaderActions } from "@/components/header-actions";
import { PlatformMediaPicker, type PlatformMediaPickerRequest, type PlatformMediaPickerResult } from "@/components/platform-media-picker";
import { normalizePageContext } from "@/components/agent-panel-types";
import { useAgentStore } from "@/lib/agent-store";
import { useAgentPanelContext, useReportPageContext } from "@/lib/agent-panel-context";
import { streamServiceEndpoint } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";
import { useWorkspaceStore } from "@/lib/workspace-store";

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

function postToFrame(frame: HTMLIFrameElement | null, message: unknown, transfer?: Transferable[]) {
  if (!frame?.contentWindow) return;
  const targetOrigin = new URL(frame.src).origin;
  if (transfer) frame.contentWindow.postMessage(message, targetOrigin, transfer);
  else frame.contentWindow.postMessage(message, targetOrigin);
}

export default function ProjectDetailClient() {
  const { id: routeID } = useParams<{ id: string }>();
  const [id, setID] = useState("");
  const [mediaPicker, setMediaPicker] = useState<PlatformMediaPickerRequest | null>(null);
  const apiBase = useServiceStore((state) => state.endpoint);
  const online = useServiceStore((state) => state.service.phase === "online");
  const apps = useWorkspaceStore((state) => state.apps);
  const installations = useWorkspaceStore((state) => state.installations);
  const project = useWorkspaceStore((state) => id ? state.projectDetailsByID[id] ?? null : null);
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const loadProject = useWorkspaceStore((state) => state.loadProject);
  const loadAgentSessions = useAgentStore((state) => state.loadSessions);
  const upsertAgentSession = useAgentStore((state) => state.upsertSession);
  const appFrame = useRef<HTMLIFrameElement>(null);
  const mediaPickerReply = useRef<((selection: PlatformMediaPickerResult | null) => void) | null>(null);
  const app = project ? apps.find((item) => item.manifest.id === project.appId) ?? null : null;
  const installation = project ? installations.find((item) => item.manifest.id === project.appId) ?? null : null;

  useEffect(() => { setID(projectIDFromLocation(routeID)); }, [routeID]);
  useLayoutEffect(() => {
    useAgentPanelContext.getState().setContext({ projectID: project?.id ?? null, headerHeight: 56 });
  }, [project?.id]);
  useReportPageContext(useMemo(() => (project ? { title: project.name, path: `/projects/${id}`, url: window.location.href } : null), [project, id]));
  useEffect(() => {
    if (!id || !online) return;
    void Promise.all([loadWorkspace(apiBase), loadProject(apiBase, id)]);
  }, [apiBase, id, loadProject, loadWorkspace, online]);

  useEffect(() => {
    if (!project) return;
    const eventsURL = new URL("/v1/events", streamServiceEndpoint(apiBase));
    eventsURL.protocol = eventsURL.protocol === "https:" ? "wss:" : "ws:";
    const events = new WebSocket(eventsURL);
    events.addEventListener("open", () => events.send(JSON.stringify({ type: "subscribe", projectId: project.id })));
    events.addEventListener("message", (message) => {
      const payload = JSON.parse(message.data);
      if (payload.type !== "project.event") return;
      postToFrame(appFrame.current, { type: "recut.project.event", event: payload.event });
    });
    return () => events.close();
  }, [apiBase, project]);

  const connectUI = useCallback(() => {
    if (!appFrame.current || !project) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = async (event) => {
      const request = event.data; const reply = (result?: unknown, error?: string) => channel.port1.postMessage({ id: request.id, result, error });
      console.debug(`[recut-host] iframe request id=${String(request.id)} type=${String(request.type)}`);
      try {
        if (request.type === "state.query") {
          const response = await fetch(`${apiBase}/v1/projects/${project.id}/apps/${project.appId}/api/${request.input.name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const payload = await response.json();
          reply(payload, response.ok ? undefined : operationError(payload, "状态读取失败"));
          console.debug(`[recut-host] iframe response id=${String(request.id)} type=state.query result=${response.ok ? "ok" : "error"}`);
        } else if (request.type === "background.call") {
          const { name, ...input } = request.input; const response = await fetch(`${apiBase}/v1/projects/${project.id}/apps/${project.appId}/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
          const payload = await response.json();
          reply(payload, response.ok ? undefined : operationError(payload, "后台调用失败"));
          console.debug(`[recut-host] iframe response id=${String(request.id)} type=background.call result=${response.ok ? "ok" : "error"}`);
        } else if (request.type === "agent.compose") {
          const prompt = String(request.input?.prompt || "").trim();
          if (!prompt) throw new Error("Agent Prompt 不能为空");
          useAgentPanelContext.getState().setDraft({ id: String(request.id), text: prompt });
          reply({ delivery: "agent-composer" });
          console.debug(`[recut-host] iframe response id=${String(request.id)} type=agent.compose result=ok`);
        } else if (request.type === "page.context") {
          const context = normalizePageContext(request.input?.context);
          if (!context) throw new Error("页面上下文需要标题");
          useAgentPanelContext.getState().setPageContext(context);
          reply({ delivery: "page-context" });
          console.debug(`[recut-host] iframe response id=${String(request.id)} type=page.context result=ok`);
        } else if (request.type === "media.pick") {
          if (mediaPickerReply.current) throw new Error("已有素材选择器正在打开");
          const kinds = Array.isArray(request.input?.kinds) ? request.input.kinds.filter((kind: unknown): kind is "image" | "video" | "audio" => kind === "image" || kind === "video" || kind === "audio") : [];
          if (!kinds.length) throw new Error("请声明可选择的素材类型");
          const multiple = request.input?.multiple === true;
          const selectedIDs = Array.isArray(request.input?.selectedIDs) ? request.input.selectedIDs.filter((id: unknown): id is string => typeof id === "string" && Boolean(id.trim())) : [];
          mediaPickerReply.current = (selection) => reply(selection);
          setMediaPicker({ kinds, multiple, selectedIDs });
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Recut Host 通信失败";
        console.error(`[recut-host] iframe response id=${String(request.id)} type=${String(request.type)} result=error: ${message}`);
        reply(undefined, message);
      }
    };
    console.debug(`[recut-host] iframe loaded; sending MessageChannel to ${new URL(appFrame.current.src).origin}`);
    postToFrame(appFrame.current, { type: "recut.ui.connect" }, [channel.port2]);
  }, [apiBase, project]);

  useEffect(() => {
    const receiveReady = (event: MessageEvent) => {
      const frame = appFrame.current;
      if (event.data?.type !== "recut.ui.ready" || !frame?.contentWindow) return;
      if (event.source !== frame.contentWindow || event.origin !== new URL(frame.src).origin) return;
      connectUI();
    };
    window.addEventListener("message", receiveReady);
    return () => window.removeEventListener("message", receiveReady);
  }, [connectUI]);

  const view = app?.manifest.ui?.projectView;
  const uiURL = project && view ? `${apiBase}/v1/apps/${encodeURIComponent(project.appId)}/ui/${view}?projectId=${encodeURIComponent(project.id)}&appVersion=${encodeURIComponent(app?.manifest.version ?? "")}` : null;
  const resolveMediaPicker = (selection: PlatformMediaPickerResult | null) => { mediaPickerReply.current?.(selection); mediaPickerReply.current = null; setMediaPicker(null); };

  return <main className="flex min-h-0 min-w-[1024px] flex-1 flex-col overflow-hidden bg-background">
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-5">
      <div className="flex min-w-0 items-center gap-4">
        <Link aria-label="返回项目列表" className="flex shrink-0 items-center gap-2" href="/"><ArrowLeft className="size-4" /><img alt="Recut" className="size-5 shrink-0 rounded-sm object-cover" src="/logo.jpg" /></Link>
        <div aria-hidden="true" className="h-5 w-px bg-border" />
        <div className="min-w-0"><p className="truncate text-sm font-medium">{project?.name ?? "加载项目…"}</p><p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{project ? `${app?.manifest.name ?? project.appId} · v${app?.manifest.version ?? project.appVersion} · ${project.id}` : "正在读取项目元信息"}</p></div>
      </div>
      <HeaderActions>{installation && <AppVersionControl app={installation} onUpdated={() => window.location.reload()} />}</HeaderActions>
    </header>
    <div className="min-h-0 flex-1 overflow-hidden md:pr-[var(--side-panel-width)]">
      <section className="h-full min-w-0 overflow-hidden border-r bg-card">
        {uiURL ? <iframe className="block h-full w-full border-0" onLoad={connectUI} ref={appFrame} src={uiURL} title={`${project?.name ?? "Recut"} App`} /> : <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">这个 App 没有声明项目 UI。</div>}
      </section>
    </div>
    <PlatformMediaPicker apiBase={apiBase} onCancel={() => resolveMediaPicker(null)} onPick={resolveMediaPicker} request={mediaPicker} />
  </main>;
}
