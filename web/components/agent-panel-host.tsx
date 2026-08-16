/*
 * [INPUT]: 依赖 Next 路径、marketing-site / marketing-apps 公开页面、marketing-apps 静态目录、service-store 的 endpoint/连接阶段、工作台模式、agent-panel-context 的全局 projectID/草稿、固定 64px 工作台 Header、useResizableSidePanel 与 ProjectAgentPanel
 * [OUTPUT]: 对外提供根布局挂载的全局 Host 路由边界与工作台壳：SSR 与浏览器 Host 未确认时透明输出页面 children；Marketing Host 在客户端路由时直接渲染官网 Home / Apps / App 详情或 404，绝不挂载工作台页面；App Host 才渲染固定桌面 Agent 壳，左右两栏与拖动手柄共同读取 `--side-panel-width`
 * [POS]: components 的域名级路由边界与工作台全局壳；先保持 SSR 中性，避免官网首屏泄露应用壳；所有正常 App Host 路由共享同一 ProjectAgentPanel 实例（单一全局会话，不做按页面过滤）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { CSSProperties, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MarketingAppDetailContent, MarketingAppsContent } from "@/components/marketing-apps";
import { MarketingLanding, MarketingShell } from "@/components/marketing-site";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";
import { useAgentPanelContext } from "@/lib/agent-panel-context";
import { getMarketingApp } from "@/lib/marketing-apps";
import { isLocalWorkspace } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";
import { useAppInstallationEvents } from "@/components/use-app-installation-events";

const workspaceHeaderHeight = 64;
const marketingHosts = new Set(["localhost", "recut.video", "www.recut.video"]);

export function AgentPanelHost({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const apiBase = useServiceStore((state) => state.endpoint);
  const servicePhase = useServiceStore((state) => state.service.phase);
  const projectID = useAgentPanelContext((state) => state.projectID);
  const draft = useAgentPanelContext((state) => state.draft);
  const pageContext = useAgentPanelContext((state) => state.pageContext);
  const { handlePointerDown, isDragging, layoutRef, panelWidth } = useResizableSidePanel({ storageKey: "recut.agent-panel-width" });
  const [browserHost, setBrowserHost] = useState<string | null>(null);
  useLayoutEffect(() => setBrowserHost(window.location.hostname), []);
  const marketingHost = browserHost !== null && marketingHosts.has(browserHost);
  const publicSite = isPublicSitePath(pathname) || marketingHost;
  const hostResolved = browserHost !== null;
  const showAgentPanel = hostResolved && !publicSite && (isLocalWorkspace || servicePhase !== "offline");
  useAppInstallationEvents(apiBase, !publicSite && servicePhase === "online");
  if (!hostResolved) return <>{children}</>;
  if (marketingHost) return <MarketingHostRoute pathname={pathname}>{children}</MarketingHostRoute>;
  return (
    <div className={publicSite ? "min-h-screen bg-background" : "relative flex min-h-screen min-w-0 flex-col overflow-hidden bg-background md:h-screen"} ref={layoutRef} style={{ "--side-panel-width": `${panelWidth}px` } as CSSProperties}>
      <div className={publicSite ? "" : "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"}>{children}</div>
      {showAgentPanel && isDragging && <div aria-hidden="true" className="absolute inset-0 z-[5] cursor-col-resize" />}
      {showAgentPanel && <button aria-label="拖动调整对话面板宽度" className="group absolute bottom-0 left-[calc(var(--side-panel-width)_-_0.25rem)] z-10 hidden w-2 cursor-col-resize border-0 bg-transparent p-0 focus:outline-none md:block" onPointerDown={handlePointerDown} style={{ top: workspaceHeaderHeight }} type="button"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[oklch(0.9_0_0)] transition-colors group-hover:w-0.5 group-hover:bg-foreground group-focus:w-0.5 group-focus:bg-foreground" /></button>}
      {showAgentPanel && <aside className="absolute bottom-0 left-0 z-0 hidden md:block" style={{ top: workspaceHeaderHeight, width: "var(--side-panel-width)" }}>
        <ProjectAgentPanel apiBase={apiBase} draft={draft} pageContext={pageContext} projectID={projectID} servicePhase={servicePhase} />
      </aside>}
    </div>
  );
}

function isPublicSitePath(pathname: string | null) {
  return pathname === "/marketing" || pathname?.startsWith("/marketing/") || pathname === "/docs" || pathname?.startsWith("/docs/") || pathname === "/blog" || pathname?.startsWith("/blog/");
}

function MarketingHostRoute({ children, pathname }: { children: React.ReactNode; pathname: string | null }) {
  if (pathname === "/" || pathname === "/marketing" || pathname === "/marketing/") return <MarketingShell><MarketingLanding /></MarketingShell>;
  const appPath = pathname?.match(/^\/(?:marketing\/)?apps\/([^/]+)\/?$/);
  if (appPath) {
    const app = getMarketingApp(decodeURIComponent(appPath[1]));
    return app ? <MarketingShell><MarketingAppDetailContent app={app} /></MarketingShell> : <MarketingNotFound />;
  }
  if (pathname === "/apps" || pathname === "/apps/" || pathname === "/marketing/apps" || pathname === "/marketing/apps/") return <MarketingShell><MarketingAppsContent /></MarketingShell>;
  if (pathname === "/docs" || pathname?.startsWith("/docs/") || pathname === "/blog" || pathname?.startsWith("/blog/")) return <>{children}</>;
  return <MarketingNotFound />;
}

function MarketingNotFound() {
  return <MarketingShell><main className="mx-auto grid min-h-[60vh] max-w-6xl place-items-center px-5 py-16 text-center sm:px-8"><div><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">PUBLIC SITE</p><h1 className="mt-4 text-3xl font-semibold tracking-tight">这个页面不在官网中。</h1><a className="mt-7 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground" href="/">返回 Recut 官网</a></div></main></MarketingShell>;
}
