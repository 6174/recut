/*
 * [INPUT]: 依赖 React 状态能力、Zustand 共享的 Daemon 与工作台目录状态、静态 App Catalog、Agent Session HTTP API 及全局 Agent 面板上下文
 * [OUTPUT]: 对外提供 Studio、Projects、Assets、Apps 四个独立入口、固定使用通用会话上下文的 Agent 面板（由根布局全局挂载，本页只声明作用域）、Studio 的紧凑最近项目卡（按 App 设置的图片/视频封面渲染）与最近资源外显、可预览的项目 App 选择与详情入口、Git 仓库安装入口、已安装 App 的单个与聚合升级动作、为项目型 App 弹框创建项目、直接打开工作区型 App、安装列表的明确读取/失败/空态和 service 连接错误诊断
 * [POS]: web/app 的主工作台框架；Studio 是默认创作入口，工作台目录由 lib/workspace-store 跨路由缓存，创建、安装、升级后显式刷新，绝不 5 秒轮询；Agent 面板不在此挂载，只经 agent-panel-context 声明会话作用域
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, ArrowRight, Box, Captions, Check, ChevronDown, Clapperboard, Code2, Download, ExternalLink, FileImage, FolderOpen, FolderPlus, ImageIcon, LoaderCircle, Music2, Plus, Send, Sparkles, Store, Video, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { AppUpdateAllControl, AppVersionControl } from "@/components/app-version-control";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreateAppDialog } from "@/components/create-app-dialog";
import { InstallGitAppDialog } from "@/components/install-git-app-dialog";
import { Input } from "@/components/ui/input";
import { HeaderActions } from "@/components/header-actions";
import { useAgentPanelContext, useReportPageContext } from "@/lib/agent-panel-context";
import { marketplaceApps } from "@/lib/app-catalog";
import { isLocalWorkspace } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";
import { useWorkspaceStore, type WorkspaceApp as App, type WorkspaceInstallation as Installation, type WorkspaceProject as Project } from "@/lib/workspace-store";
import { VideoFrame } from "@/components/video-frame";
import { WebGLStudioHero } from "@/components/webgl-studio-hero";
import type { Asset } from "./media/media-types";
import { MediaLibraryPanel } from "./media/media-library-panel";

type AppDetailRenderer = (context: { onConnectService: () => void; serviceOnline: boolean }) => React.ReactNode;
type WorkspaceTab = "studio" | "projects" | "assets" | "apps";
type InstallationLoadState = "loading" | "ready" | "failed" | "offline";

export function Workspace({ appDetail, initialTab = "studio" }: { appDetail?: AppDetailRenderer; initialTab?: WorkspaceTab } = {}) {
  const apps = useWorkspaceStore((state) => state.apps);
  const installations = useWorkspaceStore((state) => state.installations);
  const projects = useWorkspaceStore((state) => state.projects);
  const workspaceState = useWorkspaceStore((state) => state.state);
  const workspaceError = useWorkspaceStore((state) => state.error);
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const [appID, setAppID] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("app") ?? "");
  const [name, setName] = useState("");
  const [createApp, setCreateApp] = useState<Installation | null>(null);
  const service = useServiceStore((state) => state.service);
  const apiBase = useServiceStore((state) => state.endpoint);
  const [tab, setTab] = useState<WorkspaceTab>(appDetail ? "apps" : initialTab);
  const [mediaProjectID, setMediaProjectID] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"service" | "multimodal" | undefined>();
  const [error, setError] = useState("");

  const online = service.phase === "online";
  const agentProjectID = tab === "assets" ? mediaProjectID : null;
  useLayoutEffect(() => {
    useAgentPanelContext.getState().setContext({ projectID: agentProjectID, headerHeight: 64 });
  }, [agentProjectID]);
  const pageContext = useMemo(() => tab === "assets"
    ? { title: "素材库", path: "/media" }
    : tab === "projects"
      ? { title: "项目", path: "/projects" }
      : tab === "apps"
        ? { title: "应用", path: "/apps" }
        : null, [tab]);
  useReportPageContext(pageContext);
  useEffect(() => {
    if (!online) return;
    void loadWorkspace(apiBase);
  }, [apiBase, loadWorkspace, online]);

  useEffect(() => {
    const projectApps = apps.filter((app) => app.manifest.type === "project");
    setAppID((current) => current && projectApps.some((app) => app.manifest.id === current) ? current : projectApps[0]?.manifest.id ?? "");
  }, [apps]);

  async function reloadWorkspace() {
    await loadWorkspace(apiBase, true);
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !appID) return;
    const response = await fetch(`${apiBase}/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, appId: appID }) });
    if (!response.ok) { setError(await responseMessage(response)); return; }
    await response.json();
    setName("");
    await loadWorkspace(apiBase, true);
  }

  function openCreateProject(app: Installation) {
    setCreateApp(app);
  }

  async function createProjectWithApp(app: Installation, projectName: string) {
    const response = await fetch(`${apiBase}/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName, appId: app.manifest.id }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    const project = await response.json() as Project;
    await loadWorkspace(apiBase, true);
    window.location.assign(`/projects/${project.id}`);
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

  const detail = appDetail?.({ onConnectService: openServiceSettings, serviceOnline: online });
  const appInstallationLoadState: InstallationLoadState = online ? workspaceState : service.phase === "checking" ? "loading" : "offline";
  const content = detail ?? (tab === "apps" ? <Apps apiBase={apiBase} installations={installations} installationError={workspaceError} installationLoadState={appInstallationLoadState} onStartProject={openCreateProject} onUpdated={reloadWorkspace} serviceOnline={online} />
    : service.phase === "checking" ? <ServiceChecking />
    : !online ? <ServiceGuide embedded={isLocalWorkspace} error={service.error} onConnectRemote={openServiceSettings} />
    : tab === "studio" ? <Studio apiBase={apiBase} installations={installations} onCompose={(text) => useAgentPanelContext.getState().setDraft({ id: `${Date.now()}`, text })} onStartProject={openCreateProject} projects={projects} />
      : tab === "projects" ? <ProjectsPage apps={installations.filter((app) => app.manifest.type === "project")} name={name} onAppChange={setAppID} onNameChange={setName} onSubmit={createProject} projects={projects} selectedApp={appID} />
        : <MediaLibraryPanel onOpenProviderSettings={openMediaProviderSettings} onProjectIDChange={setMediaProjectID} />);
  return <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-4 md:px-5">
      <div className="flex min-w-0 items-center gap-3 md:gap-4"><span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg"><img alt="Recut" className="size-full object-cover" src="/logo.jpg" /></span><span className="hidden h-5 w-px bg-border sm:block" /><nav aria-label="工作台" className="flex min-w-0 items-center gap-0.5 sm:gap-1"><Tab active={tab === "studio"} href="/">Studio</Tab><Tab active={tab === "projects"} href="/projects">Projects</Tab><Tab active={tab === "assets"} href="/media">Assets</Tab><Tab active={tab === "apps"} href="/apps">Apps</Tab></nav></div>
      <div className="hidden md:block"><HeaderActions onSettingsOpenChange={changeSettingsOpen} settingsOpen={settingsOpen} settingsSection={settingsSection} /></div>
    </header>
    <div className="min-h-0 flex-1 overflow-hidden md:pl-[var(--side-panel-width)]">
      {online && tab === "assets" ? content : <section className="h-full min-h-0 overflow-y-auto bg-muted/30 p-4 sm:p-6 md:p-8"><div className="mx-auto max-w-6xl">{content}</div></section>}
    </div>
    {createApp && <CreateProjectFromAppDialog app={createApp} onClose={() => setCreateApp(null)} onCreate={async (projectName) => createProjectWithApp(createApp, projectName)} />}
  </main>;
}

export default Workspace;

function Tab({ active, children, href }: { active: boolean; children: React.ReactNode; href: string }) {
  return <Link aria-current={active ? "page" : undefined} className={active ? "rounded-lg bg-accent px-2 py-1.5 text-[11px] font-semibold text-accent-foreground sm:px-2.5 sm:text-xs" : "rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:px-2.5 sm:text-xs"} href={href}>{children}</Link>;
}

function Projects({ apps, name, onAppChange, onNameChange, onSubmit, projects, selectedApp }: { apps: App[]; name: string; onAppChange: (value: string) => void; onNameChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; projects: Project[]; selectedApp: string }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4"><form className="group flex min-h-56 min-w-0 flex-col rounded-xl border-2 border-dashed border-primary/35 bg-card p-5 transition hover:border-primary hover:bg-accent/40" onSubmit={onSubmit}><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><FolderPlus className="size-5" /></span><div className="mt-auto min-w-0"><p className="text-base font-semibold">新建项目</p><p className="mt-1 text-xs leading-5 text-muted-foreground">选择一个 App，给你的新创作命名。</p><div className="mt-4 grid min-w-0 gap-2"><div className="min-w-0"><label className="mb-1 block text-[11px] font-medium" htmlFor="project-name">项目名称</label><Input className="h-8 bg-background text-xs" id="project-name" onChange={(event) => onNameChange(event.target.value)} placeholder="例如：夏季品牌片" value={name} /></div><AppPicker apps={apps} onChange={onAppChange} selectedApp={selectedApp} /><Button className="mt-1 h-8 rounded-md bg-primary text-primary-foreground hover:bg-primary/85" disabled={!name.trim() || !selectedApp} type="submit"><Plus className="size-3.5" />创建项目</Button></div></div></form>{projects.map((project) => <Link className="group min-w-0" href={`/projects/${project.id}`} key={project.id}><Card className="flex min-h-56 h-full min-w-0 flex-col border-transparent bg-card p-5 shadow-sm transition-all group-hover:-translate-y-1 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-overlay)]"><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><AppWindow className="size-5" /></span><Badge className="border-primary/20 bg-accent/60 text-accent-foreground">{project.appId}</Badge></div><div className="mt-auto"><p className="truncate text-base font-semibold">{project.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{project.id}</p><div className="mt-4 flex items-center gap-2 text-xs font-medium text-primary"><span className="size-1.5 rounded-full bg-primary" />继续创作</div></div></Card></Link>)}</div>;
}

const HOME_INSPIRATIONS = [
  "今天，镜头先于语言，让画面替你说出未尽的话。",
  "把时间剪开一条缝，光就会从那里透进来。",
  "一帧是一念，把念想连成故事。",
  "每个故事都值得一个耐心的开始。",
  "别急着回答，先让画面安静一会儿。",
  "光影落下的地方，就是叙事的起点。",
  "好故事不是被发现的，是被剪辑出来的。",
  "从第一秒开始，让观看变成一场呼吸。",
  "灵感是一阵风，剪进画面，它就停住了。",
  "把日常拍成诗的，不是技巧，是目光。",
  "空白也是内容，留白处有回声。",
  "让节奏慢一点，情绪就会自己长出来。",
  "你在意的细节，就是观众动容的瞬间。",
  "今天的素材里，藏着你明天的代表作。",
  "声音先到，画面随后抵达。",
  "把想法落到时间轴上，它才算真正开始。",
  "色彩会说话，情绪有形状。",
  "好的开头是一句邀请，观众不会拒绝。",
  "每一个转场，都是写给下个镜头的情书。",
  "记录世界，或者创造它，都从这一帧开始。",
];

function inspirationForToday() {
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return HOME_INSPIRATIONS[Math.abs(dayIndex) % HOME_INSPIRATIONS.length];
}

function Studio({ apiBase, installations, onCompose, onStartProject, projects }: { apiBase: string; installations: Installation[]; onCompose: (text: string) => void; onStartProject: (app: Installation) => void; projects: Project[] }) {
  const [idea, setIdea] = useState("");
  const suggestions = [
    { icon: Clapperboard, label: "从脚本生成视频", prompt: "根据这段脚本规划并生成一支完整视频：" },
    { icon: Video, label: "生成 B-roll", prompt: "为当前创作规划需要的 B-roll，并生成第一组镜头。" },
    { icon: ImageIcon, label: "生成视频封面", prompt: "为我的视频设计一组吸引人的封面方向。" },
  ];
  const recentProjects = projects.slice(0, 4);
  return <div className="pb-10">
    <section className="relative min-h-[21rem] overflow-hidden border-b border-border pb-8 pt-7 sm:min-h-[23rem]">
      <WebGLStudioHero />
      <div className="relative z-10 max-w-xl">
      <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">GOOD MORNING · STUDIO</p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight">你的 AI 创作工作站</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{inspirationForToday()}</p>
      <form className="relative z-10 mt-7 max-w-3xl rounded-md border bg-card p-2 shadow-[var(--shadow-overlay)]" onSubmit={(event) => { event.preventDefault(); if (!idea.trim()) return; onCompose(idea.trim()); setIdea(""); }}>
        <div className="flex items-center gap-3 px-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground"><Sparkles className="size-4" /></span><label className="sr-only" htmlFor="studio-idea">创作想法</label><input className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" id="studio-idea" onChange={(event) => setIdea(event.target.value)} placeholder="描述你想创作的内容，Agent 会把它变成可执行的工作流" value={idea} /><Button aria-label="发送创作想法" className="size-9 rounded-md p-0" disabled={!idea.trim()} type="submit"><Send className="size-4" /></Button></div>
      </form>
      <div className="relative z-10 mt-3 flex flex-wrap gap-2">{suggestions.map(({ icon: Icon, label, prompt }) => <button className="inline-flex h-9 items-center gap-2 rounded-full border bg-card px-3 text-xs font-medium transition hover:border-primary/30 hover:bg-accent/40" key={label} onClick={() => onCompose(prompt)} type="button"><Icon className="size-3.5 text-primary" />{label}</button>)}</div>
      </div>
    </section>
    <section className="mt-8"><SectionHeading action={<Link className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" href="/apps">管理 Apps<ArrowRight className="size-3.5" /></Link>} description="已安装的创作能力，按项目或独立工作区直接进入。" title="创作 Apps" />{installations.length ? <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{installations.map((app) => <StudioAppCard app={app} key={app.package} onOpen={() => app.manifest.type === "standalone" ? window.location.assign(`/workspace-app/app?id=${encodeURIComponent(app.manifest.id)}`) : onStartProject(app)} />)}</div> : <EmptyHomeApps />}</section>
    <section className="mt-9"><SectionHeading action={<Link className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" href="/projects">查看全部<ArrowRight className="size-3.5" /></Link>} description="从上次停下的地方继续。" title="继续创作" />{recentProjects.length ? <RecentProjects apiBase={apiBase} projects={recentProjects} /> : <Card><CardContent className="flex min-h-28 items-center justify-between gap-5 p-5"><div><p className="text-sm font-semibold">从一个项目开始</p><p className="mt-1 text-xs text-muted-foreground">选择一款已安装的 App，建立你的第一个创作空间。</p></div><Link className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xs bg-primary px-2.5 text-xs font-medium text-primary-foreground" href="/projects"><FolderPlus className="size-3.5" />新建项目</Link></CardContent></Card>}</section>
    <section className="mt-9"><SectionHeading action={<Link className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" href="/media">打开 Assets<ArrowRight className="size-3.5" /></Link>} description="最近加入工作台的图片、视频和音频，可直接带入下一次创作。" title="最近使用的资源" /><RecentAssets apiBase={apiBase} /></section>
  </div>;
}

function RecentProjects({ apiBase, projects }: { apiBase: string; projects: Project[] }) {
  const gridClass = projects.length === 1 ? "grid max-w-60 grid-cols-1 gap-3" : "grid grid-cols-2 gap-3 lg:grid-cols-4";
  return <div className={gridClass}>{projects.map((project) => <Link className="group" href={`/projects/${project.id}`} key={project.id}><Card className="overflow-hidden transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)]"><ProjectCoverPreview apiBase={apiBase} project={project} /><CardContent className="p-3"><p className="truncate text-sm font-semibold">{project.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{project.appId}</p><p className="mt-2 text-xs font-medium text-primary">继续编辑</p></CardContent></Card></Link>)}</div>;
}

function ProjectCoverPreview({ apiBase, project }: { apiBase: string; project: Project }) {
  const cover = project.cover;
  if (cover) {
    const src = `${apiBase}/v1/media/assets/${encodeURIComponent(cover.assetId)}/content`;
    if (cover.kind === "video") return <VideoFrame alt={`${project.name} 项目封面`} className="aspect-[16/7] border-b" src={src} />;
    return <img alt={`${project.name} 项目封面`} className="aspect-[16/7] w-full border-b object-cover" src={src} />;
  }
  return <div className="flex aspect-[16/7] items-center justify-between border-b bg-muted p-3"><span className="grid size-7 place-items-center rounded-sm bg-card text-muted-foreground shadow-sm"><AppWindow className="size-3.5" /></span><span className="rounded-xs border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">PROJECT</span></div>;
}

function ProjectsPage({ apps, name, onAppChange, onNameChange, onSubmit, projects, selectedApp }: { apps: Installation[]; name: string; onAppChange: (value: string) => void; onNameChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; projects: Project[]; selectedApp: string }) {
  return <><SectionTitle count={`${projects.length} PROJECTS`} description="整理所有创作空间，新项目从这里开始。" title="Projects" /><Projects apps={apps} name={name} onAppChange={onAppChange} onNameChange={onNameChange} onSubmit={onSubmit} projects={projects} selectedApp={selectedApp} /></>;
}

function RecentAssets({ apiBase }: { apiBase: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => { let active = true; void fetch(`${apiBase}/v1/media/assets`, { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<Asset[]>; }).then((items) => { if (active) { setAssets(items.slice(0, 5)); setState("ready"); } }).catch(() => { if (active) setState("error"); }); return () => { active = false; }; }, [apiBase]);
  if (state === "loading") return <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div className="aspect-square animate-pulse rounded-sm bg-muted" key={index} />)}</div>;
  if (state === "error" || !assets.length) return <Card><CardContent className="flex min-h-28 items-center gap-3"><span className="grid size-9 place-items-center rounded-sm bg-muted"><Box className="size-4 text-muted-foreground" /></span><div><p className="text-sm font-medium">还没有可展示的资源</p><p className="mt-1 text-xs text-muted-foreground">上传素材或在任一 App 中生成内容后，它们会出现在这里。</p></div></CardContent></Card>;
  return <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">{assets.map((asset) => <Link className="group min-w-0" href="/media" key={asset.id}><Card className="overflow-hidden transition group-hover:-translate-y-0.5 group-hover:border-primary/35"><AssetPreview apiBase={apiBase} asset={asset} /><CardContent className="p-2.5"><p className="truncate text-xs font-medium">{asset.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : asset.kind === "transcript" ? "转写" : "音频"}</p></CardContent></Card></Link>)}</div>;
}

function AssetPreview({ apiBase, asset }: { apiBase: string; asset: Asset }) {
  const source = `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/content`;
  const icon = asset.kind === "audio" ? <Music2 className="size-5" /> : asset.kind === "video" ? <Video className="size-5" /> : asset.kind === "transcript" ? <Captions className="size-5" /> : <FileImage className="size-5" />;
  if (asset.status !== "completed") return <div className="grid aspect-square place-items-center bg-muted text-muted-foreground">{icon}</div>;
  if (asset.kind === "video") return <VideoFrame alt={asset.name} className="aspect-square" src={source} />;
  if (asset.kind === "image") return <img alt={asset.name} className="aspect-square w-full object-cover" src={source} />;
  return <div className="grid aspect-square place-items-center bg-muted text-primary">{icon}</div>;
}

function StudioAppCard({ app, onOpen }: { app: Installation; onOpen: () => void }) {
  const detailHref = `/apps/${encodeURIComponent(app.manifest.id)}`;
  const actionLabel = app.manifest.type === "standalone" ? "打开应用" : "新建项目";
  return <Card className="group cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)]" onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }} role="button" tabIndex={0}><CardContent className="flex flex-col p-3"><div className="flex items-center gap-2"><span className="grid size-7 shrink-0 place-items-center rounded-sm bg-accent text-accent-foreground"><AppWindow className="size-3" /></span><p className="min-w-0 flex-1 truncate text-xs font-semibold">{app.manifest.name}</p><Link aria-label={`查看 ${app.manifest.name} 详情`} className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground" href={detailHref} onClick={(event) => event.stopPropagation()}>详情</Link></div><p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{app.manifest.description}</p><p className="mt-2 text-[11px] font-medium text-primary">{actionLabel}</p></CardContent></Card>;
}

function SectionHeading({ action, description, title }: { action?: React.ReactNode; description: string; title: string }) {
  return <div className="mb-4 flex items-end justify-between gap-5"><div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>{action}</div>;
}

function EmptyHomeApps() {
  return <Card><CardContent className="flex min-h-44 flex-col items-center justify-center gap-3 text-center"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Store className="size-5" /></span><div><p className="text-sm font-medium">还没有已安装的 App</p><p className="mt-1 text-xs text-muted-foreground">去 Apps 挑一个顺手的，装好就能从这里开工。</p></div><Link className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xs bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85" href="/apps"><Store className="size-3.5" />浏览 Apps</Link></CardContent></Card>;
}

function CreateProjectFromAppDialog({ app, onClose, onCreate }: { app: Installation; onClose: () => void; onCreate: (projectName: string) => Promise<void> }) {
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectName.trim() || creating) return;
    setCreating(true); setError("");
    try { await onCreate(projectName.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : "创建项目失败"); setCreating(false); }
  }
  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="create-project-app-title"><section className="w-full max-w-md rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">NEW PROJECT</p><h2 className="mt-1 text-base font-semibold" id="create-project-app-title">为「{app.manifest.name}」新建项目</h2><p className="mt-1 text-xs text-muted-foreground">创建后进入项目工作台，开始使用这个 App 创作。</p></div><button aria-label="关闭新建项目" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><form onSubmit={submit}><div className="p-5"><label className="mb-1 block text-[11px] font-medium" htmlFor="create-project-app-name">项目名称</label><Input autoFocus className="h-9 bg-background text-xs" id="create-project-app-name" onChange={(event) => setProjectName(event.target.value)} placeholder="例如：夏季品牌片" value={projectName} />{error && <p className="mt-2 text-xs text-warning">{error}</p>}</div><footer className="flex items-center justify-end gap-2 border-t px-5 py-3"><Button onClick={onClose} type="button" variant="ghost">取消</Button><Button disabled={!projectName.trim() || creating} type="submit">{creating ? "正在创建…" : "创建并进入项目"}</Button></footer></form></section></div>;
}

function AppPicker({ apps, onChange, selectedApp }: { apps: App[]; onChange: (id: string) => void; selectedApp: string }) {
  const [open, setOpen] = useState(false);
  const selected = apps.find((app) => app.manifest.id === selectedApp);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return <div className="min-w-0"><label className="mb-1 block text-[11px] font-medium" htmlFor="project-app-picker">应用</label><button aria-describedby="project-app-help" aria-expanded={open} aria-haspopup="dialog" className="flex min-h-11 min-w-0 w-full items-center justify-between gap-2 overflow-hidden rounded-sm border bg-background px-2 text-left transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" id="project-app-picker" onClick={() => setOpen(true)} type="button"><span className="min-w-0 flex-1 overflow-hidden"><span className="block truncate text-xs font-medium">{selected?.manifest.name ?? "选择一个 App"}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{selected ? `作者 · ${selected.manifest.author}` : "查看用途后再开始创作"}</span></span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /></button><p className="sr-only" id="project-app-help">打开应用选择面板，查看用途和详情后选择项目 App。</p>{open && <AppPickerDialog apps={apps} onChange={onChange} onClose={() => setOpen(false)} selectedApp={selectedApp} />}</div>;
}

function AppPickerDialog({ apps, onChange, onClose, selectedApp }: { apps: App[]; onChange: (id: string) => void; onClose: () => void; selectedApp: string }) {
  const selected = apps.find((app) => app.manifest.id === selectedApp) ?? apps[0];
  function choose(app: App) { onChange(app.manifest.id); onClose(); }

  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="app-picker-title"><section className="flex max-h-[min(620px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">PROJECT APP</p><h2 className="mt-1 text-base font-semibold" id="app-picker-title">选择创作方式</h2><p className="mt-1 text-xs text-muted-foreground">先了解 App 的用途，再把它作为新项目的工作台。</p></div><button aria-label="关闭应用选择" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header>{apps.length ? <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_18rem]"><div className="divide-y border-r">{apps.map((app) => { const active = app.manifest.id === selectedApp; return <button aria-pressed={active} className={active ? "block w-full bg-accent/60 px-5 py-4 text-left" : "block w-full px-5 py-4 text-left hover:bg-muted"} key={app.manifest.id} onClick={() => choose(app)} type="button"><span className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background text-accent-foreground"><AppWindow className="size-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3 text-xs font-medium">{app.manifest.name}{active && <Check className="size-3.5 shrink-0 text-primary" />}</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{app.manifest.description}</span><span className="mt-2 block font-mono text-[10px] text-muted-foreground">{app.manifest.author} · v{app.manifest.version}</span></span></span></button>; })}</div><aside className="bg-muted/30 p-5">{selected && <><span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground"><AppWindow className="size-5" /></span><p className="mt-4 text-sm font-semibold">{selected.manifest.name}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{selected.manifest.description}</p><dl className="mt-5 space-y-3 text-xs"><div><dt className="text-muted-foreground">作者</dt><dd className="mt-1">{selected.manifest.author}</dd></div><div><dt className="text-muted-foreground">版本</dt><dd className="mt-1 font-mono">v{selected.manifest.version}</dd></div></dl><Link className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline" href={`/apps/${encodeURIComponent(selected.manifest.id)}`} onClick={onClose}>查看详情<ExternalLink className="size-3.5" /></Link></>}</aside></div> : <div className="grid min-h-60 place-items-center p-8 text-center"><div><p className="text-sm font-medium">还没有可用于项目的 App</p><p className="mt-2 text-xs leading-5 text-muted-foreground">去 Apps 添加一个项目型 App，再回到这里开始创作。</p></div></div>}<footer className="flex items-center justify-between gap-4 border-t px-5 py-3"><span className="text-[11px] text-muted-foreground">{apps.length ? `${apps.length} 个可用项目 App` : "项目 App 决定项目的创作能力"}</span><Link className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline" href="/apps" onClick={onClose}>前往 Apps 添加更多能力<ExternalLink className="size-3.5" /></Link></footer></section></div>;
}

function Apps({ apiBase, installations, installationError, installationLoadState, onStartProject, onUpdated, serviceOnline }: { apiBase: string; installations: Installation[]; installationError: string; installationLoadState: InstallationLoadState; onStartProject: (app: Installation) => void; onUpdated: () => Promise<void>; serviceOnline: boolean }) {
  const installationCount = installationLoadState === "loading" ? "读取中…" : installationLoadState === "offline" ? "SERVICE OFFLINE" : `${installations.length} APPS`;
  const marketplaceStatus = (installed: boolean) => installed ? "INSTALLED" : installationLoadState === "loading" ? "CHECKING" : "MARKET APP";
  return <><SectionTitle action={<><AppUpdateAllControl apps={installations} onUpdated={onUpdated} /><CreateAppDialog /><InstallGitAppDialog apiBase={apiBase} disabled={!serviceOnline} onInstalled={onUpdated} /></>} description="选择、安装和管理所有创作能力；每个 App 都使用同一套工作台规范。" title="Apps" /><section><div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">已安装</h2><p className="mt-1 text-xs text-muted-foreground">你已装好的能力，随时用来新建项目或直接打开。</p></div><Badge>{installationCount}</Badge></div>{installationLoadState === "loading" ? <InstalledAppsLoading /> : installationLoadState === "offline" ? <InstalledAppsOffline /> : installationLoadState === "failed" ? <InstalledAppsError message={installationError} onRetry={() => void onUpdated()} /> : installations.length === 0 ? <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-6 text-primary" /><p className="text-sm font-medium">还没有已安装的 App</p><p className="text-xs text-muted-foreground">在下面挑一个装好，它就会出现在这里。</p></CardContent></Card> : <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">{installations.map((app) => <InstalledAppCard app={app} key={app.package} onStartProject={onStartProject} onUpdated={onUpdated} />)}</div>}</section><section className="mt-10"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">可添加的能力</h2><p className="mt-1 text-xs text-muted-foreground">浏览你要的创作能力，打开详情就能安装或开始项目。</p></div><Badge>{marketplaceApps.length} AVAILABLE</Badge></div><div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">{marketplaceApps.map((app) => { const installed = installations.some((item) => item.manifest.id === app.manifest.id); return <Link className="group" href={`/apps/${encodeURIComponent(app.manifest.id)}`} key={app.manifest.id}><Card className="h-full transition-all group-hover:-translate-y-1 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-overlay)]"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><AppWindow className="size-5" /></span><Badge>{marketplaceStatus(installed)}</Badge></div><p className="mt-5 text-base font-semibold">{app.manifest.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{app.manifest.id}</p><p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{app.manifest.description}</p><p className="mt-2 text-[11px] text-muted-foreground">作者 · {app.manifest.author} · v{app.manifest.version}</p><p className="mt-4 text-xs font-medium text-primary">查看详情</p></CardContent></Card></Link>; })}</div></section></>;
}

function InstalledAppsLoading() {
  return <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center"><LoaderCircle aria-hidden="true" className="size-6 animate-spin text-primary" /><p className="text-sm font-medium">正在读取已安装的 App…</p><p className="text-xs text-muted-foreground">正在检查本机安装状态和可用更新。</p></CardContent></Card>;
}

function InstalledAppsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-6 text-warning" /><div><p className="text-sm font-medium">未能读取已安装的 App</p><p className="mt-1 text-xs text-muted-foreground">{message}</p></div><Button onClick={onRetry} type="button" variant="outline">重新读取</Button></CardContent></Card>;
}

function InstalledAppsOffline() {
  return <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-6 text-primary" /><p className="text-sm font-medium">连接 service 后显示已安装 App</p><p className="text-xs text-muted-foreground">应用市场仍可浏览，详情页会显示当前安装状态。</p></CardContent></Card>;
}

function InstalledAppCard({ app, onStartProject, onUpdated }: { app: Installation; onStartProject: (app: Installation) => void; onUpdated: () => void }) {
  const detailHref = `/apps/${encodeURIComponent(app.manifest.id)}`;
  const status = app.dirty ? "存在本地 Git 修改，升级已保护" : app.updateAvailable ? "检测到远端更新" : app.status ?? "已是当前 Git 状态";
  return <Card className="flex min-h-72 flex-col transition-shadow hover:shadow-[var(--shadow-overlay)]"><CardContent className="flex flex-1 flex-col p-5"><div className="flex items-start justify-between gap-3"><Link aria-label={`查看 ${app.manifest.name} 详情`} className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground transition hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring" href={detailHref}><AppWindow className="size-5" /></Link><div onClick={(event) => event.stopPropagation()}><AppVersionControl app={app} onUpdated={onUpdated} /></div></div><Link className="mt-5 flex flex-1 flex-col rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" href={detailHref}><p className="text-base font-semibold">{app.manifest.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{app.manifest.id}</p><p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{app.manifest.description}</p><p className="mt-2 text-[11px] text-muted-foreground">作者 · {app.manifest.author}</p><p className="mt-3 text-xs text-muted-foreground">{status}</p><p className="mt-auto pt-4 text-xs font-medium text-primary">查看详情</p></Link></CardContent><div className="border-t px-5 py-3"><InstalledAppAction app={app} onStartProject={onStartProject} /></div></Card>;
}

function InstalledAppAction({ app, onStartProject }: { app: Installation; onStartProject: (app: Installation) => void }) {
  if (app.manifest.type === "standalone") return <Link className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xs bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85" href={`/workspace-app/app?id=${encodeURIComponent(app.manifest.id)}`}><AppWindow className="size-3.5" />打开应用</Link>;
  return <Button className="w-full" onClick={() => onStartProject(app)} type="button"><FolderPlus className="size-3.5" />新建项目</Button>;
}

function ServiceGuide({ embedded, error, onConnectRemote }: { embedded?: boolean; error?: string; onConnectRemote: () => void }) {
  if (embedded) return <Card><CardContent className="flex min-h-80 flex-col items-center justify-center gap-5 p-8 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Download className="size-6" /></span><div><p className="text-lg font-semibold">本地工作台连接中断</p><p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">当前页面由同一个 Recut service 提供；请刷新页面或检查该 service 的日志。</p></div>{error && <RepairGuide message={error} />}</CardContent></Card>;
  return <Card><CardContent className="flex min-h-80 flex-col items-center justify-center gap-5 p-8 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Download className="size-6" /></span><div><p className="text-lg font-semibold">连接一个 service</p><p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">Recut 的数据与执行能力仍在你的电脑上，浏览器正在等待本地 service。</p></div><code className="rounded-md border bg-muted px-4 py-2 text-sm">curl -fsSL https://recut.video/install.sh | sh</code><Button onClick={onConnectRemote} type="button" variant="outline">连接已有的远程 service</Button><p className="max-w-md text-xs leading-5 text-muted-foreground">可以安装本地 service，也可以在连接设置中填入团队或服务器提供的 HTTPS 地址。</p>{error ? <RepairGuide message={error} /> : <RepairGuide message="安装本地 service 过程中出现错误" />}</CardContent></Card>;
}

function ServiceChecking() {
  return <Card><CardContent className="grid min-h-80 place-items-center p-8 text-center"><div><span className="mx-auto block size-2 animate-pulse rounded-full bg-muted-foreground" /><p className="mt-4 text-sm text-muted-foreground">正在连接本地 service…</p></div></CardContent></Card>;
}

function SectionTitle({ action, count, description, title }: { action?: React.ReactNode; count?: string; description: string; title: string }) {
  return <div className="mb-7 flex items-end justify-between"><div><p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary"><span className="size-1.5 rounded-full bg-primary" />DESKTOP</p><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div><div className="flex items-center gap-3">{action}{count && <Badge className="border-primary/25 bg-accent text-accent-foreground">{count}</Badge>}</div></div>;
}

function RepairGuide({ message }: { message: string }) {
  const prompt = `Recut 本地环境遇到问题：${message}\n请先检查 service 日志、Git 状态和 manifest.json；解释根因并给出最小、可验证的修复。不要跳过现有本地修改。`;
  return <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-left"><p className="text-xs font-medium">{message}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">不要让界面猜测或直接覆盖本机状态。把诊断任务交给 Codex、Claude Code 或 OpenCode。</p><Button className="mt-2 h-7" onClick={() => void navigator.clipboard.writeText(prompt)} type="button" variant="outline"><Code2 className="size-3.5" />复制诊断任务</Button></div>;
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? `请求失败（${response.status}）`;
}
