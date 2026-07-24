/*
 * [INPUT]: 依赖项目/App manifest API 与 Next.js 路由参数
 * [OUTPUT]: 对外提供通用项目 App UI 容器与项目范围终端
 * [POS]: web 的 Extension Host 页面；不包含任何具体 App UI 或业务逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeft, Clapperboard } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TerminalPanel } from "@/components/terminal-panel";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
type Project = { id: string; name: string; appId: string };
type App = { manifest: { id: string; ui: { projectView?: string } } };

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [app, setApp] = useState<App | null>(null);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    void (async () => {
      const projectResponse = await fetch(`${apiBase}/v1/projects/${id}`);
      if (!projectResponse.ok) return;
      const nextProject = await projectResponse.json();
      setProject(nextProject);
      const appsResponse = await fetch(`${apiBase}/v1/apps`);
      if (appsResponse.ok) setApp((await appsResponse.json()).find((item: App) => item.manifest.id === nextProject.appId) ?? null);
      setOnline(true);
    })();
  }, [id]);

  const view = app?.manifest.ui.projectView;
  const uiURL = project && view ? `${apiBase}/v1/apps/${encodeURIComponent(project.appId)}/ui/${view}` : null;

  return <main className="min-h-screen bg-background"><header className="flex h-12 items-center justify-between border-b bg-card px-4"><Link className="flex items-center gap-2" href="/"><ArrowLeft className="size-4" /><Clapperboard className="size-4" /><strong className="text-sm tracking-tight">RECUT</strong></Link><Badge>LOCAL</Badge></header><div className="grid min-h-[calc(100vh-3rem)] lg:grid-cols-[minmax(0,1fr)_380px]"><section className="p-5 sm:p-8">{uiURL ? <iframe className="min-h-[calc(100vh-7rem)] w-full rounded-xs border bg-card" src={uiURL} title={`${project?.name ?? "Recut"} App`} /> : <p className="text-sm text-muted-foreground">这个 App 没有声明项目 UI。</p>}</section><TerminalPanel apiBase={apiBase} online={online} projectID={project?.id ?? null} /></div></main>;
}
