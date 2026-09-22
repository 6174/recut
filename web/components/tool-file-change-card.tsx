/*
 * [INPUT]: 依赖 lib/agent/file-change 的归一化结果、Agent 工具调用字段与 i18n 字典
 * [OUTPUT]: 对外提供 FileChangeCard：把 write/edit/patch/file_change 渲染成可直接预览文件内容与 diff 的卡片，点击打开完整预览
 * [POS]: components 的工具结果展示层；归一化逻辑在 lib/agent/file-change，本层只负责渲染
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ChevronRight, FileCode2, FilePlus2, FileX2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { copyToClipboard } from "@/components/agent-install-guide";
import {
  changeDiff,
  diffStats,
  extractFileChanges,
  isFileChangeCall,
  lineCount,
  type FileChange,
  type FileChangeKind,
  type FileToolCall,
} from "@/lib/agent/file-change";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";

export { extractFileChanges, isFileChangeCall };
export type { FileChange, FileChangeKind, FileToolCall };

const CONTENT_PREVIEW_LINES = 12;
const DIFF_PREVIEW_LINES = 16;
const DIALOG_MAX_LINES = 4000;

export function FileChangeCard({
  apiBase,
  call,
  changes,
  duration,
}: {
  apiBase: string;
  call: FileToolCall;
  changes: FileChange[];
  duration: string;
}) {
  const { t: text } = useI18n();
  const [open, setOpen] = useState(false);
  if (changes.length === 0) return null;
  const stateLabel = {
    running: text("agent.tool.running"),
    success: text("agent.tool.success"),
    error: text("agent.tool.error"),
  }[call.state];
  const stateDot = {
    running: "animate-pulse bg-warning",
    success: "bg-success",
    error: "bg-destructive",
  }[call.state];
  const stateText =
    call.state === "error"
      ? "text-destructive"
      : call.state === "success"
        ? "text-success"
        : "text-warning";
  const primary = changes[0];
  const additions = changes.reduce((total, change) => total + diffStats(change.diff).additions, 0) +
    changes.reduce(
      (total, change) => total + (change.diff ? 0 : lineCount(change.content)),
      0,
    );
  const deletions = changes.reduce((total, change) => total + diffStats(change.diff).deletions, 0);
  return (
    <div className="max-w-full text-[11px]">
      <button
        aria-label={interpolate(text("agent.file.viewFull"), { name: baseName(primary.path) })}
        className={`block w-full overflow-hidden rounded-sm border bg-card text-left shadow-sm transition hover:border-primary ${call.state === "error" ? "border-destructive/40" : ""}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="flex items-center gap-2 px-2.5 py-2">
          <FileIcon kind={primary.kind} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium text-foreground">{baseName(primary.path)}</span>
              <KindBadge kind={primary.kind} />
              {changes.length > 1 && (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {interpolate(text("agent.file.fileCount"), { count: String(changes.length) })}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
              {shortenPath(primary.path)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {(additions > 0 || deletions > 0) && (
              <span className="flex items-center gap-1 font-mono text-[10px]">
                {additions > 0 && <span className="text-success">+{additions}</span>}
                {deletions > 0 && <span className="text-destructive">−{deletions}</span>}
              </span>
            )}
            <ChevronRight className="size-3 text-muted-foreground" />
          </span>
        </span>
        <FileChangePreview call={call} change={primary} />
        <span className="flex items-center gap-1.5 border-t px-2.5 py-1 text-[10px] text-muted-foreground">
          <span className={`size-1.5 rounded-full ${stateDot}`} />
          <span className={stateText}>{stateLabel}</span>
          <span>· {duration}</span>
          <span className="ml-auto">{text("agent.file.viewFullShort")}</span>
        </span>
      </button>
      {open &&
        createPortal(
          <FileChangeDialog apiBase={apiBase} call={call} changes={changes} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </div>
  );
}

function FileChangePreview({ call, change }: { call: FileToolCall; change: FileChange }) {
  if (change.diff) {
    return <DiffLines diff={change.diff} maxHeightClass="max-h-32" maxLines={DIFF_PREVIEW_LINES} />;
  }
  if (typeof change.content === "string") {
    return <ContentLines content={change.content} maxHeightClass="max-h-32" maxLines={CONTENT_PREVIEW_LINES} />;
  }
  if (call.state === "error" && call.error) {
    return (
      <span className="block max-h-32 overflow-hidden border-t bg-destructive/5 px-2.5 py-1.5">
        <span className="block truncate font-mono text-[10px] text-destructive">
          {call.error.split("\n")[0]}
        </span>
      </span>
    );
  }
  return null;
}

type FileDocState = {
  status: "idle" | "loading" | "ready" | "error";
  content?: string;
  error?: string;
};

// useFileDocument 读取文件全文用于「文档」视图：write 自带 content 直接用；
// edit/patch 只有 diff，按需向后端 /v1/files/local 读取数据根内的落地文件。
function useFileDocument(apiBase: string, change: FileChange, enabled: boolean): FileDocState {
  const inline = typeof change.content === "string" ? change.content : undefined;
  const [state, setState] = useState<FileDocState>(() =>
    inline !== undefined ? { status: "ready", content: inline } : { status: "idle" },
  );
  useEffect(() => {
    if (!enabled) return;
    if (inline !== undefined) {
      setState({ status: "ready", content: inline });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`${apiBase}/v1/files/local?path=${encodeURIComponent(change.path)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { content?: unknown; error?: unknown } | null;
        if (cancelled) return;
        if (!response.ok || !payload || typeof payload.content !== "string") {
          const message = typeof payload?.error === "string" ? payload.error : "read failed";
          setState({ status: "error", error: message });
          return;
        }
        setState({ status: "ready", content: payload.content });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState({ status: "error", error: cause instanceof Error ? cause.message : "read failed" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, change.path, inline, enabled]);
  return state;
}

function FileChangeDialog({
  apiBase,
  call,
  changes,
  onClose,
}: {
  apiBase: string;
  call: FileToolCall;
  changes: FileChange[];
  onClose: () => void;
}) {
  const { t: text } = useI18n();
  const [copied, setCopied] = useState(false);
  const primary = changes[0];
  const single = changes.length === 1;
  const primaryDiff = single ? changeDiff(primary) : undefined;
  const hasDiffTab = Boolean(primaryDiff);
  const [tab, setTab] = useState<"diff" | "doc">(hasDiffTab ? "diff" : "doc");
  const doc = useFileDocument(apiBase, primary, single && tab === "doc");
  const copyValue = useMemo(() => {
    if (single) {
      if (tab === "doc") return doc.content ?? primary.content ?? primary.path;
      return primaryDiff ?? primary.content ?? primary.path;
    }
    return changes
      .map((change) => change.diff ?? change.content ?? change.path)
      .join("\n\n");
  }, [single, tab, doc.content, primary, primaryDiff, changes]);
  async function copy() {
    const ok = await copyToClipboard(copyValue);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2200);
  }
  const title = single ? baseName(primary.path) : primary.path;
  return (
    <div
      aria-labelledby="file-change-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
    >
      <section
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-medium" id="file-change-title">
              <span className="truncate">{title}</span>
              {single && <KindBadge kind={primary.kind} />}
            </h2>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {single ? primary.path : shortenPath(primary.path)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {single && hasDiffTab && (
              <div className="mr-1 flex items-center gap-0.5 rounded-sm border p-0.5">
                <TabButton active={tab === "diff"} onClick={() => setTab("diff")}>
                  {text("agent.file.tab.diff")}
                </TabButton>
                <TabButton active={tab === "doc"} onClick={() => setTab("doc")}>
                  {text("agent.file.tab.doc")}
                </TabButton>
              </div>
            )}
            <button
              className="rounded-sm px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => void copy()}
              type="button"
            >
              {copied ? text("agent.file.copied") : text("agent.file.copy")}
            </button>
            <button
              aria-label={text("agent.file.close")}
              className="grid size-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
              onClick={onClose}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {call.state === "error" && call.error && (
            <p className="border-b bg-destructive/5 px-4 py-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">
              {call.error}
            </p>
          )}
          {single ? (
            tab === "diff" && primaryDiff ? (
              <DiffLines diff={primaryDiff} maxHeightClass="" maxLines={DIALOG_MAX_LINES} />
            ) : (
              <FileDocument state={doc} />
            )
          ) : (
            changes.map((change) => (
              <section className="border-b last:border-b-0" key={change.path}>
                <p className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
                  <KindBadge kind={change.kind} />
                  <span className="truncate">{shortenPath(change.path)}</span>
                </p>
                {change.diff ? (
                  <DiffLines diff={change.diff} maxHeightClass="" maxLines={DIALOG_MAX_LINES} />
                ) : typeof change.content === "string" ? (
                  <ContentLines content={change.content} maxHeightClass="" maxLines={DIALOG_MAX_LINES} />
                ) : (
                  <p className="px-4 py-2 font-mono text-[11px] text-muted-foreground">{change.path}</p>
                )}
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-sm px-2 py-0.5 text-[10px] transition ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function FileDocument({ state }: { state: FileDocState }) {
  const { t: text } = useI18n();
  if (state.status === "loading") {
    return <p className="px-4 py-3 text-[11px] text-muted-foreground">{text("agent.file.loading")}</p>;
  }
  if (state.status === "error") {
    return (
      <p className="px-4 py-3 text-[11px] text-destructive">
        {interpolate(text("agent.file.readFailed"), { message: state.error ?? "" })}
      </p>
    );
  }
  if (typeof state.content === "string") {
    return <ContentLines content={state.content} maxHeightClass="" maxLines={DIALOG_MAX_LINES} />;
  }
  return <p className="px-4 py-3 text-[11px] text-muted-foreground">{text("agent.file.empty")}</p>;
}

type DiffLine = { type: "add" | "del" | "context" | "hunk" | "meta"; text: string };

function DiffLines({
  diff,
  maxLines,
  maxHeightClass = "max-h-[60vh]",
}: {
  diff: string;
  maxLines: number;
  maxHeightClass?: string;
}) {
  const { t: text } = useI18n();
  const lines = useMemo(() => parseDiff(diff), [diff]);
  const visible = lines.slice(0, maxLines);
  const hidden = lines.length - visible.length;
  return (
    <span className={`block ${maxHeightClass} overflow-auto border-t bg-muted/20 font-mono text-[11px] leading-5`}>
      {visible.map((line, index) => (
        <span className={diffLineClass(line.type)} key={index}>
          <span className="w-4 shrink-0 text-center text-muted-foreground/60 select-none">
            {diffSign(line.type)}
          </span>
          <span className="whitespace-pre-wrap break-all">{line.text === "" ? " " : line.text}</span>
        </span>
      ))}
      {hidden > 0 && (
        <span className="block px-2 py-1 text-center text-[10px] text-muted-foreground">
          {interpolate(text("agent.file.more"), { count: String(hidden) })}
        </span>
      )}
    </span>
  );
}

function ContentLines({
  content,
  maxLines,
  maxHeightClass = "max-h-[60vh]",
}: {
  content: string;
  maxLines: number;
  maxHeightClass?: string;
}) {
  const { t: text } = useI18n();
  const lines = useMemo(() => content.replace(/\n$/, "").split("\n"), [content]);
  const visible = lines.slice(0, maxLines);
  const hidden = lines.length - visible.length;
  return (
    <span className={`block ${maxHeightClass} overflow-auto border-t bg-muted/20 font-mono text-[11px] leading-5`}>
      {visible.length === 0 ? (
        <span className="block px-3 py-2 text-muted-foreground">{text("agent.file.empty")}</span>
      ) : (
        visible.map((line, index) => (
          <span className="flex" key={index}>
            <span className="w-8 shrink-0 select-none pr-2 text-right text-muted-foreground/50">
              {index + 1}
            </span>
            <span className="whitespace-pre-wrap break-all">{line === "" ? " " : line}</span>
          </span>
        ))
      )}
      {hidden > 0 && (
        <span className="block px-2 py-1 text-center text-[10px] text-muted-foreground">
          {interpolate(text("agent.file.more"), { count: String(hidden) })}
        </span>
      )}
    </span>
  );
}

function FileIcon({ kind }: { kind: FileChangeKind }) {
  if (kind === "add") return <FilePlus2 className="size-3.5 shrink-0 text-success" />;
  if (kind === "delete") return <FileX2 className="size-3.5 shrink-0 text-destructive" />;
  return <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />;
}

function KindBadge({ kind }: { kind: FileChangeKind }) {
  const { t: text } = useI18n();
  const label =
    kind === "add"
      ? text("agent.file.new")
      : kind === "delete"
        ? text("agent.file.delete")
        : text("agent.file.edit");
  const tone =
    kind === "add"
      ? "bg-success/10 text-success"
      : kind === "delete"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`shrink-0 rounded-sm px-1 py-0.5 text-[9px] leading-4 ${tone}`}>{label}</span>
  );
}

function diffLineClass(type: DiffLine["type"]) {
  return (
    {
      add: "flex bg-success/10 text-success",
      del: "flex bg-destructive/10 text-destructive",
      hunk: "flex bg-primary/5 text-primary",
      meta: "flex text-muted-foreground/70",
      context: "flex text-muted-foreground",
    } as Record<DiffLine["type"], string>
  )[type];
}

function diffSign(type: DiffLine["type"]) {
  return type === "add" ? "+" : type === "del" ? "−" : type === "hunk" ? "" : " ";
}

function parseDiff(diff: string): DiffLine[] {
  return diff.split("\n").map((line) => {
    if (line.startsWith("@@")) return { type: "hunk", text: line };
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("Index:") ||
      line.startsWith("===")
    ) {
      return { type: "meta", text: line };
    }
    if (line.startsWith("+")) return { type: "add", text: line.slice(1) };
    if (line.startsWith("-")) return { type: "del", text: line.slice(1) };
    if (line.startsWith(" ")) return { type: "context", text: line.slice(1) };
    return { type: "context", text: line };
  });
}

function baseName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function shortenPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const home = normalized.match(/^\/(?:Users|home)\/[^/]+/);
  const trimmed = home ? `~${normalized.slice(home[0].length)}` : normalized;
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length <= 3) return trimmed;
  return `…/${parts.slice(-3).join("/")}`;
}
