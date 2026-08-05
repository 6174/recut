/*
 * [INPUT]: 依赖 lib/workspace-store 的项目/App 缓存与受控的 `<project>`/`<app>` 引用
 * [OUTPUT]: 对外提供 ProjectReferenceCard 与 AppReferenceCard，把 Agent 回复中的项目/App 引用渲染为可点击卡片
 * [POS]: components 的 Agent 引用卡片层；不解析任意 HTML，数据来自 workspace-store 去重缓存
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, FolderKanban, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { useWorkspaceStore } from "@/lib/workspace-store";

export function ProjectReferenceCard({ apiBase, projectId }: { apiBase: string; projectId: string }) {
  const load = useWorkspaceStore((state) => state.load);
  const loadProject = useWorkspaceStore((state) => state.loadProject);
  const project = useWorkspaceStore((state) => state.projectDetailsByID[projectId]);
  const apps = useWorkspaceStore((state) => state.apps);
  const app = apps.find((item) => item.manifest.id === project?.appId);
  useEffect(() => {
    void loadProject(apiBase, projectId).catch(() => {});
    void load(apiBase).catch(() => {});
  }, [apiBase, projectId, loadProject, load]);
  return (
    <Link className="group block w-64 overflow-hidden rounded-sm border bg-card text-left shadow-sm transition hover:border-primary hover:shadow-md" href={`/projects/${encodeURIComponent(projectId)}`}>
      <span className="grid aspect-video place-items-center bg-muted text-muted-foreground">{project ? <FolderKanban className="size-7" /> : <LoaderCircle className="size-5 animate-spin text-primary" />}</span>
      <span className="flex items-center gap-1.5 border-t px-2 py-1.5 font-mono text-[10px] text-muted-foreground group-hover:text-foreground"><FolderKanban className="size-3" />{project ? project.name : "正在读取项目…"} · {app ? app.manifest.name : project?.appId ?? "项目"} · 点击打开</span>
    </Link>
  );
}

export function AppReferenceCard({ apiBase, appId }: { apiBase: string; appId: string }) {
  const load = useWorkspaceStore((state) => state.load);
  const app = useWorkspaceStore((state) => state.apps.find((item) => item.manifest.id === appId));
  useEffect(() => {
    void load(apiBase).catch(() => {});
  }, [apiBase, load]);
  const href = app?.manifest.type === "standalone" ? `/workspace-app/app?id=${encodeURIComponent(appId)}` : `/apps/${encodeURIComponent(appId)}`;
  return (
    <Link className="group block w-64 overflow-hidden rounded-sm border bg-card text-left shadow-sm transition hover:border-primary hover:shadow-md" href={href}>
      <span className="grid aspect-video place-items-center bg-muted text-muted-foreground">{app ? <AppWindow className="size-7" /> : <LoaderCircle className="size-5 animate-spin text-primary" />}</span>
      <span className="flex items-center gap-1.5 border-t px-2 py-1.5 font-mono text-[10px] text-muted-foreground group-hover:text-foreground"><AppWindow className="size-3" />{app ? app.manifest.name : "正在读取 App…"} · {app ? (app.manifest.type === "standalone" ? "工作区 App" : "项目型 App") : ""} · 点击打开</span>
    </Link>
  );
}
