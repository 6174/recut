/*
 * [INPUT]: 依赖 React 状态、项目范围 Agent Session HTTP/SSE API 与基础 UI 原子组件
 * [OUTPUT]: 对外提供 ProjectAgentPanel，在项目工作台中显示结构化一对一 Agent 对话
 * [POS]: components 的项目页协作侧栏；替代 TerminalPanel 的产品位置，终端仍保留为诊断能力
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowUp, Bot, ChevronDown, CircleStop, Copy, History, MessageSquarePlus, Plus, SlidersHorizontal, ThumbsDown, ThumbsUp } from "lucide-react";
import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type Session = { id: string; title: string; runtime: string; status: string; updatedAt: string; projectName?: string; appId?: string };
type Turn = { id: string; role: "user" | "assistant"; content: string };
type AgentEvent = { id: number; turnId?: string; type: string; createdAt: string; payload?: { label?: string; phase?: string; toolCallId?: string; tool?: string }; };
type Detail = Session & { turns: Turn[]; events: AgentEvent[]; lastEventId: number };
type Props = { apiBase: string; online: boolean; projectID: string | null };

export function ProjectAgentPanel({ apiBase, online, projectID }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const streamRef = useRef<EventSource | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (online && projectID) void loadSessions(); else { streamRef.current?.close(); setSessions([]); setDetail(null); setActiveID(null); } }, [online, projectID]);
  useEffect(() => () => streamRef.current?.close(), []);
  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); }, [detail?.turns.length, detail?.events.length]);
  useEffect(() => { if (detail?.status !== "running") return; setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [detail?.status]);

  async function loadSessions() {
    if (!projectID) return;
    const response = await fetch(`${apiBase}/v1/agent-sessions?projectId=${encodeURIComponent(projectID)}`);
    if (!response.ok) return;
    const next: Session[] = await response.json(); setSessions(next);
    const selected = activeID && next.some((session) => session.id === activeID) ? activeID : next[0]?.id ?? null;
    if (selected) await open(selected);
  }

  async function open(id: string) {
    streamRef.current?.close(); setActiveID(id);
    const response = await fetch(`${apiBase}/v1/agent-sessions/${id}`);
    if (!response.ok) { setError("无法读取对话"); return; }
    const next: Detail = await response.json(); setDetail(next);
    const stream = new EventSource(`${apiBase}/v1/agent-sessions/${id}/events?after=${next.lastEventId}`);
    stream.addEventListener("agent", (event) => {
      const incoming = JSON.parse((event as MessageEvent<string>).data) as AgentEvent;
      setDetail((current) => current ? { ...current, events: [...current.events, incoming], lastEventId: incoming.id } : current);
      if (incoming.type === "assistant.completed" || incoming.type === "turn.completed" || incoming.type === "turn.failed") void refresh(id);
    });
    streamRef.current = stream;
  }

  async function refresh(id: string) {
    const response = await fetch(`${apiBase}/v1/agent-sessions/${id}`); if (!response.ok) return;
    const next: Detail = await response.json(); setDetail(next); setSessions((current) => [next, ...current.filter((session) => session.id !== id)]);
  }

  async function create(runtime: "codex" | "claude") {
    if (!projectID) return;
    setError("");
    const response = await fetch(`${apiBase}/v1/agent-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: projectID, runtime }) });
    if (!response.ok) { setError("无法创建对话"); return; }
    const session: Session = await response.json(); setSessions((current) => [session, ...current]); await open(session.id);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeID || !content.trim() || detail?.status === "running") return;
    const text = content.trim(); setContent(""); setError("");
    const response = await fetch(`${apiBase}/v1/agent-sessions/${activeID}/turns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }) });
    if (!response.ok) { setContent(text); setError("无法发送消息"); return; }
    await refresh(activeID);
  }

  async function stop() { if (activeID) await fetch(`${apiBase}/v1/agent-sessions/${activeID}/stop`, { method: "POST" }); }
  if (!online) return <aside className="h-full overflow-y-auto bg-muted/40 p-4"><p className="text-xs font-medium">Agent 暂不可用</p><p className="mt-1 text-xs leading-5 text-muted-foreground">本地服务恢复后，会话与记录会自动回到这里。</p></aside>;
  return <aside className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"><header className="flex h-10 shrink-0 items-center justify-between border-b bg-card px-4"><p className="text-xs font-semibold tracking-wide">AI</p><div className="flex items-center gap-1"><Button className="size-7 px-0" onClick={() => { setRuntimeOpen(false); setHistoryOpen((open) => !open); }} title="会话历史" type="button" variant="ghost"><History className="size-3.5" /></Button><Button className="size-7 px-0" onClick={() => { setHistoryOpen(false); setRuntimeOpen((open) => !open); }} title="新建对话" type="button" variant="ghost"><MessageSquarePlus className="size-3.5" /></Button></div></header>
    {runtimeOpen && <RuntimePicker onChoose={(runtime) => { setRuntimeOpen(false); void create(runtime); }} />}
    {historyOpen && <section className="absolute right-3 top-14 z-20 w-[calc(100%-1.5rem)] overflow-hidden rounded-md border bg-popover shadow-[var(--shadow-overlay)]"><p className="border-b px-3 py-2 text-[10px] font-medium text-muted-foreground">此项目的会话历史</p><div className="max-h-64 overflow-y-auto p-1.5">{sessions.length === 0 ? <p className="px-2 py-5 text-center text-xs text-muted-foreground">还没有会话</p> : sessions.map((session) => <button className={`w-full rounded-sm px-2 py-2 text-left text-xs hover:bg-muted ${session.id === activeID ? "bg-accent" : ""}`} key={session.id} onClick={() => { setHistoryOpen(false); void open(session.id); }} type="button"><span className="block truncate font-medium">{session.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{session.projectName ?? "当前项目"} · {session.appId ?? session.runtime}</span></button>)}</div></section>}
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-36" ref={messagesRef}>{error && <p className="mb-4 text-xs text-destructive">{error}</p>}{!detail ? <div className="grid min-h-48 place-items-center text-center"><div><Bot className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 text-xs font-medium">让 AI 协助这个项目</p><Button className="mt-3" onClick={() => setRuntimeOpen(true)} type="button" variant="outline">创建对话</Button></div></div> : <div className="space-y-5">{detail.turns.map((turn, index) => <article key={turn.id}>{turn.role === "user" ? <p className="ml-auto w-fit max-w-[85%] rounded-sm bg-secondary px-3 py-2 text-left text-xs leading-5 break-words whitespace-pre-wrap">{turn.content}</p> : <><p className="text-xs leading-5 whitespace-pre-wrap">{turn.content}</p><ToolLines events={eventsForReply(detail.events, detail.turns[index - 1], turn)} /><div className="mt-2 flex items-center gap-1 text-muted-foreground"><ActionIcon label="复制回复"><Copy /></ActionIcon><ActionIcon label="有帮助"><ThumbsUp /></ActionIcon><ActionIcon label="没帮助"><ThumbsDown /></ActionIcon></div></>}</article>)}{detail.status === "running" && <RunningStatus events={detail.events} now={now} />}</div>}</div>
    <form className="absolute inset-x-0 bottom-0 border-t bg-card p-3" onSubmit={send}><div className="rounded-md border bg-popover px-3 py-2 shadow-[var(--shadow-overlay)]"><textarea className="block min-h-12 w-full resize-none bg-transparent py-0.5 text-xs leading-5 outline-none placeholder:text-muted-foreground" disabled={!detail || detail.status === "running"} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="告诉 AI 需要做什么 — @ 引用项目素材" value={content} /><div className="mt-1 flex items-center justify-between"><div className="flex items-center gap-1"><button className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground" type="button"><Bot className="size-3" />Agent <ChevronDown className="size-3" /></button><button aria-label="对话设置" className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" type="button"><SlidersHorizontal className="size-3.5" /></button></div><div className="flex items-center gap-1"><button aria-label="添加引用" className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" type="button"><Plus className="size-4" /></button>{detail?.status === "running" ? <Button className="size-6 rounded-full p-0" onClick={() => void stop()} title="停止" type="button" variant="outline"><CircleStop className="size-3" /></Button> : <Button className="size-6 rounded-full p-0" disabled={!detail || !content.trim()} type="submit"><ArrowUp className="size-3" /></Button>}</div></div></div></form>
  </aside>;
}

function eventsForReply(events: AgentEvent[], request: Turn | undefined, reply: Turn) { return events.filter((event) => event.turnId === request?.id || event.turnId === reply.id); }
function ToolLines({ events }: { events: AgentEvent[] }) { const calls = new Map<string, AgentEvent>(); for (const event of events) { if (!event.type.startsWith("tool.")) continue; calls.set(event.payload?.toolCallId ?? String(event.id), event); } if (calls.size === 0) return null; return <div className="mt-3 space-y-1.5">{[...calls.values()].map((event) => <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" key={event.id}><span className="size-1.5 rounded-full bg-success" />{event.payload?.label ?? event.payload?.tool ?? "调用工具"}</p>)}</div>; }
function RunningStatus({ events, now }: { events: AgentEvent[]; now: number }) { const started = [...events].reverse().find((event) => event.type === "turn.started"); const elapsed = started ? Math.max(0, Math.floor((now - new Date(started.createdAt).getTime()) / 1000)) : 0; return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-success" />正在继续处理 · {elapsed}s</p>; }
function ActionIcon({ children, label }: { children: ReactNode; label: string }) { return <button aria-label={label} className="grid size-6 place-items-center rounded-sm hover:bg-muted hover:text-foreground [&>svg]:size-3" type="button">{children}</button>; }
function RuntimePicker({ onChoose }: { onChoose: (runtime: "codex" | "claude") => void }) { return <section className="absolute right-3 top-14 z-30 w-[calc(100%-1.5rem)] overflow-hidden rounded-md border bg-popover shadow-[var(--shadow-overlay)]"><p className="border-b px-3 py-2 text-[10px] font-medium text-muted-foreground">选择 Agent · 创建后不可更改</p><button className="block w-full px-3 py-2.5 text-left text-xs hover:bg-muted" onClick={() => onChoose("codex")} type="button"><span className="block font-medium">Codex</span><span className="mt-0.5 block text-[10px] text-muted-foreground">JSONL adapter · 已支持续聊与 Recut MCP</span></button><button className="block w-full border-t px-3 py-2.5 text-left text-xs hover:bg-muted" onClick={() => onChoose("claude")} type="button"><span className="block font-medium">Claude Code</span><span className="mt-0.5 block text-[10px] text-muted-foreground">stream-json adapter · 已支持续聊与 Recut MCP</span></button><p className="border-t px-3 py-2 text-[10px] leading-4 text-muted-foreground">Kimi、Gemini 会在各自 native session adapter 完成后开放，避免创建无法续聊的伪会话。</p></section>; }
