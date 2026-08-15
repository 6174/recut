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
import { codexModelLabel, contextLabel, opencodeModelLabel, reasoningLabel, runtimeLabel } from "@/components/agent-panel-types";
import { type AgentEvent, type CLIEntry, type Detail, type Session, type ToolPayload, type Turn } from "@/components/agent-panel-types";

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
  return (
    <div aria-live="polite" className="grid h-full place-items-center">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" />
        正在加载对话…
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
  const outputRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [entries.length]);
  const output = entries
    .map((entry) => {
      const at = new Date(entry.createdAt).toLocaleTimeString("zh-CN", {
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
              Agent CLI 运行流
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              仅保留在本机内存中，不写入服务日志。
            </p>
          </div>
          <button
            aria-label="关闭 CLI 运行流"
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
              ? "等待 CLI 输出…"
              : "此会话没有可用的实时 CLI 流。运行流只会从启用本功能后启动的 Agent turn 开始捕获。")}
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
                    待发送
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
                <ActionIcon label="复制回复">
                  <Copy />
                </ActionIcon>
                <ActionIcon label="有帮助">
                  <ThumbsUp />
                </ActionIcon>
                <ActionIcon label="没帮助">
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
          正在停止当前回复…
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
  const missing = !agent.available;
  const diagnostic = `请在运行 Recut service 的设备上排查 ${agent.name} CLI 启动失败。\n\n错误：\n${failure}\n\n请检查 ${agent.command} 是否可执行、已登录且可运行，再给出修复命令。`;
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
              ? `正在检查 ${agent.name} 状态`
              : `重新检查 ${agent.name} 状态`
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
              正在检查 {agent.name} 状态…
            </p>
          )}
          {checkFailed && (
            <p aria-live="polite" className="mt-3 text-xs text-destructive">
              无法连接 Recut service，请确认设备在线后重试。
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
              <p className="text-xs font-medium">诊断任务</p>
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
                  ? "已复制诊断任务"
                  : `复制给 ${agent.name} 排查`}
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
  const completedAt = user.completedAt ?? reply.completedAt ?? reply.createdAt;
  return {
    label: `${formatMessageTime(completedAt)} · 耗时 ${toolDuration(user.createdAt, completedAt, Date.now())}`,
    title: `完成于 ${formatMessageTime(completedAt)}，从发送到完成耗时 ${toolDuration(user.createdAt, completedAt, Date.now())}`,
  };
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDetail = true;
  const duration = toolDuration(call.createdAt, call.completedAt, now);
  const label = toolDisplayLabel(call.payload);
  const stateLabel = { running: "执行中", success: "已完成", error: "失败" }[
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
            aria-label="展开工具调用详情"
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
              {stateLabel} · 耗时 {duration}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="min-w-0 break-all font-mono text-[10px] text-muted-foreground">
              真实工具名：{call.payload.toolName ?? call.payload.tool ?? "未返回"}
            </p>
            <button
              className="shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={async () => {
                setCopied(await copyToClipboard(toolCallReport(call, label, duration)));
              }}
              type="button"
            >
              {copied ? "已复制" : "复制调用"}
            </button>
          </div>
          <ToolDetail
            emptyLabel="未返回调用参数"
            title="调用参数"
            value={call.input}
          />
          {call.state !== "error" && (
            <ToolResultAssets apiBase={apiBase} output={call.output} />
          )}
          <ToolDetail
            emptyLabel={
              call.state === "error" ? "未返回错误详情" : "未返回执行结果"
            }
            title={call.state === "error" ? "错误信息" : "执行结果"}
            value={call.error ?? call.output}
          />
          {call.payload.cost && (
            <ToolDetail title="成本信息" value={call.payload.cost} />
          )}
        </div>
      )}
    </div>
  );
}

