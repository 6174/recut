/*
 * [INPUT]: 依赖 React 状态能力和 Daemon 的健康、App、项目与终端会话 HTTP API
 * [OUTPUT]: 对外提供两栏本地工作台：左侧项目，右侧终端会话管理
 * [POS]: web/app 的首屏控制台，组合项目工作区与通用本机终端入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Clapperboard, FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TerminalPanel } from "@/components/terminal-panel";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
type App = { manifest: { id: string; name: string; version: string } };
type Project = { id: string; name: string; appId: string; createdAt: string };

export default function Workspace() {
  const [apps, setApps] = useState<App[]>([]); const [projects, setProjects] = useState<Project[]>([]);
  const [appID, setAppID] = useState(""); const [name, setName] = useState(""); const [projectID, setProjectID] = useState<string | null>(null);
  const [online, setOnline] = useState(false);

  useEffect(() => { void loadWorkspace(); const timer = window.setInterval(() => void loadWorkspace(), 3000); return () => window.clearInterval(timer); }, []);

  async function loadWorkspace() {
    try {
      const health = await fetch(`${apiBase}/health`); if (!health.ok) throw new Error();
      const [appsResponse, projectsResponse] = await Promise.all([fetch(`${apiBase}/v1/apps`), fetch(`${apiBase}/v1/projects`)]);
      if (!appsResponse.ok || !projectsResponse.ok) throw new Error();
      const nextApps: App[] = await appsResponse.json(); const nextProjects: Project[] = await projectsResponse.json();
      setApps(nextApps); setProjects(nextProjects); setAppID((current) => current || nextApps[0]?.manifest.id || "");
      setProjectID((current) => current && nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id ?? null); setOnline(true);
    } catch { setOnline(false); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!name.trim() || !appID) return;
    const response = await fetch(`${apiBase}/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, appId: appID }) });
    if (!response.ok) return; const created: Project = await response.json(); setName(""); await loadWorkspace(); setProjectID(created.id);
  }

  return <main className="min-h-screen bg-background"><header className="flex h-12 items-center justify-between border-b bg-card px-4"><div className="flex items-center gap-2"><Clapperboard className="size-4" /><strong className="text-sm tracking-tight">RECUT</strong><Badge>LOCAL</Badge></div><div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground"><span className={online ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-amber-500"} />{online ? "DAEMON CONNECTED" : "DAEMON OFFLINE"}</div></header>
    <div className="grid min-h-[calc(100vh-3rem)] lg:grid-cols-[minmax(0,1fr)_380px]"><section className="p-5 sm:p-8"><div className="mb-8 flex items-end justify-between border-b pb-5"><div><p className="mb-2 font-mono text-[10px] text-muted-foreground">WORKSPACE / PROJECTS</p><h1 className="text-2xl font-semibold tracking-tight">项目工作区</h1></div><Badge>{online ? `${projects.length} PROJECTS` : "PROJECTS UNAVAILABLE"}</Badge></div>
      {online && <form className="mb-5 grid gap-3 rounded-xs border bg-card p-4 sm:grid-cols-[1fr_180px_auto]" onSubmit={createProject}><Input onChange={(event) => setName(event.target.value)} placeholder="新项目名称" value={name} /><select className="h-9 rounded-xs border bg-background px-2 text-xs" onChange={(event) => setAppID(event.target.value)} value={appID}>{apps.map((app) => <option key={app.manifest.id} value={app.manifest.id}>{app.manifest.name}</option>)}</select><Button disabled={!name.trim() || !appID} type="submit"><Plus className="size-3.5" />创建项目</Button></form>}
      <div className="grid gap-3">{!online ? <Card><CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-5 text-muted-foreground" /><div><p className="text-sm font-medium">暂时无法读取项目</p><p className="mt-1 text-xs text-muted-foreground">本地服务离线；项目仍保存在本机，服务恢复后会重新显示。</p></div></CardContent></Card> : projects.length === 0 ? <Card><CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-5 text-muted-foreground" /><div><p className="text-sm font-medium">创建第一个项目</p><p className="mt-1 text-xs text-muted-foreground">在上方输入名称、选择 App，然后开始创作。</p></div></CardContent></Card> : projects.map((project) => <Card className="transition-colors hover:bg-muted/30" key={project.id}><Link className="block" href={`/projects/${project.id}`}><CardContent className="flex items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="truncate text-sm font-medium">{project.name}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{project.id}</p></div><Badge>{project.appId}</Badge></CardContent></Link></Card>)}</div>
    </section><TerminalPanel apiBase={apiBase} online={online} projectID={projectID} /></div></main>;
}
