/*
 * [INPUT]: 项目 workflow API、WebSocket 事件与用户的自然语言创作意图
 * [OUTPUT]: VoxBrollWorkflow，提供纵向资源管理器、资源版本展示和 Agent 意图入口
 * [POS]: Vox B-roll 的主创作空间；左侧是资源索引，中央是资源内容与设置，不呈现线性 workflow
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ChevronRight, MessageSquarePlus, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = { apiBase: string; projectID: string; projectName: string };
type Brief = { title?: string; premise?: string; direction?: string; script?: string; topic?: string };
type Proposal = { proposalId: string; sessionId: string; path: string; value: Brief };
type Resource = { id: string; label: string; hint: string };

const resources: Resource[] = [
  { id: "brief", label: "创作方向", hint: "视频想表达什么" },
  { id: "beats", label: "分镜", hint: "故事如何展开" },
  { id: "look", label: "视觉风格", hint: "画面应该是什么感觉" },
  { id: "keyframes", label: "关键帧", hint: "每个镜头的核心画面" },
  { id: "motion", label: "动态", hint: "镜头与元素如何运动" },
  { id: "audio", label: "旁白与音乐", hint: "声音与节奏" },
  { id: "delivery", label: "成片", hint: "预览与交付" },
];

export function VoxBrollWorkflow({ apiBase, projectID, projectName }: Props) {
  const [selected, setSelected] = useState("brief");
  const [brief, setBrief] = useState<Brief>({});
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [topic, setTopic] = useState("");
  const [feedback, setFeedback] = useState("");
  const [working, setWorking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = async () => {
    const response = await fetch(`${apiBase}/v1/projects/${projectID}/workflow`);
    if (!response.ok) return;

    const workflow = await response.json();
    setBrief(workflow.brief ?? {});
    if (workflow.proposal?.proposal) {
      setProposal({
        proposalId: workflow.proposal.proposal.id,
        sessionId: workflow.proposal.sessionId,
        path: workflow.proposal.proposal.path,
        value: workflow.proposal.proposal.value,
      });
    }
  };

  useEffect(() => {
    void load();
    const socket = new WebSocket(`${apiBase.replace(/^http/, "ws")}/v1/events`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "subscribe", projectId: projectID }));
    socket.onmessage = (message) => {
      const event = JSON.parse(message.data).event;
      if (event?.type === "agent.command.proposed" && event.path === "data/brief.json") {
        setProposal({ proposalId: event.proposalId, sessionId: event.sessionId, path: event.path, value: event.value });
      }
      if (event?.type === "agent.command.committed") {
        setProposal(null);
        void load();
      }
    };
    return () => socket.close();
  }, [apiBase, projectID]);

  const ask = async (instruction: string) => {
    setWorking(true);
    await fetch(`${apiBase}/v1/projects/${projectID}/agent-tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
    setWorking(false);
  };

  const create = () => void ask(`为主题“${topic}”创作一份 30 秒、竖屏 9:16 的 Vox 风格视频创作方向。调用 Recut 工具并提出 data/brief.json 更新，包含标题、核心观点、叙事方式与解说草案。`);
  const revise = () => void ask(`用户希望调整当前创作方向：${feedback}。读取 data/brief.json，基于当前版本提出新的候选版本。`);
  const approve = async () => {
    if (!proposal) return;
    await fetch(`${apiBase}/v1/projects/${projectID}/proposals/${proposal.proposalId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: proposal.sessionId }),
    });
  };

  const current = proposal?.value ?? brief;
  const hasBrief = Boolean(brief.title || brief.topic);
  const resource = resources.find((item) => item.id === selected)!;

  return (
    <section>
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="font-mono text-[10px] text-muted-foreground">VOX EXPLAINER / {projectName}</p>
          <h1 className="mt-2 text-3xl font-semibold">制作一支解说视频</h1>
        </div>
        <Button onClick={() => setSettingsOpen(!settingsOpen)} variant="outline"><Settings2 className="size-3.5" />项目设置</Button>
      </header>
      {settingsOpen && <div className="mb-5 grid gap-3 rounded-xs border bg-card p-4 sm:grid-cols-3"><Setting label="时长" value="30 秒" /><Setting label="画幅" value="竖屏 9:16" /><Setting label="语言" value="中文" /></div>}
      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav className="rounded-xs border bg-card p-2">
          {resources.map((item) => <ResourceNavigationItem hasBrief={hasBrief} key={item.id} proposal={proposal} selected={selected} setSelected={setSelected} resource={item} />)}
        </nav>
        <main className="min-w-0 rounded-xs border bg-card p-6">
          {selected === "brief" ? (
            <BriefPanel approve={approve} brief={current} create={create} feedback={feedback} hasBrief={hasBrief} proposal={proposal} revise={revise} setFeedback={setFeedback} setTopic={setTopic} topic={topic} working={working} />
          ) : (
            <EmptyResource ask={ask} hasBrief={hasBrief} resource={resource} resources={resources} working={working} />
          )}
        </main>
      </div>
    </section>
  );
}

function ResourceNavigationItem({ resource, selected, setSelected, hasBrief, proposal }: { resource: Resource; selected: string; setSelected: (id: string) => void; hasBrief: boolean; proposal: Proposal | null }) {
  const status = resource.id === "brief" ? (proposal ? "AI 已准备" : "当前使用") : (resource.id === "beats" && hasBrief ? "可以开始" : "尚未创建");
  return <button className={`w-full rounded-xs px-3 py-3 text-left ${selected === resource.id ? "bg-muted" : "hover:bg-muted/50"}`} onClick={() => setSelected(resource.id)}><p className="text-sm font-medium">{resource.label}</p><p className="mt-1 text-[10px] text-muted-foreground">{status}</p></button>;
}

function BriefPanel({ hasBrief, proposal, brief, topic, setTopic, feedback, setFeedback, create, revise, approve, working }: any) {
  if (!hasBrief && !proposal) {
    return <><p className="font-mono text-[10px] text-muted-foreground">创作方向 / 新资源</p><h2 className="mt-2 text-2xl font-semibold">这支视频想讲什么？</h2><textarea className="mt-5 min-h-32 w-full rounded-xs border bg-background p-3 text-sm" onChange={(event) => setTopic(event.target.value)} placeholder="输入一个主题、观点或你想解释的问题" value={topic} /><Button className="mt-4" disabled={!topic.trim() || working} onClick={create}>{working ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}让 AI 构思方向</Button></>;
  }

  return <><p className="font-mono text-[10px] text-muted-foreground">创作方向 / {proposal ? "AI 新版本" : "当前工作版本"}</p><h2 className="mt-2 text-2xl font-semibold">{brief.title ?? brief.topic}</h2><Detail label="核心观点" value={brief.premise} /><Detail label="叙事方式" value={brief.direction} /><Detail label="解说草案" value={brief.script} /><div className="mt-6 border-t pt-4"><p className="text-xs font-medium">你想怎么继续？</p><div className="mt-2 flex flex-wrap gap-2">{proposal && <Button onClick={approve}>将此版本设为当前使用</Button>}<Button onClick={() => document.getElementById("feedback")?.focus()} variant="outline"><MessageSquarePlus className="size-3.5" />基于此版本调整</Button></div><textarea className="mt-3 min-h-20 w-full rounded-xs border bg-background p-2 text-xs" id="feedback" onChange={(event) => setFeedback(event.target.value)} placeholder="例如：让开头更有冲击力，整体语气更克制" value={feedback} /><Button className="mt-2" disabled={!feedback.trim() || working} onClick={revise} variant="outline">让 AI 创建新版本<ChevronRight className="size-3.5" /></Button></div></>;
}

function EmptyResource({ resource, resources, hasBrief, ask, working }: { resource: Resource; resources: Resource[]; hasBrief: boolean; ask: (prompt: string) => Promise<void>; working: boolean }) {
  const [open, setOpen] = useState(false);
  const [dependencies, setDependencies] = useState<string[]>(hasBrief ? ["brief"] : []);
  const [note, setNote] = useState("");
  const selectedDependencies = resources.filter((item) => dependencies.includes(item.id));
  const prompt = `为当前项目创建“${resource.label}”的新版本。\n前置资源：${selectedDependencies.map((item) => item.label).join("、") || "无"}\n额外要求：${note || "无"}\n先读取所选资源，再创建可审阅 proposal；不要修改任何前置资源。`;

  const toggleDependency = (id: string) => setDependencies((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return <><p className="font-mono text-[10px] text-muted-foreground">{resource.label} / 资源库</p><h2 className="mt-2 text-2xl font-semibold">{resource.label}</h2><div className="mt-6 rounded-xs border border-dashed p-6"><p className="text-sm font-medium">尚未创建{resource.label}</p><p className="mt-1 text-xs text-muted-foreground">{resource.hint}。创建后，这里会保留所有版本及其依赖关系。</p><Button className="mt-4" disabled={working} onClick={() => setOpen(true)}><Sparkles className="size-3.5" />创建新版本</Button></div>{open && <ResourceCreationDialog dependencies={dependencies} note={note} onClose={() => setOpen(false)} onCreate={() => { void ask(prompt); setOpen(false); }} onNoteChange={setNote} resource={resource} resources={resources} toggleDependency={toggleDependency} working={working} />}</>;
}

function ResourceCreationDialog({ resource, resources, dependencies, toggleDependency, note, onNoteChange, onClose, onCreate, working }: { resource: Resource; resources: Resource[]; dependencies: string[]; toggleDependency: (id: string) => void; note: string; onNoteChange: (value: string) => void; onClose: () => void; onCreate: () => void; working: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><div className="w-full max-w-lg rounded-md border bg-card p-5 shadow-xl"><p className="font-mono text-[10px] text-muted-foreground">新建资源</p><h3 className="mt-1 text-lg font-semibold">创建{resource.label}</h3><p className="mt-2 text-xs text-muted-foreground">选择这次创作应参考哪些已有资源。</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{resources.filter((item) => item.id !== resource.id).map((item) => <label className="flex items-center gap-2 rounded-xs border p-2 text-xs" key={item.id}><input checked={dependencies.includes(item.id)} onChange={() => toggleDependency(item.id)} type="checkbox" />{item.label}</label>)}</div><textarea className="mt-4 min-h-20 w-full rounded-xs border bg-background p-2 text-xs" onChange={(event) => onNoteChange(event.target.value)} placeholder="额外要求（可选）" value={note} /><div className="mt-5 flex justify-end gap-2"><Button onClick={onClose} variant="outline">取消</Button><Button disabled={working} onClick={onCreate}>{working ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}交给 AI 创建</Button></div></div></div>;
}

function Detail({ label, value }: { label: string; value?: string }) {
  return value ? <div className="mt-5"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{value}</p></div> : null;
}

function Setting({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}
