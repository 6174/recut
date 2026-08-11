/*
 * [INPUT]: 依赖 Agent runtime 与素材引用类型
 * [OUTPUT]: 对外提供 Agent 会话、Turn、事件、配置、泛化的消息上下文（MessageContext：media/page/未来类型）、保留原始信息的可复制会话调试报告与面板 Props（含宿主回填、不自动提交的草稿与当前页面上下文）的共享类型及默认配置
 * [POS]: components Agent 对话模块的唯一数据契约；被面板控制器、会话视图与输入区共同消费
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
export type UploadedAsset = {
  id: string;
  name: string;
  mimeType: string;
  kind: Attachment["kind"];
  origin: string;
  status: string;
};

// PageContext is the structured description of the page the user was on when
// sending a message. Native pages report a title and path; App iframes may add
// selection and content for the currently edited element.
export type PageContext = {
  title: string;
  path?: string;
  url?: string;
  selection?: string;
  content?: string;
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
export function pageContextPayload(context: PageContext): MessageContext {
  return { type: "page", source: "page", payload: { ...context } };
}
export function normalizePageContext(value: unknown): PageContext | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return null;
  const stringField = (key: string) =>
    typeof input[key] === "string" && input[key].trim() ? input[key] : undefined;
  return {
    title,
    path: stringField("path"),
    url: stringField("url"),
    selection: stringField("selection"),
    content: stringField("content"),
  };
}
export function contextLabel(context: MessageContext): string {
  if (context.type === "media")
    return String(context.payload.name ?? context.payload.assetId ?? "素材");
  if (context.type === "page")
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
};
export type AgentEvent = {
  id: number;
  turnId?: string;
  type: string;
  createdAt: string;
  payload?: ToolPayload;
};
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
export type Props = { apiBase: string; servicePhase: "checking" | "online" | "offline"; projectID: string | null; draft?: { id: string; text: string } | null; pageContext?: PageContext | null };

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
