/*
 * [INPUT]: 依赖 React 状态能力、Zustand 共享的 Daemon 与按数据域区分失败原因的工作台目录状态、静态 App Catalog、Agent Session HTTP API 及全局 Agent 面板上下文
 * [OUTPUT]: 对外提供 Studio、Projects、Assets、Apps 四个独立入口及保持根壳的一级 Tab 切换、固定使用通用会话上下文的 Agent 面板（由根布局全局挂载，本页只声明作用域）、Studio 的日期稳定随机创作场景卡与新手/继续创作帮助入口（点击只回填左侧创作输入框，绝不自动提交）、紧凑最近项目卡（按 App 设置的图片/视频封面渲染）与最近资源外显、可预览的项目 App 选择与详情入口、Git 仓库安装入口、已安装 App 的单个与聚合升级动作、为项目型 App 弹框创建项目、直接打开工作区型 App、安装列表的明确读取/失败/空态和无外框的 service 连接/诊断空态
 * [POS]: web/app 的主工作台框架；Studio 是默认创作入口，工作台目录由 lib/workspace-store 跨路由缓存，创建、安装、升级后显式刷新，绝不 5 秒轮询；Agent 面板不在此挂载，只经 agent-panel-context 声明会话作用域
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, ArrowRight, Box, Captions, Check, ChevronDown, Clapperboard, Code2, Copy, Download, ExternalLink, FileImage, FolderOpen, FolderPlus, ImageIcon, LoaderCircle, Music2, Plus, Sparkles, Store, Video, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, MouseEvent, useEffect, useLayoutEffect, useMemo, useState } from "react";

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
  const installationsState = useWorkspaceStore((state) => state.installationsState);
  const installationsError = useWorkspaceStore((state) => state.installationsError);
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
    useAgentPanelContext.getState().setProjectID(agentProjectID);
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
    function syncTabFromHistory() {
      const next = tabFromPath(window.location.pathname);
      if (next) setTab(next);
    }
    window.addEventListener("popstate", syncTabFromHistory);
    return () => window.removeEventListener("popstate", syncTabFromHistory);
  }, []);

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

  function navigateTab(next: WorkspaceTab, href: string, event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (window.location.pathname !== href) window.history.pushState(null, "", href);
    setTab(next);
  }

  const detail = appDetail?.({ onConnectService: openServiceSettings, serviceOnline: online });
  const appInstallationLoadState: InstallationLoadState = online ? installationsState : service.phase === "checking" ? "loading" : "offline";
  const content = detail ?? (tab === "apps" ? <Apps apiBase={apiBase} installations={installations} installationError={installationsError} installationLoadState={appInstallationLoadState} onStartProject={openCreateProject} onUpdated={reloadWorkspace} serviceOnline={online} />
    : service.phase === "checking" ? <ServiceChecking />
    : !online ? <ServiceGuide embedded={isLocalWorkspace} error={service.error} onConnectRemote={openServiceSettings} />
    : tab === "studio" ? <Studio apiBase={apiBase} installations={installations} onCompose={(text) => useAgentPanelContext.getState().setDraft({ id: `${Date.now()}`, text })} onStartProject={openCreateProject} projects={projects} />
      : tab === "projects" ? <ProjectsPage apps={installations.filter((app) => app.manifest.type === "project")} name={name} onAppChange={setAppID} onNameChange={setName} onSubmit={createProject} projects={projects} selectedApp={appID} />
        : <MediaLibraryPanel onOpenProviderSettings={openMediaProviderSettings} onProjectIDChange={setMediaProjectID} />);
  return <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-4 md:px-5">
      <div className="flex min-w-0 items-center gap-3 md:gap-4"><span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg"><img alt="Recut" className="size-full object-cover" src="/logo.jpg" /></span><span className="hidden h-5 w-px bg-border sm:block" /><nav aria-label="工作台" className="flex min-w-0 items-center gap-0.5 sm:gap-1"><Tab active={tab === "studio"} href="/" onNavigate={navigateTab} tab="studio">Studio</Tab><Tab active={tab === "projects"} href="/projects" onNavigate={navigateTab} tab="projects">Projects</Tab><Tab active={tab === "assets"} href="/media" onNavigate={navigateTab} tab="assets">Assets</Tab><Tab active={tab === "apps"} href="/apps" onNavigate={navigateTab} tab="apps">Apps</Tab></nav></div>
      <div className="hidden md:block"><HeaderActions onSettingsOpenChange={changeSettingsOpen} settingsOpen={settingsOpen} settingsSection={settingsSection} /></div>
    </header>
    <div className="min-h-0 flex-1 overflow-hidden md:pl-[var(--side-panel-width)]">
      {online && tab === "assets" ? content : <section className="h-full min-h-0 overflow-y-auto bg-muted/30 p-4 sm:p-6 md:p-8"><div className="mx-auto max-w-6xl">{content}</div></section>}
    </div>
    {createApp && <CreateProjectFromAppDialog app={createApp} onClose={() => setCreateApp(null)} onCreate={async (projectName) => createProjectWithApp(createApp, projectName)} />}
  </main>;
}

export default Workspace;

function tabFromPath(pathname: string): WorkspaceTab | null {
  if (pathname === "/") return "studio";
  if (pathname === "/projects" || pathname === "/projects/") return "projects";
  if (pathname === "/media" || pathname === "/media/") return "assets";
  if (pathname === "/apps" || pathname === "/apps/") return "apps";
  return null;
}

function Tab({ active, children, href, onNavigate, tab }: { active: boolean; children: React.ReactNode; href: string; onNavigate: (tab: WorkspaceTab, href: string, event: MouseEvent<HTMLAnchorElement>) => void; tab: WorkspaceTab }) {
  return <a aria-current={active ? "page" : undefined} className={active ? "rounded-lg bg-accent px-2 py-1.5 text-[11px] font-semibold text-accent-foreground sm:px-2.5 sm:text-xs" : "rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:px-2.5 sm:text-xs"} href={href} onClick={(event) => onNavigate(tab, href, event)}>{children}</a>;
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

const STUDIO_PROMPT_TEMPLATES = [
  {
    icon: Clapperboard,
    title: "把一段文字做成视频",
    description: "从你的故事或脚本开始，慢慢拼成一支短片。",
    prompt: "请根据下面这段脚本规划并制作一支完整视频。先梳理叙事结构、镜头清单和节奏，再给出可执行的生成与剪辑计划：\n\n[在这里粘贴脚本]",
  },
  {
    icon: Video,
    title: "给现有视频补一些画面",
    description: "补上细节和衔接画面，让故事看起来更完整。",
    prompt: "我正在制作一支视频，请为下面的内容规划并生成一组衔接主线的画面。每个画面请说明内容、运动、时长和它在故事里的作用：\n\n[描述主题、脚本或已有主镜头]",
  },
  {
    icon: ImageIcon,
    title: "做一支剪纸风格动画",
    description: "用纸片、纹理和手作感讲一个小故事。",
    prompt: "我想做一支剪纸风格的小动画。请帮我想好故事、画面、色彩和镜头节奏，再开始制作：[填写主题、人物、时长和想要的感觉]",
  },
  {
    icon: Sparkles,
    title: "给产品拍一条短片",
    description: "把亮点、细节和使用场景讲清楚。",
    prompt: "请帮我策划一支产品发布短片。先提炼核心卖点与受众，再输出 30 秒的分镜、旁白和视觉生成提示词：\n\n[填写产品、卖点、受众和发布场景]",
  },
  {
    icon: Sparkles,
    title: "做一支 Remotion 视频",
    description: "用清爽的动态画面，把一个主题讲明白。",
    prompt: "我想做一支 Remotion 视频。请根据下面的主题，帮我想好画面、文字、节奏和转场，再开始制作：[填写主题、时长、风格和想传达的重点]",
  },
  {
    icon: Captions,
    title: "把数据讲成一支视频",
    description: "让数字、图表和结论变得一目了然。",
    prompt: "请制作一支数据解说视频。将下面的数据转成有节奏的图表动效、关键结论和旁白，并制作一支可编辑的视频：[填写数据、观点、时长和受众]",
  },
  {
    icon: Video,
    title: "给产品补一些好看的画面",
    description: "拍出细节、材质和真正被使用的瞬间。",
    prompt: "请为下面的产品设计一组高质感画面。覆盖开场、细节特写、使用场景与收束画面，并为每个画面写出可生成的视频提示词：[填写产品、材质、使用场景和风格参考]",
  },
  {
    icon: Clapperboard,
    title: "把一个人的故事剪成短片",
    description: "让采访、日常和细节连成一个故事。",
    prompt: "请把下面的人物与素材方向策划成一支人物故事短片。输出故事主线、采访问题、配套画面和剪辑节奏：[填写人物、故事、现有素材与目标时长]",
  },
  {
    icon: Sparkles,
    title: "给短视频想一个好开头",
    description: "先在前三秒抓住观众，再慢慢把话讲完。",
    prompt: "请为下面的主题设计 5 个适合短视频的前三秒开场方案。每个方案包含画面、屏幕文案、旁白、音效节奏和后续画面的衔接：[填写主题、平台和目标观众]",
  },
  {
    icon: Clapperboard,
    title: "做一支教程演示视频",
    description: "把步骤、重点和操作过程讲得清清楚楚。",
    prompt: "请制作一支教程演示视频。根据下面的步骤规划屏幕录制、重点标注、字幕、转场和时间轴，再制作一支可编辑的视频：[填写教程主题、步骤、时长和画面素材]",
  },
  {
    icon: Video,
    title: "做一段循环的氛围视频",
    description: "给音乐、活动或页面添一点会呼吸的画面。",
    prompt: "请为下面的主题设计一支可无缝循环的氛围背景视频。明确镜头运动、色彩、循环衔接点和生成提示词：[填写使用场景、时长、画幅和情绪关键词]",
  },
  {
    icon: ImageIcon,
    title: "做一个好看的视频封面",
    description: "用一张画面先让人愿意点开。",
    prompt: "请为下面这支视频设计 3 个有吸引力的封面方向。每个方向包含构图、主体、标题文案、色彩和可直接用于生成图片的提示词：[描述视频主题与目标观众]",
  },
];

const STUDIO_HELP_PROMPTS = [
  { title: "认识 Recut", prompt: "我是第一次使用 Recut。请用简单的话告诉我这里能做什么，并带我从一个最适合的新手视频开始。" },
  { title: "做我的第一支视频", prompt: "我想从零开始做我的第一支视频。请先问我几个简单的问题，再带我一步一步开始。" },
  { title: "找回上次的创作", prompt: "我想继续上次的创作。请帮我看看现在可以从哪里接着做。" },
];

function promptTemplatesForToday() {
  const templates = [...STUDIO_PROMPT_TEMPLATES];
  let seed = Math.floor(Date.now() / 86_400_000) >>> 0;
  for (let index = templates.length - 1; index > 0; index -= 1) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    const swapIndex = seed % (index + 1);
    [templates[index], templates[swapIndex]] = [templates[swapIndex], templates[index]];
  }
  return templates.slice(0, 4);
}

function Studio({ apiBase, installations, onCompose, onStartProject, projects }: { apiBase: string; installations: Installation[]; onCompose: (text: string) => void; onStartProject: (app: Installation) => void; projects: Project[] }) {
  const recentProjects = projects.slice(0, 4);
  const [promptTemplates, setPromptTemplates] = useState(() => STUDIO_PROMPT_TEMPLATES.slice(0, 4));
  useEffect(() => setPromptTemplates(promptTemplatesForToday()), []);
  return <div className="pb-10">
    <section className="relative min-h-[21rem] overflow-hidden border-b border-border pb-8 pt-7 sm:min-h-[23rem]">
      <WebGLStudioHero />
      <div className="relative z-10 max-w-xl">
      <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">GOOD MORNING · STUDIO</p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight">你的 AI 创作工作站</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{inspirationForToday()}</p>
      <div className="mt-7">
        <div><h2 className="text-lg font-semibold">今天想做什么？</h2><p className="mt-1 text-sm text-muted-foreground">从一个你已经有感觉的画面开始。</p></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{promptTemplates.map(({ description, icon: Icon, prompt, title }) => <button aria-label={`从「${title}」开始`} className="group flex min-h-[7.75rem] flex-col rounded-lg border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" key={title} onClick={() => onCompose(prompt)} type="button"><span className="grid size-7 place-items-center rounded-sm bg-accent text-accent-foreground"><Icon className="size-3.5" /></span><p className="mt-2 text-sm font-semibold">{title}</p><p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">{description}</p><span className="mt-auto flex items-center gap-1.5 pt-2 text-xs font-medium text-primary">从这里开始<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span></button>)}</div>
        <div className="mt-5 rounded-lg border bg-card p-4 shadow-sm"><p className="text-sm font-semibold">第一次来这里？</p><p className="mt-1 text-xs text-muted-foreground">从认识 Recut 或做第一支视频开始。</p><div className="mt-3 flex flex-wrap gap-2">{STUDIO_HELP_PROMPTS.map(({ prompt, title }) => <button className="inline-flex items-center gap-1.5 rounded-sm border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/35 hover:text-primary" key={title} onClick={() => onCompose(prompt)} type="button">{title}<ArrowRight className="size-3" /></button>)}</div></div>
      </div>
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
  const [copied, setCopied] = useState(false);
  const title = embedded ? "本地工作台连接中断" : "启动一个 service";
  const description = embedded ? "当前页面由同一个 Recut service 提供；请刷新页面或检查该 service 的日志。" : "Recut 的数据与执行能力仍在你的电脑上。安装后会自动启动本地 service。";
  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText("curl -fsSL https://recut.video/install.sh | sh");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }
  return <section className="mx-auto flex min-h-[30rem] max-w-2xl flex-col items-center justify-center py-12 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Download className="size-6" /></span><p className="mt-6 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">LOCAL SERVICE</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{description}</p>{!embedded && <><div className="mt-7 flex w-full max-w-xl items-center overflow-hidden rounded-lg bg-foreground text-left text-primary-foreground shadow-sm"><code className="min-w-0 flex-1 overflow-x-auto px-4 py-3 font-mono text-xs">curl -fsSL https://recut.video/install.sh | sh</code><button aria-label="复制安装命令" className="flex h-11 shrink-0 items-center gap-1.5 border-l border-primary-foreground/15 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85" onClick={() => void copyInstallCommand()} type="button"><Copy className="size-3.5" />{copied ? "已复制" : "复制"}</button></div><button className="mt-5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground" onClick={onConnectRemote} type="button">连接已有的远程 service</button><p className="mt-2 text-xs leading-5 text-muted-foreground">也可以在连接设置中填入团队或服务器提供的 HTTPS 地址。</p></>}{error && <div className="mt-8 w-full max-w-2xl"><RepairGuide message={error} /></div>}</section>;
}

function ServiceChecking() {
  return <section aria-busy="true" aria-label="正在连接本地 service" className="grid min-h-80 place-items-center p-8 text-center"><div><span className="mx-auto block size-2 animate-pulse rounded-full bg-muted-foreground" /><p className="mt-4 text-sm text-muted-foreground">正在连接本地 service…</p></div></section>;
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
