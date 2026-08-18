/*
 * [INPUT]: 依赖共享会话类型、Agent 安装恢复能力、素材引用卡片与基础 UI 原子组件
 * [OUTPUT]: 对外提供会话时间线、历史、调试与工具结果预览；用户消息按原始结构显示素材、Work Surface、有效 Focus 和 legacy page context
 * [POS]: components Agent 对话模块的纯展示层；不拥有请求状态，历史中的 Focus 永远不改变工作面 target
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Bot, Check, ChevronRight, CircleAlert, Copy, RefreshCw, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AgentInstallGuide, CopyFeedback, copyToClipboard, recoverySubtitle, recoveryTitle, type AgentRuntimeStatus } from "@/components/agent-install-guide";
import { AgentMessageContent } from "@/components/agent-message-content";
import { AssetReferenceChip } from "@/components/asset-reference-picker";
import { ToolResultAssets } from "@/components/tool-result-assets";
import { Button } from "@/components/ui/button";
import { ActionIcon, RunningStatus, WorkFocusChip, WorkSurfaceChip } from "@/components/agent-composer";import { codexModelLabel, contextLabel, defaultCodexConfiguration, hasWorkFocusSelection, opencodeModelLabel, parseSubagentJob, runtimeLabel, type SubagentJob, type WorkFocusContext, type WorkSurfaceContext } from "@/components/agent-panel-types";
import { type AgentEvent, type CLIEntry, type Detail, type Session, type ToolPayload, type Turn } from "@/components/agent-panel-types";
import { t, useI18n } from "@/lib/i18n/index";
import { useLocaleStore } from "@/lib/i18n/locale-store";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { getRealtimeChannel } from "@/lib/realtime-channel";
import { useSubagentJob } from "@/lib/subagent-store";

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
  subagent?: { id: string; appId?: string; operation?: string };
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
              const pageContexts = (user.contexts ?? []).filter((context) => context.type !== "media" && (context.type !== "work_focus" || hasWorkFocusSelection(context.payload as WorkFocusContext)));
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
                    {pageContexts.map((context, index) => {
                      if (context.type === "work_focus") {
                        return <WorkFocusChip focus={context.payload as WorkFocusContext} key={`${user.id}-${index}`} />;
                      }
                      const surface = context.type === "work_surface"
                        ? context.payload as WorkSurfaceContext
                        : { version: 1, surface: "workspace", title: contextLabel(context), policy: { defaultIntent: "browse" } } satisfies WorkSurfaceContext;
                      return <WorkSurfaceChip key={`${user.id}-${index}`} surface={surface} />;
                    })}
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
    if (event.payload?.subagentId) {
      call.subagent = {
        id: event.payload.subagentId,
        appId: event.payload.subagentAppId,
        operation: event.payload.subagentOperation,
      };
    }
    calls.set(id, call);
  }
  return [...calls.values()];
}

function ToolTimelineItem({ apiBase, call, now }: { apiBase: string; call: ToolCall; now: number }) {
  // 子 Agent 任务：识别到 subagentId 判别字段即渲染专用任务卡片（含实时状态与耗时 counter）。
  if (call.subagent?.id) {
    return <SubagentTaskCard apiBase={apiBase} call={call} now={now} />;
  }
  const { t: text } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDetail = true;
  const duration = toolDuration(call.createdAt, call.completedAt, now);
  const label = toolDisplayLabel(call.payload, call.input, text);
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

// 工具动作标签同时展示翻译名称与英文 tool-name；未知工具名直接展示英文名，
// 不做无语义的「MCP 工具调用」兜底。有输入参数时再附加关键参数摘要，便于一眼看出调用内容。
export function toolDisplayLabel(payload: ToolPayload, input: string | undefined, t: (key: string) => string) {
  const name = payload.toolName ?? payload.tool ?? "";
  const alias = `recut_${name.replaceAll(".", "_")}`;
  const directKey = `agent.tool.name.${name}`;
  const aliasKey = `agent.tool.name.${alias}`;
  const direct = t(directKey) !== directKey ? t(directKey) : "";
  const viaAlias = aliasKey !== directKey && t(aliasKey) !== aliasKey ? t(aliasKey) : "";
  const translated = direct || viaAlias;
  const english = name.trim();
  let label = "";
  if (translated) {
    label = english && translated !== english ? `${translated} · ${english}` : translated;
  } else {
    const serverLabel = payload.label?.trim();
    if (serverLabel && !serverLabel.startsWith("调用 ")) {
      label = english && serverLabel !== english ? `${serverLabel} · ${english}` : serverLabel;
    } else {
      label = english || t("agent.tool.noName");
    }
  }
  const kind = payload.tool;
  const noParams = kind === "command_execution" || kind === "file_change" || kind === "web_search";
  return label + (noParams ? "" : toolParamSummary(name, input));
}

// 每个工具在标签里额外展示的关键参数（按规范英文 tool-name）。
// 未配置的工具走 toolParamPriority 通用优先级，最多展示两个非空参数。
const TOOL_PARAM_SUMMARY: Record<string, string[]> = {
  "recut.skills.read": ["skillId"],
  "recut.skills.reference": ["skillId", "path"],
  "recut.apps.install": ["repository"],
  "recut.apps.update": ["package"],
  "recut.design_system.get": ["styleId"],
  "recut.project.get": ["projectId"],
  "recut.project_context": ["projectId"],
  "recut.agent.run": ["app", "operation"],
  "recut.job.status": ["jobId"],
  "recut.job.wait": ["jobId"],
  "recut.job.logs": ["jobId"],
  "recut.job.cancel": ["jobId"],
  "recut.image.generate": ["prompt"],
  "recut.video.generate": ["prompt"],
  "recut.speech.generate": ["text"],
  "recut.media.list_voices": ["voiceId"],
  "recut.media.get_job": ["jobId"],
  "recut.media.wait_for_job": ["jobId"],
  "recut.media.list_assets": ["query"],
  "recut.media.import_image": ["path"],
  "recut.media.create_reference": ["url"],
  "recut.media.attach": ["assetId"],
  "recut.worlds.list": ["text"],
  "recut.worlds.get": ["worldId"],
  "recut.worlds.entities.list": ["worldId"],
  "recut.worlds.entities.get": ["worldId", "entityId"],
  "recut.worlds.evidence.list": ["worldId"],
  "recut.worlds.resolve": ["worldId"],
  "recut.worlds.create": ["name"],
  "recut.worlds.update": ["worldId", "name"],
  "recut.worlds.entities.upsert": ["worldId", "title"],
  "recut.worlds.references.attach": ["worldId", "assetId"],
  "recut.worlds.evidence.attach": ["worldId", "assetId"],
  "recut.worlds.evidence.update": ["worldId", "evidenceId"],
  "recut.worlds.evidence.archive": ["worldId", "evidenceId"],
  "recut.worlds.bind_project": ["projectId", "worldId"],
  "recut.recut_editor.workflow_context": ["projectId"],
  "recut.recut_editor.timeline_command": ["action"],
  "recut_recut_editor_workflow_context": ["projectId"],
  "recut_recut_editor_timeline_command": ["action"],
};

// 未配置工具的关键参数通用优先级。
const TOOL_PARAM_PRIORITY = [
  "title",
  "name",
  "skillId",
  "query",
  "path",
  "command",
  "action",
  "projectId",
  "jobId",
  "worldId",
  "entityId",
  "assetId",
  "url",
  "repository",
  "package",
  "voiceId",
  "prompt",
  "text",
];

function toolParamSummary(name: string, input: string | undefined): string {
  if (!name.trim() || !input) return "";
  const alias = `recut_${name.replaceAll(".", "_")}`;
  const keys =
    TOOL_PARAM_SUMMARY[alias] ??
    TOOL_PARAM_SUMMARY[name] ??
    TOOL_PARAM_PRIORITY;
  const values = parseToolInput(input);
  if (!values) return "";
  const parts: string[] = [];
  for (const key of keys) {
    const value = values[key];
    if (typeof value !== "string" || !value.trim()) continue;
    parts.push(`${key}=${shortenParam(value)}`);
    if (parts.length === 2) break;
  }
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function parseToolInput(input: string): Record<string, unknown> | null {
  let values: unknown;
  try {
    values = JSON.parse(input);
  } catch {
    return null;
  }
  if (values && typeof values === "object" && !Array.isArray(values)) {
    const record = values as Record<string, unknown>;
    for (const key of ["arguments", "input"]) {
      const nested = record[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
      }
    }
    return record;
  }
  return null;
}

function shortenParam(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 40 ? `${compact.slice(0, 40)}…` : compact;
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

// SubagentTaskCard 渲染一次 subagent 工具调用（识别到 payload.subagentId）为任务卡片：
// 状态徽标 + authorize/run/finalize 阶段指示 + 自治实时耗时 counter；点击打开全局预览弹框。
// 状态来自共享 subagent-store（单条 ws subagent channel 订阅），初始用工具 output 的 job view 做种子。
function SubagentTaskCard({ apiBase, call, now }: { apiBase: string; call: ToolCall; now: number }) {
  const { t: text } = useI18n();
  const { job, available } = useSubagentJob(call.subagent?.id, apiBase);
  const seed = useMemo(() => parseSubagentJob(call.output), [call.output]);
  const current = job ?? seed;
  const [open, setOpen] = useState(false);
  const [localNow, setLocalNow] = useState(() => Date.now());
  const running = current?.status === "queued" || current?.status === "running";
  useEffect(() => {
    if (!running) return;
    setLocalNow(Date.now());
    const timer = window.setInterval(() => setLocalNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const displayNow = running ? localNow : now;
  const label = toolDisplayLabel(call.payload, call.input, text);
  const status = current?.status ?? "running";
  const statusLabel = text(`agent.subagent.status.${status}`);
  const statusClass =
    (
      {
        queued: "bg-muted-foreground",
        running: "animate-pulse bg-warning",
        completed: "bg-success",
        failed: "bg-destructive",
        cancelled: "bg-muted-foreground",
      } as Record<string, string>
    )[status] ?? "bg-muted-foreground";
  const statusTextClass =
    (
      {
        running: "text-warning",
        completed: "text-success",
        failed: "text-destructive",
      } as Record<string, string>
    )[status] ?? "text-muted-foreground";
  const elapsed = toolDuration(current?.createdAt ?? call.createdAt, current?.updatedAt ?? call.completedAt, displayNow);
  const phaseIndex =
    current?.phase === "authorizing" || current?.phase === "authoring"
      ? 0
      : current?.phase === "finalizing"
        ? 2
        : current?.phase === "running" || current?.phase === "complete"
          ? 2
          : -1;
  const phases = ["authorizing", "running", "finalizing"] as const;
  const metaLine = call.subagent?.appId
    ? `${call.subagent.appId}.${call.subagent.operation ?? "…"}`
    : call.payload.toolName ?? call.subagent?.id ?? "";
  return (
    <div className="max-w-full text-[11px]">
      <button
        aria-label={text("agent.subagent.card.open")}
        className="flex w-full min-w-0 items-center gap-2 rounded-sm border bg-card px-2.5 py-2 text-left shadow-sm transition hover:border-primary"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className={`size-1.5 shrink-0 rounded-full ${statusClass}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{label}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
            {metaLine || subagentIdLabel(call, text)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {phases.map((phase, index) => (
            <span
              className={`size-1 rounded-full ${index <= phaseIndex ? "bg-primary" : "bg-muted-foreground/30"}`}
              key={phase}
              title={text(`agent.subagent.phase.${phase}`)}
            />
          ))}
        </span>
        <span className={`shrink-0 text-[10px] ${statusTextClass}`}>
          {available === false && !current ? text("agent.subagent.dialog.unavailable") : `${statusLabel} · ${elapsed}`}
        </span>
      </button>
      {open && current && <SubagentPreviewDialog apiBase={apiBase} job={current} onClose={() => setOpen(false)} />}
    </div>
  );
}

function subagentIdLabel(call: ToolCall, text: (key: string) => string) {
  if (call.payload.toolName) return call.payload.toolName;
  return text("agent.subagent.card.unknown");
}

// SubagentPreviewDialog 是子 Agent 任务的全局预览弹框：Meta 头（job/app/operation/status/phase/耗时/取消/复制诊断）
// + 主体 = 子 Agent 会话的 chat 视图（复用 Conversation 渲染 child session 的 turns + 事件）。
// 数据：GET /v1/agent-sessions/{childSessionId} 首屏 + agent channel(childSessionId) 实时事件；
// job 状态由卡片经 subagent-store 驱动本组件 rerender。
function SubagentPreviewDialog({ apiBase, job, onClose }: { apiBase: string; job: SubagentJob; onClose: () => void }) {
  const { t: text } = useI18n();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const running = job.status === "queued" || job.status === "running";
  const terminal = !running;
  const childID = job.childSessionId;

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  // 首屏：拉取子会话详情并订阅其实时事件（本质就是 chat 的会话通道）。
  useEffect(() => {
    if (!childID) return;
    let cancelled = false;
    let handle: { unsubscribe: () => void } | null = null;
    setLoading(true);
    setDetail(null);
    void fetch(`${apiBase}/v1/agent-sessions/${encodeURIComponent(childID)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((loaded: Detail | null) => {
        if (cancelled) return;
        setLoading(false);
        if (!loaded) return;
        setDetail(loaded);
        handle = {
          unsubscribe: getRealtimeChannel(apiBase).subscribe(
            "agent",
            childID,
            (frame) => {
              setDetail((current) => (current ? applyAgentEvent(current, frame.data as AgentEvent) : current));
            },
            loaded.lastEventId,
          ),
        };
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      handle?.unsubscribe();
    };
  }, [apiBase, childID]);

  // job 终态时刷新一次子会话详情（服务端已把子会话状态同步为 completed/failed/cancelled）。
  useEffect(() => {
    if (!terminal || !childID) return;
    void fetch(`${apiBase}/v1/agent-sessions/${encodeURIComponent(childID)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((loaded: Detail | null) => {
        if (loaded) setDetail(loaded);
      })
      .catch(() => {});
  }, [terminal, childID, apiBase]);

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await fetch(`${apiBase}/v1/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
    } catch {
      // 网络错误静默；job 终态由 store 帧驱动，无需乐观更新。
    } finally {
      setCancelling(false);
    }
  }

  async function copyDiagnostic() {
    const report = JSON.stringify(
      {
        subagentJob: job,
        childSession: detail
          ? { id: detail.id, status: detail.status, turns: detail.turns, events: detail.events.slice(-100) }
          : null,
      },
      null,
      2,
    );
    const ok = await copyToClipboard(report);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2200);
  }

  const status = job.status;
  const statusLabel = text(`agent.subagent.status.${status}`);
  const phaseKey = job.phase === "authoring" ? "authorizing" : job.phase;
  const phaseLabel = text(`agent.subagent.phase.${phaseKey}`);
  const elapsed = toolDuration(job.createdAt ?? new Date().toISOString(), job.updatedAt, running ? now : Date.now());
  const metaLine = `${job.appId ? `${job.appId}.` : ""}${job.operation ?? "sub-agent"} · ${job.id}`;

  return createPortal(
    <div
      aria-labelledby="subagent-preview-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
    >
      <section
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium" id="subagent-preview-title">
              {text("agent.subagent.dialog.title")}
            </h2>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{metaLine}</p>
          </div>
          <button
            aria-label={text("agent.subagent.dialog.close")}
            className="grid size-8 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
          <span className={`size-1.5 rounded-full ${status === "running" ? "animate-pulse bg-warning" : status === "completed" ? "bg-success" : status === "failed" ? "bg-destructive" : "bg-muted-foreground"}`} />
          <span className="font-medium text-foreground">{statusLabel}</span>
          <span>{interpolate(text("agent.subagent.meta.phase"), { phase: phaseLabel })}</span>
          <span className="ml-auto flex items-center gap-1">
            <Button className="h-6 px-2 text-[10px]" disabled={cancelling || terminal} onClick={() => void cancel()} type="button" variant="outline">
              {cancelling ? text("agent.subagent.dialog.cancelling") : text("agent.subagent.dialog.cancel")}
            </Button>
            <Button className="h-6 px-2 text-[10px]" onClick={() => void copyDiagnostic()} type="button" variant="ghost">
              {copied ? text("agent.subagent.dialog.copied") : text("agent.subagent.dialog.copyDiagnostic")}
            </Button>
            <span className="shrink-0">{elapsed}</span>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <ConversationLoading />
          ) : detail ? (
            <Conversation apiBase={apiBase} detail={detail} now={now} />
          ) : childID ? (
            <p className="text-xs text-muted-foreground">{text("agent.subagent.dialog.noActivity")}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{text("agent.subagent.dialog.noActivity")}</p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function toolDuration(
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
