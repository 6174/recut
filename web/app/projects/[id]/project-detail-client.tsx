/*
 * [INPUT]: 依赖全局 Zustand service 状态、workspace-store 的项目/App/安装状态、平台素材选择器、Assets bridge、可编辑项目名称、按 scope 缓存的 Agent Session 列表、全局 Agent 面板上下文与 Next.js 浏览器路由参数
 * [OUTPUT]: 对外提供通用项目 App UI 容器、按 iframe 实际 origin 转发的项目事件、全局素材选择、受 project scope 限制的 recut.assets 能力、项目名称编辑与结构化 Agent 请求转交；App 只能经全局面板上下文回填左侧 Agent 输入草稿（不再提供 agent.send 直发），对话与结果始终在全局 chat 中可见
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
import { EditableProjectName } from "./editable-project-name";
import { normalizeWorkFocus } from "@/components/agent-panel-types";
import { useAgentStore } from "@/lib/agent-store";
import { useAgentPanelContext, useReportWorkSurface } from "@/lib/agent-panel-context";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { recutHeaders } from "@/lib/service-endpoint";
import { getRealtimeChannel } from "@/lib/realtime-channel";
import { useServiceStore } from "@/lib/service-store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { handleIframeAssetsRequest } from "@/lib/iframe-assets-bridge";

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
  const { t, locale } = useI18n();
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
  const frameReady = useRef(false);
  const pendingProjectEvents = useRef<unknown[]>([]);
  const mediaPickerReply = useRef<((selection: PlatformMediaPickerResult | null) => void) | null>(null);
  const app = project ? apps.find((item) => item.manifest.id === project.appId) ?? null : null;
  const installation = project ? installations.find((item) => item.manifest.id === project.appId) ?? null : null;

  useEffect(() => { setID(projectIDFromLocation(routeID)); }, [routeID]);
  useLayoutEffect(() => {
    useAgentPanelContext.getState().setProjectID(project?.id ?? null);
  }, [project?.id]);
  useReportWorkSurface(useMemo(() => {
    if (!project || !app) return null;
    const agentSurface = app.manifest.agentSurface;
    return {
      version: 1 as const,
      surface: "project" as const,
      title: project.name,
      path: `/projects/${id}`,
      url: window.location.href,
      target: { kind: "project" as const, projectId: project.id, appId: project.appId, appName: app.manifest.name, appKind: "project" as const },
      policy: {
        defaultIntent: agentSurface?.defaultIntent ?? "project_edit" as const,
        requiredSkill: agentSurface?.requiredSkill ? { appId: project.appId, skillId: agentSurface.requiredSkill } : undefined,
      },
    };
  }, [app, id, project]));
  useEffect(() => {
    if (!id || !online) return;
    void Promise.all([loadWorkspace(apiBase), loadProject(apiBase, id)]);
  }, [apiBase, id, loadProject, loadWorkspace, online]);

  useEffect(() => {
    if (!project) return;
    frameReady.current = false;
    pendingProjectEvents.current = [];
    return () => {
      frameReady.current = false;
      pendingProjectEvents.current = [];
    };
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    const channel = getRealtimeChannel(apiBase);
    const unsubscribe = channel.subscribe("project", project.id, (frame) => {
      if (frame.type !== "project.event") return;
      const message = { type: "recut.project.event", event: frame.event };
      if (!frameReady.current) {
        pendingProjectEvents.current.push(message);
        if (pendingProjectEvents.current.length > 64) pendingProjectEvents.current.shift();
        return;
      }
      postToFrame(appFrame.current, message);
    });
    return unsubscribe;
  }, [apiBase, project]);

  const connectUI = useCallback(() => {
    if (!appFrame.current || !project) return;
    frameReady.current = true;
    const channel = new MessageChannel();
    channel.port1.onmessage = async (event) => {
      const request = event.data; const reply = (result?: unknown, error?: string) => channel.port1.postMessage({ id: request.id, result, error });
      console.debug(`[recut-host] iframe request id=${String(request.id)} type=${String(request.type)}`);
      try {
        if (request.type === "state.query") {
          const response = await fetch(`${apiBase}/v1/projects/${project.id}/apps/${project.appId}/api/${request.input.name}`, { method: "POST", headers: { "Content-Type": "application/json", ...recutHeaders() }, body: "{}" });
          const payload = await response.json();
          reply(payload, response.ok ? undefined : operationError(payload, t("detail.operation.state")));
          console.debug(`[recut-host] iframe response id=${String(request.id)} type=state.query result=${response.ok ? "ok" : "error"}`);
        } else if (request.type === "background.call") {
          const operation = request.input?.operation ?? request.input?.name;
          const { operation: _operation, ...input } = request.input ?? {};
          const response = await fetch(`${apiBase}/v1/projects/${project.id}/apps/${project.appId}/api/${operation}`, { method: "POST", headers: { "Content-Type": "application/json", ...recutHeaders() }, body: JSON.stringify(input) });
          const payload = await response.json();
          reply(payload, response.ok ? undefined : operationError(payload, t("detail.operation.background")));
          console.debug(`[recut-host] iframe response id=${String(request.id)} type=background.call result=${response.ok ? "ok" : "error"}`);
        } else {
          const assets = await handleIframeAssetsRequest(request, { apiBase, projectID: project.id, headers: recutHeaders() });
          if (assets.handled) {
            reply(assets.result);
          } else if (request.type === "agent.compose") {
          const prompt = String(request.input?.prompt || "").trim();
          if (!prompt) throw new Error(t("detail.operation.prompt"));
          useAgentPanelContext.getState().setDraft({ id: String(request.id), text: prompt });
          reply({ delivery: "agent-composer" });
          console.debug(`[recut-host] iframe response id=${String(request.id)} type=agent.compose result=ok`);
        } else if (request.type === "focus.report" || request.type === "page.context") {
          const focus = normalizeWorkFocus(request.input?.focus ?? request.input?.context);
          if (!focus) throw new Error(t("detail.operation.context"));
          useAgentPanelContext.getState().setWorkFocus(focus);
          reply({ delivery: "work-focus" });
          console.debug(`[recut-host] iframe response id=${String(request.id)} type=${String(request.type)} result=ok`);
        } else if (request.type === "media.pick") {
          if (mediaPickerReply.current) throw new Error(t("detail.operation.pickerBusy"));
          const kinds = Array.isArray(request.input?.kinds) ? request.input.kinds.filter((kind: unknown): kind is "image" | "video" | "audio" | "transcript" | "reference" => kind === "image" || kind === "video" || kind === "audio" || kind === "transcript" || kind === "reference") : [];
          if (!kinds.length) throw new Error(t("detail.operation.kinds"));
          const multiple = request.input?.multiple === true;
          const selectedIDs = Array.isArray(request.input?.selectedIDs) ? request.input.selectedIDs.filter((id: unknown): id is string => typeof id === "string" && Boolean(id.trim())) : [];
          mediaPickerReply.current = (selection) => reply(selection);
          setMediaPicker({ kinds, multiple, selectedIDs });
          }
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : t("detail.operation.host");
        console.error(`[recut-host] iframe response id=${String(request.id)} type=${String(request.type)} result=error: ${message}`);
        reply(undefined, message);
      }
    };
    console.debug(`[recut-host] iframe loaded; sending MessageChannel to ${new URL(appFrame.current.src).origin}`);
    postToFrame(appFrame.current, { type: "recut.ui.connect" }, [channel.port2]);
    const pending = pendingProjectEvents.current.splice(0);
    for (const message of pending) postToFrame(appFrame.current, message);
  }, [apiBase, project, t]);

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
  const uiURL = project && view ? `${apiBase}/v1/apps/${encodeURIComponent(project.appId)}/ui/${view}?projectId=${encodeURIComponent(project.id)}&appVersion=${encodeURIComponent(app?.manifest.version ?? "")}&locale=${encodeURIComponent(locale)}` : null;
  const resolveMediaPicker = (selection: PlatformMediaPickerResult | null) => { mediaPickerReply.current?.(selection); mediaPickerReply.current = null; setMediaPicker(null); };
  const refreshProject = async () => {
    if (!project) return;
    await Promise.all([loadWorkspace(apiBase, true), loadProject(apiBase, project.id, true)]);
  };

  return <main className="flex min-h-0 min-w-[1024px] flex-1 flex-col overflow-hidden bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-5">
      <div className="flex min-w-0 items-center gap-4">
        <Link aria-label={t("detail.back")} className="flex shrink-0 items-center gap-2" href="/"><ArrowLeft className="size-4" /><img alt="Recut" className="size-5 shrink-0 rounded-sm object-cover" src="/logo.jpg" /></Link>
        <div aria-hidden="true" className="h-5 w-px bg-border" />
        <div className="min-w-0">{project ? <EditableProjectName apiBase={apiBase} name={project.name} onRenamed={refreshProject} projectID={project.id} /> : <p className="truncate text-sm font-medium">{t("detail.loading")}</p>}<p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{project ? `${app?.manifest.name ?? project.appId} · v${app?.manifest.version ?? project.appVersion} · ${project.id}` : t("detail.loading.meta")}</p></div>
      </div>
      <HeaderActions>{installation && <AppVersionControl app={installation} onUpdated={() => window.location.reload()} />}</HeaderActions>
    </header>
    <div className="min-h-0 flex-1 overflow-hidden md:pl-[var(--side-panel-width)]">
      <section className="h-full min-w-0 overflow-hidden border-l bg-card">
        {uiURL ? <iframe allow="fullscreen" className="block h-full w-full border-0" onLoad={connectUI} ref={appFrame} src={uiURL} title={interpolate(t("detail.frame.title"), { name: project?.name ?? "Recut" })} /> : <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">{t("detail.noUI")}</div>}
      </section>
    </div>
    <PlatformMediaPicker apiBase={apiBase} onCancel={() => resolveMediaPicker(null)} onPick={resolveMediaPicker} request={mediaPicker} />
  </main>;
}
