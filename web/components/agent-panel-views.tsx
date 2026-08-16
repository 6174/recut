/*
 * [INPUT]: 依赖共享会话类型、Agent 安装恢复能力、素材引用卡片与基础 UI 原子组件
 * [OUTPUT]: 对外提供会话时间线、历史列表、加载/CLI 调试/恢复视图、工具结果中的 Asset 预览入口；所有工具调用在收起态只展示人可读动作、展开后可查看真实名称，且以单份可复制诊断记录归集输入/输出/错误/成本；调试与工具详情弹框经 document.body Portal 脱离侧栏堆叠上下文，以及 SSE 事件归并函数
 * [POS]: components Agent 对话模块的展示层；只根据传入数据渲染，不拥有会话请求状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Bot, Check, ChevronRight, CircleAlert, Copy, RefreshCw, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AgentInstallGuide, CopyFeedback, copyToClipboard, recoverySubtitle, recoveryTitle, type AgentRuntimeStatus } from "@/components/agent-install-guide";
import { AgentMessageContent } from "@/components/agent-message-content";
import { AssetReferenceChip } from "@/components/asset-reference-picker";
import { ToolResultAssets } from "@/components/tool-result-assets";
import { Button } from "@/components/ui/button";
import { ActionIcon, PageContextChip, RunningStatus } from "@/components/agent-composer";
import { codexModelLabel, contextLabel, defaultCodexConfiguration, opencodeModelLabel, runtimeLabel } from "@/components/agent-panel-types";
import { type AgentEvent, type CLIEntry, type Detail, type Session, type ToolPayload, type Turn } from "@/components/agent-panel-types";
import { t, useI18n } from "@/lib/i18n/index";
import { useLocaleStore } from "@/lib/i18n/locale-store";
import { interpolate } from "@/lib/i18n/workspace-dict";

export async function responseMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" && payload.error.trim()
      ? payload.error
      : fallback;
  } catch {
    return fallback;
  }
}
export function messageOf(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : fallback;
}
export function ConversationLoading() {
  const { t } = useI18n();
  return (
    <div aria-live="polite" className="grid h-full place-items-center">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" />
        {t("agent.conversation.loading")}
      </p>
    </div>
  );
}

export function CLIDebugDialog({
  available,
  entries,
  onClose,
}: {
  available: boolean;
  entries: CLIEntry[];
  onClose: () => void;
}) {
  const { t: text, locale } = useI18n();
  const outputRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [entries.length]);
  const output = entries
    .map((entry) => {
      const at = new Date(entry.createdAt).toLocaleTimeString(locale === "en" ? "en-US" : "zh-CN", {
        hour12: false,
      });
      return `${at} ${entry.stream === "stderr" ? "ERR" : "OUT"} ${entry.text}`;
    })
    .join("\n");
  return createPortal(
    <div
      aria-labelledby="agent-cli-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
    >
      <section
        className="flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-medium" id="agent-cli-title">
              {text("agent.cli.title")}
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {text("agent.cli.desc")}
            </p>
          </div>
          <button
            aria-label={text("agent.cli.close")}
            className="grid size-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <pre
          className="min-h-64 flex-1 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 p-4 font-mono text-[11px] leading-5 text-zinc-100"
          ref={outputRef}
        >
          {output ||
            (available
              ? text("agent.cli.waiting")
              : text("agent.cli.unavailable"))}
        </pre>
      </section>
    </div>,
    document.body,
  );
}

type TimelineItem =
  | { id: string; at: string; kind: "user"; turn: Turn }
  | { id: string; at: string; kind: "assistant"; turn: Turn }
  | { id: string; at: string; kind: "tool"; call: ToolCall };
type ToolCall = {
  id: string;
  createdAt: string;
  completedAt?: string;
  state: "running" | "success" | "error";
  input?: string;
  output?: string;
  error?: string;
  payload: ToolPayload;
};

export function Conversation({
  apiBase,
  detail,
  now,
}: {
  apiBase: string;
  detail: Detail;
  now: number;
}) {
  const turnItems: TimelineItem[] = detail.turns.map((turn) =>
    turn.role === "user"
      ? { id: turn.id, at: turn.createdAt, kind: "user", turn }
      : { id: turn.id, at: turn.createdAt, kind: "assistant", turn },
  );
  const timeline: TimelineItem[] = [
    ...turnItems,
    ...toolCalls(detail.events).map(
      (call) =>
        ({
          id: call.id,
          at: call.createdAt,
          kind: "tool",
          call,
        }) as TimelineItem,
    ),
  ].sort(
    (left, right) => new Date(left.at).getTime() - new Date(right.at).getTime(),
  );
  const groups = responseGroups(timeline);
  const isProcessing =
    detail.status === "running" || detail.status === "stopping";
  const { t: text } = useI18n();
  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const failure = group.user
          ? turnFailure(detail.events, group.user.id)
          : "";
        const reply = lastAssistantTurn(group.items);
        const meta = group.user && reply ? replyMeta(group.user, reply) : null;
        return (
          <section key={group.id}>
            {group.user && (() => {
              const user = group.user;
              const pageContexts = (user.contexts ?? []).filter((context) => context.type !== "media");
              return (
              <div className="group ml-auto w-fit max-w-[85%]">
                {(pageContexts.length > 0 || (user.attachments ?? []).length > 0) && (
                  <div className="mb-1 flex flex-wrap justify-end gap-1">
                    {(user.attachments ?? []).map((attachment) => (
                      <AssetReferenceChip
                        apiBase={apiBase}
                        key={attachment.assetId}
                        reference={attachment}
                      />
                    ))}
                    {pageContexts.map((context, index) => (
                      <PageContextChip
                        key={`${user.id}-${index}`}
                        selection={
                          typeof context.payload.selection === "string"
                            ? context.payload.selection
                            : undefined
                        }
                        // TODO: contextLabel 的「素材/当前页面」兜底定义在 agent-panel-types.ts，暂未本地化。
                        title={contextLabel(context)}
                      />
                    ))}
                  </div>
                )}
                {user.content && (
                  <p className="rounded-sm bg-secondary px-3 py-2 text-left text-xs leading-5 break-words whitespace-pre-wrap">
                    {user.content}
                  </p>
                )}
                {user.status === "queued" ? (
                  <p className="mt-1 text-right text-[10px] text-muted-foreground">
                    {text("agent.conversation.queued")}
                  </p>
                ) : (
                  <p className="mt-1 h-3 text-right text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    {formatMessageTime(user.createdAt)}
                  </p>
                )}
              </div>
              );
            })()}
            <div className={group.user ? "mt-5 space-y-5" : "space-y-5"}>
              {group.items.map((item) =>
                item.kind === "assistant" ? (
                  <AgentMessageContent
                    apiBase={apiBase}
                    content={item.turn.content}
                    key={item.id}
                  />
                ) : (
                  <ToolTimelineItem apiBase={apiBase} call={item.call} key={item.id} now={now} />
                ),
              )}
            </div>
            {failure && <TurnFailure message={failure} />}
            {!isProcessing && reply && (
              <div className="mt-2 flex items-center gap-1 text-muted-foreground">
                <ActionIcon label={text("agent.conversation.copyReply")}>
                  <Copy />
                </ActionIcon>
                <ActionIcon label={text("agent.conversation.helpful")}>
                  <ThumbsUp />
                </ActionIcon>
                <ActionIcon label={text("agent.conversation.notHelpful")}>
                  <ThumbsDown />
                </ActionIcon>
                {meta && (
                  <span
                    className="ml-1 text-[10px] text-muted-foreground/75"
                    title={meta.title}
                  >
                    {meta.label}
                  </span>
                )}
              </div>
            )}
          </section>
        );
      })}
      {detail.status === "running" && (
        <RunningStatus events={detail.events} now={now} />
      )}
      {detail.status === "stopping" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-warning" />
          {text("agent.panel.stopping")}
        </p>
      )}
    </div>
  );
}

function turnFailure(events: AgentEvent[], turnID: string) {
  return (
    [...events]
      .reverse()
      .find((event) => event.turnId === turnID && event.type === "turn.failed")
      ?.payload?.message?.trim() ?? ""
  );
}

function TurnFailure({ message }: { message: string }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-sm border bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
      <CircleAlert className="size-4 shrink-0" />
      <p className="min-w-0 break-words whitespace-pre-wrap">{message}</p>
    </div>
  );
}

export function latestFailedTurn(detail: Detail | null) {
  if (!detail) return null;
  const turn = [...detail.turns].reverse().find((item) => item.role === "user");
  const message =
    turn?.status === "failed" ? turnFailure(detail.events, turn.id) : "";
  return turn && message ? { id: turn.id, message } : null;
}

export function isCLIUnavailableFailure(message: string) {
  return /\bCLI is (?:not installed|unavailable)\b/i.test(message);
}

export function AgentRecoveryPanel({
  agent,
  failure,
  onRecheck,
}: {
  agent: AgentRuntimeStatus;
  failure: string;
  onRecheck: () => Promise<void>;
}) {
  const { t: text } = useI18n();
  const missing = !agent.available;
  const diagnostic = interpolate(text("agent.recovery.diagnostic"), { name: agent.name, failure, command: agent.command });
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  async function copy() {
    const copied = await copyToClipboard(diagnostic);
    setCopyStatus(copied ? "copied" : "failed");
    if (copied) window.setTimeout(() => setCopyStatus("idle"), 2200);
  }
  async function recheck() {
    if (checking) return;
    setChecking(true);
    setCheckFailed(false);
    try {
      await onRecheck();
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  }
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-10 shrink-0 items-center justify-between border-b bg-card px-4">
        <p className="text-xs font-semibold tracking-wide">AI</p>
        <Button
          className="size-7 px-0"
          disabled={checking}
          onClick={() => void recheck()}
          title={
            checking
              ? interpolate(text("agent.recovery.checkingTitle"), { name: agent.name })
              : interpolate(text("agent.recovery.recheckTitle"), { name: agent.name })
          }
          type="button"
          variant="ghost"
        >
          <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} />
        </Button>
      </header>
      <main className="flex min-h-0 flex-1 items-center overflow-y-auto p-7">
        <section className="mx-auto w-full max-w-sm">
          <div className="grid size-10 place-items-center rounded-sm bg-primary text-primary-foreground">
            <Bot className="size-5" />
          </div>
          <h2 className="mt-5 text-base font-medium">
            {recoveryTitle(agent, missing)}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {recoverySubtitle(agent, missing)}
          </p>
          {checking && (
            <p
              aria-live="polite"
              className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <RefreshCw className="size-3 animate-spin" />
              {interpolate(text("agent.recovery.checking"), { name: agent.name })}
            </p>
          )}
          {checkFailed && (
            <p aria-live="polite" className="mt-3 text-xs text-destructive">
              {text("agent.recovery.offline")}
            </p>
          )}
          {missing ? (
            <div className="mt-7">
              <AgentInstallGuide
                agent={agent}
                checkFailed={checkFailed}
                checking={checking}
                onRecheck={recheck}
              />
            </div>
          ) : (
            <div className="mt-7">
              <p className="text-xs font-medium">{text("agent.recovery.diagnosticTask")}</p>
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted p-3 font-mono text-xs leading-5 text-foreground">
                {failure}
              </pre>
              <Button
                className="mt-3 h-8 w-full justify-center"
                onClick={() => void copy()}
                type="button"
                variant="outline"
              >
                {copyStatus === "copied" ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copyStatus === "copied"
                  ? text("agent.recovery.copied")
                  : interpolate(text("agent.recovery.copyTo"), { name: agent.name })}
              </Button>
              <CopyFeedback status={copyStatus} />
            </div>
          )}
        </section>
      </main>
    </aside>
  );
}

type ResponseGroup = {
  id: string;
  user?: Turn;
  items: Exclude<TimelineItem, { kind: "user" }>[];
};

export function applyAgentEvent(detail: Detail, event: AgentEvent): Detail {
  const status =
    event.type === "turn.started"
      ? "running"
      : event.type === "turn.completed"
        ? "completed"
        : event.type === "turn.failed"
          ? "failed"
          : event.type === "turn.cancelled"
            ? "cancelled"
            : undefined;
  // The server flips the session to idle only via a later session.updated +
  // refresh round-trip; clear the running indicator here on the active turn's
  // terminal event so a delayed or dropped refresh can never leave the
  // "正在分析" spinner stuck after the AI has actually finished.
  const latestUserTurn = [...detail.turns]
    .reverse()
    .find((turn) => turn.role === "user");
  const clearsRunning =
    status === "completed" || status === "failed" || status === "cancelled"
      ? event.turnId === latestUserTurn?.id
      : false;
  return {
    ...detail,
    status:
      event.type === "turn.started"
        ? "running"
        : clearsRunning
          ? "idle"
          : detail.status,
    turns:
      status && event.turnId
        ? detail.turns.map((turn) =>
            turn.id === event.turnId
              ? {
                  ...turn,
                  status,
                  completedAt:
                    status === "running" ? undefined : event.createdAt,
                }
              : turn,
          )
        : detail.turns,
    events: [...detail.events, event],
    lastEventId: event.id,
  };
}

function lastAssistantTurn(items: ResponseGroup["items"]) {
  const item = [...items]
    .reverse()
    .find((candidate) => candidate.kind === "assistant");
  return item?.kind === "assistant" ? item.turn : undefined;
}

function replyMeta(user: Turn, reply: Turn) {
  const locale = useLocaleStore.getState().locale;
  const completedAt = user.completedAt ?? reply.completedAt ?? reply.createdAt;
  const duration = toolDuration(user.createdAt, completedAt, Date.now());
  return {
    label: `${formatMessageTime(completedAt)} · ${interpolate(t("workspace", locale, "agent.conversation.elapsed"), { duration })}`,
    title: interpolate(t("workspace", locale, "agent.conversation.elapsedTitle"), { at: formatMessageTime(completedAt), duration }),
  };
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(useLocaleStore.getState().locale === "en" ? "en-US" : "zh-CN", {
        dateStyle: "medium",
        timeStyle: "medium",
        hour12: false,
      }).format(date);
}

function responseGroups(timeline: TimelineItem[]): ResponseGroup[] {
  const groups: ResponseGroup[] = [];
  let current: ResponseGroup | null = null;
  for (const item of timeline) {
    if (item.kind === "user") {
      current = { id: item.id, user: item.turn, items: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { id: "initial", items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

function toolCalls(events: AgentEvent[]): ToolCall[] {
  const calls = new Map<string, ToolCall>();
  for (const event of events.filter((item) => item.type.startsWith("tool."))) {
    const id = `${event.turnId ?? "session"}:${event.payload?.toolCallId ?? event.id}`;
    const previous = calls.get(id);
    const call: ToolCall = {
      id,
      createdAt: previous?.createdAt ?? event.createdAt,
      completedAt: previous?.completedAt,
      state: previous?.state ?? "running",
      input: previous?.input,
      output: previous?.output,
      error: previous?.error,
      payload: { ...previous?.payload, ...event.payload },
    };
    // OpenCode 只发终态事件；所有事件均可携带参数，不能只依赖 started。
    const input =
      event.payload?.input ?? legacyToolDetail(event.payload?.detail, "input");
    if (input !== undefined) call.input = input;
    if (event.type === "tool.completed") {
      call.state = "success";
      call.completedAt = event.createdAt;
      call.output =
        event.payload?.output ??
        legacyToolDetail(event.payload?.detail, "output");
    }
    if (event.type === "tool.failed") {
      call.state = "error";
      call.completedAt = event.createdAt;
      call.error =
        event.payload?.error ??
        legacyToolDetail(event.payload?.detail, "error");
    }
    calls.set(id, call);
  }
  return [...calls.values()];
}

function ToolTimelineItem({ apiBase, call, now }: { apiBase: string; call: ToolCall; now: number }) {
  const { t: text } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDetail = true;
  const duration = toolDuration(call.createdAt, call.completedAt, now);
  const label = toolDisplayLabel(call.payload, text);
  const stateLabel = { running: text("agent.tool.running"), success: text("agent.tool.success"), error: text("agent.tool.error") }[
    call.state
  ];
  const stateClass = {
    running: "animate-pulse bg-warning",
    success: "bg-success",
    error: "bg-destructive",
  }[call.state];
  const labelClass =
    call.state === "error"
      ? "text-destructive"
      : call.state === "success"
        ? "text-success"
        : "text-warning";
  return (
    <div className="max-w-full text-[11px]">
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span className={`size-1.5 shrink-0 rounded-full ${stateClass}`} />
        <span className="truncate">{label}</span>
        <span className={`ml-auto shrink-0 text-[10px] ${labelClass}`}>
          {stateLabel} · {duration}
        </span>
        {hasDetail && (
          <button
            aria-expanded={open}
            aria-label={text("agent.tool.expand")}
            className="grid size-5 shrink-0 place-items-center rounded-sm hover:bg-muted hover:text-foreground"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <ChevronRight
              className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        )}
      </div>
      {open && hasDetail && (
        <div
          className={`mt-2 max-w-full rounded-sm border p-3 text-foreground ${call.state === "error" ? "border-destructive/40 bg-destructive/5" : "bg-muted/30"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">
              {label}
            </p>
            <span className={`shrink-0 text-[10px] ${labelClass}`}>
              {stateLabel} · {interpolate(text("agent.conversation.elapsed"), { duration })}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="min-w-0 break-all font-mono text-[10px] text-muted-foreground">
              {interpolate(text("agent.tool.realName"), { name: call.payload.toolName ?? call.payload.tool ?? text("agent.tool.noName") })}
            </p>
            <button
              className="shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={async () => {
                setCopied(await copyToClipboard(toolCallReport(call, label, duration)));
              }}
              type="button"
            >
              {copied ? text("agent.tool.copied") : text("agent.tool.copy")}
            </button>
          </div>
          <ToolDetail
            emptyLabel={text("agent.tool.args.empty")}
            title={text("agent.tool.args")}
            value={call.input}
          />
          {call.state !== "error" && (
            <ToolResultAssets apiBase={apiBase} output={call.output} />
          )}
          <ToolDetail
            emptyLabel={
              call.state === "error" ? text("agent.tool.error.empty") : text("agent.tool.output.empty")
            }
            title={call.state === "error" ? text("agent.tool.error.title") : text("agent.tool.output")}
            value={call.error ?? call.output}
          />
          {call.payload.cost && (
            <ToolDetail title={text("agent.tool.cost")} value={call.payload.cost} />
          )}
        </div>
      )}
    </div>
  );
}

// 工具动作标签统一走字典（agent.tool.name.*），未知工具名回退服务端下发 label。
// TODO: 服务端下发的 payload.label 仍是服务端数据（如以「调用 」开头的 MCP 标签），暂不本地化，待服务端按 locale 下发。
function toolDisplayLabel(payload: ToolPayload, t: (key: string) => string) {
  const name = payload.toolName ?? "";
  const alias = `recut_${name.replaceAll(".", "_")}`;
  const directKey = `agent.tool.name.${name}`;
  const aliasKey = `agent.tool.name.${alias}`;
  const direct = t(directKey) !== directKey ? t(directKey) : "";
  const viaAlias = aliasKey !== directKey && t(aliasKey) !== aliasKey ? t(aliasKey) : "";
  const label = direct || viaAlias || payload.label?.trim();
  return label?.startsWith("调用 ") ? t("agent.tool.mcpCall") : label || t("agent.tool.mcpCall");
}

function toolCallReport(call: ToolCall, label: string, duration: string) {
  return JSON.stringify(
    {
      action: label,
      toolName: call.payload.toolName ?? call.payload.tool ?? null,
      state: call.state,
      startedAt: call.createdAt,
      completedAt: call.completedAt ?? null,
      duration,
      input: parseToolReportValue(call.input),
      output: parseToolReportValue(call.output),
      error: parseToolReportValue(call.error),
      cost: parseToolReportValue(call.payload.cost),
    },
    null,
    2,
  );
}

function parseToolReportValue(value: string | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function ToolDetail({
  emptyLabel,
  title,
  value,
}: {
  emptyLabel?: string;
  title: string;
  value?: string;
}) {
  const { t: text } = useI18n();
  const [open, setOpen] = useState(false);
  const detail = value ? safeToolDetail(value) : (emptyLabel ?? text("agent.tool.noData"));
  return (
    <section className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium text-muted-foreground">{title}</p>
        <div className="flex shrink-0 gap-1">
          <button
            className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setOpen(true)}
            type="button"
          >
            {text("agent.tool.viewFull")}
          </button>
        </div>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/60 p-2 font-mono text-[10px] leading-4">
        {detail}
      </pre>
      {open && (
        <ToolDetailDialog
          onClose={() => setOpen(false)}
          text={detail}
          title={title}
        />
      )}
    </section>
  );
}
function ToolDetailDialog({
  onClose,
  text: content,
  title,
}: {
  onClose: () => void;
  text: string;
  title: string;
}) {
  const { t: text } = useI18n();
  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
      aria-labelledby="tool-detail-title"
    >
      <section
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium" id="tool-detail-title">
            {title}
          </h2>
          <button
            aria-label={text("agent.tool.closeDetail")}
            className="grid size-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5">
          {content}
        </pre>
      </section>
    </div>,
    document.body,
  );
}
function toolDuration(
  startedAt: string,
  completedAt: string | undefined,
  now: number,
) {
  const elapsed = Math.max(
    0,
    (new Date(completedAt ?? now).getTime() - new Date(startedAt).getTime()) /
      1000,
  );
  const value = elapsed < 10 ? elapsed.toFixed(1) : String(Math.round(elapsed));
  return interpolate(t("workspace", useLocaleStore.getState().locale, "agent.tool.seconds"), { value });
}
function legacyToolDetail(
  value: string | undefined,
  phase: "input" | "output" | "error",
) {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(value) as Record<string, unknown>;
    const keys = {
      input: [
        "arguments",
        "input",
        "command",
        "cmd",
        "path",
        "query",
        "search_query",
      ],
      output: [
        "result",
        "output",
        "aggregated_output",
        "changes",
        "summary",
        "results",
      ],
      error: ["error", "result", "output", "aggregated_output"],
    }[phase];
    const detail = Object.fromEntries(
      keys.filter((key) => key in decoded).map((key) => [key, decoded[key]]),
    );
    return Object.keys(detail).length ? JSON.stringify(detail) : undefined;
  } catch {
    return phase === "input" ? value : undefined;
  }
}
function safeToolDetail(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function SessionHistory({
  activeID,
  label,
  onOpen,
  sessions,
}: {
  activeID: string | null;
  label: string;
  onOpen: (id: string) => void;
  sessions: Session[];
}) {
  const { t: text } = useI18n();
  return (
    <section className="absolute right-3 top-14 z-20 w-[calc(100%-1.5rem)] overflow-hidden rounded-md border bg-popover shadow-[var(--shadow-overlay)]">
      <p className="border-b px-3 py-2 text-[10px] font-medium text-muted-foreground">
        {label}
      </p>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {sessions.length === 0 ? (
          <p className="px-2 py-5 text-center text-xs text-muted-foreground">
            {text("agent.history.empty")}
          </p>
        ) : (
          sessions.map((session) => (
            <button
              className={`w-full rounded-sm px-2 py-2 text-left text-xs hover:bg-muted ${session.id === activeID ? "bg-accent" : ""}`}
              key={session.id}
              onClick={() => onOpen(session.id)}
              type="button"
            >
              <span className="block truncate font-medium">
                {session.title}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {sessionSummary(session)}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

// reasoningLabel 的本地化包装（agent-panel-types 仍返回中文，仅在展示层包装）：字典缺失时回退原始 effort 值。
function reasoningEffortLabel(effort?: string): string {
  const locale = useLocaleStore.getState().locale;
  const value = effort ?? defaultCodexConfiguration.reasoningEffort;
  const key = `agent.composer.reasoning.${value}`;
  const label = t("workspace", locale, key);
  return label !== key ? label : value;
}

function sessionSummary(session: Session): string {
  const agent = runtimeLabel(session.runtime);
  if (session.runtime === "codex")
    return `${agent} · ${codexModelLabel(session.codexModel)} · ${reasoningEffortLabel(session.reasoningEffort)}`;
  if (session.runtime === "opencode")
    return `${agent} · ${opencodeModelLabel(session.opencodeModel)}`;
  return agent;
}
