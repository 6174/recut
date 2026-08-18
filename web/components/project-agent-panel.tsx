/*
 * [INPUT]: 依赖按 endpoint 缓存的 Agent 运行时、模型、引导与会话列表、general scope 的 Agent Session/Media HTTP API、Agent 与媒体 SSE、AgentInstallGuide 共享安装正文、AgentInstallDialog 共享安装对话框及基础 UI 原子组件
 * [OUTPUT]: 对外提供单一全局 Agent 会话及其运行、调试、素材上下文与 Work Surface/Focus 发送逻辑；稳定工作面默认附带，完整 Focus 可独立移除，二者随每个 Turn 持久化
 * [POS]: components 的通用 Agent 侧栏；由根布局挂载，Work Surface 是本次操作目标的单一真相，Focus 只是可撤销的局部视线
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Bug, Check, History, MessageSquarePlus, Terminal } from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AgentInstallDialog } from "@/components/agent-install-dialog";
import {
  copyToClipboard,
  runtimeAgentName,
  type AgentRuntimeStatus,
  type Runtime,
} from "@/components/agent-install-guide";
import { AgentOnboarding } from "@/components/agent-onboarding";
import { Button } from "@/components/ui/button";
import { MediaAssetEventsProvider } from "@/components/use-media-asset-events";
import { Composer, RuntimePicker } from "@/components/agent-composer";
import {
  AgentRecoveryPanel,
  applyAgentEvent,
  CLIDebugDialog,
  Conversation,
  ConversationLoading,
  latestFailedTurn,
  messageOf,
  responseMessage,
  SessionHistory,
} from "@/components/agent-panel-views";
import {
  buildSessionDebugReport,
  defaultCodexConfiguration,
  defaultOpencodeConfiguration,
  creationWorldContextPayload,
  hasWorkFocusSelection,
  mediaContextPayload,
  workFocusContextPayload,
  workSurfaceContextPayload,
  type AgentEvent,
  type Attachment,
  type CLIEntry,
  type CodexConfiguration,
  type Detail,
  type MessageContext,
  type OpencodeConfiguration,
  type OpencodeModel,
  type Props,
  type Session,
  type UploadedAsset,
  type WorldReference,
} from "@/components/agent-panel-types";
import { useAgentStore } from "@/lib/agent-store";
import { getRealtimeChannel } from "@/lib/realtime-channel";
import { isDefaultServiceEndpoint, isLocalWorkspace } from "@/lib/service-endpoint";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
const EMPTY_SESSIONS: Session[] = [];
const EMPTY_OPENCODE_MODELS: OpencodeModel[] = [];
const serviceInstallCommand = "curl -fsSL https://recut.video/install.sh | sh";

export function ProjectAgentPanel(props: Props) {
  return (
    <MediaAssetEventsProvider apiBase={props.apiBase}>
      <ProjectAgentPanelContent {...props} />
    </MediaAssetEventsProvider>
  );
}
function ProjectAgentPanelContent({ apiBase, draft, projectID, servicePhase, workFocus, workSurface }: Props) {
  const { t } = useI18n();
  const online = servicePhase === "online";
  // 全局单一会话：不随路由切换改变会话或按页面过滤历史。
  const scope = "general";
  const sessions = useAgentStore((state) => state.sessionsByScope[scope] ?? EMPTY_SESSIONS);
  const runtimeStatus = useAgentStore((state) => state.runtimeStatus);
  const opencodeModels = useAgentStore((state) => state.opencodeModels ?? EMPTY_OPENCODE_MODELS);
  const cachedActiveID = useAgentStore((state) => state.activeSessionIDByScope[scope] ?? null);
  const loadCachedSessions = useAgentStore((state) => state.loadSessions);
  const loadCachedRuntimeStatus = useAgentStore((state) => state.loadRuntimeStatus);
  const loadCachedOpencodeModels = useAgentStore((state) => state.loadOpencodeModels);
  const upsertCachedSession = useAgentStore((state) => state.upsertSession);
  const loadCachedSessionDetail = useAgentStore((state) => state.loadSessionDetail);
  const setCachedActiveSession = useAgentStore((state) => state.setActiveSession);
  const upsertCachedSessionDetail = useAgentStore((state) => state.upsertSessionDetail);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [worldReferences, setWorldReferences] = useState<WorldReference[]>([]);
  const [workSurfaceIncluded, setWorkSurfaceIncluded] = useState(true);
  const [workFocusIncluded, setWorkFocusIncluded] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [creatingRuntime, setCreatingRuntime] = useState(false);
  const [syncingID, setSyncingID] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(online);
  const [error, setError] = useState("");
  const [stopNotice, setStopNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [cliOpen, setCLIOpen] = useState(false);
  const [cliEntries, setCLIEntries] = useState<CLIEntry[]>([]);
  const [cliAvailable, setCLIAvailable] = useState(true);
  const [debugCopyStatus, setDebugCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [installDialogAgent, setInstallDialogAgent] =
    useState<AgentRuntimeStatus | null>(null);
  const [pendingCodexConfig, setPendingCodexConfig] =
    useState<CodexConfiguration>(defaultCodexConfiguration);
  const [pendingOpencodeConfig, setPendingOpencodeConfig] =
    useState<OpencodeConfiguration>(defaultOpencodeConfiguration);
  const [serviceInstallCopyStatus, setServiceInstallCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [now, setNow] = useState(() => Date.now());
  const streamRef = useRef<{ unsubscribe: () => void } | null>(null);
  const cliStreamRef = useRef<{ unsubscribe: () => void } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const scopeVersionRef = useRef(0);
  const detailVersionRef = useRef(0);
  const activeIDRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const scopeVersion = ++scopeVersionRef.current;
    ++detailVersionRef.current;
    activeIDRef.current = null;
    streamRef.current?.unsubscribe();
    streamRef.current = null;
    cliStreamRef.current?.unsubscribe();
    cliStreamRef.current = null;
    setActiveID(null);
    setDetail(null);
    setSyncingID(null);
    setError("");
    setStopNotice("");
    setHistoryOpen(false);
    setRuntimeOpen(false);
    setCLIOpen(false);
    setCLIEntries([]);
    setDebugCopyStatus("idle");
    setLoadingSessions(online);
    if (online) {
      void loadSessions(scopeVersion);
      void loadRuntimeStatus(scopeVersion).then((status) => {
        if (status?.some((agent) => agent.id === "opencode" && agent.available)) void loadOpencodeModels(scopeVersion);
      });
    }
  }, [apiBase, online]);
  useEffect(
    () => () => {
      streamRef.current?.unsubscribe();
      cliStreamRef.current?.unsubscribe();
    },
    [],
  );
  // 实时通道断线重连后，立即与服务器会话详情对齐，避免 EventSource 时代
  // onerror 触发的 reconcile 在 channel 化后丢失。
  useEffect(() => {
    const channel = getRealtimeChannel(apiBase);
    const off = channel.onStatusChange((connected) => {
      if (connected && activeIDRef.current) {
        void refresh(
          activeIDRef.current,
          scopeVersionRef.current,
          detailVersionRef.current,
        ).catch(() => {});
      }
    });
    return off;
  }, [apiBase]);
  useEffect(() => {
    if (!draft?.text) return;
    setContent(draft.text);
    setAttachments([]);
    setError("");
  }, [draft]);
  useEffect(() => {
    setWorkSurfaceIncluded(true);
  }, [workSurface]);
  useEffect(() => {
    setWorkFocusIncluded(true);
  }, [workFocus]);
  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [detail?.turns.length, detail?.events.length]);
  useEffect(() => {
    if (detail?.status !== "running") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [detail?.status]);
  // The SSE events stream can silently stall (dropped EventSource, backgrounded
  // tab). While a turn runs, periodically re-sync from the server so a turn the
  // AI actually finished never leaves the "正在分析" indicator spinning.
  useEffect(() => {
    if (!activeID || detail?.status !== "running") return;
    const timer = window.setInterval(
      () => void refresh(activeID).catch(() => {}),
      10_000,
    );
    return () => window.clearInterval(timer);
  }, [activeID, detail?.status]);
  function isCurrentRequest(
    id: string,
    scopeVersion: number,
    detailVersion: number,
  ) {
    return (
      scopeVersion === scopeVersionRef.current &&
      detailVersion === detailVersionRef.current &&
      id === activeIDRef.current
    );
  }
  async function loadSessions(scopeVersion: number) {
    try {
      const next = await loadCachedSessions(apiBase, scope);
      if (scopeVersion !== scopeVersionRef.current) return;
      const selected = cachedActiveID && next.some((session) => session.id === cachedActiveID)
        ? cachedActiveID
        : next[0]?.id;
      if (selected) {
        await open(selected, scopeVersion);
        return;
      }
    } catch (cause) {
      if (scopeVersion !== scopeVersionRef.current) return;
      setError(interpolate(t("agent.panel.loadSessions.failed"), { message: messageOf(cause, t("agent.panel.retry")) }));
    }
    if (scopeVersion === scopeVersionRef.current) setLoadingSessions(false);
  }
  async function loadRuntimeStatus(scopeVersion = scopeVersionRef.current) {
    try {
      const next = await loadCachedRuntimeStatus(apiBase);
      return scopeVersion === scopeVersionRef.current ? next : null;
    } catch {
      return null;
    }
  }
  async function loadOpencodeModels(scopeVersion = scopeVersionRef.current) {
    try {
      await loadCachedOpencodeModels(apiBase);
    } catch {}
  }
  async function open(id: string, scopeVersion = scopeVersionRef.current) {
    const detailVersion = ++detailVersionRef.current;
    activeIDRef.current = id;
    streamRef.current?.unsubscribe();
    streamRef.current = null;
    setActiveID(id);
    setCachedActiveSession(apiBase, scope, id);
    setDetail(null);
    setError("");
    setSyncingID(id);
    setLoadingSessions(true);
    try {
      const next = await loadCachedSessionDetail(apiBase, id);
      if (!isCurrentRequest(id, scopeVersion, detailVersion)) return;
      setDetail(next);
      upsertCachedSessionDetail(apiBase, next);
      subscribe(id, next.lastEventId, scopeVersion, detailVersion);
    } catch (cause) {
      if (!isCurrentRequest(id, scopeVersion, detailVersion)) return;
      setDetail(null);
      setError(interpolate(t("agent.panel.loadConversation.failed"), { message: messageOf(cause, t("agent.panel.retry")) }));
    } finally {
      if (!isCurrentRequest(id, scopeVersion, detailVersion)) return;
      setSyncingID(null);
      setLoadingSessions(false);
    }
  }
  function subscribe(
    id: string,
    after: number,
    scopeVersion: number,
    detailVersion: number,
  ) {
    const handle = {
      unsubscribe: getRealtimeChannel(apiBase).subscribe(
        "agent",
        id,
        (frame) => {
          if (!isCurrentRequest(id, scopeVersion, detailVersion)) return;
          const incoming = frame.data as AgentEvent;
          setDetail((current) => {
            const next = current ? applyAgentEvent(current, incoming) : current;
            if (next) upsertCachedSessionDetail(apiBase, next);
            return next;
          });
          if (incoming.type === "turn.cancelled") setStopNotice(incoming.turnId ?? "");
          if (
            ["turn.started", "assistant.completed", "turn.completed", "turn.failed"].includes(
              incoming.type,
            )
          )
            setStopNotice("");
          if (
            [
              "assistant.completed",
              "turn.completed",
              "turn.failed",
              "turn.cancelled",
              "session.updated",
            ].includes(incoming.type)
          )
            void refresh(id, scopeVersion, detailVersion);
        },
        after,
      ),
    };
    streamRef.current = handle;
  }
  function openCLIStream() {
    if (!activeID) return;
    cliStreamRef.current?.unsubscribe();
    setCLIEntries([]);
    setCLIAvailable(true);
    setCLIOpen(true);
    // 订阅前先建立句柄，供输出帧内用于关闭；history 由服务端在订阅后立即回放。
    let handle: { unsubscribe: () => void } = { unsubscribe: () => {} };
    handle = {
      unsubscribe: getRealtimeChannel(apiBase).subscribe("cli", activeID, (frame) => {
        const data = frame.data as CLIEntry & { available?: boolean };
        if (data && "available" in data) {
          setCLIAvailable(false);
          handle.unsubscribe();
          return;
        }
        setCLIEntries((current) => [...current.slice(-399), data]);
      }),
    };
    cliStreamRef.current = handle;
  }
  function closeCLIStream() {
    cliStreamRef.current?.unsubscribe();
    cliStreamRef.current = null;
    setCLIOpen(false);
  }
  async function refresh(
    id: string,
    scopeVersion = scopeVersionRef.current,
    detailVersion = detailVersionRef.current,
  ) {
    const next = await loadCachedSessionDetail(apiBase, id, true);
    if (!isCurrentRequest(id, scopeVersion, detailVersion)) return;
    setDetail(next);
    upsertCachedSession(apiBase, scope, next);
    upsertCachedSessionDetail(apiBase, next);
  }
  async function createSession(runtime: Runtime) {
    if (creatingRuntime) return null;
    if (
      runtimeStatus?.find((agent) => agent.id === runtime)?.available === false
    ) {
      setError(
        interpolate(t("agent.panel.runtimeUnavailable"), { name: runtimeAgentName(runtime) }),
      );
      return null;
    }
    setCreatingRuntime(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        runtime,
      };
      if (runtime === "codex") {
        body.codexModel = pendingCodexConfig.codexModel;
        body.reasoningEffort = pendingCodexConfig.reasoningEffort;
      }
      if (runtime === "opencode") {
        body.opencodeModel = pendingOpencodeConfig.opencodeModel;
      }
      const response = await fetch(`${apiBase}/v1/agent-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(await responseMessage(response, t("agent.panel.create.fallback")));
      const session: Session = await response.json();
      upsertCachedSession(apiBase, scope, session);
      setRuntimeOpen(false);
      await open(session.id);
      return session;
    } catch (cause) {
      setError(interpolate(t("agent.panel.createConversation.failed"), { message: messageOf(cause, t("agent.panel.retryLater")) }));
      return null;
    } finally {
      setCreatingRuntime(false);
    }
  }
  async function addAsset(asset: UploadedAsset) {
    // Attachments are workspace-level Asset references: the turn carries only
    // assetIds and the Agent decides whether to attach them to a Project via
    // the recut.media.attach tool. No project linkage happens on the client.
    setAttachments((current) =>
      current.some((item) => item.assetId === asset.id)
        ? current
        : [
            ...current,
            {
              assetId: asset.id,
              name: asset.name,
              mimeType: asset.mimeType,
              kind: asset.kind,
              origin: asset.origin,
              status: asset.status,
            },
          ],
    );
  }
  async function uploadMedia(files: FileList | File[]) {
    const media = [...files].filter((file) =>
      /^(image|video|audio)\//.test(file.type),
    );
    if (!media.length) return;
    setUploading(true);
    setError("");
    try {
      await Promise.all(
        media.map(async (file) => {
          const body = new FormData();
          body.append("file", file);
          const response = await fetch(`${apiBase}/v1/media/assets`, {
            method: "POST",
            body,
          });
          if (!response.ok) throw new Error(t("agent.panel.uploadFailed"));
          await addAsset((await response.json()) as UploadedAsset);
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("agent.panel.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const workSurfaceAttached = Boolean(workSurface && workSurfaceIncluded);
    if (
      creatingRuntime ||
      loadingSessions ||
      (!content.trim() && !attachments.length && !worldReferences.length && !workSurfaceAttached)
    )
      return;
    const text = content.trim();
    const pendingAttachments = attachments;
    const pendingWorldReferences = worldReferences;
    const session = activeID
      ? null
      : await createSession((detail?.runtime as Runtime) ?? "codex");
    const sessionID = activeID ?? session?.id;
    if (!sessionID) return;
    const workSurfaceItem = workSurfaceAttached && workSurface ? [workSurfaceContextPayload(workSurface)] : [];
    const workFocusItem = workSurfaceAttached && hasWorkFocusSelection(workFocus) && workFocusIncluded && workFocus ? [workFocusContextPayload(workFocus)] : [];
    const contexts: MessageContext[] = [
      ...pendingAttachments.map((attachment) =>
        mediaContextPayload(attachment.assetId),
      ),
      ...pendingWorldReferences.map((world) => creationWorldContextPayload(world.worldId)),
      ...workSurfaceItem,
      ...workFocusItem,
    ];
    setContent("");
    setAttachments([]);
    setWorldReferences([]);
    setError("");
    setStopNotice("");
    const response = await fetch(
      `${apiBase}/v1/agent-sessions/${sessionID}/turns`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          contexts,
        }),
      },
    );
    if (!response.ok) {
      setContent(text);
      setAttachments(pendingAttachments);
      setWorldReferences(pendingWorldReferences);
      setError(interpolate(t("agent.panel.send.failed"), { message: await responseMessage(response, t("agent.panel.retry")) }));
      return;
    }
    await refresh(sessionID);
  }
  async function stop() {
    if (!activeID) return;
    setStopNotice(t("agent.panel.stopping"));
    setDetail((current) => {
      const next = current ? { ...current, status: "stopping" } : current;
      if (next) upsertCachedSessionDetail(apiBase, next);
      return next;
    });
    const response = await fetch(
      `${apiBase}/v1/agent-sessions/${activeID}/stop`,
      { method: "POST" },
    );
    if (!response.ok) {
      setStopNotice("");
      setError(t("agent.panel.stop.failed"));
      await refresh(activeID);
      return;
    }
    await refresh(activeID);
  }
  async function saveCodexConfiguration(next: CodexConfiguration) {
    if (!activeID) {
      setPendingCodexConfig(next);
      return true;
    }
    setError("");
    const response = await fetch(
      `${apiBase}/v1/agent-sessions/${activeID}/codex-configuration`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      },
    );
    if (!response.ok) {
      setError(t("agent.panel.codexSaveFailed"));
      return false;
    }
    await refresh(activeID);
    return true;
  }
  async function saveOpencodeConfiguration(next: OpencodeConfiguration) {
    if (!activeID) {
      setPendingOpencodeConfig(next);
      return true;
    }
    setError("");
    const response = await fetch(
      `${apiBase}/v1/agent-sessions/${activeID}/opencode-configuration`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      },
    );
    if (!response.ok) {
      setError(t("agent.panel.opencodeSaveFailed"));
      return false;
    }
    await refresh(activeID);
    return true;
  }
  if (servicePhase === "checking")
    return <aside aria-busy="true" aria-label={t("agent.panel.connecting")} className="h-full overflow-hidden bg-muted/40 p-4"><div className="space-y-3 pt-2"><div className="h-3 w-20 animate-pulse rounded-full bg-muted" /><div className="h-3 w-4/5 animate-pulse rounded-full bg-muted" /><div className="h-3 w-3/5 animate-pulse rounded-full bg-muted" /></div></aside>;
  if (!online) {
    const canInstallLocalService = !isLocalWorkspace && isDefaultServiceEndpoint(apiBase);
    async function copyServiceInstallCommand() {
      const copied = await copyToClipboard(serviceInstallCommand);
      setServiceInstallCopyStatus(copied ? "copied" : "failed");
      if (copied) window.setTimeout(() => setServiceInstallCopyStatus("idle"), 2200);
    }
    return (
      <aside className="h-full overflow-y-auto bg-muted/40 p-4">
        <p className="text-xs font-medium">{canInstallLocalService ? t("agent.panel.offline.title.local") : t("agent.panel.offline.title.remote")}</p>
        {canInstallLocalService ? <><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("agent.panel.offline.desc.local")}</p><code className="mt-3 block overflow-x-auto rounded-sm border bg-background px-2 py-2 text-[10px] text-foreground">{serviceInstallCommand}</code><Button className="mt-2 h-8 w-full" onClick={() => void copyServiceInstallCommand()} type="button" variant="outline">{serviceInstallCopyStatus === "copied" ? t("agent.panel.install.copied") : serviceInstallCopyStatus === "failed" ? t("agent.panel.install.copyFailed") : t("agent.panel.install.copy")}</Button></> : <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("agent.panel.offline.desc.remote")}</p>}
      </aside>
    );
  }
  const activeRuntime = (detail?.runtime ?? "codex") as Runtime;
  const creatingLabel = creatingRuntime
    ? interpolate(t("agent.panel.creating"), { name: runtimeAgentName(activeRuntime) })
    : "";
  const syncing = Boolean(activeID && syncingID === activeID);
  const activeAgent = runtimeStatus?.find(
    (agent) => agent.id === activeRuntime,
  );
  const unavailableRuntime =
    activeID && activeAgent && !activeAgent.available ? activeAgent : undefined;
  const noRuntimeReady =
    runtimeStatus !== null && !runtimeStatus.some((agent) => agent.available);
  const failedTurn = latestFailedTurn(detail);
  const chooseOnboarding = (prompt: string) => setContent(prompt);
  // recheckAgent re-fetches /v1/agents and refreshes the active session. When invoked from
  // the proactive install dialog with a targetID, it additionally closes the dialog as soon
  // as the target agent is reported available.
  async function recheckAgent(
    targetID?: string,
  ): Promise<AgentRuntimeStatus[] | null> {
    const status = await loadCachedRuntimeStatus(apiBase, true);
    if (status?.some((agent) => agent.id === "opencode" && agent.available)) {
      await loadCachedOpencodeModels(apiBase, true);
    }
    if (activeID) await refresh(activeID);
    if (targetID && status?.find((agent) => agent.id === targetID)?.available) {
      setInstallDialogAgent(null);
    }
    return status;
  }
  function openInstallDialog(agent: AgentRuntimeStatus) {
    setInstallDialogAgent(agent);
    setRuntimeOpen(false);
  }
  async function copySessionDebugReport() {
    if (!detail) return;
    const copied = await copyToClipboard(buildSessionDebugReport({ apiBase, detail, scope }));
    setDebugCopyStatus(copied ? "copied" : "failed");
    if (copied) window.setTimeout(() => setDebugCopyStatus("idle"), 2200);
  }
  if (!loadingSessions && unavailableRuntime)
    return (
      <AgentRecoveryPanel
        agent={unavailableRuntime}
        failure={failedTurn?.message ?? t("agent.recovery.unavailable")}
        onRecheck={async () => {
          await recheckAgent();
        }}
      />
    );
  if (!loadingSessions && noRuntimeReady)
    return (
      <>
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
          <header className="flex h-10 shrink-0 items-center border-b bg-card px-4">
            <p className="text-xs font-semibold tracking-wide">AI</p>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
            <AgentOnboarding
              apiBase={apiBase}
              onChoose={chooseOnboarding}
              onInstall={openInstallDialog}
              projectID={projectID}
              runtimeStatus={runtimeStatus}
            />
          </div>
        </aside>
        <AgentInstallDialog
          agent={installDialogAgent}
          onClose={() => setInstallDialogAgent(null)}
          onRecheck={() => recheckAgent(installDialogAgent?.id)}
          open={installDialogAgent !== null}
        />
      </>
    );
  return (
    <>
      <aside className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <header className="flex h-10 shrink-0 items-center justify-between border-b bg-card px-4">
          <p className="text-xs font-semibold tracking-wide">AI</p>
          <div className="flex items-center gap-1">
            <Button
              aria-label={debugCopyStatus === "copied" ? t("agent.debug.copied") : t("agent.debug.copy")}
              className="size-7 px-0"
              disabled={!detail || creatingRuntime || loadingSessions}
              onClick={() => void copySessionDebugReport()}
              title={
                debugCopyStatus === "copied"
                  ? t("agent.debug.copied")
                  : debugCopyStatus === "failed"
                    ? t("agent.debug.copyFailed")
                    : t("agent.debug.copy")
              }
              type="button"
              variant="ghost"
            >
              {debugCopyStatus === "copied" ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Bug className="size-3.5" />
              )}
            </Button>
            <Button
              className="size-7 px-0"
              disabled={!activeID || creatingRuntime || loadingSessions}
              onClick={openCLIStream}
              title={t("agent.debug.viewCli")}
              type="button"
              variant="ghost"
            >
              <Terminal className="size-3.5" />
            </Button>
            <Button
              className="size-7 px-0"
              disabled={creatingRuntime || loadingSessions}
              onClick={() => {
                setRuntimeOpen(false);
                setHistoryOpen((value) => !value);
              }}
              title={t("agent.history.title")}
              type="button"
              variant="ghost"
            >
              <History className="size-3.5" />
            </Button>
            <Button
              className="size-7 px-0"
              disabled={creatingRuntime || loadingSessions}
              onClick={() => {
                setHistoryOpen(false);
                setRuntimeOpen((value) => !value);
              }}
              title={t("agent.panel.newConversation")}
              type="button"
              variant="ghost"
            >
              <MessageSquarePlus className="size-3.5" />
            </Button>
          </div>
        </header>
        {runtimeOpen && (
          <RuntimePicker
            creating={creatingRuntime}
            onChoose={(runtime) => void createSession(runtime)}
            onInstall={openInstallDialog}
            runtimeStatus={runtimeStatus ?? []}
          />
        )}
        {historyOpen && (
          <SessionHistory
            activeID={activeID}
            label={historyLabel(t, scope)}
            onOpen={(id) => {
              setHistoryOpen(false);
              void open(id);
            }}
            sessions={sessions}
          />
        )}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-72"
          ref={messagesRef}
        >
          {loadingSessions ? (
            <ConversationLoading />
          ) : (
            <>
              {creatingLabel && (
                <p
                  aria-live="polite"
                  className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span className="size-1.5 animate-pulse rounded-full bg-warning" />
                  {creatingLabel}
                </p>
              )}
              {syncing && (
                <p
                  aria-live="polite"
                  className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                  {t("agent.panel.syncing")}
                </p>
              )}
              {error && (
                <p className="mb-4 text-xs text-destructive">{error}</p>
              )}
              {stopNotice && !currentTurnHasReply(detail, stopNotice) && (
                <p className="mb-4 text-xs text-muted-foreground">
                  {t("agent.panel.stopped")}
                </p>
              )}
              {!detail || detail.turns.length === 0 ? (
                <AgentOnboarding
                  apiBase={apiBase}
                  onChoose={chooseOnboarding}
                  onInstall={openInstallDialog}
                  projectID={projectID}
                  runtimeStatus={runtimeStatus ?? []}
                />
              ) : (
                <Conversation apiBase={apiBase} detail={detail} now={now} />
              )}
            </>
          )}
        </div>
        <Composer
          apiBase={apiBase}
          attachments={attachments}
          codexConfiguration={
            detail?.codexModel || detail?.reasoningEffort
              ? {
                  codexModel:
                    detail.codexModel || defaultCodexConfiguration.codexModel,
                  reasoningEffort:
                    detail.reasoningEffort ||
                    defaultCodexConfiguration.reasoningEffort,
                }
              : pendingCodexConfig
          }
          content={content}
          disabled={creatingRuntime || syncing || loadingSessions}
          firstTurn={!detail}
          onAddAsset={(asset) =>
            void addAsset(asset).catch((cause) =>
              setError(cause instanceof Error ? cause.message : t("agent.panel.addAssetFailed")),
            )
          }
          onAddWorld={(world) => setWorldReferences((current) => current.some((item) => item.worldId === world.worldId) ? current : [...current, world])}
          onChange={setContent}
          onRemoveAttachment={(assetID) =>
            setAttachments((current) =>
              current.filter((attachment) => attachment.assetId !== assetID),
            )
          }
          onRemoveWorld={(worldID) => setWorldReferences((current) => current.filter((world) => world.worldId !== worldID))}
          onSaveCodexConfiguration={saveCodexConfiguration}
          onSaveOpencodeConfiguration={saveOpencodeConfiguration}
          onSend={send}
          onStop={() => void stop()}
          onUpload={uploadMedia}
          opencodeConfiguration={
            detail?.opencodeModel
              ? { opencodeModel: detail.opencodeModel }
              : pendingOpencodeConfig
          }
          opencodeModels={opencodeModels}
          onRemoveWorkFocus={() => setWorkFocusIncluded(false)}
          onRemoveWorkSurface={() => setWorkSurfaceIncluded(false)}
          workFocus={workFocus ?? null}
          workFocusIncluded={workFocusIncluded}
          workSurface={workSurface ?? null}
          workSurfaceIncluded={workSurfaceIncluded}
          projectID={projectID}
          runtime={(detail?.runtime as Runtime | undefined) ?? "codex"}
          running={
            detail?.status === "running" || detail?.status === "stopping"
          }
          stopping={detail?.status === "stopping"}
          uploading={uploading}
          worldReferences={worldReferences}
        />
      </aside>
      <AgentInstallDialog
        agent={installDialogAgent}
        onClose={() => setInstallDialogAgent(null)}
        onRecheck={() => recheckAgent(installDialogAgent?.id)}
        open={installDialogAgent !== null}
      />
      {cliOpen && (
        <CLIDebugDialog
          available={cliAvailable}
          entries={cliEntries}
          onClose={closeCLIStream}
        />
      )}
    </>
  );
}

function currentTurnHasReply(detail: Detail | null, turnID?: string) {
  if (!detail || !turnID) return false;
  const userIndex = detail.turns.findIndex((turn) => turn.id === turnID);
  if (userIndex < 0) return false;
  return detail.turns.slice(userIndex + 1).some((turn) => turn.role === "assistant");
}

// 会话历史标签：scope 分类为本地静态文案，按当前 locale 从字典取值。
function historyLabel(t: (key: string) => string, scope: string): string {
  if (scope === "general") return t("agent.history.general");
  if (scope === "media") return t("agent.history.media");
  if (scope.startsWith("app:")) return t("agent.history.app");
  if (scope.startsWith("project:")) return t("agent.history.project");
  return t("agent.history.default");
}
