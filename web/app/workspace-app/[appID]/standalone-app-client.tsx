/*
 * [INPUT]: 依赖 workspace-store 的独立 App scope/manifest、media-configuration-store 的 Provider/凭据、App API、媒体生成、平台素材选择器、按 scope 缓存的 Agent Session 列表与全局 Agent 面板上下文
 * [OUTPUT]: 对外提供独立 App iframe 容器、按 iframe 实际 origin 的宿主通信、所有已连接 Provider 可用模型的受 scope 约束直生、AI 设置定位、全局素材选择和工作区级 Agent 对话侧栏；App 只能经全局面板上下文回填输入草稿（不再提供 agent.send 直发），对话与结果始终在全局 chat 中可见
 * [POS]: workspace-app/[appID] 的客户端工作台；从统一缓存复用项目级安全 scope，但不显示或创建用户项目；iframe URL 是消息目标 origin 的唯一真相源；Agent 面板由根布局全局挂载为单一会话，本页只声明素材上下文与草稿
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HeaderActions } from "@/components/header-actions";
import { PlatformMediaPicker, type PlatformMediaPickerRequest, type PlatformMediaPickerResult } from "@/components/platform-media-picker";
import { normalizePageContext } from "@/components/agent-panel-types";
import { useAgentStore } from "@/lib/agent-store";
import { useAgentPanelContext, useReportPageContext } from "@/lib/agent-panel-context";
import { streamServiceEndpoint } from "@/lib/service-endpoint";
import { useMediaConfigurationStore } from "@/lib/media-configuration-store";
import { useServiceStore } from "@/lib/service-store";
import { useWorkspaceStore } from "@/lib/workspace-store";

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

function postToFrame(frame: HTMLIFrameElement | null, message: unknown, transfer?: Transferable[]) {
  if (!frame?.contentWindow) return;
  const targetOrigin = new URL(frame.src).origin;
  if (transfer) frame.contentWindow.postMessage(message, targetOrigin, transfer);
  else frame.contentWindow.postMessage(message, targetOrigin);
}

export default function StandaloneAppClient() {
  const { appID: routeID } = useParams<{ appID: string }>();
  const [appID, setAppID] = useState("");
  const [mediaPicker, setMediaPicker] = useState<PlatformMediaPickerRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"multimodal" | undefined>();
  const apiBase = useServiceStore((state) => state.endpoint);
  const online = useServiceStore((state) => state.service.phase === "online");
  const apps = useWorkspaceStore((state) => state.apps);
  const installations = useWorkspaceStore((state) => state.installations);
  const scope = useWorkspaceStore((state) => appID ? state.workspaceScopesByAppID[appID] ?? null : null);
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const loadWorkspaceScope = useWorkspaceStore((state) => state.loadWorkspaceScope);
  const loadAgentSessions = useAgentStore((state) => state.loadSessions);
  const upsertAgentSession = useAgentStore((state) => state.upsertSession);
  const appFrame = useRef<HTMLIFrameElement>(null);
  const mediaPickerReply = useRef<((selection: PlatformMediaPickerResult | null) => void) | null>(null);
  const app = appID ? apps.find((item) => item.manifest.id === appID) ?? null : null;

  useEffect(() => { setAppID(appIDFromLocation(routeID)); }, [routeID]);
  useLayoutEffect(() => {
    useAgentPanelContext.getState().setProjectID(null);
  }, []);
  useReportPageContext(useMemo(() => (app ? { title: app.manifest.name, path: `/workspace-app/${appID}`, url: window.location.href } : null), [app, appID]));
  useEffect(() => {
    if (!appID || !online) return;
    void Promise.all([loadWorkspace(apiBase), loadWorkspaceScope(apiBase, appID)]);
  }, [apiBase, appID, loadWorkspace, loadWorkspaceScope, online]);

  useEffect(() => {
    if (!scope) return;
    const eventsURL = new URL("/v1/events", streamServiceEndpoint(apiBase));
    eventsURL.protocol = eventsURL.protocol === "https:" ? "wss:" : "ws:";
    const events = new WebSocket(eventsURL);
    events.addEventListener("open", () => events.send(JSON.stringify({ type: "subscribe", projectId: scope.id })));
    events.addEventListener("message", (message) => {
      const payload = JSON.parse(message.data) as { type?: string; event?: unknown };
      if (payload.type === "project.event") postToFrame(appFrame.current, { type: "recut.project.event", event: payload.event });
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
          const response = await fetch(`${apiBase}/v1/apps/${scope.appId}/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.type === "state.query" ? {} : input) });
          const payload = await response.json();
          reply(payload, response.ok ? undefined : operationError(payload, "后台调用失败"));
        } else if (request.type === "agent.compose") {
          const prompt = String(request.input?.prompt || "").trim();
          if (!prompt) throw new Error("Agent Prompt 不能为空");
          useAgentPanelContext.getState().setDraft({ id: String(request.id), text: prompt });
          reply({ delivery: "agent-composer" });
        } else if (request.type === "page.context") {
          const context = normalizePageContext(request.input?.context);
          if (!context) throw new Error("页面上下文需要标题");
          useAgentPanelContext.getState().setPageContext(context);
          reply({ delivery: "page-context" });
        } else if (request.type === "media.configuration") {
          await useMediaConfigurationStore.getState().load(apiBase);
          const configuration = useMediaConfigurationStore.getState();
          if (configuration.endpoint !== apiBase || configuration.state !== "ready") throw new Error("无法读取图片模型配置");
          const { providers, credentials } = configuration;
          const payload = credentials.filter((credential) => credential.secretSet).flatMap((credential) => {
            const provider = providers.find((item) => item.id === credential.provider);
            return (provider?.models ?? []).filter((model) => model.capability === "image.generate" && model.available).map((model) => ({ id: `${credential.id}:${model.id}`, model, credentialID: credential.id, credentialName: credential.name, providerName: provider?.name ?? credential.provider }));
          });
          reply(payload);
        } else if (request.type === "media.generate") {
          const prompt = String(request.input?.prompt || "").trim();
          const modelID = String(request.input?.modelID || "").trim();
          const credentialID = String(request.input?.credentialID || "").trim();
          const referenceIDs = Array.isArray(request.input?.referenceIDs) ? request.input.referenceIDs.filter((id: unknown): id is string => typeof id === "string" && Boolean(id.trim())) : [];
          if (!prompt || !modelID || !credentialID) throw new Error("图片生成需要 Prompt 和已连接模型");
          const response = await fetch(`${apiBase}/v1/media/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capability: "image.generate", prompt, modelId: modelID, credentialId: credentialID, referenceIds: referenceIDs }) });
          const payload = await response.json();
          reply(payload, response.ok ? undefined : operationError(payload, "无法创建图片生成任务"));
        } else if (request.type === "settings.open") {
          if (request.input?.section !== "multimodal") throw new Error("不支持的设置分类");
          setSettingsSection("multimodal");
          setSettingsOpen(true);
          reply({ delivery: "settings" });
        } else if (request.type === "media.pick") {
          if (mediaPickerReply.current) throw new Error("已有素材选择器正在打开");
          const kinds = Array.isArray(request.input?.kinds) ? request.input.kinds.filter((kind: unknown): kind is "image" | "video" | "audio" | "transcript" | "reference" => kind === "image" || kind === "video" || kind === "audio" || kind === "transcript" || kind === "reference") : [];
          if (!kinds.length) throw new Error("请声明可选择的素材类型");
          const multiple = request.input?.multiple === true;
          const selectedIDs = Array.isArray(request.input?.selectedIDs) ? request.input.selectedIDs.filter((id: unknown): id is string => typeof id === "string" && Boolean(id.trim())) : [];
          mediaPickerReply.current = (selection) => reply(selection);
          setMediaPicker({ kinds, multiple, selectedIDs });
        }
      } catch (cause) { reply(undefined, cause instanceof Error ? cause.message : "Recut Host 通信失败"); }
    };
    postToFrame(appFrame.current, { type: "recut.ui.connect" }, [channel.port2]);
  };

  const view = app?.manifest.ui?.standaloneView;
  const uiURL = scope && app && view ? `${apiBase}/v1/apps/${encodeURIComponent(app.manifest.id)}/ui/${view}?projectId=${encodeURIComponent(scope.id)}&appVersion=${encodeURIComponent(app.manifest.version)}` : null;
  const resolveMediaPicker = (selection: PlatformMediaPickerResult | null) => { mediaPickerReply.current?.(selection); mediaPickerReply.current = null; setMediaPicker(null); };
  const changeSettingsOpen = (open: boolean) => { setSettingsOpen(open); if (!open) setSettingsSection(undefined); };
  return <main className="flex min-h-0 min-w-[1024px] flex-1 flex-col overflow-hidden bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-5"><div className="flex min-w-0 items-center gap-4"><Link aria-label="返回首页" className="flex shrink-0 items-center gap-2" href="/"><ArrowLeft className="size-4" /><AppWindow className="size-4" /><strong className="text-sm tracking-tight">RECUT</strong></Link><div aria-hidden="true" className="h-5 w-px bg-border" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{app?.manifest.name ?? "工作区 App"}</p><p className="truncate font-mono text-[10px] text-muted-foreground">WORKSPACE APP · 不创建项目</p></div></div><HeaderActions onSettingsOpenChange={changeSettingsOpen} settingsOpen={settingsOpen} settingsSection={settingsSection} /></header>
    <div className="min-h-0 flex-1 overflow-hidden md:pl-[var(--side-panel-width)]"><section className="h-full min-w-0 overflow-hidden border-l bg-card">{uiURL ? <iframe className="block h-full w-full border-0" onLoad={connectUI} ref={appFrame} src={uiURL} title={app?.manifest.name ?? "Recut App"} /> : <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">正在准备独立 App 工作区…</div>}</section></div>
    <PlatformMediaPicker apiBase={apiBase} onCancel={() => resolveMediaPicker(null)} onPick={resolveMediaPicker} request={mediaPicker} />
  </main>;
}
