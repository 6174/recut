/*
 * [INPUT]: 依赖项目或 general scope 的 Agent Session/Media HTTP API、Agent 与媒体 SSE、AgentInstallGuide 共享安装正文、AgentInstallDialog 共享安装对话框及基础 UI 原子组件
 * [OUTPUT]: 对外提供带非空新对话 onboarding、本地 Agent CLI 主动安装入口、当前会话的易读时间线与原始 CLI stdout/stderr 调试弹框、项目与 general scope、首条消息自动创建所选 runtime 会话、按 Agent 类型优先展示配置模型的会话历史、作用域切换时同步 Loading 且拒绝过期请求回写的对话加载、创建/同步/重试均可见的状态、输入法保护、图片上传/粘贴上下文、Codex 模型/推理强度配置与可搜索的实时 OpenCode TUI 模型配置的时间线预览的 ProjectAgentPanel；失效 session 自动收敛为空态，工具调用以行内卡片展示分离的输入、输出/错误、成本与耗时，含 `assetIds` 的结果直接显示可点击素材预览，并可完整查看或复制；全部本地 CLI 未就绪时只保留安装入口，不渲染无效的新对话引导或输入框
 * [POS]: components 的通用 Agent 侧栏；首页无项目时自动使用隐藏 general scope，存在可用 runtime 的空态允许直接输入并在发送时创建会话，运行期间的用户消息持久化排队，每张项目媒体以资产引用绑定到对应用户 Turn，并为内部预览提供共享 Asset 缓存
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { History, MessageSquarePlus, Terminal } from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AgentInstallDialog } from "@/components/agent-install-dialog";
import {
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
  isCLIUnavailableFailure,
  latestFailedTurn,
  messageOf,
  responseMessage,
  SessionHistory,
} from "@/components/agent-panel-views";
import {
  defaultCodexConfiguration,
  defaultOpencodeConfiguration,
  type AgentEvent,
  type Attachment,
  type CLIEntry,
  type CodexConfiguration,
  type Detail,
  type OpencodeConfiguration,
  type OpencodeModel,
  type Props,
  type Session,
  type UploadedAsset,
} from "@/components/agent-panel-types";

export function ProjectAgentPanel(props: Props) {
  return (
    <MediaAssetEventsProvider apiBase={props.apiBase}>
      <ProjectAgentPanelContent {...props} />
    </MediaAssetEventsProvider>
  );
}
function ProjectAgentPanelContent({ apiBase, online, projectID }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
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
  const [installDialogAgent, setInstallDialogAgent] =
    useState<AgentRuntimeStatus | null>(null);
  const [pendingCodexConfig, setPendingCodexConfig] =
    useState<CodexConfiguration>(defaultCodexConfiguration);
  const [pendingOpencodeConfig, setPendingOpencodeConfig] =
    useState<OpencodeConfiguration>(defaultOpencodeConfiguration);
  const [opencodeModels, setOpencodeModels] = useState<OpencodeModel[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [runtimeStatus, setRuntimeStatus] = useState<
    AgentRuntimeStatus[] | null
  >(null);
  const [acknowledgedFailureID, setAcknowledgedFailureID] = useState<
    string | null
  >(null);
  const streamRef = useRef<EventSource | null>(null);
  const cliStreamRef = useRef<EventSource | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const scopeVersionRef = useRef(0);
  const detailVersionRef = useRef(0);
  const activeIDRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const scopeVersion = ++scopeVersionRef.current;
    ++detailVersionRef.current;
    activeIDRef.current = null;
    streamRef.current?.close();
    streamRef.current = null;
    cliStreamRef.current?.close();
    cliStreamRef.current = null;
    setSessions([]);
    setActiveID(null);
    setDetail(null);
    setSyncingID(null);
    setError("");
    setStopNotice("");
    setHistoryOpen(false);
    setRuntimeOpen(false);
    setCLIOpen(false);
    setCLIEntries([]);
    setRuntimeStatus(null);
    setOpencodeModels([]);
    setLoadingSessions(online);
    if (online) {
      void loadSessions(scopeVersion);
      void loadRuntimeStatus(scopeVersion);
      void loadOpencodeModels(scopeVersion);
    }
  }, [apiBase, online, projectID]);
  useEffect(
    () => () => {
      streamRef.current?.close();
      cliStreamRef.current?.close();
    },
    [],
  );
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
    const scope = projectID
      ? `projectId=${encodeURIComponent(projectID)}`
      : "scope=general";
    try {
      const response = await fetch(`${apiBase}/v1/agent-sessions?${scope}`);
      if (!response.ok)
        throw new Error(await responseMessage(response, "无法读取会话列表"));
      const next: Session[] = await response.json();
      if (scopeVersion !== scopeVersionRef.current) return;
      setSessions(next);
      const selected = next[0]?.id;
      if (selected) {
        await open(selected, scopeVersion);
        return;
      }
    } catch (cause) {
      if (scopeVersion !== scopeVersionRef.current) return;
      setError(`无法加载会话：${messageOf(cause, "请重试")}`);
    }
    if (scopeVersion === scopeVersionRef.current) setLoadingSessions(false);
  }
  async function loadRuntimeStatus(scopeVersion = scopeVersionRef.current) {
    try {
      const response = await fetch(`${apiBase}/v1/agents`);
      if (!response.ok) return null;
      const next = (await response.json()) as AgentRuntimeStatus[];
      if (scopeVersion === scopeVersionRef.current) setRuntimeStatus(next);
      return next;
    } catch {
      return null;
    }
  }
  async function loadOpencodeModels(scopeVersion = scopeVersionRef.current) {
    try {
      const response = await fetch(`${apiBase}/v1/agents/opencode/models`);
      if (!response.ok) return;
      const next = (await response.json()) as OpencodeModel[];
      if (scopeVersion === scopeVersionRef.current) setOpencodeModels(next);
    } catch {}
  }
  async function open(id: string, scopeVersion = scopeVersionRef.current) {
    const detailVersion = ++detailVersionRef.current;
    activeIDRef.current = id;
    streamRef.current?.close();
    streamRef.current = null;
    setActiveID(id);
    setDetail(null);
    setError("");
    setSyncingID(id);
    setLoadingSessions(true);
    try {
      const response = await fetch(`${apiBase}/v1/agent-sessions/${id}`);
      if (!response.ok)
        throw new Error(await responseMessage(response, "无法读取对话"));
      const next: Detail = await response.json();
      if (!isCurrentRequest(id, scopeVersion, detailVersion)) return;
      setDetail(next);
      subscribe(id, next.lastEventId, scopeVersion, detailVersion);
    } catch (cause) {
      if (!isCurrentRequest(id, scopeVersion, detailVersion)) return;
      setDetail(null);
      setError(`无法加载对话：${messageOf(cause, "请重试")}`);
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
    const stream = new EventSource(
      `${apiBase}/v1/agent-sessions/${id}/events?after=${after}`,
    );
    stream.addEventListener("agent", (event) => {
      if (
        !isCurrentRequest(id, scopeVersion, detailVersion) ||
        streamRef.current !== stream
      )
        return;
      const incoming = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as AgentEvent;
      setDetail((current) =>
        current ? applyAgentEvent(current, incoming) : current,
      );
      if (incoming.type === "turn.cancelled") setStopNotice("已停止当前回复");
      if (incoming.type === "turn.started") setStopNotice("");
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
    });
    streamRef.current = stream;
  }
  function openCLIStream() {
    if (!activeID) return;
    cliStreamRef.current?.close();
    setCLIEntries([]);
    setCLIAvailable(true);
    setCLIOpen(true);
    const stream = new EventSource(
      `${apiBase}/v1/agent-sessions/${activeID}/cli-stream`,
    );
    // EventSource may dispatch the replayed history immediately. Publish this
    // instance before registering handlers so the first CLI line is never
    // mistaken for output from the prior dialog connection.
    cliStreamRef.current = stream;
    stream.addEventListener("output", (event) => {
      if (cliStreamRef.current !== stream) return;
      const incoming = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as CLIEntry;
      setCLIEntries((current) => [...current.slice(-399), incoming]);
    });
    stream.addEventListener("status", () => {
      if (cliStreamRef.current !== stream) return;
      setCLIAvailable(false);
      stream.close();
    });
    stream.onerror = () => {
      if (cliStreamRef.current === stream) stream.close();
    };
  }
  function closeCLIStream() {
    cliStreamRef.current?.close();
    cliStreamRef.current = null;
    setCLIOpen(false);
  }
  async function refresh(
    id: string,
    scopeVersion = scopeVersionRef.current,
    detailVersion = detailVersionRef.current,
  ) {
    const response = await fetch(`${apiBase}/v1/agent-sessions/${id}`);
    if (!response.ok || !isCurrentRequest(id, scopeVersion, detailVersion))
      return;
    const next: Detail = await response.json();
    if (!isCurrentRequest(id, scopeVersion, detailVersion)) return;
    setDetail(next);
    setSessions((current) => [
      next,
      ...current.filter((session) => session.id !== id),
    ]);
  }
  async function createSession(runtime: Runtime) {
    if (creatingRuntime) return null;
    if (
      runtimeStatus?.find((agent) => agent.id === runtime)?.available === false
    ) {
      setError(
        `${runtimeAgentName(runtime)} CLI 未就绪，请先完成面板中的安装指引。`,
      );
      return null;
    }
    setCreatingRuntime(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        ...(projectID ? { projectId: projectID } : {}),
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
        throw new Error(await responseMessage(response, "无法创建对话"));
      const session: Session = await response.json();
      setSessions((current) => [session, ...current]);
      setRuntimeOpen(false);
      await open(session.id);
      return session;
    } catch (cause) {
      setError(`无法创建对话：${messageOf(cause, "请稍后重试")}`);
      return null;
    } finally {
      setCreatingRuntime(false);
    }
  }
  async function addAsset(asset: UploadedAsset) {
    if (!projectID) throw new Error("请先选择一个项目");
    const attached = await fetch(
      `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/attach`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectID }),
      },
    );
    if (!attached.ok) throw new Error("资源无法加入当前项目");
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
    if (!projectID) {
      setError("通用对话暂不支持项目素材附件。");
      return;
    }
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
          if (!response.ok) throw new Error("素材上传失败");
          await addAsset((await response.json()) as UploadedAsset);
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "素材上传失败");
    } finally {
      setUploading(false);
    }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      creatingRuntime ||
      loadingSessions ||
      (!content.trim() && !attachments.length)
    )
      return;
    const text = content.trim();
    const pendingAttachments = attachments;
    const session = activeID
      ? null
      : await createSession((detail?.runtime as Runtime) ?? "codex");
    const sessionID = activeID ?? session?.id;
    if (!sessionID) return;
    setContent("");
    setAttachments([]);
    setError("");
    setStopNotice("");
    const response = await fetch(
      `${apiBase}/v1/agent-sessions/${sessionID}/turns`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          assetIds: pendingAttachments.map((attachment) => attachment.assetId),
        }),
      },
    );
    if (!response.ok) {
      setContent(text);
      setAttachments(pendingAttachments);
      setError(`无法发送消息：${await responseMessage(response, "请重试")}`);
      return;
    }
    await refresh(sessionID);
  }
  async function stop() {
    if (!activeID) return;
    setStopNotice("正在停止当前回复…");
    setDetail((current) =>
      current ? { ...current, status: "stopping" } : current,
    );
    const response = await fetch(
      `${apiBase}/v1/agent-sessions/${activeID}/stop`,
      { method: "POST" },
    );
    if (!response.ok) {
      setStopNotice("");
      setError("无法停止当前回复");
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
      setError("无法保存 Codex 配置");
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
      setError("无法保存 OpenCode 配置");
      return false;
    }
    await refresh(activeID);
    return true;
  }
  if (!online)
    return (
      <aside className="h-full overflow-y-auto bg-muted/40 p-4">
        <p className="text-xs font-medium">Agent 暂不可用</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          本地服务恢复后，会话与记录会自动回到这里。
        </p>
      </aside>
    );
  const activeRuntime = (detail?.runtime ?? "codex") as Runtime;
  const creatingLabel = creatingRuntime
    ? `正在创建 ${runtimeAgentName(activeRuntime)} 对话…`
    : "";
  const syncing = Boolean(activeID && syncingID === activeID);
  const activeAgent = runtimeStatus?.find(
    (agent) => agent.id === activeRuntime,
  );
  const unavailableRuntime =
    activeID && activeAgent && !activeAgent.available ? activeAgent : undefined;
  const noRuntimeReady =
    runtimeStatus !== null && !runtimeStatus.some((agent) => agent.available);
  const failedTurn =
    activeRuntime === "codex" || activeRuntime === "opencode"
      ? latestFailedTurn(detail)
      : null;
  const historicalMissingCLI =
    activeAgent?.available &&
    isCLIUnavailableFailure(failedTurn?.message ?? "");
  const startupFailure =
    failedTurn?.id === acknowledgedFailureID || historicalMissingCLI
      ? ""
      : (failedTurn?.message ?? "");
  const chooseOnboarding = (prompt: string) => setContent(prompt);
  // recheckAgent re-fetches /v1/agents and refreshes the active session. When invoked from
  // the proactive install dialog with a targetID, it additionally closes the dialog as soon
  // as the target agent is reported available. The recovery panel calls it without a target.
  async function recheckAgent(
    targetID?: string,
  ): Promise<AgentRuntimeStatus[] | null> {
    const status = await loadRuntimeStatus();
    if (activeID) await refresh(activeID);
    if (targetID && status?.find((agent) => agent.id === targetID)?.available) {
      setAcknowledgedFailureID(failedTurn?.id ?? null);
      setInstallDialogAgent(null);
    } else if (
      !targetID &&
      status?.find((agent) => agent.id === activeRuntime)?.available
    ) {
      setAcknowledgedFailureID(failedTurn?.id ?? null);
    }
    return status;
  }
  function openInstallDialog(agent: AgentRuntimeStatus) {
    setInstallDialogAgent(agent);
    setRuntimeOpen(false);
  }
  if (!loadingSessions && (unavailableRuntime || startupFailure))
    return (
      <AgentRecoveryPanel
        agent={
          unavailableRuntime ?? {
            id: activeRuntime,
            name: runtimeAgentName(activeRuntime),
            command: activeRuntime,
            available: true,
          }
        }
        failure={startupFailure}
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
              className="size-7 px-0"
              disabled={!activeID || creatingRuntime || loadingSessions}
              onClick={openCLIStream}
              title="查看当前 Agent 的 CLI 运行流"
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
              title="会话历史"
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
              title="新建对话"
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
            general={!projectID}
            onOpen={(id) => {
              setHistoryOpen(false);
              void open(id);
            }}
            sessions={sessions}
          />
        )}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-36"
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
                  正在同步对话记录；完成前暂不能输入。
                </p>
              )}
              {error && (
                <p className="mb-4 text-xs text-destructive">{error}</p>
              )}
              {stopNotice && (
                <p className="mb-4 text-xs text-muted-foreground">
                  {stopNotice}
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
              setError(cause instanceof Error ? cause.message : "无法引用资源"),
            )
          }
          onChange={setContent}
          onRemoveAttachment={(assetID) =>
            setAttachments((current) =>
              current.filter((attachment) => attachment.assetId !== assetID),
            )
          }
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
          projectID={projectID}
          runtime={(detail?.runtime as Runtime | undefined) ?? "codex"}
          running={
            detail?.status === "running" || detail?.status === "stopping"
          }
          stopping={detail?.status === "stopping"}
          uploading={uploading}
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
