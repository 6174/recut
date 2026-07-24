/*
 * [INPUT]: 依赖 React 状态、项目范围 Agent Session HTTP/SSE API 与基础 UI 原子组件
 * [OUTPUT]: 对外提供 ProjectAgentPanel，在项目工作台中显示结构化一对一 Agent 对话
 * [POS]: components 的项目页协作侧栏；替代 TerminalPanel 的产品位置，终端仍保留为诊断能力
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowUp, Bot, ChevronDown, CircleStop, History, MessageSquarePlus } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

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
  if (!online) return <aside className="h-full overflow-y-auto bg-[#f7f6f2] p-4"><p className="text-xs font-medium">Agent 暂不可用</p><p className="mt-1 text-xs leading-5 text-[#77756f]">本地服务恢复后，会话与记录会自动回到这里。</p></aside>;
  return <aside className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f6f2]"><header className="flex shrink-0 items-center justify-between border-b border-[#d8d6d0] px-4 py-3"><div><p className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-[#77756f]"><Bot className="size-3.5" /> AI {detail?.appId && <span>· {detail.appId}</span>}</p><p className="mt-1 text-sm font-semibold">{detail?.title ?? "项目协作"}</p><p className="mt-0.5 text-[10px] text-[#8c8982]">{detail?.projectName ?? "当前项目"} · {detail?.runtime ?? "选择 Agent"}</p></div><div className="flex items-center gap-1"><Button className="size-7 px-0" onClick={() => { setRuntimeOpen(false); setHistoryOpen((open) => !open); }} title="会话历史" type="button" variant="ghost"><History className="size-4" /></Button><Button className="size-7 px-0" onClick={() => { setHistoryOpen(false); setRuntimeOpen((open) => !open); }} title="新建对话" type="button" variant="ghost"><MessageSquarePlus className="size-4" /></Button></div></header>
    {runtimeOpen && <RuntimePicker onChoose={(runtime) => { setRuntimeOpen(false); void create(runtime); }} />}
    {historyOpen && <section className="absolute right-3 top-14 z-20 w-[calc(100%-1.5rem)] overflow-hidden rounded border border-[#d8d6d0] bg-[#fbfaf7] shadow-lg"><p className="border-b border-[#d8d6d0] px-3 py-2 text-[10px] font-medium text-[#77756f]">此项目的会话历史</p><div className="max-h-64 overflow-y-auto p-1.5">{sessions.length === 0 ? <p className="px-2 py-5 text-center text-xs text-[#77756f]">还没有会话</p> : sessions.map((session) => <button className={`w-full rounded px-2 py-2 text-left text-xs hover:bg-[#efede7] ${session.id === activeID ? "bg-[#e9e7e1]" : ""}`} key={session.id} onClick={() => { setHistoryOpen(false); void open(session.id); }} type="button"><span className="block truncate font-medium">{session.title}</span><span className="mt-0.5 block truncate text-[10px] text-[#77756f]">{session.projectName ?? "当前项目"} · {session.appId ?? session.runtime}</span></button>)}</div></section>}
    <div className="flex-1 overflow-y-auto px-4 py-5" ref={messagesRef}>{error && <p className="mb-3 text-xs text-red-700">{error}</p>}{!detail ? <div className="grid min-h-48 place-items-center text-center"><div><Bot className="mx-auto size-5 text-[#77756f]" /><p className="mt-2 text-xs font-medium">让 AI 协助这个项目</p><Button className="mt-3" onClick={() => setRuntimeOpen(true)} type="button" variant="outline">创建对话</Button></div></div> : <div className="space-y-4">{detail.turns.map((turn) => <div key={turn.id}>{turn.role === "user" ? <p className="rounded-sm bg-[#e7e5df] px-2.5 py-2 text-xs leading-5 whitespace-pre-wrap">{turn.content}</p> : <p className="text-xs leading-5 whitespace-pre-wrap">{turn.content}</p>}{turn.role === "user" && <ToolLines events={detail.events.filter((event) => event.turnId === turn.id)} />}</div>)}{detail.status === "running" && <RunningStatus events={detail.events} now={now} />}</div>}</div>
    <form className="shrink-0 border-t border-[#d8d6d0] p-3" onSubmit={send}><div className="flex items-end gap-2 rounded border border-[#d8d6d0] bg-[#fbfaf7] p-1.5"><textarea className="min-h-14 flex-1 resize-none bg-transparent px-1.5 py-1 text-xs outline-none placeholder:text-[#98958d]" disabled={!detail || detail.status === "running"} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="告诉 AI 接下来做什么…" value={content} />{detail?.status === "running" ? <Button className="size-7 rounded-full p-0" onClick={() => void stop()} title="停止" type="button" variant="outline"><CircleStop className="size-3.5" /></Button> : <Button className="size-7 rounded-full p-0" disabled={!detail || !content.trim()} type="submit"><ArrowUp className="size-3.5" /></Button>}</div><p className="mt-1.5 flex items-center gap-1 text-[10px] text-[#8c8982]">Agent · Codex <ChevronDown className="size-3" /></p></form>
  </aside>;
}

function ToolLines({ events }: { events: AgentEvent[] }) { const calls = new Map<string, AgentEvent>(); for (const event of events) { if (!event.type.startsWith("tool.")) continue; calls.set(event.payload?.toolCallId ?? String(event.id), event); } if (calls.size === 0) return null; return <div className="mt-3 space-y-1.5">{[...calls.values()].map((event) => <p className="flex items-center gap-1.5 text-[11px] text-[#72716d]" key={event.id}><span className="size-1.5 rounded-full bg-[#438a55]" />{event.payload?.label ?? event.payload?.tool ?? "调用工具"}</p>)}</div>; }
function RunningStatus({ events, now }: { events: AgentEvent[]; now: number }) { const started = [...events].reverse().find((event) => event.type === "turn.started"); const elapsed = started ? Math.max(0, Math.floor((now - new Date(started.createdAt).getTime()) / 1000)) : 0; return <p className="flex items-center gap-1.5 text-xs text-[#77756f]"><span className="size-1.5 animate-pulse rounded-full bg-[#438a55]" />正在继续处理 · {elapsed}s</p>; }
function RuntimePicker({ onChoose }: { onChoose: (runtime: "codex" | "claude") => void }) { return <section className="absolute right-3 top-14 z-30 w-[calc(100%-1.5rem)] overflow-hidden rounded border border-[#d8d6d0] bg-[#fbfaf7] shadow-lg"><p className="border-b border-[#d8d6d0] px-3 py-2 text-[10px] font-medium text-[#77756f]">选择 Agent · 创建后不可更改</p><button className="block w-full px-3 py-2.5 text-left text-xs hover:bg-[#efede7]" onClick={() => onChoose("codex")} type="button"><span className="block font-medium">Codex</span><span className="mt-0.5 block text-[10px] text-[#77756f]">JSONL adapter · 已支持续聊与 Recut MCP</span></button><button className="block w-full border-t border-[#e2e0da] px-3 py-2.5 text-left text-xs hover:bg-[#efede7]" onClick={() => onChoose("claude")} type="button"><span className="block font-medium">Claude Code</span><span className="mt-0.5 block text-[10px] text-[#77756f]">stream-json adapter · 已支持续聊与 Recut MCP</span></button><p className="border-t border-[#e2e0da] px-3 py-2 text-[10px] leading-4 text-[#8c8982]">Kimi、Gemini 会在各自 native session adapter 完成后开放，避免创建无法续聊的伪会话。</p></section>; }
