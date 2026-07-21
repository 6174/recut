/*
 * [INPUT]: 依赖 React 状态能力和 Daemon 的 /health、/v1/apps、/v1/projects HTTP API
 * [OUTPUT]: 对外提供本地 App 目录、项目列表及创建项目的工作台首页
 * [POS]: web/app 的首屏控制台，是前端与本机 Daemon 的唯一示例集成点
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Clapperboard, FolderOpen, Plus, Radio, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";

type App = { manifest: { id: string; name: string; version: string } };
type Project = { id: string; name: string; appId: string; createdAt: string };

export default function Workspace() {
  const [apps, setApps] = useState<App[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [appID, setAppID] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"connecting" | "ready" | "error">("connecting");

  useEffect(() => {
    void loadWorkspace();
  }, []);

  async function loadWorkspace() {
    try {
      const [appsResponse, projectsResponse] = await Promise.all([fetch(`${apiBase}/v1/apps`), fetch(`${apiBase}/v1/projects`)]);
      if (!appsResponse.ok || !projectsResponse.ok) throw new Error("Daemon unavailable");
      const nextApps: App[] = await appsResponse.json();
      setApps(nextApps);
      setProjects(await projectsResponse.json());
      setAppID((current) => current || nextApps[0]?.manifest.id || "");
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !appID) return;
    const response = await fetch(`${apiBase}/v1/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, appId: appID }),
    });
    if (!response.ok) {
      setStatus("error");
      return;
    }
    setName("");
    setStatus("ready");
    await loadWorkspace();
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="flex h-12 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-2"><Clapperboard className="size-4" /><strong className="text-sm tracking-tight">RECUT</strong><Badge>LOCAL</Badge></div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground"><span className={status === "ready" ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-amber-500"} /><span>{status === "ready" ? "DAEMON CONNECTED" : status === "error" ? "DAEMON OFFLINE" : "CONNECTING"}</span></div>
      </header>
      <div className="grid min-h-[calc(100vh-3rem)] lg:grid-cols-[244px_minmax(0,1fr)_320px]">
        <aside className="border-b bg-card p-3 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between px-1"><span className="font-mono text-[10px] text-muted-foreground">APPLICATIONS</span><Sparkles className="size-3.5 text-muted-foreground" /></div>
          <div className="grid gap-1">
            {apps.map((app) => (
              <button className={appID === app.manifest.id ? "flex items-center justify-between rounded-xs bg-muted px-2 py-2 text-left text-xs font-medium" : "flex items-center justify-between rounded-xs px-2 py-2 text-left text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"} key={app.manifest.id} onClick={() => setAppID(app.manifest.id)} type="button">
                <span className="flex items-center gap-2"><span className={appID === app.manifest.id ? "size-1.5 rounded-full bg-foreground" : "size-1.5 rounded-full bg-border"} />{app.manifest.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{app.manifest.version}</span>
              </button>
            ))}
          </div>
        </aside>
        <section className="p-5 sm:p-8">
          <div className="mb-8 flex items-end justify-between gap-4 border-b pb-5"><div><p className="mb-2 font-mono text-[10px] text-muted-foreground">WORKSPACE / PROJECTS</p><h1 className="text-2xl font-semibold tracking-tight">项目工作区</h1></div><Badge>{projects.length} PROJECTS</Badge></div>
          <div className="grid gap-3">{projects.length === 0 ? <Card><CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-5 text-muted-foreground" /><div><p className="text-sm font-medium">尚无项目</p><p className="mt-1 text-xs text-muted-foreground">从右侧选择应用并创建第一个本地项目。</p></div></CardContent></Card> : projects.map((project) => <Card className="transition-colors hover:bg-muted/30" key={project.id}><CardContent className="flex items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="truncate text-sm font-medium">{project.name}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{project.id}</p></div><Badge>{project.appId}</Badge></CardContent></Card>)}</div>
        </section>
        <aside className="border-t bg-card p-4 lg:border-t-0 lg:border-l">
          <Card>
            <CardHeader><div className="flex items-center gap-2"><Plus className="size-3.5" /><CardTitle>新建项目</CardTitle></div><CardDescription>项目文件始终保存于本机。</CardDescription></CardHeader>
            <form onSubmit={createProject}>
              <CardContent className="space-y-3"><label className="grid gap-1.5 text-xs font-medium">项目名称<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：第 1 集" /></label><div className="rounded-xs border bg-muted/40 px-2.5 py-2"><p className="font-mono text-[10px] text-muted-foreground">SELECTED APP</p><p className="mt-1 text-xs font-medium">{apps.find((app) => app.manifest.id === appID)?.manifest.name ?? "选择一个应用"}</p></div></CardContent>
              <CardFooter><Button className="w-full" disabled={!appID || !name.trim()} type="submit"><Plus className="size-3.5" />创建本地项目</Button></CardFooter>
            </form>
          </Card>
          <div className="mt-4 flex items-center gap-2 rounded-xs border border-dashed px-3 py-2.5 text-xs text-muted-foreground"><Radio className="size-3.5" />Agent 连接将显示在这里</div>
        </aside>
      </div>
    </main>
  );
}
