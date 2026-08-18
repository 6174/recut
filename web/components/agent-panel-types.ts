/*
 * [INPUT]: 依赖 Agent runtime 与素材引用类型
 * [OUTPUT]: 对外提供 Agent 会话、Turn、配置以及 Work Surface（宿主目标）/Work Focus（完整选区）消息上下文、可复制会话调试报告与面板 Props
 * [POS]: components Agent 对话模块的唯一数据契约；iframe 只能补充 Focus，不能覆盖宿主签发的目标
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Runtime } from "@/components/agent-install-guide";
import type { AssetReference } from "@/components/asset-reference-picker";

export function runtimeLabel(runtime: string): string {
  return (
    (
      { codex: "Codex", opencode: "OpenCode", claude: "Claude Code" } as Record<
        string,
        string
      >
    )[runtime] ?? runtime
  );
}

export type Session = {
  id: string;
  title: string;
  runtime: string;
  status: string;
  createdAt?: string;
  updatedAt: string;
  nativeSessionId?: string;
  codexModel?: string;
  reasoningEffort?: string;
  opencodeModel?: string;
};
export type CodexConfiguration = { codexModel: string; reasoningEffort: string };
export const defaultCodexConfiguration: CodexConfiguration = {
  codexModel: "gpt-5.6-terra",
  reasoningEffort: "xhigh",
};
export type OpencodeConfiguration = { opencodeModel: string };
export type OpencodeModel = { id: string; provider: string };
export const defaultOpencodeConfiguration: OpencodeConfiguration = {
  opencodeModel: "opencode-go/deepseek-v4-flash",
};
export type Attachment = AssetReference;
export type WorldReference = { worldId: string; name: string };
export type UploadedAsset = {
  id: string;
  name: string;
  mimeType: string;
  kind: Attachment["kind"];
  origin: string;
  status: string;
};

// WorkSurfaceContext is host-owned, stable context for the page from which a
// turn starts. It binds the real object the user is working on; an iframe may
// only augment it with WorkFocusContext and must never replace its target.
export type WorkSurfaceContext = {
  version: 1;
  surface: "workspace" | "media_library" | "project" | "standalone_app" | "world" | "app_detail";
  title: string;
  path?: string;
  url?: string;
  target?:
    | { kind: "project"; projectId: string; appId: string; appName: string; appKind: "project" }
    | { kind: "app_scope"; appId: string; scopeId: string; appName: string; appKind: "standalone" }
    | { kind: "world"; worldId: string; revisionId?: string; name: string }
    | { kind: "media_library"; scope: "workspace" | "project"; projectId?: string }
    | { kind: "app"; appId: string; appName: string };
  policy: {
    defaultIntent: "browse" | "create" | "project_edit" | "world_review" | "media_manage";
    requiredSkill?: { appId: string; skillId: string };
  };
};

export type ContextRef =
  | { kind: "timeline_element"; id: string }
  | { kind: "timeline_track"; id: string }
  | { kind: "component"; id: string }
  | { kind: "asset"; id: string }
  | { kind: "world_entity"; id: string }
  | { kind: "world_evidence"; id: string };

// WorkFocusContext is app-owned, ephemeral state. State intentionally carries
// the complete user-visible selection snapshot so the Agent does not re-read
// the same object merely to reconstruct what the user has selected.
export type WorkFocusContext = {
  version: 1;
  view?: string;
  selection?: { refs: ContextRef[]; primaryRef?: ContextRef; state: Record<string, unknown> };
  cursor?: { kind: "time"; seconds: number } | { kind: "none" };
  state?: Record<string, unknown>;
  summary?: string;
};

// MessageContext is the generic wire form of one typed context item mounted on
// a user turn, mirroring the backend ChatContext. Type is the discriminator
// ("media" | "page" | future "project-element"); source records who mounted it
// ("user" for explicit picks, "page"/"app" for auto-attached current page).
export type MessageContext = {
  type: string;
  source?: string;
  payload: Record<string, unknown>;
};

export function mediaContextPayload(assetId: string): MessageContext {
  return { type: "media", source: "user", payload: { assetId } };
}
export function creationWorldContextPayload(worldId: string): MessageContext {
  return { type: "creation_world", source: "user", payload: { worldId } };
}
export function workSurfaceContextPayload(context: WorkSurfaceContext): MessageContext {
  return { type: "work_surface", source: "host", payload: { ...context } };
}
export function workFocusContextPayload(context: WorkFocusContext): MessageContext {
  return { type: "work_focus", source: "app", payload: { ...context } };
}
export function normalizeWorkFocus(value: unknown): WorkFocusContext | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const refs = Array.isArray(input.selection) ? input.selection : null;
  const selection = refs
    ? { refs: refs.filter(isContextRef), state: objectField(input.selectionState) }
    : undefined;
  const state = objectField(input.state);
  const view = stringField(input.view);
  const summary = stringField(input.summary) ?? stringField(input.selection);
  const legacyContent = stringField(input.content);
  if (!selection && !state && !view && !summary && !legacyContent) return null;
  return { version: 1, view, selection, state: legacyContent ? { ...state, legacyContent } : state, summary };
}
function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function isContextRef(value: unknown): value is ContextRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.id === "string" && typeof ref.kind === "string" && ["timeline_element", "timeline_track", "component", "asset", "world_entity", "world_evidence"].includes(ref.kind);
}
export function contextLabel(context: MessageContext): string {
  if (context.type === "media")
    return String(context.payload.name ?? context.payload.assetId ?? "素材");
  if (context.type === "work_surface")
    return String(context.payload.title ?? "当前页面");
  return context.type;
}

export type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  attachments?: Attachment[];
  contexts?: MessageContext[];
};
export type ToolPayload = {
  label?: string;
  message?: string;
  phase?: string;
  toolCallId?: string;
  tool?: string;
  toolName?: string;
  detail?: string;
  input?: string;
  output?: string;
  error?: string;
  cost?: string;
  // subagent 判别字段：一次 subAgent op（如 component.create）启动受限子 Agent job 时，
  // tool.completed 事件注入这三个字段；前端据此渲染子 Agent 任务卡片。
  subagentId?: string;
  subagentAppId?: string;
  subagentOperation?: string;
};
export type AgentEvent = {
  id: number;
  turnId?: string;
  type: string;
  createdAt: string;
  payload?: ToolPayload;
};

// 子 Agent 任务的 job 视图（服务端 agentJobView 扩展）与实时帧（ws subagent channel）。
export type SubagentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type SubagentPhase = "queued" | "authoring" | "authorizing" | "running" | "finalizing" | "complete";
export type SubagentJob = {
  id: string;
  kind?: string;
  status: SubagentStatus;
  phase: SubagentPhase;
  result?: unknown;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  appId?: string;
  operation?: string;
  parentSessionId?: string;
  childSessionId?: string;
  elapsedMs?: number;
};
export type SubagentFrame = {
  event: "job.updated" | "job.completed" | "job.failed" | "job.cancelled";
  job: SubagentJob;
};

// parseSubagentJob 从工具 output（job 视图 JSON 文本）解析初始 job 状态，作为卡片/弹框的种子。
export function parseSubagentJob(output?: string): SubagentJob | null {
  if (!output) return null;
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  if (record.kind !== undefined && record.kind !== "sub-agent") return null;
  const status = String(record.status ?? "queued") as SubagentStatus;
  const phase = String(record.phase ?? "queued") as SubagentPhase;
  const pick = (key: string) => (typeof record[key] === "string" ? String(record[key]) : undefined);
  return {
    id: record.id,
    kind: "sub-agent",
    status,
    phase,
    result: record.result,
    error: pick("error"),
    createdAt: pick("createdAt"),
    updatedAt: pick("updatedAt"),
    appId: pick("appId"),
    operation: pick("operation"),
    parentSessionId: pick("parentSessionId"),
    childSessionId: pick("childSessionId"),
    elapsedMs: typeof record.elapsedMs === "number" ? record.elapsedMs : undefined,
  };
}
export type CLIEntry = {
  sequence: number;
  stream: "stdout" | "stderr";
  text: string;
  createdAt: string;
};
export type Detail = Session & {
  turns: Turn[];
  events: AgentEvent[];
  lastEventId: number;
};
export type Props = { apiBase: string; servicePhase: "checking" | "online" | "offline"; projectID: string | null; draft?: { id: string; text: string } | null; workSurface?: WorkSurfaceContext | null; workFocus?: WorkFocusContext | null };

type SessionDebugReportInput = {
  apiBase: string;
  detail: Detail;
  scope: string;
};

function debugServiceEndpoint(apiBase: string) {
  try {
    return new URL(apiBase).origin;
  } catch {
    return apiBase;
  }
}

function debugSessionMetadata(detail: Detail) {
  return {
    id: detail.id,
    nativeSessionId: detail.nativeSessionId,
    title: detail.title,
    runtime: detail.runtime,
    status: detail.status,
    codexModel: detail.codexModel,
    reasoningEffort: detail.reasoningEffort,
    opencodeModel: detail.opencodeModel,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    lastEventId: detail.lastEventId,
  };
}

function debugTurnMetadata({ attachments, contexts, content, completedAt, createdAt, id, role, status }: Turn) {
  return {
    id,
    role,
    content,
    status,
    createdAt,
    completedAt,
    attachments: attachments?.map(({ assetId, kind, mimeType, name, origin }) => ({
      assetId,
      name,
      kind,
      mimeType,
      origin,
    })),
    contexts,
  };
}

// 调试报告保留原始事件与聊天正文，排障时不丢弃任何信息。
export function buildSessionDebugReport({
  apiBase,
  detail,
  scope,
}: SessionDebugReportInput) {
  const events = detail.events.slice(-100);
  return JSON.stringify(
    {
      format: "recut.agent-session-debug/v1",
      capturedAt: new Date().toISOString(),
      serviceEndpoint: debugServiceEndpoint(apiBase),
      scope,
      session: debugSessionMetadata(detail),
      turns: detail.turns.map(debugTurnMetadata),
      events,
      eventWindow: {
        total: detail.events.length,
        included: events.length,
        truncated: events.length < detail.events.length,
      },
    },
    null,
    2,
  );
}


export function codexModelLabel(model?: string) {
  return (
    (
      {
        "gpt-5.6-sol": "5.6 Sol",
        "gpt-5.6-terra": "5.6 Terra",
        "gpt-5.6-luna": "5.6 Luna",
        "gpt-5.5": "5.5",
        "gpt-5.4": "5.4",
        "gpt-5.4-mini": "5.4 Mini",
        "gpt-5.2": "5.2",
      } as Record<string, string>
    )[model || defaultCodexConfiguration.codexModel] ?? "Codex"
  );
}
export function reasoningLabel(effort?: string) {
  return (
    (
      {
        low: "低",
        medium: "中",
        high: "高",
        xhigh: "极高",
        max: "最大",
      } as Record<string, string>
    )[effort || defaultCodexConfiguration.reasoningEffort] ?? "默认推理"
  );
}
export function opencodeModelLabel(model?: string) {
  return model || defaultOpencodeConfiguration.opencodeModel;
}
export function opencodeProviderLabel(provider: string) {
  return provider === "opencode"
    ? "OpenCode Zen"
    : provider === "opencode-go"
      ? "OpenCode Go"
      : provider;
}
