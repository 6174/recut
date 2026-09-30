/*
 * [INPUT]: 依赖 workspace-store 的项目快照、worlds-store 的世界分页、service endpoint、next/link、ui/hover-card 与工作台 i18n 字典
 * [OUTPUT]: 对外提供 WorkspaceBackMenu（返回入口悬停浮层的内容：核心导航 + 最近 10 个项目/世界 + 查看全部）与 WorkspaceNavHover（把任一导航入口包成同一份悬停浮层）
 * [POS]: web/components 的顶层导航快捷浮层；返回入口与工作台首页入口共用同一份内容，读取全部复用既有 workspace/worlds 缓存，展开时才补齐未就绪的目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowRight, Globe, Library, Store, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, type ReactNode } from "react";

import { appIcon } from "@/components/app-identity-icon";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useI18n } from "@/lib/i18n";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { worldOrigin, type WorldSummary } from "@/lib/recut-worlds-client";
import { useServiceStore } from "@/lib/service-store";
import { useWorkspaceStore, type WorkspaceProject } from "@/lib/workspace-store";
import { useWorldsStore } from "@/lib/worlds-store";

const RECENT_LIMIT = 10;

type RecentItem = { href: string; icon: LucideIcon; id: string; kind: "project" | "world"; name: string; updatedAt?: string };

function updatedAtOf(value?: string) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

// 最近项目的口径与项目页一致：项目与世界按 updatedAt 倒序混排，平台世界（只读内容目录）不算用户项目。
function recentItems(projects: WorkspaceProject[], worlds: WorldSummary[]): RecentItem[] {
  const items: RecentItem[] = [
    ...projects.map((project): RecentItem => ({ href: `/projects/${encodeURIComponent(project.id)}`, icon: appIcon(project.appId), id: project.id, kind: "project", name: project.name, updatedAt: project.updatedAt })),
    ...worlds.filter((world) => worldOrigin(world) !== "platform").map((world): RecentItem => ({ href: `/worlds/${encodeURIComponent(world.id)}`, icon: Globe, id: world.id, kind: "world", name: world.name, updatedAt: world.updatedAt })),
  ];
  items.sort((a, b) => updatedAtOf(b.updatedAt) - updatedAtOf(a.updatedAt));
  return items.slice(0, RECENT_LIMIT);
}

// 没有可信时间戳就不显示时间，而不是伪装成「刚刚」。
function relativeTime(value: string | undefined, text: (key: string) => string) {
  const elapsed = value ? Date.now() - Date.parse(value) : NaN;
  if (!Number.isFinite(elapsed) || elapsed < 0) return "";
  if (elapsed < 60_000) return text("back.menu.time.justNow");
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return interpolate(text("back.menu.time.minutesAgo"), { value: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return interpolate(text("back.menu.time.hoursAgo"), { value: hours });
  return interpolate(text("back.menu.time.daysAgo"), { value: Math.floor(hours / 24) });
}

function NavRow({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link className="flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-muted" href={href} title={label}>
      <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-xs text-foreground">{label}</span>
    </Link>
  );
}

function RecentRow({ item }: { item: RecentItem }) {
  const { t } = useI18n();
  const Icon = item.icon;
  const meta = relativeTime(item.updatedAt, t);
  return (
    <Link className="flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-muted" href={item.href} title={item.name}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{item.name}</span>
      {meta ? <span className="shrink-0 text-[10px] text-muted-foreground">{meta}</span> : null}
    </Link>
  );
}

export function WorkspaceBackMenu() {
  const { t } = useI18n();
  const apiBase = useServiceStore((state) => state.endpoint);
  const online = useServiceStore((state) => state.service.phase === "online");
  const projects = useWorkspaceStore((state) => state.projects);
  const workspaceState = useWorkspaceStore((state) => state.state);
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const worlds = useWorldsStore((state) => state.page);
  const loadWorlds = useWorldsStore((state) => state.loadPage);

  // 浮层只在展开时挂载，这里补一次目录读取；两个 store 都按 endpoint 去重并复用缓存，不需要额外的加载状态。
  useEffect(() => {
    if (!online || !apiBase) return;
    void loadWorkspace(apiBase);
    void loadWorlds(apiBase, { limit: 50 });
  }, [apiBase, loadWorkspace, loadWorlds, online]);

  const recent = useMemo(() => recentItems(projects, worlds), [projects, worlds]);

  return (
    <div className="p-1.5 font-sans">
      <div className="grid gap-0.5">
        <NavRow href="/media" icon={Library} label={t("nav.assets")} />
        <NavRow href="/community" icon={Store} label={t("nav.market")} />
      </div>
      <div aria-hidden="true" className="my-1.5 h-px bg-border" />
      <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{t("back.menu.recent")}</p>
      {recent.length ? (
        <div className="grid gap-0.5">
          {recent.map((item) => (
            <RecentRow item={item} key={`${item.kind}-${item.id}`} />
          ))}
        </div>
      ) : (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">{workspaceState === "loading" ? t("back.menu.loading") : t("back.menu.empty")}</p>
      )}
      <div aria-hidden="true" className="my-1.5 h-px bg-border" />
      <Link className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted" href="/projects">
        <span className="min-w-0 flex-1 truncate">{t("back.menu.all")}</span>
        <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
      </Link>
    </div>
  );
}

// 顶层导航入口（返回箭头、工作台首页 mark）共用同一份悬停浮层：悬停或聚焦入口即展开，
// 浮层挂在入口下方左侧，避免遮住入口自身的命中区。
export function WorkspaceNavHover({ children }: { children: ReactNode }) {
  return (
    <HoverCard closeDelay={120} openDelay={180}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-0" side="bottom">
        <WorkspaceBackMenu />
      </HoverCardContent>
    </HoverCard>
  );
}
