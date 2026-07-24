/*
 * [INPUT]: 依赖 Next.js 路由参数、VoxBrollWorkflow 与 Daemon 的项目读取 API
 * [OUTPUT]: 对外提供独立的 Vox B-roll 项目详情页与项目范围终端
 * [POS]: web/app/projects 的详情路由，不展示项目创建或 App 管理界面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeft, Clapperboard } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TerminalPanel } from "@/components/terminal-panel";
import { VoxBrollWorkflow } from "@/components/vox-broll-workflow";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
type Project = { id: string; name: string; appId: string };

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>(); const [project, setProject] = useState<Project | null>(null); const [online, setOnline] = useState(false);
  useEffect(() => { void (async () => { const response = await fetch(`${apiBase}/v1/projects/${id}`); if (!response.ok) return; setProject(await response.json()); setOnline(true); })(); }, [id]);
  return <main className="min-h-screen bg-background"><header className="flex h-12 items-center justify-between border-b bg-card px-4"><Link className="flex items-center gap-2" href="/"><ArrowLeft className="size-4" /><Clapperboard className="size-4" /><strong className="text-sm tracking-tight">RECUT</strong></Link><Badge>LOCAL</Badge></header><div className="grid min-h-[calc(100vh-3rem)] lg:grid-cols-[minmax(0,1fr)_380px]"><section className="p-5 sm:p-8">{project?.appId === "recut.vox-broll" ? <VoxBrollWorkflow apiBase={apiBase} projectID={project.id} projectName={project.name} /> : <p className="text-sm text-muted-foreground">项目不存在或暂不支持独立详情页。</p>}</section><TerminalPanel apiBase={apiBase} online={online} projectID={project?.id ?? null} /></div></main>;
}
