/*
 * [INPUT]: 依赖 xterm.js、React 生命周期和 Daemon 的健康、CLI 探测、终端会话 HTTP API
 * [OUTPUT]: 对外提供 TerminalPanel，用于引导启动 Daemon、检测 CLI、启动和恢复带最新消息摘要的本机终端会话
 * [POS]: components 的终端适配器；只传递 PTY 字节流，不理解 Codex 或 Claude 的消息格式
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, Clock3, Copy, Play, RotateCcw, Search, SquareTerminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type Agent = { id: string; name: string; command: string; available: boolean };
type Session = { id: string; projectId: string; command: string; running: boolean; startedAt: string; lastActivityAt?: string; lastMessage?: string };
type Props = { apiBase: string; online: boolean; projectID: string | null };

const daemonCommand = "cd service && go run .";
const daemonPrompt = "请在 Recut 项目根目录启动本地服务：cd service && go run .。服务启动后保持进程运行。";

export function TerminalPanel({ apiBase, online, projectID }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionID, setSessionID] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const historyRef = useRef<HTMLDivElement>(null);
  const previewRefresh = useRef<number | null>(null);
  const activeSession = sessions.find((session) => session.id === sessionID);

  useEffect(() => {
    if (!online) {
      setAgents([]); setSessions([]); setSessionID(null); setHistoryOpen(false);
      return;
    }
    void loadManager();
  }, [online, projectID]);

  useEffect(() => { const refresh = () => void loadManager(); window.addEventListener("recut-terminal-started", refresh); return () => window.removeEventListener("recut-terminal-started", refresh); }, [online, projectID]);

  useEffect(() => {
    const sendToCodex = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt: string }>).detail?.prompt;
      const session = sessions.find((candidate) => candidate.id === sessionID && candidate.command === "codex" && candidate.running);
      if (!prompt || !session) { setError("请先在右侧启动一个运行中的 Codex 会话"); return; }
      void fetch(`${apiBase}/v1/terminals/${session.id}/input`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: `${prompt}\n` }) });
    };
    window.addEventListener("recut-terminal-input", sendToCodex);
    return () => window.removeEventListener("recut-terminal-input", sendToCodex);
  }, [apiBase, sessionID, sessions]);


  useEffect(() => {
    function closeHistory(event: MouseEvent) {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    }
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") setHistoryOpen(false);
    }
    document.addEventListener("mousedown", closeHistory);
    document.addEventListener("keydown", handleKeydown);
    return () => { document.removeEventListener("mousedown", closeHistory); document.removeEventListener("keydown", handleKeydown); };
  }, []);

  useEffect(() => {
    if (!host.current || !sessionID) return;
    const sessionIsLive = activeSession?.running ?? false;
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !host.current) return;
      const terminal = new Terminal({ cursorBlink: sessionIsLive, disableStdin: !sessionIsLive, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, theme: { background: "#0a0a0a" } });
      const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.current); fit.fit();
      const send = (path: string, body: unknown) => fetch(`${apiBase}/v1/terminals/${sessionID}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (sessionIsLive) void send("resize", { cols: terminal.cols, rows: terminal.rows });
      const input = sessionIsLive ? terminal.onData((data) => { void send("input", { data }); }) : undefined;
      const stream = new EventSource(`${apiBase}/v1/terminals/${sessionID}/events`);
      stream.addEventListener("output", (event) => {
        terminal.write(JSON.parse((event as MessageEvent<string>).data));
        if (sessionIsLive) {
          if (previewRefresh.current) window.clearTimeout(previewRefresh.current);
          previewRefresh.current = window.setTimeout(() => { previewRefresh.current = null; void loadManager(); }, 800);
        }
      });
      const resize = new ResizeObserver(() => { fit.fit(); if (sessionIsLive) void send("resize", { cols: terminal.cols, rows: terminal.rows }); });
      resize.observe(host.current); if (sessionIsLive) terminal.focus();
      cleanup = () => { if (previewRefresh.current) window.clearTimeout(previewRefresh.current); input?.dispose(); resize.disconnect(); stream.close(); terminal.dispose(); };
    })();
    return () => { disposed = true; cleanup(); };
  }, [activeSession?.running, apiBase, sessionID]);

  async function loadManager() {
    try {
      const [agentsResponse, sessionsResponse] = await Promise.all([fetch(`${apiBase}/v1/agents`), fetch(`${apiBase}/v1/terminals`)]);
      if (!agentsResponse.ok || !sessionsResponse.ok) return;
      const nextSessions: Session[] = await sessionsResponse.json();
      const filtered = nextSessions.filter((session) => session.projectId === (projectID ?? ""));
      setAgents(await agentsResponse.json()); setSessions(filtered);
      setSessionID((current) => filtered.some((session) => session.id === current) ? current : filtered[0]?.id ?? null);
    } catch {
      // Daemon 状态由父工作台轮询管理；终端输出后的摘要刷新不能中断当前会话。
    }
  }

  async function start(command: string, args: string[] = []) {
    setError(""); setStarting(command);
    try {
      const response = await fetch(`${apiBase}/v1/terminals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: projectID, command, args }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "无法启动终端"); }
      const session: Session = await response.json();
      await loadManager(); setSessionID(session.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法启动终端"); } finally { setStarting(""); }
  }

  const visibleSessions = sessions.filter((session) => session.command.toLowerCase().includes(sessionQuery.trim().toLowerCase()));
  const canResume = activeSession?.command === "codex" || activeSession?.command === "claude";

  if (!online) return <aside className="border-t bg-card p-4 lg:border-l lg:border-t-0"><PanelTitle /><p className="mt-4 text-sm font-medium">本地服务尚未启动</p><p className="mt-1 text-xs leading-5 text-muted-foreground">浏览器无法自行启动宿主进程。复制命令到终端，或把 prompt 发给已打开的 Codex。</p><CopyAction label="复制启动命令" text={daemonCommand} /><CopyAction label="复制给 Codex 的 prompt" text={daemonPrompt} /></aside>;

  return <aside className="border-t bg-card p-4 lg:border-l lg:border-t-0"><div className="relative" ref={historyRef}><PanelTitle activeSession={activeSession} historyOpen={historyOpen} onHistoryToggle={() => { setSessionQuery(""); setHistoryOpen((open) => !open); }} />
    {historyOpen && <SessionHistory query={sessionQuery} sessions={visibleSessions} selectedID={sessionID} onQueryChange={setSessionQuery} onSelect={(id) => { setSessionID(id); setHistoryOpen(false); }} />}</div>
    <p className="mt-3 text-xs text-muted-foreground">{projectID ? "会话在当前项目目录中运行。" : "未选择项目：会话在 projects 根目录中运行。"}</p>
    <><div className="mt-4 grid gap-2">{agents.map((agent) => <Button disabled={!agent.available || Boolean(starting)} key={agent.id} onClick={() => start(agent.command)} type="button"><Play className="size-3.5" />{starting === agent.command ? `正在启动 ${agent.name}…` : agent.available ? `启动 ${agent.name}` : `${agent.name} 未安装`}</Button>)}</div>
      {error && <p className="mt-2 rounded-xs border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">{error}</p>}
      {activeSession && <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground">当前会话 · {activeSession.command}</p>}
      {activeSession && !activeSession.running && <div className="mt-3 rounded-xs border bg-muted/40 p-3"><p className="text-xs font-medium">此终端已结束，以下内容仅供查看。</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">原始 PTY 无法在 Daemon 重启后重新附着。继续会打开 Agent 的原生会话选择器。</p>{canResume && <Button className="mt-3 w-full" disabled={Boolean(starting)} onClick={() => void start(activeSession.command, activeSession.command === "codex" ? ["resume", "--dangerously-bypass-approvals-and-sandbox"] : ["--resume"])} type="button" variant="outline"><RotateCcw className="size-3.5" />继续 {activeSession.command === "codex" ? "Codex 对话" : "Claude 对话"}</Button>}</div>}
      <div className="mt-3 h-[calc(100vh-17rem)] min-h-72 overflow-hidden rounded-xs border bg-[#0a0a0a] p-1"><div className="h-full" ref={host}>{!sessionID && <p className="p-3 font-mono text-[11px] text-zinc-500">选择一个已安装的 CLI 启动终端会话。</p>}</div></div>
    </>
  </aside>;
}

function PanelTitle({ activeSession, historyOpen, onHistoryToggle }: { activeSession?: Session; historyOpen?: boolean; onHistoryToggle?: () => void }) {
  return <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="font-mono text-[10px] text-muted-foreground">TERMINAL SESSIONS</p><h2 className="mt-1 truncate text-sm font-semibold">{activeSession ? activeSession.command : "本机 Agent"}</h2></div>{onHistoryToggle ? <Button aria-expanded={historyOpen} aria-haspopup="dialog" className="shrink-0" onClick={onHistoryToggle} title="会话历史" type="button" variant="ghost"><Clock3 className="size-4" /><span className="sr-only">会话历史</span></Button> : <SquareTerminal className="size-4 shrink-0 text-muted-foreground" />}</div>;
}

function SessionHistory({ query, sessions, selectedID, onQueryChange, onSelect }: { query: string; sessions: Session[]; selectedID: string | null; onQueryChange: (query: string) => void; onSelect: (id: string) => void }) {
  return <section aria-label="会话历史" className="absolute right-0 top-full z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-md border bg-card shadow-xl"><div className="border-b p-2"><div className="flex h-8 items-center gap-2 rounded-xs border bg-background px-2 text-muted-foreground"><Search className="size-3.5" /><input aria-label="搜索最近会话" autoFocus className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground" onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索最近会话" value={query} />{query && <button aria-label="清除搜索" className="text-muted-foreground hover:text-foreground" onClick={() => onQueryChange("")} type="button"><X className="size-3.5" /></button>}</div></div><div className="max-h-80 overflow-y-auto p-1.5">{sessions.length === 0 ? <p className="px-2 py-6 text-center text-xs text-muted-foreground">没有匹配的会话</p> : sessions.map((session) => <button className={`flex w-full items-center gap-2 rounded-xs px-2 py-2 text-left text-xs transition-colors hover:bg-muted ${session.id === selectedID ? "bg-muted" : ""}`} key={session.id} onClick={() => onSelect(session.id)} type="button"><span className={`size-1.5 shrink-0 rounded-full ${session.running ? "bg-emerald-500" : "bg-muted-foreground/50"}`} /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{session.command}</span>{session.lastMessage && <span className="mt-0.5 block truncate text-[10px] text-foreground/75">{session.lastMessage}</span>}<span className="mt-0.5 block text-[10px] text-muted-foreground">{session.running ? "运行中" : "已结束"} · {relativeTime(session.lastActivityAt ?? session.startedAt)}</span></span>{session.id === selectedID && <Check className="size-3.5 shrink-0 text-foreground" />}</button>)}</div></section>;
}

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "刚刚";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function CopyAction({ label, text }: { label: string; text: string }) { return <Button className="mt-3 w-full" onClick={() => void navigator.clipboard.writeText(text)} type="button"><Copy className="size-3.5" />{label}</Button>; }