const toolLabels: Record<string, string> = {
  recut_recut_context: "读取 Recut 上下文",
  recut_recut_apps_list: "读取已安装应用",
  recut_recut_apps_store: "浏览应用商店",
  recut_recut_apps_install: "安装应用",
  recut_recut_apps_update: "更新应用",
  recut_recut_skills_list: "读取技能目录",
  recut_recut_skills_read: "读取技能说明",
  recut_recut_skills_reference: "读取技能参考资料",
  recut_recut_design_system_list: "浏览设计系统",
  recut_recut_design_system_get: "读取设计系统",
  recut_recut_project_create: "创建项目",
  recut_recut_project_list: "读取项目列表",
  recut_recut_project_get: "读取项目",
  recut_recut_project_context: "读取项目上下文",
  recut_recut_job_status: "查询任务状态",
  recut_recut_job_wait: "等待任务完成",
  recut_recut_job_logs: "读取任务日志",
  recut_recut_job_cancel: "取消任务",
  recut_recut_image_generate: "提交图片生成任务",
  recut_recut_video_generate: "提交视频生成任务",
  recut_recut_speech_generate: "提交语音生成任务",
  recut_recut_media_list_voices: "读取可用音色",
  recut_recut_media_get_job: "查询媒体生成进度",
  recut_recut_media_wait_for_job: "等待媒体生成结果",
  recut_recut_media_list_assets: "读取素材库",
  recut_recut_media_import_image: "归档生成图片",
  recut_recut_media_create_reference: "登记参考资料",
  recut_recut_media_attach: "关联素材到项目",
  recut_recut_worlds_list: "读取世界列表",
  recut_recut_worlds_get: "读取世界",
  recut_recut_worlds_entities_list: "读取世界实体",
  recut_recut_worlds_entities_get: "读取世界实体详情",
  recut_recut_worlds_evidence_list: "读取世界资料",
  recut_recut_worlds_resolve: "解析世界上下文",
  recut_recut_worlds_create: "创建世界",
  recut_recut_worlds_update: "更新世界",
  recut_recut_worlds_entities_upsert: "保存世界实体",
  recut_recut_worlds_references_attach: "关联世界参考素材",
  recut_recut_worlds_evidence_attach: "收录世界资料",
  recut_recut_worlds_evidence_update: "更新世界资料",
  recut_recut_worlds_evidence_archive: "归档世界资料",
  recut_recut_worlds_bind_project: "关联世界到项目",
  recut_recut_editor_project_create: "创建剪辑项目",
  recut_recut_editor_workflow_context: "读取剪辑工作流",
  recut_recut_editor_timeline_assets: "登记时间线素材",
  recut_recut_editor_project_get: "读取剪辑项目",
  recut_recut_editor_project_updateSettings: "更新剪辑设置",
  recut_recut_editor_project_lock: "锁定剪辑项目",
  recut_recut_editor_project_unlock: "解锁剪辑项目",
  recut_recut_editor_timeline_read: "读取时间线",
  recut_recut_editor_element_get: "读取时间线元素",
  recut_recut_editor_timeline_validate: "校验时间线",
  recut_recut_editor_timeline_command: "编辑时间线",
  recut_recut_editor_history_undo: "撤销时间线操作",
  recut_recut_editor_history_redo: "重做时间线操作",
  recut_recut_editor_film_package_import: "导入短片交接包",
  recut_recut_editor_component_define: "创建剪辑组件",
  recut_recut_editor_component_verify: "验证剪辑组件",
  recut_recut_editor_component_list: "读取剪辑组件",
  recut_recut_editor_component_source: "读取组件源码",
};

function toolDisplayLabel(payload: ToolPayload) {
  const name = payload.toolName ?? "";
  const alias = `recut_${name.replaceAll(".", "_")}`;
  const label = toolLabels[name] ?? toolLabels[alias] ?? payload.label?.trim();
  return label?.startsWith("调用 ") ? "MCP 工具调用" : label || "MCP 工具调用";
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
  emptyLabel = "未返回数据",
  title,
  value,
}: {
  emptyLabel?: string;
  title: string;
  value?: string;
}) {
  const [open, setOpen] = useState(false);
  const detail = value ? safeToolDetail(value) : emptyLabel;
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
            完整查看
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
  text,
  title,
}: {
  onClose: () => void;
  text: string;
  title: string;
}) {
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
            aria-label="关闭详情"
            className="grid size-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5">
          {text}
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
  return elapsed < 10
    ? `${elapsed.toFixed(1)} 秒`
    : `${Math.round(elapsed)} 秒`;
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
  return (
    <section className="absolute right-3 top-14 z-20 w-[calc(100%-1.5rem)] overflow-hidden rounded-md border bg-popover shadow-[var(--shadow-overlay)]">
      <p className="border-b px-3 py-2 text-[10px] font-medium text-muted-foreground">
        {label}
      </p>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {sessions.length === 0 ? (
          <p className="px-2 py-5 text-center text-xs text-muted-foreground">
            还没有会话
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

function sessionSummary(session: Session): string {
  const agent = runtimeLabel(session.runtime);
  if (session.runtime === "codex")
    return `${agent} · ${codexModelLabel(session.codexModel)} · ${reasoningLabel(session.reasoningEffort)}`;
  if (session.runtime === "opencode")
    return `${agent} · ${opencodeModelLabel(session.opencodeModel)}`;
  return agent;
}
