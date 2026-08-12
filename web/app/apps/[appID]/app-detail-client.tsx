/*
 * [INPUT]: 依赖静态 App Catalog、浏览器真实 URL、Next.js 路由、workspace-store 的本地 App/安装状态、安装/项目 HTTP API 与版本展示原子
 * [OUTPUT]: 对外提供静态语义化 App 详情、安装状态、市场 App 安装与项目或工作区入口
 * [POS]: apps/[appID] 的客户端交互层；应用中心由 Catalog 决定身份，用户手动安装的 App 从 workspace-store 目录发现，service 只执行用户操作
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AlertTriangle, ArrowLeft, FolderPlus, Github, HardDrive, PackageCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { AppVersionControl } from "@/components/app-version-control";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCatalogApp } from "@/lib/app-catalog";
import { useServiceStore } from "@/lib/service-store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { Workspace } from "../../page";

type Project = { id: string };
type DetailContext = { onConnectService: () => void; serviceOnline: boolean };

function appIDFromLocation(routeID: string) {
  const match = window.location.pathname.match(/^\/apps\/([^/]+)\/?$/);
  const appID = match?.[1] === "app" ? routeID : match?.[1] ?? routeID;
  try { return decodeURIComponent(appID); } catch { return appID; }
}

export default function AppDetailClient() {
  return <Workspace appDetail={(context) => <AppDetailContent {...context} />} />;
}

function AppDetailContent({ onConnectService, serviceOnline }: DetailContext) {
  const { appID: routeAppID } = useParams<{ appID: string }>();
  const router = useRouter();
  const [appID, setAppID] = useState("");
  const catalogApp = getCatalogApp(appID);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const apiBase = useServiceStore((state) => state.endpoint);
  const apps = useWorkspaceStore((state) => state.apps);
  const installations = useWorkspaceStore((state) => state.installations);
  const workspaceState = useWorkspaceStore((state) => state.state);
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const serviceApp = serviceOnline ? apps.find((item) => item.manifest.id === appID) ?? null : null;
  const installation = serviceOnline ? installations.find((item) => item.manifest.id === appID) ?? null : null;
  const app = catalogApp ?? serviceApp;
  const appRequirements = catalogApp?.requirements;

  useEffect(() => { setAppID(appIDFromLocation(routeAppID)); }, [routeAppID]);

  useEffect(() => {
    if (serviceOnline) void loadWorkspace(apiBase);
  }, [apiBase, loadWorkspace, serviceOnline]);

  async function installApp() {
    if (!app?.manifest.repository) return;
    if (!serviceOnline) {
      setError("安装 App 前，请先配置并连接一个 service。");
      onConnectService();
      return;
    }
    setInstalling(true); setError("");
    try {
      const response = await fetch(`${apiBase}/v1/apps/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository: app.manifest.repository }) });
      if (!response.ok) throw new Error(await responseMessage(response));
      await response.json();
      await loadWorkspace(apiBase, true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "安装 App 失败"); } finally { setInstalling(false); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!installation || !app || !name.trim()) return;
    setCreating(true); setError("");
    try {
      const response = await fetch(`${apiBase}/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), appId: app.manifest.id }) });
      if (!response.ok) throw new Error(await responseMessage(response));
      const project = await response.json() as Project;
      await loadWorkspace(apiBase, true);
      router.push(`/projects/${project.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建项目失败"); } finally { setCreating(false); }
  }

  const canCreateProject = Boolean(app && installation && app.manifest.type === "project");
  const canOpenWorkspace = Boolean(app && installation && app.manifest.type === "standalone");
  const loading = !appID || (!catalogApp && workspaceState === "loading");
  const unavailableMessage = serviceOnline
    ? "这个 App 不在应用中心，也没有在当前 service 中找到本地安装包。"
    : "这是本地安装的 App；连接 service 后才能读取它。";
  return <div className="mx-auto w-full max-w-3xl">{!app ? <Card><CardContent className="grid min-h-64 place-items-center gap-4 text-center text-sm text-muted-foreground">{loading ? "正在读取应用信息…" : <><p>{unavailableMessage}</p>{!serviceOnline && <Button onClick={onConnectService} type="button" variant="outline">连接 service</Button>}</>}</CardContent></Card> : <><div className="mb-7 flex items-start justify-between gap-5"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">APP DETAIL</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{app.manifest.name}</h1>        <p className="mt-2 font-mono text-xs text-muted-foreground">{app.manifest.id}</p><Link className="mt-4 inline-flex items-center gap-1.5 text-xs text-primary hover:underline" href="/apps"><ArrowLeft className="size-3.5" />返回 Apps</Link></div>{installation && <AppVersionControl app={installation} onUpdated={() => window.location.reload()} />}</div><Card><CardContent className="p-6"><div className="flex items-start gap-4"><span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"><PackageCheck className="size-5" /></span><div><p className="text-sm font-medium">{app.manifest.type === "project" ? "项目型 App" : "工作区 App"} · 作者 {app.manifest.author}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{app.manifest.description}</p><p className="mt-3 text-xs leading-5 text-muted-foreground">{installation ? app.manifest.type === "standalone" ? "已安装；直接打开即可复用同一组模板和历史。" : "此 App 已安装，可在本机安全升级。" : serviceOnline ? "尚未安装。安装后即可使用。" : "连接 service 后可确认安装状态并安装此 App。"}</p></div></div>{app.manifest.repository && <a className="mt-5 inline-flex items-center gap-1.5 text-xs text-primary hover:underline" href={app.manifest.repository.replace(/\.git$/, "")} rel="noreferrer" target="_blank"><Github className="size-3.5" />查看仓库</a>}</CardContent></Card>{appRequirements && <Card className="mt-5 border-warning/35 bg-warning/5"><CardContent className="p-6"><div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-warning/15 text-warning"><HardDrive className="size-4" /></span><div><h2 className="text-sm font-semibold">{appRequirements.title}</h2><ul className="mt-2 grid gap-1.5 text-xs leading-5 text-muted-foreground">{appRequirements.items.map((item) => <li className="flex gap-2" key={item}><AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />{item}</li>)}</ul>{appRequirements.note && <p className="mt-3 border-t border-warning/20 pt-3 text-xs leading-5 text-foreground">{appRequirements.note}</p>}</div></div></CardContent></Card>}{!installation && app.manifest.repository ? <Card className="mt-5"><CardContent className="flex items-center justify-between gap-4 p-6"><div><h2 className="text-sm font-semibold">安装此 App</h2><p className="mt-1 text-xs text-muted-foreground">安装后才会把它加入你的本地工作台。</p></div><Button disabled={installing} onClick={() => void installApp()} type="button">{installing ? "正在安装…" : "安装 App"}</Button></CardContent></Card> : canCreateProject ? <Card className="mt-5"><CardContent className="p-6"><div className="flex items-start gap-3"><FolderPlus className="mt-0.5 size-4 text-primary" /><div><h2 className="text-sm font-semibold">用此 App 创建项目</h2><p className="mt-1 text-xs text-muted-foreground">项目会绑定当前已安装版本的 {app.manifest.name}。</p></div></div><form className="mt-5 flex max-w-lg gap-3" onSubmit={createProject}><div className="min-w-0 flex-1"><label className="mb-1 block text-[11px] font-medium" htmlFor="app-project-name">项目名称</label><Input id="app-project-name" onChange={(event) => setName(event.target.value)} placeholder="例如：夏季品牌片" value={name} /></div><Button className="mt-5" disabled={!name.trim() || creating} type="submit"><FolderPlus className="size-4" />{creating ? "正在创建…" : "创建项目"}</Button></form></CardContent></Card> : canOpenWorkspace ? <Card className="mt-5"><CardContent className="flex items-center justify-between gap-4 p-6"><div><h2 className="text-sm font-semibold">直接打开工作区</h2><p className="mt-1 text-xs text-muted-foreground">模板、参考图选择和历史封面会持续保留，但不会创建项目。</p></div><Link className="inline-flex h-9 items-center rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/85" href={`/workspace-app/app?id=${encodeURIComponent(app.manifest.id)}`}>打开 App</Link></CardContent></Card> : null}{error && <p className="mt-3 text-xs text-destructive">{error}</p>}</>}</div>;
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? `请求失败（${response.status}）`;
}
