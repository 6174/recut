/*
 * [INPUT]: 依赖 React 状态能力、Zustand 共享的 Daemon 与按数据域区分失败原因的工作台目录状态、静态 App Catalog、统一 App 身份图标、Agent Session HTTP API 及全局 Agent 面板上下文、工作台 i18n 字典与 Accept-Language 统一请求包装
 * [OUTPUT]: 对外提供 app.recut.video / app.localhost:3000 的 Studio、Projects、Assets、Apps 工作台入口及保持根壳的一级 Tab 切换、固定使用通用会话上下文的 Agent 面板（由根布局全局挂载，本页只声明作用域）、首次离线时的安装 service 引导与嵌入式工作台真实诊断空态；全部文案经 useI18n 迁移到 workspace 字典
 * [POS]: web/app 的应用工作台框架；Studio 是 app Host 的默认创作入口，世界观作为首个原生创作应用统一进入世界观管理，工作台目录由 lib/workspace-store 跨路由缓存，创建、安装、升级后显式刷新，绝不 5 秒轮询；Agent 面板不在此挂载，只经 agent-panel-context 声明会话作用域
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, ArrowRight, Blocks, Box, Captions, Check, Clapperboard, Code2, Copy, Download, ExternalLink, FileImage, FolderOpen, FolderPlus, Globe2, HardDrive, ImageIcon, Link2, LoaderCircle, Mic2, Music2, Plus, Scissors, Sparkles, Terminal, Video, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { FormEvent, MouseEvent, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { AssetPreviewDialog } from "@/components/asset-preview-dialog";
import { AppIdentityIcon, appIcon } from "@/components/app-identity-icon";
import { CardMoreMenu } from "@/components/card-more-menu";
import { Badge } from "@/components/ui/badge";
import { AppUpdateAllControl, AppVersionControl } from "@/components/app-version-control";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreateAppDialog } from "@/components/create-app-dialog";
import { InstallGitAppDialog } from "@/components/install-git-app-dialog";
import { Input } from "@/components/ui/input";
import { HeaderActions } from "@/components/header-actions";
import { useAgentPanelContext, useReportWorkSurface } from "@/lib/agent-panel-context";
import { trackEvent } from "@/components/posthog-analytics";
import { marketplaceDescription, marketplaceName, type MarketplaceApp } from "@/lib/appstore";
import { isLocalWorkspace, fetchRecutJSON } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";
import { useWorkspaceStore, type WorkspaceInstallation as Installation, type WorkspaceProject as Project } from "@/lib/workspace-store";
import { t, useI18n, type Locale } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { STUDIO_INSPIRATION_COUNT, STUDIO_TEMPLATE_COUNT } from "@/lib/i18n/workspace-studio-dict";
import { VideoFrame } from "@/components/video-frame";
import { WebGLStudioHero } from "@/components/webgl-studio-hero";
import type { Asset } from "./media/media-types";
import { MediaLibraryPanel } from "./media/media-library-panel";
import { WorldsClient } from "./worlds/worlds-client";

type AppDetailRenderer = (context: { onConnectService: () => void; serviceOnline: boolean }) => React.ReactNode;
type WorkspaceTab = "studio" | "worlds" | "projects" | "assets" | "apps";
type InstallationLoadState = "loading" | "ready" | "failed" | "offline";
type WorkspaceProps = { appDetail?: AppDetailRenderer; contentTab?: WorkspaceTab; initialTab?: WorkspaceTab };

export function Workspace(props: WorkspaceProps = {}) {
  return <WorkspaceFrame {...props} />;
}

function WorkspaceFrame({ appDetail, contentTab, initialTab = "studio" }: WorkspaceProps = {}) {
  const { t } = useI18n();
  const installations = useWorkspaceStore((state) => state.installations);
  const projects = useWorkspaceStore((state) => state.projects);
  const installationsState = useWorkspaceStore((state) => state.installationsState);
  const installationsError = useWorkspaceStore((state) => state.installationsError);
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const marketplace = useWorkspaceStore((state) => state.marketplace);
  const loadMarketplace = useWorkspaceStore((state) => state.loadMarketplace);
  const [initialAssetID, setInitialAssetID] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("asset") ?? "");
  const [createApp, setCreateApp] = useState<Installation | null>(null);
  const service = useServiceStore((state) => state.service);
  const apiBase = useServiceStore((state) => state.endpoint);
  const [tab, setTab] = useState<WorkspaceTab>(contentTab ?? (appDetail ? "apps" : initialTab));
  const [mediaProjectID, setMediaProjectID] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"service" | "multimodal" | undefined>();

  const online = service.phase === "online";
  const showLanding = !isLocalWorkspace && service.phase === "offline";
  const showAgentPanel = isLocalWorkspace || service.phase !== "offline";
  const agentProjectID = tab === "assets" ? mediaProjectID : null;
  useLayoutEffect(() => {
    useAgentPanelContext.getState().setProjectID(agentProjectID);
  }, [agentProjectID]);
  const workSurface = useMemo(() => tab === "assets"
    ? { version: 1 as const, surface: "media_library" as const, title: t("page.assets.title"), path: "/media", target: { kind: "media_library" as const, scope: mediaProjectID ? "project" as const : "workspace" as const, projectId: mediaProjectID ?? undefined }, policy: { defaultIntent: "media_manage" as const } }
    : tab === "worlds"
      ? { version: 1 as const, surface: "workspace" as const, title: t("page.worlds.title"), path: "/worlds", policy: { defaultIntent: "browse" as const } }
      : tab === "projects"
        ? { version: 1 as const, surface: "workspace" as const, title: t("page.projects.title"), path: "/projects", policy: { defaultIntent: "browse" as const } }
        : tab === "apps"
          ? { version: 1 as const, surface: "workspace" as const, title: t("page.apps.title"), path: "/apps", policy: { defaultIntent: "browse" as const } }
          : null, [tab, t]);
  useReportWorkSurface(workSurface);
  useEffect(() => {
    if (!online) return;
    void loadWorkspace(apiBase);
  }, [apiBase, loadWorkspace, online]);

  // 应用市场（云端数据）与 service 目录解耦：挂载即拉取，语言切换只影响展示层选择。
  useEffect(() => {
    void loadMarketplace();
  }, [loadMarketplace]);

  useEffect(() => {
    function syncTabFromHistory() {
      const next = tabFromPath(window.location.pathname);
      if (next) setTab(next);
    }
    window.addEventListener("popstate", syncTabFromHistory);
    return () => window.removeEventListener("popstate", syncTabFromHistory);
  }, []);

  async function reloadWorkspace() {
    await loadWorkspace(apiBase, true);
  }

  function openCreateProject(app: Installation) {
    setCreateApp(app);
  }

  async function createProjectWithApp(app: Installation, projectName: string) {
    const project = await fetchRecutJSON<Project>(apiBase, "/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName, appId: app.manifest.id }) });
    await loadWorkspace(apiBase, true);
    window.location.assign(`/projects/${project.id}`);
  }

  async function renameProject(project: Project, projectName: string) {
    await fetchRecutJSON(apiBase, `/v1/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName }) });
    await loadWorkspace(apiBase, true);
  }

  async function deleteProject(project: Project) {
    await fetchRecutJSON(apiBase, `/v1/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
    await loadWorkspace(apiBase, true);
  }

  function openMediaProviderSettings() {
    setSettingsSection("multimodal");
    setSettingsOpen(true);
  }

  function openServiceSettings() {
    setSettingsSection("service");
    setSettingsOpen(true);
  }

  function changeSettingsOpen(open: boolean) {
    setSettingsOpen(open);
    if (!open) setSettingsSection(undefined);
  }

  useEffect(() => {
    if (tab !== "assets") setInitialAssetID("");
  }, [tab]);

  function navigateTab(next: WorkspaceTab, href: string, event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (window.location.pathname !== href) window.history.pushState(null, "", href);
    setTab(next);
  }

  const detail = appDetail?.({ onConnectService: openServiceSettings, serviceOnline: online });
  const appInstallationLoadState: InstallationLoadState = online ? installationsState : service.phase === "checking" ? "loading" : "offline";
  const content = detail ?? (tab === "apps" ? <Apps apiBase={apiBase} installations={installations} installationError={installationsError} installationLoadState={appInstallationLoadState} marketplace={marketplace} onStartProject={openCreateProject} onUpdated={reloadWorkspace} serviceOnline={online} />
    : service.phase === "checking" ? <ServiceChecking />
    : !online ? <ServiceGuide embedded={isLocalWorkspace} error={service.error} onConnectRemote={openServiceSettings} />
    : tab === "studio" ? <Studio apiBase={apiBase} apps={installations.filter((app) => app.manifest.type === "project")} installations={installations} onCompose={(text) => useAgentPanelContext.getState().setDraft({ id: `${Date.now()}`, text })} onDeleteProject={deleteProject} onManageApps={(event) => navigateTab("apps", "/apps", event)} onRenameProject={renameProject} onStartProject={openCreateProject} projects={projects} />
      : tab === "worlds" ? <WorldsClient />
        : tab === "projects" ? <ProjectsPage apiBase={apiBase} apps={installations.filter((app) => app.manifest.type === "project")} onDeleteProject={deleteProject} onRenameProject={renameProject} onStartProject={openCreateProject} projects={projects} />
          : <MediaLibraryPanel initialAssetID={initialAssetID} onOpenProviderSettings={openMediaProviderSettings} onProjectIDChange={setMediaProjectID} />);
  return <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-4 md:px-5">
      <div className="flex min-w-0 items-center gap-3 md:gap-4"><span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg"><img alt="Recut" className="size-full object-cover" src="/logo.jpg" /></span><span className="hidden h-5 w-px bg-border sm:block" /><nav aria-label={showLanding ? t("nav.aria.website") : t("nav.aria.workspace")} className="flex min-w-0 items-center gap-0.5 sm:gap-1">{showLanding ? <><Tab active={tab === "studio"} href="/" onNavigate={navigateTab} tab="studio">{t("nav.workspace")}</Tab><Tab active={tab === "apps"} href="/apps" onNavigate={navigateTab} tab="apps">{t("nav.market")}</Tab></> : <><Tab active={tab === "studio"} href="/" onNavigate={navigateTab} tab="studio">{t("nav.studio")}</Tab><Tab active={tab === "worlds"} href="/worlds" onNavigate={navigateTab} tab="worlds">{t("nav.worlds")}</Tab><Tab active={tab === "projects"} href="/projects" onNavigate={navigateTab} tab="projects">{t("nav.projects")}</Tab><Tab active={tab === "assets"} href="/media" onNavigate={navigateTab} tab="assets">{t("nav.assets")}</Tab><Tab active={tab === "apps"} href="/apps" onNavigate={navigateTab} tab="apps">{t("nav.apps")}</Tab></>}</nav></div>
      {!showLanding && <div className="hidden md:block"><HeaderActions onSettingsOpenChange={changeSettingsOpen} settingsOpen={settingsOpen} settingsSection={settingsSection} /></div>}
    </header>
    <div className={`min-h-0 flex-1 overflow-hidden ${showAgentPanel ? "md:pl-[var(--side-panel-width)]" : ""}`}>
      {online && tab === "assets" ? content : <section className="h-full min-h-0 overflow-y-auto bg-muted/30 p-4 sm:p-6 md:p-8"><div className="mx-auto max-w-6xl">{content}</div></section>}
    </div>
    {createApp && <CreateProjectFromAppDialog app={createApp} onClose={() => setCreateApp(null)} onCreate={async (projectName) => createProjectWithApp(createApp, projectName)} />}
  </main>;
}

export default Workspace;

function tabFromPath(pathname: string): WorkspaceTab | null {
  if (pathname === "/") return "studio";
  if (pathname === "/worlds" || pathname === "/worlds/") return "worlds";
  if (pathname === "/projects" || pathname === "/projects/") return "projects";
  if (pathname === "/media" || pathname === "/media/") return "assets";
  if (pathname === "/apps" || pathname === "/apps/") return "apps";
  return null;
}

function Tab({ active, children, href, onNavigate, tab }: { active: boolean; children: React.ReactNode; href: string; onNavigate: (tab: WorkspaceTab, href: string, event: MouseEvent<HTMLAnchorElement>) => void; tab: WorkspaceTab }) {
  return <a aria-current={active ? "page" : undefined} className={active ? "rounded-lg bg-accent px-2 py-1.5 text-[11px] font-semibold text-accent-foreground sm:px-2.5 sm:text-xs" : "rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:px-2.5 sm:text-xs"} href={href} onClick={(event) => onNavigate(tab, href, event)}>{children}</a>;
}

function Projects({ apiBase, apps, onDeleteProject, onRenameProject, onStartProject, projects }: { apiBase: string; apps: Installation[]; onDeleteProject: (project: Project) => Promise<void>; onRenameProject: (project: Project, name: string) => Promise<void>; onStartProject: (app: Installation) => void; projects: Project[] }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"><NewProjectCard apps={apps} onStartProject={onStartProject} />{projects.map((project) => <ProjectCard apiBase={apiBase} app={apps.find((app) => app.manifest.id === project.appId)} key={project.id} onDeleteProject={onDeleteProject} onRenameProject={onRenameProject} project={project} />)}</div>;
}

function NewProjectCard({ apps, onStartProject }: { apps: Installation[]; onStartProject: (app: Installation) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <><button className="group flex min-h-40 min-w-0 flex-col rounded-lg border-2 border-dashed border-primary/35 bg-transparent p-4 text-left shadow-none transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60" disabled={!apps.length} onClick={() => setOpen(true)} type="button"><span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><Plus className="size-5" /></span><span className="mt-auto"><span className="block text-base font-semibold">{t("projects.new")}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{apps.length ? t("projects.new.desc") : t("projects.new.descEmpty")}</span><span className="mt-3 inline-flex text-xs font-medium text-primary">{t("projects.new.choose")}</span></span></button>{open && <ProjectAppPickerDialog apps={apps} onClose={() => setOpen(false)} onPick={(app) => { setOpen(false); onStartProject(app); }} />}</>;
}

function ProjectAppPickerDialog({ apps, onClose, onPick }: { apps: Installation[]; onClose: () => void; onPick: (app: Installation) => void }) {
  const { t } = useI18n();
  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="project-app-picker-title"><section className="w-full max-w-lg rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">NEW PROJECT</p><h2 className="mt-1 text-base font-semibold" id="project-app-picker-title">{t("projects.picker.title")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("projects.picker.desc")}</p></div><button aria-label={t("projects.picker.close")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><div className="grid gap-2 p-3">{apps.map((app) => <button className="group flex min-w-0 items-center gap-3 rounded-sm p-3 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" key={app.package} onClick={() => onPick(app)} type="button"><AppIdentityIcon appID={app.manifest.id} className="transition group-hover:bg-primary group-hover:text-primary-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{app.manifest.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{app.manifest.description}</span></span><ArrowRight className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" /></button>)}</div></section></div>;
}

function homeInspirations(locale: Locale) {
  return Array.from({ length: STUDIO_INSPIRATION_COUNT }, (_, index) => t("workspace", locale, `studio.inspiration.${index}`));
}

function inspirationForToday(locale: Locale) {
  const inspirations = homeInspirations(locale);
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return inspirations[Math.abs(dayIndex) % inspirations.length];
}

type StudioPromptTemplate = { icon: LucideIcon; title: string; description: string; prompt: string };

const STUDIO_TEMPLATE_ICONS: LucideIcon[] = [Clapperboard, Video, ImageIcon, Sparkles, Sparkles, Captions, Video, Clapperboard, Sparkles, Clapperboard, Video, ImageIcon];
const STUDIO_FIRST_VISIT_ICON: LucideIcon = Sparkles;

function studioPromptTemplates(locale: Locale): StudioPromptTemplate[] {
  return Array.from({ length: STUDIO_TEMPLATE_COUNT }, (_, index) => ({
    icon: STUDIO_TEMPLATE_ICONS[index],
    title: t("workspace", locale, `studio.template.${index}.title`),
    description: t("workspace", locale, `studio.template.${index}.description`),
    prompt: t("workspace", locale, `studio.template.${index}.prompt`),
  }));
}

function studioFirstVisitTemplate(locale: Locale): StudioPromptTemplate {
  return {
    icon: STUDIO_FIRST_VISIT_ICON,
    title: t("workspace", locale, "studio.firstVisit.title"),
    description: t("workspace", locale, "studio.firstVisit.description"),
    prompt: t("workspace", locale, "studio.firstVisit.prompt"),
  };
}

function promptTemplatesForToday(locale: Locale) {
  const templates = [...studioPromptTemplates(locale), studioFirstVisitTemplate(locale)];
  let seed = Math.floor(Date.now() / 86_400_000) >>> 0;
  for (let index = templates.length - 1; index > 0; index -= 1) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    const swapIndex = seed % (index + 1);
    [templates[index], templates[swapIndex]] = [templates[swapIndex], templates[index]];
  }
  return templates.slice(0, 2);
}

function Studio({ apiBase, apps, installations, onCompose, onDeleteProject, onManageApps, onRenameProject, onStartProject, projects }: { apiBase: string; apps: Installation[]; installations: Installation[]; onCompose: (text: string) => void; onDeleteProject: (project: Project) => Promise<void>; onManageApps: (event: MouseEvent<HTMLAnchorElement>) => void; onRenameProject: (project: Project, name: string) => Promise<void>; onStartProject: (app: Installation) => void; projects: Project[] }) {
  const { t, locale } = useI18n();
  const recentProjects = projects.slice(0, 11);
  const [promptTemplates, setPromptTemplates] = useState(() => studioPromptTemplates(locale).slice(0, 2));
  useEffect(() => setPromptTemplates(promptTemplatesForToday(locale)), [locale]);
  return <div className="pb-10">
    <section className="relative min-h-[17rem] overflow-hidden pb-8 pt-7 sm:min-h-[19rem]">
      <WebGLStudioHero />
      <div className="relative z-10 max-w-xl">
      <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">{t("studio.eyebrow")}</p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight">{t("studio.title")}</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{inspirationForToday(locale)}</p>
      <div className="mt-7 flex max-w-2xl flex-col">{promptTemplates.map(({ description, icon: Icon, prompt, title }) => <button aria-label={interpolate(t("studio.template.aria"), { title })} className="group flex min-w-0 items-center gap-3 border-b border-border/80 py-3 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" key={title} onClick={() => onCompose(prompt)} type="button"><span className="grid size-7 shrink-0 place-items-center rounded-sm bg-accent text-accent-foreground"><Icon className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="text-sm font-semibold">{title}</span><span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{description}</span></span><ArrowRight className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" /></button>)}</div>
      </div>
    </section>
    <section className="mt-8"><SectionHeading action={<a className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" href="/apps" onClick={onManageApps}>{t("studio.section.apps.manage")}<ArrowRight className="size-3.5" /></a>} description={t("studio.section.apps.desc")} title={t("studio.section.apps")} /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><WorldsAppCard />{installations.map((app) => <StudioAppCard app={app} key={app.package} onOpen={() => app.manifest.type === "standalone" ? window.location.assign(`/workspace-app/app?id=${encodeURIComponent(app.manifest.id)}`) : onStartProject(app)} />)}</div></section>
    <section className="mt-9"><SectionHeading action={<Link className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" href="/projects">{t("studio.section.projects.all")}<ArrowRight className="size-3.5" /></Link>} description={t("studio.section.projects.desc")} title={t("studio.section.projects")} /><RecentProjects apiBase={apiBase} apps={apps} onDeleteProject={onDeleteProject} onRenameProject={onRenameProject} onStartProject={onStartProject} projects={recentProjects} /></section>
    <section className="mt-9"><SectionHeading action={<Link className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" href="/media">{t("studio.section.assets.open")}<ArrowRight className="size-3.5" /></Link>} description={t("studio.section.assets.desc")} title={t("studio.section.assets")} /><RecentAssets apiBase={apiBase} /></section>
  </div>;
}

function RecentProjects({ apiBase, apps, onDeleteProject, onRenameProject, onStartProject, projects }: { apiBase: string; apps: Installation[]; onDeleteProject: (project: Project) => Promise<void>; onRenameProject: (project: Project, name: string) => Promise<void>; onStartProject: (app: Installation) => void; projects: Project[] }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"><NewProjectCard apps={apps} onStartProject={onStartProject} />{projects.map((project) => <ProjectCard apiBase={apiBase} app={apps.find((app) => app.manifest.id === project.appId)} key={project.id} onDeleteProject={onDeleteProject} onRenameProject={onRenameProject} project={project} />)}</div>;
}

function ProjectCard({ apiBase, app, onDeleteProject, onRenameProject, project }: { apiBase?: string; app?: Installation; onDeleteProject: (project: Project) => Promise<void>; onRenameProject: (project: Project, name: string) => Promise<void>; project: Project }) {
  const { t } = useI18n();
  const appName = app?.manifest.name ?? project.appId;
  return <div className="group relative"><Link className="block" href={`/projects/${project.id}`}><Card className="overflow-hidden transition group-hover:-translate-y-0.5 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-overlay)]"><ProjectCoverPreview apiBase={apiBase} app={app} project={project} /><CardContent className="p-3"><p className="truncate text-sm font-semibold">{project.name}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{appName}</p></CardContent></Card></Link><div className="absolute right-2 top-2"><CardMoreMenu itemName={project.name} itemType={t("nav.projects")} onDelete={() => onDeleteProject(project)} onRename={(projectName) => onRenameProject(project, projectName)} /></div></div>;
}

function ProjectCoverPreview({ apiBase, app, project }: { apiBase?: string; app?: Installation; project: Project }) {
  const { t } = useI18n();
  const cover = project.cover;
  if (cover && apiBase) {
    if (cover.source === "file") {
      const src = `${apiBase}/v1/projects/${encodeURIComponent(project.id)}/cover`;
      return <img alt={interpolate(t("projects.cover.alt"), { name: project.name })} className="aspect-[16/7] w-full border-b object-cover" src={src} />;
    }
    const src = cover.assetId ? `${apiBase}/v1/media/assets/${encodeURIComponent(cover.assetId)}/content` : null;
    if (src && cover.kind === "video") return <VideoFrame alt={interpolate(t("projects.cover.alt"), { name: project.name })} className="aspect-[16/7] border-b" src={src} />;
    if (src) return <img alt={interpolate(t("projects.cover.alt"), { name: project.name })} className="aspect-[16/7] w-full border-b object-cover" src={src} />;
    const Icon = app ? appIcon(app.manifest.id) : AppWindow;
    return <div className="flex aspect-[16/7] items-center justify-between border-b bg-muted p-3"><span className="grid size-7 place-items-center rounded-sm bg-card text-muted-foreground shadow-sm"><Icon className="size-3.5" /></span><span className="rounded-xs border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">{app?.manifest.name ?? project.appId}</span></div>;
  }
  const Icon = app ? appIcon(app.manifest.id) : AppWindow;
  return <div className="flex aspect-[16/7] items-center justify-between border-b bg-muted p-3"><span className="grid size-7 place-items-center rounded-sm bg-card text-muted-foreground shadow-sm"><Icon className="size-3.5" /></span><span className="rounded-xs border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">{app?.manifest.name ?? project.appId}</span></div>;
}

function ProjectsPage({ apiBase, apps, onDeleteProject, onRenameProject, onStartProject, projects }: { apiBase: string; apps: Installation[]; onDeleteProject: (project: Project) => Promise<void>; onRenameProject: (project: Project, name: string) => Promise<void>; onStartProject: (app: Installation) => void; projects: Project[] }) {
  const { t } = useI18n();
  return <><SectionTitle count={interpolate(t("projects.count"), { count: projects.length })} description={t("projects.desc")} title={t("projects.title")} /><Projects apiBase={apiBase} apps={apps} onDeleteProject={onDeleteProject} onRenameProject={onRenameProject} onStartProject={onStartProject} projects={projects} /></>;
}

function RecentAssets({ apiBase }: { apiBase: string }) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [preview, setPreview] = useState<Asset | null>(null);
  useEffect(() => { let active = true; void fetchRecutJSON<Asset[]>(apiBase, "/v1/media/assets").then((items) => { if (active) { setAssets(items.slice(0, 5)); setState("ready"); } }).catch(() => { if (active) setState("error"); }); return () => { active = false; }; }, [apiBase]);
  async function renameAsset(asset: Asset, name: string) {
    const updated = await fetchRecutJSON<Asset>(apiBase, `/v1/media/assets/${encodeURIComponent(asset.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    setAssets((items) => items.map((item) => item.id === asset.id ? updated : item));
  }
  async function deleteAsset(asset: Asset) {
    await fetchRecutJSON(apiBase, `/v1/media/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    setAssets((items) => items.filter((item) => item.id !== asset.id));
    if (preview?.id === asset.id) setPreview(null);
  }
  if (state === "loading") return <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div className="aspect-square animate-pulse rounded-sm bg-muted" key={index} />)}</div>;
  if (state === "error" || !assets.length) return <HomeEmptyState description={t("assets.recent.desc")} icon={Box} title={t("assets.recent.title")} />;
  return <>{preview && <AssetPreviewDialog apiBase={apiBase} asset={preview} assets={assets} onClose={() => setPreview(null)} />}<div className="grid grid-cols-3 gap-3 sm:grid-cols-5">{assets.map((asset) => <div className="group relative min-w-0" key={asset.id}><button aria-label={interpolate(t("assets.preview.aria"), { name: asset.name })} className="block w-full text-left" onClick={() => setPreview(asset)} type="button"><Card className="overflow-hidden transition group-hover:-translate-y-0.5 group-hover:border-primary/35"><AssetPreview apiBase={apiBase} asset={asset} /><CardContent className="p-2.5"><p className="truncate text-xs font-medium">{asset.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{asset.kind === "image" ? t("assets.kind.image") : asset.kind === "video" ? t("assets.kind.video") : asset.kind === "transcript" ? t("assets.kind.transcript") : asset.kind === "reference" ? t("assets.kind.reference") : t("assets.kind.audio")}</p></CardContent></Card></button><div className="absolute right-2 top-2"><CardMoreMenu itemName={asset.name} itemType={t("page.assets.title")} onDelete={() => deleteAsset(asset)} onRename={(name) => renameAsset(asset, name)} /></div></div>)}</div></>;
}

function AssetPreview({ apiBase, asset }: { apiBase: string; asset: Asset }) {
  const source = `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/content`;
  const icon = asset.kind === "audio" ? <Music2 className="size-5" /> : asset.kind === "video" ? <Video className="size-5" /> : asset.kind === "transcript" ? <Captions className="size-5" /> : asset.kind === "reference" ? <Link2 className="size-5" /> : <FileImage className="size-5" />;
  if (asset.status !== "completed") return <div className="grid aspect-square place-items-center bg-muted text-muted-foreground">{icon}</div>;
  if (asset.kind === "video") return <VideoFrame alt={asset.name} className="aspect-square" src={source} />;
  if (asset.kind === "image") return <img alt={asset.name} className="aspect-square w-full object-cover" src={source} />;
  return <div className="grid aspect-square place-items-center bg-muted text-primary">{icon}</div>;
}

function WorldsAppCard() {
  const { t } = useI18n();
  return <Link aria-label={t("studio.worlds.open")} className="group flex min-h-32 min-w-0 flex-col rounded-lg border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" href="/worlds"><div className="flex min-w-0 items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/10 bg-primary/10 text-primary transition duration-200 group-hover:bg-primary group-hover:text-primary-foreground"><Globe2 aria-hidden="true" className="size-5" strokeWidth={1.8} /></span><div className="min-w-0"><p className="truncate text-sm font-semibold">{t("studio.worlds.title")}</p><p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">{t("studio.worlds.desc")}</p></div></div><span className="mt-auto flex items-center justify-end pt-3 text-primary"><ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span></Link>;
}

function StudioAppCard({ app, onOpen }: { app: Installation; onOpen: () => void }) {
  const { t } = useI18n();
  const actionLabel = app.manifest.type === "standalone" ? interpolate(t("studio.app.open"), { name: app.manifest.name }) : interpolate(t("studio.app.new"), { name: app.manifest.name });
  return <button aria-label={actionLabel} className="group flex min-h-32 min-w-0 flex-col rounded-lg border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={onOpen} type="button"><div className="flex min-w-0 items-start gap-3"><AppIdentityIcon appID={app.manifest.id} className="transition duration-200 group-hover:bg-primary group-hover:text-primary-foreground" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{app.manifest.name}</p><p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">{app.manifest.description}</p></div></div><span className="mt-auto flex items-center justify-end pt-3 text-primary"><ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span></button>;
}

function SectionHeading({ action, description, title }: { action?: React.ReactNode; description: string; title: string }) {
  return <div className="mb-4 flex items-end justify-between gap-5"><div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>{action}</div>;
}

function HomeEmptyState({ action, description, icon: Icon, title }: { action?: React.ReactNode; description: string; icon?: LucideIcon; title: string }) {
  return <div className="flex min-h-24 items-center justify-between gap-5 border-y border-border/80 py-4"><div className="flex min-w-0 items-center gap-3">{Icon && <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-muted"><Icon className="size-4 text-muted-foreground" /></span>}<div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div></div>{action}</div>;
}

function CreateProjectFromAppDialog({ app, onClose, onCreate }: { app: Installation; onClose: () => void; onCreate: (projectName: string) => Promise<void> }) {
  const { t } = useI18n();
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectName.trim() || creating) return;
    setCreating(true); setError("");
    try { await onCreate(projectName.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : t("projects.create.failed")); setCreating(false); }
  }
  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="create-project-app-title"><section className="w-full max-w-md rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">NEW PROJECT</p><h2 className="mt-1 text-base font-semibold" id="create-project-app-title">{interpolate(t("projects.create.title"), { name: app.manifest.name })}</h2><p className="mt-1 text-xs text-muted-foreground">{t("projects.create.desc")}</p></div><button aria-label={t("projects.create.close")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><form onSubmit={submit}><div className="p-5"><label className="mb-1 block text-[11px] font-medium" htmlFor="create-project-app-name">{t("projects.create.name")}</label><Input autoFocus className="h-9 bg-background text-xs" id="create-project-app-name" onChange={(event) => setProjectName(event.target.value)} placeholder={t("projects.create.name.placeholder")} value={projectName} />{error && <p className="mt-2 text-xs text-warning">{error}</p>}</div><footer className="flex items-center justify-end gap-2 border-t px-5 py-3"><Button onClick={onClose} type="button" variant="ghost">{t("projects.create.cancel")}</Button><Button disabled={!projectName.trim() || creating} type="submit">{creating ? t("projects.create.submitting") : t("projects.create.submit")}</Button></footer></form></section></div>;
}

function Apps({ apiBase, installations, installationError, installationLoadState, marketplace, onStartProject, onUpdated, serviceOnline }: { apiBase: string; installations: Installation[]; installationError: string; installationLoadState: InstallationLoadState; marketplace: MarketplaceApp[]; onStartProject: (app: Installation) => void; onUpdated: () => Promise<void>; serviceOnline: boolean }) {
  const { t, locale } = useI18n();
  const installationCount = installationLoadState === "loading" ? t("apps.count.loading") : installationLoadState === "offline" ? t("apps.count.offline") : interpolate(t("apps.installed.count"), { count: installations.length });
  const marketplaceStatus = (installed: boolean) => installed ? t("apps.market.installed") : installationLoadState === "loading" ? t("apps.market.checking") : t("apps.market.market");
  return <><SectionTitle action={<><AppUpdateAllControl apps={installations} onUpdated={onUpdated} /><CreateAppDialog /><InstallGitAppDialog apiBase={apiBase} disabled={!serviceOnline} onInstalled={onUpdated} /></>} description={t("apps.desc")} title={t("apps.title")} /><section><div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">{t("apps.installed")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("apps.installed.desc")}</p></div><Badge>{installationCount}</Badge></div>{installationLoadState === "loading" ? <InstalledAppsLoading /> : installationLoadState === "offline" ? <InstalledAppsOffline /> : installationLoadState === "failed" ? <InstalledAppsError message={installationError} onRetry={() => void onUpdated()} /> : installations.length === 0 ? <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-6 text-primary" /><p className="text-sm font-medium">{t("apps.installed.empty.title")}</p><p className="text-xs text-muted-foreground">{t("apps.installed.empty.desc")}</p></CardContent></Card> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{installations.map((app) => <InstalledAppCard app={app} key={app.package} onStartProject={onStartProject} onUpdated={onUpdated} />)}</div>}</section><section className="mt-10"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">{t("apps.addable")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("apps.addable.desc")}</p></div><Badge>{interpolate(t("apps.addable.count"), { count: marketplace.length })}</Badge></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{marketplace.map((app) => { const installed = installations.some((item) => item.manifest.id === app.appId); return <Link className="group" href={`/apps/${encodeURIComponent(app.appId)}`} key={app.appId}><Card className="flex min-h-32 min-w-0 flex-col rounded-lg border bg-card p-4 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-overlay)]"><CardContent className="flex flex-1 flex-col p-0"><div className="flex min-w-0 items-start gap-3"><AppIdentityIcon appID={app.appId} className="transition duration-200 group-hover:bg-primary group-hover:text-primary-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{marketplaceName(app, locale)}</p><p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">{marketplaceDescription(app, locale)}</p></div><Badge>{marketplaceStatus(installed)}</Badge></div><span className="mt-auto flex items-center justify-end pt-3 text-primary"><ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span></CardContent></Card></Link>; })}</div></section></>;
}

function InstalledAppsLoading() {
  const { t } = useI18n();
  return <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center"><LoaderCircle aria-hidden="true" className="size-6 animate-spin text-primary" /><p className="text-sm font-medium">{t("apps.installed.loading.title")}</p><p className="text-xs text-muted-foreground">{t("apps.installed.loading.desc")}</p></CardContent></Card>;
}

function InstalledAppsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-6 text-warning" /><div><p className="text-sm font-medium">{t("apps.installed.error.title")}</p><p className="mt-1 text-xs text-muted-foreground">{message}</p></div><Button onClick={onRetry} type="button" variant="outline">{t("apps.installed.error.retry")}</Button></CardContent></Card>;
}

function InstalledAppsOffline() {
  const { t } = useI18n();
  return <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-6 text-primary" /><p className="text-sm font-medium">{t("apps.installed.offline.title")}</p><p className="text-xs text-muted-foreground">{t("apps.installed.offline.desc")}</p></CardContent></Card>;
}

function InstalledAppCard({ app, onStartProject, onUpdated }: { app: Installation; onStartProject: (app: Installation) => void; onUpdated: () => void }) {
  const { t } = useI18n();
  const detailHref = `/apps/${encodeURIComponent(app.manifest.id)}`;
  const status = app.dirty && app.updateAvailable ? t("apps.status.remoteDirty") : app.dirty ? t("apps.status.dirty") : app.updateAvailable ? t("apps.status.remote") : app.status ?? t("apps.status.current");
  return <Card className="group flex min-h-32 min-w-0 flex-col rounded-lg border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)]"><CardContent className="flex flex-1 flex-col p-0"><Link aria-label={interpolate(t("apps.detail.aria"), { name: app.manifest.name })} className="flex min-w-0 items-start gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" href={detailHref}><AppIdentityIcon appID={app.manifest.id} className="transition duration-200 group-hover:bg-primary group-hover:text-primary-foreground" /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{app.manifest.name}</span><span className="mt-1 block line-clamp-2 text-xs leading-4 text-muted-foreground">{app.manifest.description}</span></span></Link><div className="mt-auto flex items-center justify-between gap-3 pt-3"><Link className="text-xs font-medium text-primary hover:underline" href={detailHref}>{t("apps.details")}</Link><InstalledAppAction app={app} onStartProject={onStartProject} /></div><div className="mt-2 flex justify-end" title={status}><AppVersionControl app={app} onUpdated={onUpdated} /></div></CardContent></Card>;
}

function InstalledAppAction({ app, onStartProject }: { app: Installation; onStartProject: (app: Installation) => void }) {
  const { t } = useI18n();
  if (app.manifest.type === "standalone") return <Link className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xs bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85" href={`/workspace-app/app?id=${encodeURIComponent(app.manifest.id)}`}><AppWindow className="size-3.5" />{t("apps.open")}</Link>;
  return <Button className="h-8 px-2.5" onClick={() => onStartProject(app)} type="button"><FolderPlus className="size-3.5" />{t("apps.new")}</Button>;
}

const SERVICE_INSTALL_COMMAND = "curl -fsSL https://recut.video/install.sh | sh";

const LANDING_FEATURES = [
  { descKey: "landing.feature.editing.desc", icon: Scissors, titleKey: "landing.feature.editing" },
  { descKey: "landing.feature.worlds.desc", icon: Globe2, titleKey: "landing.feature.worlds" },
  { descKey: "landing.feature.voice.desc", icon: Mic2, titleKey: "landing.feature.voice" },
  { descKey: "landing.feature.extensions.desc", icon: Blocks, titleKey: "landing.feature.extensions" },
] as const;

function ServiceGuide({ embedded, error, onConnectRemote }: { embedded?: boolean; error?: string; onConnectRemote: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(SERVICE_INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }
  if (embedded) return <ServiceRecoveryGuide error={error} />;
  return <section className="mx-auto max-w-6xl py-4 pb-10 sm:py-8">
    <div className="relative overflow-hidden rounded-[1.75rem] border border-primary/15 bg-card px-6 py-10 shadow-[0_24px_80px_oklch(0.25_0.06_151_/_0.10)] sm:px-10 sm:py-14 lg:px-14">
      <div aria-hidden="true" className="absolute -right-24 -top-32 size-96 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden="true" className="absolute -bottom-32 left-1/3 size-80 rounded-full bg-accent/70 blur-3xl" />
      <div className="relative grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-primary"><span className="size-1.5 rounded-full bg-primary" />RECUT · LOCAL CREATIVE OS</p>
          <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl">{t("landing.title")}<br /><span className="text-primary">{t("landing.title2")}</span></h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">{t("landing.desc")}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"><button className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" onClick={() => { trackEvent("recut_install_clicked", { location: "service_guide" }); void copyInstallCommand(); }} type="button"><Download className="size-4" />{copied ? t("landing.install.copied") : t("landing.install")}</button><a className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border bg-background px-5 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" href="https://github.com/6174/recut" onClick={() => trackEvent("recut_external_clicked", { target: "github" })} rel="noreferrer" target="_blank"><Code2 className="size-4" />{t("landing.github")}</a></div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Terminal className="size-3.5" />{t("landing.install.hint")}</p>
          <button className="mt-5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground" onClick={onConnectRemote} type="button">{t("landing.connectRemote")} <ArrowRight className="ml-1 inline size-3.5" /></button>
        </div>
        <div className="relative rounded-2xl border border-primary/15 bg-background/85 p-4 shadow-xl backdrop-blur-sm"><div className="flex items-center justify-between border-b border-border/80 pb-3"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Clapperboard className="size-4" /></span><span><span className="block text-sm font-semibold">{t("landing.workspace.title")}</span><span className="block text-[10px] text-muted-foreground">LOCAL · PRIVATE · EXTENSIBLE</span></span></div><span className="rounded-full bg-primary/10 px-2 py-1 font-mono text-[9px] font-semibold tracking-wider text-primary">READY</span></div><div className="mt-4 grid grid-cols-2 gap-2.5">{LANDING_FEATURES.map(({ descKey, icon: Icon, titleKey }) => <div className="rounded-xl border border-border/80 bg-card p-3.5" key={titleKey}><span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-4" /></span><p className="mt-5 text-sm font-semibold">{t(titleKey)}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t(descKey)}</p></div>)}</div></div>
      </div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><LandingValue icon={HardDrive} text={t("landing.value.local.desc")} title={t("landing.value.local")} /><LandingValue icon={Code2} text={t("landing.value.open.desc")} title={t("landing.value.open")} /><LandingValue icon={Check} text={t("landing.value.ready.desc")} title={t("landing.value.ready")} /></div>
    <div className="mt-5 overflow-hidden rounded-xl border bg-foreground text-left text-primary-foreground shadow-sm"><div className="flex items-center gap-3 border-b border-primary-foreground/10 px-4 py-2 text-[10px] font-medium text-primary-foreground/55"><Terminal className="size-3.5" />TERMINAL · MACOS / LINUX / FREEBSD</div><div className="flex items-center gap-3 px-4 py-3"><code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs">{SERVICE_INSTALL_COMMAND}</code><button aria-label={t("landing.copy.aria")} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/85" onClick={() => void copyInstallCommand()} type="button"><Copy className="size-3.5" />{copied ? t("landing.copied") : t("landing.copy")}</button></div></div>
    {error && <div className="mt-5"><RepairGuide message={error} /></div>}
  </section>;
}

function ServiceRecoveryGuide({ error }: { error?: string }) {
  const { t } = useI18n();
  return <section className="mx-auto flex min-h-[30rem] max-w-2xl flex-col items-center justify-center py-12 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Download className="size-6" /></span><p className="mt-6 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">LOCAL SERVICE</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("recovery.title")}</h1><p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{t("recovery.desc")}</p>{error && <div className="mt-8 w-full max-w-2xl"><RepairGuide message={error} /></div>}</section>;
}

function LandingValue({ icon: Icon, text, title }: { icon: LucideIcon; text: string; title: string }) {
  return <div className="flex gap-3 rounded-xl border bg-card p-4"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div></div>;
}

function ServiceChecking() {
  const { t } = useI18n();
  return <section aria-busy="true" aria-label={t("service.checking.aria")} className="grid min-h-80 place-items-center p-8 text-center"><div><span className="mx-auto block size-2 animate-pulse rounded-full bg-muted-foreground" /><p className="mt-4 text-sm text-muted-foreground">{t("service.checking.label")}</p></div></section>;
}

function SectionTitle({ action, count, description, title }: { action?: React.ReactNode; count?: string; description: string; title: string }) {
  return <div className="mb-7 flex items-end justify-between"><div><p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary"><span className="size-1.5 rounded-full bg-primary" />DESKTOP</p><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div><div className="flex items-center gap-3">{action}{count && <Badge className="border-primary/25 bg-accent text-accent-foreground">{count}</Badge>}</div></div>;
}

function RepairGuide({ message }: { message: string }) {
  const { t } = useI18n();
  const prompt = `Recut 本地环境遇到问题：${message}\n请先检查 service 日志、Git 状态和 manifest.json；解释根因并给出最小、可验证的修复。不要跳过现有本地修改。`;
  return <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-left"><p className="text-xs font-medium">{message}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("repair.desc")}</p><Button className="mt-2 h-7" onClick={() => void navigator.clipboard.writeText(prompt)} type="button" variant="outline"><Code2 className="size-3.5" />{t("repair.copy")}</Button></div>;
}
