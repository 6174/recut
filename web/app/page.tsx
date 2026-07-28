/*
 * [INPUT]: 依赖 React 状态能力和 Daemon 的健康、项目、App 安装与 Agent Session HTTP API
 * [OUTPUT]: 对外提供 Project/Apps 两个核心 tab，以及 service 安装、版本升级和 GitHub App 管理入口
 * [POS]: web/app 的首屏控制台；Cloudflare 托管此 UI，本地 service 仍是用户数据与执行能力的唯一边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, Clapperboard, Code2, Download, FolderOpen, FolderPlus, Github, Plus } from "lucide-react";
import Link from "next/link";
import { CSSProperties, FormEvent, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { AppVersionControl } from "@/components/app-version-control";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
// 生产发布由 Makefile 将唯一的 RECUT_VERSION 注入这里；dev 回退不会触发升级判断。
const latestServiceVersion = process.env.NEXT_PUBLIC_RECUT_SERVICE_VERSION ?? "dev";

type App = { manifest: { id: string; name: string; version: string } };
type Project = { id: string; name: string; appId: string };
type Installation = {
  package: string;
  manifest: { id: string; name: string; version: string };
  repository?: string;
  revision?: string;
  dirty: boolean;
  updateAvailable: boolean;
  manageable: boolean;
  status?: string;
};

export default function Workspace() {
  const [apps, setApps] = useState<App[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [appID, setAppID] = useState("");
  const [name, setName] = useState("");
  const [projectID, setProjectID] = useState<string | null>(null);
  const [repository, setRepository] = useState("");
  const [serviceVersion, setServiceVersion] = useState("");
  const [online, setOnline] = useState(false);
  const [tab, setTab] = useState<"projects" | "apps">("projects");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [updatingService, setUpdatingService] = useState(false);
  const { handlePointerDown, layoutRef, panelWidth } = useResizableSidePanel({ storageKey: "recut.workspace-agent-panel-width" });

  useEffect(() => {
    void loadWorkspace();
    const timer = window.setInterval(() => void loadWorkspace(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function loadWorkspace() {
    try {
      const health = await fetch(`${apiBase}/health`, { cache: "no-store" });
      if (!health.ok) throw new Error("本地 service 没有响应");
      const status = await health.json() as { version?: string };
      const [appResponse, projectResponse, installationResponse] = await Promise.all([
        fetch(`${apiBase}/v1/apps`), fetch(`${apiBase}/v1/projects`), fetch(`${apiBase}/v1/apps/installed`),
      ]);
      if (!appResponse.ok || !projectResponse.ok || !installationResponse.ok) throw new Error("本地 service 返回了无效响应");
      const nextApps = await appResponse.json() as App[];
      const nextProjects = await projectResponse.json() as Project[];
      setApps(nextApps);
      setProjects(nextProjects);
      setInstallations(await installationResponse.json() as Installation[]);
      setServiceVersion(status.version ?? "unknown");
      setAppID((current) => current || nextApps[0]?.manifest.id || "");
      setProjectID((current) => current && nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id ?? null);
      setOnline(true);
    } catch {
      setOnline(false);
    }
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

  async function installApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repository.trim()) return;
    setBusy("install"); setError("");
    try {
      const response = await fetch(`${apiBase}/v1/apps/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository }) });
      if (!response.ok) throw new Error(await responseMessage(response));
      setRepository("");
      await loadWorkspace();
    } catch (cause) { setError(messageOf(cause)); } finally { setBusy(""); }
  }

  async function updateService() {
    setUpdatingService(true); setError("");
    try {
      const response = await fetch(`${apiBase}/v1/system/update`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      window.setTimeout(() => void loadWorkspace(), 1500);
    } catch (cause) { setError(messageOf(cause)); } finally { setUpdatingService(false); }
  }

  const outdated = serviceNeedsUpgrade(serviceVersion, latestServiceVersion);
  return <main className="flex h-screen min-w-[1024px] flex-col overflow-hidden bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-5">
      <div className="flex items-center gap-4"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Clapperboard className="size-4" /></span><strong className="text-sm tracking-tight">RECUT</strong><span className="h-5 w-px bg-border" /><nav aria-label="工作台" className="flex items-center gap-1"><Tab active={tab === "projects"} onClick={() => setTab("projects")}>Project</Tab><Tab active={tab === "apps"} onClick={() => setTab("apps")}>Apps</Tab><Link className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground" href="/media">素材库</Link></nav></div>
      <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground"><span className="flex items-center gap-2"><span className={online ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-warning"} />{online ? `LOCAL SERVICE ${serviceVersion}` : "LOCAL SERVICE OFFLINE"}</span><SettingsPanel /></div>
    </header>
    <div className="relative grid min-h-0 flex-1 overflow-hidden [grid-template-columns:minmax(0,1fr)_var(--side-panel-width)]" ref={layoutRef} style={{ "--side-panel-width": `${panelWidth}px` } as CSSProperties}>
      <section className="min-h-0 overflow-y-auto bg-muted/30 p-8"><div className="mx-auto max-w-6xl">
        {!online ? <ServiceGuide /> : outdated ? <ServiceGuide error={error} installedVersion={serviceVersion} onUpdate={updateService} updating={updatingService} /> : tab === "projects" ? <Projects apps={apps} name={name} onAppChange={setAppID} onNameChange={setName} onSubmit={createProject} projects={projects} selectedApp={appID} /> : <Apps installations={installations} busy={busy} error={error} onInstall={installApp} onRepositoryChange={setRepository} onUpdated={loadWorkspace} repository={repository} />}
      </div></section>
      <button aria-label="拖动调整 Agent 面板宽度" className="group absolute inset-y-0 z-10 w-2 cursor-col-resize border-0 bg-transparent p-0 focus:outline-none [left:calc(100%_-_var(--side-panel-width)_-_0.25rem)]" onPointerDown={handlePointerDown} type="button"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-foreground group-focus:w-0.5 group-focus:bg-foreground" /></button>
      <ProjectAgentPanel apiBase={apiBase} online={online} projectID={projectID} />
    </div>
  </main>;
}

function Tab({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button aria-selected={active} className={active ? "rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground" : "rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"} onClick={onClick} role="tab" type="button">{children}</button>;
}

function Projects({ apps, name, onAppChange, onNameChange, onSubmit, projects, selectedApp }: { apps: App[]; name: string; onAppChange: (value: string) => void; onNameChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; projects: Project[]; selectedApp: string }) {
  return <><SectionTitle count={`${projects.length} PROJECTS`} description="从一个项目开始，继续你的创作。" title="项目桌面" /><div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4"><form className="group flex min-h-56 flex-col rounded-xl border-2 border-dashed border-primary/35 bg-card p-5 transition hover:border-primary hover:bg-accent/40" onSubmit={onSubmit}><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><FolderPlus className="size-5" /></span><div className="mt-auto"><p className="text-base font-semibold">新建项目</p><p className="mt-1 text-xs leading-5 text-muted-foreground">选择一个 App，给你的新创作命名。</p><div className="mt-4 grid gap-2"><div><label className="mb-1 block text-[11px] font-medium" htmlFor="project-name">项目名称</label><Input className="h-8 bg-background text-xs" id="project-name" onChange={(event) => onNameChange(event.target.value)} placeholder="例如：夏季品牌片" value={name} /></div><div><label className="mb-1 block text-[11px] font-medium" htmlFor="project-app">应用</label><select className="h-8 w-full rounded-sm border bg-background px-2 text-xs focus:border-primary focus:outline-none" id="project-app" onChange={(event) => onAppChange(event.target.value)} value={selectedApp}>{apps.map((app) => <option key={app.manifest.id} value={app.manifest.id}>{app.manifest.name}</option>)}</select></div><Button className="mt-1 h-8 rounded-md bg-primary text-primary-foreground hover:bg-primary/85" disabled={!name.trim() || !selectedApp} type="submit"><Plus className="size-3.5" />创建项目</Button></div></div></form>{projects.map((project) => <Link className="group" href={`/projects/${project.id}`} key={project.id}><Card className="flex min-h-56 h-full flex-col border-transparent bg-card p-5 shadow-sm transition-all group-hover:-translate-y-1 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-overlay)]"><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><AppWindow className="size-5" /></span><Badge className="border-primary/20 bg-accent/60 text-accent-foreground">{project.appId}</Badge></div><div className="mt-auto"><p className="truncate text-base font-semibold">{project.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{project.id}</p><div className="mt-4 flex items-center gap-2 text-xs font-medium text-primary"><span className="size-1.5 rounded-full bg-primary" />继续创作</div></div></Card></Link>)}</div></>;
}

function Apps({ installations, busy, error, onInstall, onRepositoryChange, onUpdated, repository }: { installations: Installation[]; busy: string; error: string; onInstall: (event: FormEvent<HTMLFormElement>) => void; onRepositoryChange: (value: string) => void; onUpdated: () => void; repository: string }) {
  return <><SectionTitle count={`${installations.length} INSTALLED`} description="安装符合 manifest.json 契约的 GitHub Recut App；升级只执行安全的 fast-forward。" title="应用目录" /><Card className="mb-5"><CardContent className="p-5"><form className="flex gap-3" onSubmit={onInstall}><div className="min-w-0 flex-1"><label className="mb-1 block text-[11px] font-medium" htmlFor="app-repository">GitHub 地址</label><Input id="app-repository" onChange={(event) => onRepositoryChange(event.target.value)} placeholder="https://github.com/owner/recut-app" value={repository} /></div><Button className="mt-5" disabled={busy === "install" || !repository.trim()} type="submit"><Github className="size-4" />安装 App</Button></form></CardContent></Card>{error && <RepairGuide message={error} />}{installations.length === 0 ? <Card><CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><FolderOpen className="size-6 text-primary" /><p className="text-sm font-medium">还没有可用的 App</p><p className="text-xs text-muted-foreground">粘贴一个 GitHub 仓库地址；Recut 会克隆后验证根目录的 manifest.json。</p></CardContent></Card> : <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">{installations.map((app) => <Card key={app.package}><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><AppWindow className="size-5" /></span><AppVersionControl app={app} onUpdated={onUpdated} /></div><p className="mt-5 text-base font-semibold">{app.manifest.name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{app.manifest.id}</p><p className="mt-4 text-xs text-muted-foreground">{app.dirty ? "存在本地 Git 修改，升级已保护" : app.updateAvailable ? "检测到远端更新" : app.status ?? "已是当前 Git 状态"}</p><div className="mt-4 flex gap-2">{app.repository && <a className="truncate text-xs text-primary hover:underline" href={app.repository.replace(/\.git$/, "")} rel="noreferrer" target="_blank">查看仓库</a>}</div></CardContent></Card>)}</div>}</>;
}

function ServiceGuide({ error, installedVersion, onUpdate, updating }: { error?: string; installedVersion?: string; onUpdate?: () => void; updating?: boolean }) {
  const message = installedVersion ? `本地 service 为 ${installedVersion}，当前工作台发布版本为 ${latestServiceVersion}。` : "Recut 的数据与执行能力仍在你的电脑上，浏览器正在等待本地 service。";
  return <Card><CardContent className="flex min-h-80 flex-col items-center justify-center gap-5 p-8 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Download className="size-6" /></span><div><p className="text-lg font-semibold">{installedVersion ? "升级本地 service" : "先安装本地 service"}</p><p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{message}</p></div>{onUpdate ? <><Button disabled={updating} onClick={onUpdate} type="button">{updating ? "正在下载并重启…" : "立即更新"}</Button><code className="rounded-md border bg-muted px-4 py-2 text-xs">curl -fsSL https://recut.video/install.sh | sh</code></> : <code className="rounded-md border bg-muted px-4 py-2 text-sm">curl -fsSL https://recut.video/install.sh | sh</code>}<p className="max-w-md text-xs leading-5 text-muted-foreground">{onUpdate ? "本地 daemon 会校验发布包、原子替换自身，再由 launchd 重启；旧 daemon 不支持自更新时，可使用下方命令恢复。" : <>脚本只下载当前系统的 service，安装到 <code>~/.recut</code> 并注册当前用户的后台服务；重复执行即为安全升级。</>}</p>{error ? <RepairGuide message={error} /> : <RepairGuide message={installedVersion ? "升级过程中出现错误" : "安装本地 service 过程中出现错误"} />}</CardContent></Card>;
}

function SectionTitle({ count, description, title }: { count: string; description: string; title: string }) {
  return <div className="mb-7 flex items-end justify-between"><div><p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary"><span className="size-1.5 rounded-full bg-primary" />DESKTOP</p><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div><Badge className="border-primary/25 bg-accent text-accent-foreground">{count}</Badge></div>;
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
