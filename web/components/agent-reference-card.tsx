/*
 * [INPUT]: 依赖 lib/workspace-store 的项目/App 缓存、统一 App 身份图标与受控的 `<project>`/`<app>` 引用
 * [OUTPUT]: 对外提供 ProjectReferenceCard 与 AppReferenceCard，把 Agent 回复中的项目/App 引用渲染为可点击卡片，并保持 App 图标身份一致
 * [POS]: components 的 Agent 引用卡片层；不解析任意 HTML，数据来自 workspace-store 去重缓存
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, FolderKanban, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { AppIdentityIcon, appIcon } from "@/components/app-identity-icon";
import { contextSourceForType } from "@/lib/context-catalog/registry";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useI18n } from "@/lib/i18n/index";

export function ProjectReferenceCard({ apiBase, projectId }: { apiBase: string; projectId: string }) {
  const { t } = useI18n();
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
      <span className="flex items-center gap-1.5 border-t px-2 py-1.5 font-mono text-[10px] text-muted-foreground group-hover:text-foreground"><FolderKanban className="size-3" />{project ? project.name : t("agent.reference.projectLoading")} · {app ? app.manifest.name : project?.appId ?? t("agent.reference.project")} · {t("agent.reference.open")}</span>
    </Link>
  );
}

export function AppReferenceCard({ apiBase, appId }: { apiBase: string; appId: string }) {
  const { t } = useI18n();
  const load = useWorkspaceStore((state) => state.load);
  const app = useWorkspaceStore((state) => state.apps.find((item) => item.manifest.id === appId));
  useEffect(() => {
    void load(apiBase).catch(() => {});
  }, [apiBase, load]);
  const href = app?.manifest.type === "standalone" ? `/workspace-app/app?id=${encodeURIComponent(appId)}` : `/apps/${encodeURIComponent(appId)}`;
  const Icon = app ? appIcon(app.manifest.id) : AppWindow;
  return (
    <Link className="group block w-64 overflow-hidden rounded-sm border bg-card text-left shadow-sm transition hover:border-primary hover:shadow-md" href={href}>
      <span className="grid aspect-video place-items-center bg-muted text-muted-foreground">{app ? <AppIdentityIcon appID={app.manifest.id} /> : <LoaderCircle className="size-5 animate-spin text-primary" />}</span>
      <span className="flex items-center gap-1.5 border-t px-2 py-1.5 font-mono text-[10px] text-muted-foreground group-hover:text-foreground"><Icon className="size-3" />{app ? app.manifest.name : t("agent.reference.appLoading")} · {app ? (app.manifest.type === "standalone" ? t("agent.reference.appStandalone") : t("agent.reference.appProject")) : ""} · {t("agent.reference.open")}</span>
    </Link>
  );
}

// GenericReferenceCard 渲染其余注册类型（World/Entity/Evidence/Skill/MCP 工具）为可点击 chip；
// 图标与跳转均来自唯一注册表 descriptor，新增类型零改动（协议 RFC §9）。
export function GenericReferenceCard({
  sourceType,
  attrs,
}: {
  sourceType: string;
  attrs: Record<string, string>;
}) {
  const source = contextSourceForType(sourceType);
  const label = source?.label(attrs) ?? attrs.name ?? attrs.title ?? sourceType;
  const icon = source?.icon(attrs, { apiBase: "" }) ?? null;
  return (
    <button
      className="inline-flex h-7 max-w-64 items-center gap-1.5 rounded-sm border bg-card px-2 text-[10px] text-foreground shadow-sm transition hover:border-primary"
      onClick={() => source?.navigate?.(attrs, { apiBase: "" })}
      title={`${sourceType} · ${label}`}
      type="button"
    >
      <span className="grid size-3.5 shrink-0 place-items-center text-primary">{icon}</span>
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-muted-foreground">{source?.type ?? sourceType}</span>
    </button>
  );
}
