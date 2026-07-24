/*
 * [INPUT]: 依赖 React 状态能力和 Daemon 的健康、App、项目与 Agent Session HTTP API
 * [OUTPUT]: 对外提供两栏本地工作台：左侧项目，右侧结构化 Agent 会话管理
 * [POS]: web/app 的首屏控制台，保留项目工作区结构并替换终端字节流入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Clapperboard, FolderOpen, Plus } from "lucide-react";
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-5">
      <div className="flex items-center gap-3"><Clapperboard className="size-4" /><strong className="text-sm tracking-tight">RECUT</strong><Badge>LOCAL</Badge><span className="h-4 w-px bg-border" /><span className="font-mono text-[10px] text-muted-foreground">WORKSPACE / PROJECTS</span></div>
      <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground"><span className="flex items-center gap-2"><span className={online ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-warning"} />{online ? "DAEMON CONNECTED" : "DAEMON OFFLINE"}</span><SettingsPanel /></div>
    </header>
    <div className="relative grid min-h-0 flex-1 overflow-hidden [grid-template-columns:minmax(0,1fr)_var(--side-panel-width)]" ref={layoutRef} style={{ "--side-panel-width": `${panelWidth}px` } as CSSProperties}>
      <section className="min-h-0 overflow-y-auto p-8"><div className="mx-auto max-w-5xl"><div className="mb-8 flex items-end justify-between border-b pb-5"><div><h1 className="text-2xl font-semibold tracking-tight">项目工作区</h1><p className="mt-1 text-xs text-muted-foreground">创建、打开并管理本地项目。</p></div><Badge>{online ? `${projects.length} PROJECTS` : "PROJECTS UNAVAILABLE"}</Badge></div>{online && <form className="mb-5 grid grid-cols-[1fr_180px_auto] gap-3 rounded-xs border bg-card p-4" onSubmit={createProject}><Input onChange={(event) => setName(event.target.value)} placeholder="新项目名称" value={name} /><select className="h-9 rounded-xs border bg-background px-2 text-xs" onChange={(event) => setAppID(event.target.value)} value={appID}>{apps.map((app) => <option key={app.manifest.id} value={app.manifest.id}>{app.manifest.name}</option>)}</select><Button disabled={!name.trim() || !appID} type="submit"><Plus className="size-3.5" />创建项目</Button></form>}<div className="grid gap-3">{!online ? <Card><CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-5 text-muted-foreground" /><div><p className="text-sm font-medium">暂时无法读取项目</p><p className="mt-1 text-xs text-muted-foreground">本地服务离线；项目仍保存在本机，服务恢复后会重新显示。</p></div></CardContent></Card> : projects.length === 0 ? <Card><CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-5 text-muted-foreground" /><div><p className="text-sm font-medium">创建第一个项目</p><p className="mt-1 text-xs text-muted-foreground">在上方输入名称、选择 App，然后开始创作。</p></div></CardContent></Card> : projects.map((project) => <Card className="transition-colors hover:bg-muted/30" key={project.id}><Link className="block" href={`/projects/${project.id}`}><CardContent className="flex items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="truncate text-sm font-medium">{project.name}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{project.id}</p></div><Badge>{project.appId}</Badge></CardContent></Link></Card>)}</div></div></section>
      <button aria-label="拖动调整 Agent 面板宽度" className="group absolute inset-y-0 z-10 w-2 cursor-col-resize border-0 bg-transparent p-0 focus:outline-none [left:calc(100%_-_var(--side-panel-width)_-_0.25rem)]" onPointerDown={handlePointerDown} type="button"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-foreground group-focus:w-0.5 group-focus:bg-foreground" /></button>
      <ProjectAgentPanel apiBase={apiBase} online={online} projectID={projectID} />
    </div>
  </main>;
}
