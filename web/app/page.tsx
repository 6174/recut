/*
 * [INPUT]: 依赖 React 状态能力和 Daemon 的健康、App、项目与 Agent Session HTTP API
 * [OUTPUT]: 对外提供两栏本地工作台：左侧项目，右侧结构化 Agent 会话管理
 * [POS]: web/app 的首屏控制台，保留项目工作区结构并替换终端字节流入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, Clapperboard, FolderOpen, FolderPlus, Images, Plus } from "lucide-react";
import Link from "next/link";
import { CSSProperties, FormEvent, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
export default function Workspace() {
  const [apps, setApps] = useState<{ manifest: { id: string; name: string } }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; appId: string }[]>([]);
  const [appID, setAppID] = useState(""); const [name, setName] = useState(""); const [projectID, setProjectID] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const { handlePointerDown, layoutRef, panelWidth } = useResizableSidePanel({ storageKey: "recut.workspace-agent-panel-width" });
  useEffect(() => { void loadWorkspace(); const timer = window.setInterval(() => void loadWorkspace(), 3000); return () => window.clearInterval(timer); }, []);
  async function loadWorkspace() { try { const health = await fetch(`${apiBase}/health`); if (!health.ok) throw new Error(); const [appResponse, projectResponse] = await Promise.all([fetch(`${apiBase}/v1/apps`), fetch(`${apiBase}/v1/projects`)]); if (!appResponse.ok || !projectResponse.ok) throw new Error(); const nextApps = await appResponse.json(); const nextProjects = await projectResponse.json(); setApps(nextApps); setProjects(nextProjects); setAppID((current) => current || nextApps[0]?.manifest.id || ""); setProjectID((current) => current && nextProjects.some((project: { id: string }) => project.id === current) ? current : nextProjects[0]?.id ?? null); setOnline(true); } catch { setOnline(false); } }
  async function createProject(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!name.trim() || !appID) return; const response = await fetch(`${apiBase}/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, appId: appID }) }); if (!response.ok) return; const project = await response.json(); setName(""); await loadWorkspace(); setProjectID(project.id); }
  return <main className="flex h-screen min-w-[1024px] flex-col overflow-hidden bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-5">
      <div className="flex items-center gap-4"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Clapperboard className="size-4" /></span><strong className="text-sm tracking-tight">RECUT</strong><span className="h-5 w-px bg-border" /><nav aria-label="系统应用" className="flex items-center gap-1"><Link className="group flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/20 hover:bg-accent hover:text-accent-foreground" href="/media"><span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary group-hover:bg-primary group-hover:text-primary-foreground"><Images className="size-3.5" /></span>素材管理器</Link></nav></div>
      <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground"><Link className="rounded-xs px-2 py-1 hover:bg-muted hover:text-foreground" href="/media">素材库</Link><span className="flex items-center gap-2"><span className={online ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-warning"} />{online ? "DAEMON CONNECTED" : "DAEMON OFFLINE"}</span><SettingsPanel /></div>
    </header>
    <div className="relative grid min-h-0 flex-1 overflow-hidden [grid-template-columns:minmax(0,1fr)_var(--side-panel-width)]" ref={layoutRef} style={{ "--side-panel-width": `${panelWidth}px` } as CSSProperties}>
      <section className="min-h-0 overflow-y-auto bg-muted/30 p-8"><div className="mx-auto max-w-6xl"><div className="mb-7 flex items-end justify-between"><div><p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary"><span className="size-1.5 rounded-full bg-primary" />DESKTOP</p><h1 className="text-3xl font-semibold tracking-tight">项目桌面</h1><p className="mt-2 text-sm text-muted-foreground">从一个项目开始，继续你的创作。</p></div><Badge className="border-primary/25 bg-accent text-accent-foreground">{online ? `${projects.length} PROJECTS` : "PROJECTS UNAVAILABLE"}</Badge></div>{!online ? <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-6 text-primary" /><div><p className="text-sm font-medium">暂时无法读取项目</p><p className="mt-1 text-xs text-muted-foreground">本地服务离线；项目仍保存在本机，服务恢复后会重新显示。</p></div></CardContent></Card> : <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4"><form className="group flex min-h-56 flex-col rounded-xl border-2 border-dashed border-primary/35 bg-card p-5 transition hover:border-primary hover:bg-accent/40" onSubmit={createProject}><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><FolderPlus className="size-5" /></span><div className="mt-auto"><p className="text-base font-semibold">新建项目</p><p className="mt-1 text-xs leading-5 text-muted-foreground">选择一个 App，给你的新创作命名。</p><div className="mt-4 grid gap-2"><Input className="h-8 bg-background text-xs" onChange={(event) => setName(event.target.value)} placeholder="项目名称" value={name} /><select className="h-8 rounded-sm border bg-background px-2 text-xs focus:border-primary focus:outline-none" onChange={(event) => setAppID(event.target.value)} value={appID}>{apps.map((app) => <option key={app.manifest.id} value={app.manifest.id}>{app.manifest.name}</option>)}</select><Button className="mt-1 h-8 rounded-md bg-primary text-primary-foreground hover:bg-primary/85" disabled={!name.trim() || !appID} type="submit"><Plus className="size-3.5" />创建项目</Button></div></div></form>{projects.map((project) => <Link className="group" href={`/projects/${project.id}`} key={project.id}><Card className="flex min-h-56 h-full flex-col border-transparent bg-card p-5 shadow-sm transition-all group-hover:-translate-y-1 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-overlay)]"><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><AppWindow className="size-5" /></span><Badge className="border-primary/20 bg-accent/60 text-accent-foreground">{project.appId}</Badge></div><div className="mt-auto"><p className="truncate text-base font-semibold">{project.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{project.id}</p><div className="mt-4 flex items-center gap-2 text-xs font-medium text-primary"><span className="size-1.5 rounded-full bg-primary" />继续创作</div></div></Card></Link>)}</div>}</div></section>
      <button aria-label="拖动调整 Agent 面板宽度" className="group absolute inset-y-0 z-10 w-2 cursor-col-resize border-0 bg-transparent p-0 focus:outline-none [left:calc(100%_-_var(--side-panel-width)_-_0.25rem)]" onPointerDown={handlePointerDown} type="button"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-foreground group-focus:w-0.5 group-focus:bg-foreground" /></button>
      <ProjectAgentPanel apiBase={apiBase} online={online} projectID={projectID} />
    </div>
  </main>;
}
