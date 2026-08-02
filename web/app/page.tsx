/*
 * [INPUT]: 依赖 React 状态能力、Zustand 共享的 Daemon 状态、静态 App Catalog 及项目、App 安装状态与 Agent Session HTTP API
 * [OUTPUT]: 对外提供 Project、Apps、素材库三个核心 Tab、可预览的项目 App 选择与详情入口，以及已安装 App 的直接开始动作、service 连接错误诊断和市场分区的离线可浏览目录
 * [POS]: web/app 的主工作台框架；不重复探测 service health，Cloudflare 或本地 service 托管此 UI，用户可选择本地或远程 service 作为数据与执行边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, Check, ChevronDown, Clapperboard, Code2, Download, ExternalLink, FolderOpen, FolderPlus, Plus, X } from "lucide-react";
import Link from "next/link";
import { CSSProperties, FormEvent, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { AppVersionControl } from "@/components/app-version-control";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreateAppDialog } from "@/components/create-app-dialog";
import { Input } from "@/components/ui/input";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { HeaderActions } from "@/components/header-actions";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";
import { marketplaceApps } from "@/lib/app-catalog";
import { isLocalWorkspace } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";
import { MediaLibraryPanel } from "./media/media-library-panel";

// 生产发布由 Makefile 将唯一的 RECUT_VERSION 注入这里；dev 回退不会触发升级判断。
const latestServiceVersion = process.env.NEXT_PUBLIC_RECUT_SERVICE_VERSION ?? "dev";

type App = { manifest: { id: string; name: string; author: string; description: string; repository?: string; version: string; type: "project" | "standalone" } };
type Project = { id: string; name: string; appId: string };
type Installation = {
  package: string;
  manifest: { id: string; name: string; author: string; description: string; repository?: string; version: string; type: "project" | "standalone" };
  repository?: string;
  revision?: string;
  dirty: boolean;
  updateAvailable: boolean;
  manageable: boolean;
  status?: string;
};

type AppDetailRenderer = (context: { onConnectService: () => void; serviceOnline: boolean }) => React.ReactNode;
type WorkspaceTab = "projects" | "apps" | "media";

export function Workspace({ appDetail, initialTab = "projects" }: { appDetail?: AppDetailRenderer; initialTab?: WorkspaceTab } = {}) {
  const [apps, setApps] = useState<App[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [appID, setAppID] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("app") ?? "");
  const [name, setName] = useState("");
  const [projectID, setProjectID] = useState<string | null>(null);
  const service = useServiceStore((state) => state.service);
  const apiBase = useServiceStore((state) => state.endpoint);
  const refreshService = useServiceStore((state) => state.refresh);
  const [tab, setTab] = useState<WorkspaceTab>(appDetail ? "apps" : initialTab);
  const [mediaProjectID, setMediaProjectID] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"service" | "multimodal" | undefined>();
  const [error, setError] = useState("");
  const [updatingService, setUpdatingService] = useState(false);
  const { handlePointerDown, layoutRef, panelWidth } = useResizableSidePanel({ storageKey: "recut.workspace-agent-panel-width" });

  const online = service.phase === "online";
  useEffect(() => {
    if (!online) return;
    void loadWorkspace();
    const timer = window.setInterval(() => void loadWorkspace(), 5000);
    return () => window.clearInterval(timer);
  }, [apiBase, online]);

  async function loadWorkspace() {
    try {
      const [appResponse, projectResponse, installationResponse] = await Promise.all([
        fetch(`${apiBase}/v1/apps`), fetch(`${apiBase}/v1/projects`), fetch(`${apiBase}/v1/apps/installed`),
      ]);
      if (!appResponse.ok || !projectResponse.ok || !installationResponse.ok) throw new Error("本地 service 返回了无效响应");
      const nextApps = await appResponse.json() as App[];
      const nextProjects = await projectResponse.json() as Project[];
      const projectApps = nextApps.filter((app) => app.manifest.type === "project");
      setApps(nextApps);
      setProjects(nextProjects);
      setInstallations(await installationResponse.json() as Installation[]);
      setAppID((current) => current && projectApps.some((app) => app.manifest.id === current) ? current : projectApps[0]?.manifest.id ?? "");
      setProjectID((current) => current && nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id ?? null);
    } catch { setError("本地 service 返回了无效响应"); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !appID) return;
    const response = await fetch(`${apiBase}/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, appId: appID }) });
    if (!response.ok) { setError(await responseMessage(response)); return; }
    const project = await response.json() as Project;
    setName("");
    await loadWorkspace();
    setProjectID(project.id);
  }

  async function updateService() {
    setUpdatingService(true); setError("");
    try {
      const response = await fetch(`${apiBase}/v1/system/update`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      window.setTimeout(() => void refreshService(), 1500);
    } catch (cause) { setError(messageOf(cause)); } finally { setUpdatingService(false); }
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

  const outdated = !isLocalWorkspace && serviceNeedsUpgrade(service.version, latestServiceVersion);
  const detail = appDetail?.({ onConnectService: openServiceSettings, serviceOnline: online });
  function startProjectWith(appID: string) {
    window.location.assign(`/projects?app=${encodeURIComponent(appID)}`);
  }

  const content = detail ?? (tab === "apps" ? <Apps installations={installations} onStartProject={startProjectWith} onUpdated={loadWorkspace} serviceOnline={online} />
    : service.phase === "checking" ? <ServiceChecking />
    : !online ? <ServiceGuide embedded={isLocalWorkspace} error={service.error} onConnectRemote={openServiceSettings} />
    : outdated ? <ServiceGuide error={error} installedVersion={service.version} onConnectRemote={openServiceSettings} onUpdate={updateService} updating={updatingService} />
    : tab === "projects" ? <Projects apps={apps.filter((app) => app.manifest.type === "project")} name={name} onAppChange={setAppID} onNameChange={setName} onSubmit={createProject} projects={projects} selectedApp={appID} /> : <MediaLibraryPanel onOpenProviderSettings={openMediaProviderSettings} onProjectIDChange={setMediaProjectID} />);
  return <main className="flex h-screen min-w-[1024px] flex-col overflow-hidden bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-5">
      <div className="flex items-center gap-4"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Clapperboard className="size-4" /></span><strong className="text-sm tracking-tight">RECUT</strong><span className="h-5 w-px bg-border" /><nav aria-label="工作台" className="flex items-center gap-1"><Tab active={tab === "projects"} href="/projects">Project</Tab><Tab active={tab === "apps"} href="/apps">Apps</Tab><Tab active={tab === "media"} href="/media">素材库</Tab></nav></div>
      <HeaderActions onSettingsOpenChange={changeSettingsOpen} settingsOpen={settingsOpen} settingsSection={settingsSection} />
    </header>
    <div className="relative grid min-h-0 flex-1 overflow-hidden [grid-template-columns:minmax(0,1fr)_var(--side-panel-width)]" ref={layoutRef} style={{ "--side-panel-width": `${panelWidth}px` } as CSSProperties}>
      {online && tab === "media" ? content : <section className="min-h-0 overflow-y-auto bg-muted/30 p-8"><div className="mx-auto max-w-6xl">{content}</div></section>}
      <button aria-label="拖动调整 Agent 面板宽度" className="group absolute inset-y-0 z-10 w-2 cursor-col-resize border-0 bg-transparent p-0 focus:outline-none [left:calc(100%_-_var(--side-panel-width)_-_0.25rem)]" onPointerDown={handlePointerDown} type="button"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-foreground group-focus:w-0.5 group-focus:bg-foreground" /></button>
      <ProjectAgentPanel apiBase={apiBase} online={online} projectID={tab === "media" ? mediaProjectID : projectID} />
    </div>
  </main>;
}

export default Workspace;

function Tab({ active, children, href }: { active: boolean; children: React.ReactNode; href: string }) {
  return <Link aria-current={active ? "page" : undefined} className={active ? "rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground" : "rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"} href={href}>{children}</Link>;
}

function Projects({ apps, name, onAppChange, onNameChange, onSubmit, projects, selectedApp }: { apps: App[]; name: string; onAppChange: (value: string) => void; onNameChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; projects: Project[]; selectedApp: string }) {
  return <><SectionTitle count={`${projects.length} PROJECTS`} description="从一个项目开始，继续你的创作。" title="项目桌面" /><div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4"><form className="group flex min-h-56 min-w-0 flex-col rounded-xl border-2 border-dashed border-primary/35 bg-card p-5 transition hover:border-primary hover:bg-accent/40" onSubmit={onSubmit}><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><FolderPlus className="size-5" /></span><div className="mt-auto min-w-0"><p className="text-base font-semibold">新建项目</p><p className="mt-1 text-xs leading-5 text-muted-foreground">选择一个 App，给你的新创作命名。</p><div className="mt-4 grid min-w-0 gap-2"><div className="min-w-0"><label className="mb-1 block text-[11px] font-medium" htmlFor="project-name">项目名称</label><Input className="h-8 bg-background text-xs" id="project-name" onChange={(event) => onNameChange(event.target.value)} placeholder="例如：夏季品牌片" value={name} /></div><AppPicker apps={apps} onChange={onAppChange} selectedApp={selectedApp} /><Button className="mt-1 h-8 rounded-md bg-primary text-primary-foreground hover:bg-primary/85" disabled={!name.trim() || !selectedApp} type="submit"><Plus className="size-3.5" />创建项目</Button></div></div></form>{projects.map((project) => <Link className="group min-w-0" href={`/projects/${project.id}`} key={project.id}><Card className="flex min-h-56 h-full min-w-0 flex-col border-transparent bg-card p-5 shadow-sm transition-all group-hover:-translate-y-1 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-overlay)]"><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><AppWindow className="size-5" /></span><Badge className="border-primary/20 bg-accent/60 text-accent-foreground">{project.appId}</Badge></div><div className="mt-auto"><p className="truncate text-base font-semibold">{project.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{project.id}</p><div className="mt-4 flex items-center gap-2 text-xs font-medium text-primary"><span className="size-1.5 rounded-full bg-primary" />继续创作</div></div></Card></Link>)}</div></>;
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

function Apps({ installations, onStartProject, onUpdated, serviceOnline }: { installations: Installation[]; onStartProject: (appID: string) => void; onUpdated: () => void; serviceOnline: boolean }) {
  return <><SectionTitle action={<CreateAppDialog />} count={serviceOnline ? `${installations.length} INSTALLED` : "MARKETPLACE"} description="主卡片查看详情；已安装 App 可直接开始使用。" title="应用目录" /><section><div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">已安装</h2><p className="mt-1 text-xs text-muted-foreground">已安装的 App 可创建项目或直接打开工作区。</p></div><Badge>{serviceOnline ? `${installations.length} APPS` : "SERVICE OFFLINE"}</Badge></div>{installations.length === 0 ? <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-6 text-primary" /><p className="text-sm font-medium">{serviceOnline ? "还没有已安装的 App" : "连接 service 后显示已安装 App"}</p><p className="text-xs text-muted-foreground">应用市场仍可浏览，详情页会显示当前安装状态。</p></CardContent></Card> : <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">{installations.map((app) => <InstalledAppCard app={app} key={app.package} onStartProject={onStartProject} onUpdated={onUpdated} />)}</div>}</section><section className="mt-10"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">应用市场</h2><p className="mt-1 text-xs text-muted-foreground">市场条目随工作台发布；打开详情即可安装或创建项目。</p></div><Badge>{marketplaceApps.length} AVAILABLE</Badge></div><div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">{marketplaceApps.map((app) => { const installed = installations.some((item) => item.manifest.id === app.manifest.id); return <Link className="group" href={`/apps/${encodeURIComponent(app.manifest.id)}`} key={app.manifest.id}><Card className="h-full transition-all group-hover:-translate-y-1 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-overlay)]"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><AppWindow className="size-5" /></span><Badge>{installed ? "INSTALLED" : "MARKET APP"}</Badge></div><p className="mt-5 text-base font-semibold">{app.manifest.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{app.manifest.id}</p><p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{app.manifest.description}</p><p className="mt-2 text-[11px] text-muted-foreground">作者 · {app.manifest.author} · v{app.manifest.version}</p><p className="mt-4 text-xs font-medium text-primary">查看详情</p></CardContent></Card></Link>; })}</div></section></>;
}

function InstalledAppCard({ app, onStartProject, onUpdated }: { app: Installation; onStartProject: (appID: string) => void; onUpdated: () => void }) {
  const detailHref = `/apps/${encodeURIComponent(app.manifest.id)}`;
  const status = app.dirty ? "存在本地 Git 修改，升级已保护" : app.updateAvailable ? "检测到远端更新" : app.status ?? "已是当前 Git 状态";
  return <Card className="flex min-h-72 flex-col transition-shadow hover:shadow-[var(--shadow-overlay)]"><CardContent className="flex flex-1 flex-col p-5"><div className="flex items-start justify-between gap-3"><Link aria-label={`查看 ${app.manifest.name} 详情`} className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground transition hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring" href={detailHref}><AppWindow className="size-5" /></Link><div onClick={(event) => event.stopPropagation()}><AppVersionControl app={app} onUpdated={onUpdated} /></div></div><Link className="mt-5 flex flex-1 flex-col rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" href={detailHref}><p className="text-base font-semibold">{app.manifest.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{app.manifest.id}</p><p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{app.manifest.description}</p><p className="mt-2 text-[11px] text-muted-foreground">作者 · {app.manifest.author}</p><p className="mt-3 text-xs text-muted-foreground">{status}</p><p className="mt-auto pt-4 text-xs font-medium text-primary">查看详情</p></Link></CardContent><div className="border-t px-5 py-3"><InstalledAppAction app={app} onStartProject={onStartProject} /></div></Card>;
}

function InstalledAppAction({ app, onStartProject }: { app: Installation; onStartProject: (appID: string) => void }) {
  if (app.manifest.type === "standalone") return <Link className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xs bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85" href={`/workspace-app/app?id=${encodeURIComponent(app.manifest.id)}`}><AppWindow className="size-3.5" />打开应用</Link>;
  return <Button className="w-full" onClick={() => onStartProject(app.manifest.id)} type="button"><FolderPlus className="size-3.5" />新建项目</Button>;
}

function ServiceGuide({ embedded, error, installedVersion, onConnectRemote, onUpdate, updating }: { embedded?: boolean; error?: string; installedVersion?: string; onConnectRemote: () => void; onUpdate?: () => void; updating?: boolean }) {
  if (embedded) return <Card><CardContent className="flex min-h-80 flex-col items-center justify-center gap-5 p-8 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Download className="size-6" /></span><div><p className="text-lg font-semibold">本地工作台连接中断</p><p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">当前页面由同一个 Recut service 提供；请刷新页面或检查该 service 的日志。</p></div>{error && <RepairGuide message={error} />}</CardContent></Card>;
  const message = installedVersion ? `本地 service 为 ${installedVersion}，当前工作台发布版本为 ${latestServiceVersion}。` : "Recut 的数据与执行能力仍在你的电脑上，浏览器正在等待本地 service。";
  return <Card><CardContent className="flex min-h-80 flex-col items-center justify-center gap-5 p-8 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Download className="size-6" /></span><div><p className="text-lg font-semibold">{installedVersion ? "升级本地 service" : "连接一个 service"}</p><p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{message}</p></div>{onUpdate ? <><Button disabled={updating} onClick={onUpdate} type="button">{updating ? "正在下载并重启…" : "立即更新"}</Button><code className="rounded-md border bg-muted px-4 py-2 text-xs">curl -fsSL https://recut.video/install.sh | sh</code></> : <><code className="rounded-md border bg-muted px-4 py-2 text-sm">curl -fsSL https://recut.video/install.sh | sh</code><Button onClick={onConnectRemote} type="button" variant="outline">连接已有的远程 service</Button></>}<p className="max-w-md text-xs leading-5 text-muted-foreground">{onUpdate ? "本地 daemon 会校验发布包、原子替换自身，再由 launchd 重启；旧 daemon 不支持自更新时，可使用下方命令恢复。" : <>可以安装本地 service，也可以在连接设置中填入团队或服务器提供的 HTTPS 地址。</>}</p>{error ? <RepairGuide message={error} /> : <RepairGuide message={installedVersion ? "升级过程中出现错误" : "安装本地 service 过程中出现错误"} />}</CardContent></Card>;
}

function ServiceChecking() {
  return <Card><CardContent className="grid min-h-80 place-items-center p-8 text-center"><div><span className="mx-auto block size-2 animate-pulse rounded-full bg-muted-foreground" /><p className="mt-4 text-sm text-muted-foreground">正在连接本地 service…</p></div></CardContent></Card>;
}

function SectionTitle({ action, count, description, title }: { action?: React.ReactNode; count: string; description: string; title: string }) {
  return <div className="mb-7 flex items-end justify-between"><div><p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary"><span className="size-1.5 rounded-full bg-primary" />DESKTOP</p><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div><div className="flex items-center gap-3">{action}<Badge className="border-primary/25 bg-accent text-accent-foreground">{count}</Badge></div></div>;
}

function RepairGuide({ message }: { message: string }) {
  const prompt = `Recut 本地环境遇到问题：${message}\n请先检查 service 日志、Git 状态和 manifest.json；解释根因并给出最小、可验证的修复。不要跳过现有本地修改。`;
  return <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-left"><p className="text-xs font-medium">{message}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">不要让界面猜测或直接覆盖本机状态。把诊断任务交给 Codex 或 Claude Code。</p><Button className="mt-2 h-7" onClick={() => void navigator.clipboard.writeText(prompt)} type="button" variant="outline"><Code2 className="size-3.5" />复制诊断任务</Button></div>;
}

function serviceNeedsUpgrade(installed: string, required: string) {
  if (!installed || installed === "dev" || installed === "unknown") return false;
  const parse = (value: string) => value.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(installed); const minimum = parse(required);
  for (const index of [0, 1, 2]) {
    if (current[index] < minimum[index]) return true;
    if (current[index] > minimum[index]) return false;
  }
  return false;
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? `请求失败（${response.status}）`;
}

function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : "未知错误"; }
