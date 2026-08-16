/*
 * [INPUT]: 依赖 Next 路径、service-store 的 endpoint/连接阶段、工作台模式、agent-panel-context 的全局 projectID/草稿、固定 64px 工作台 Header、useResizableSidePanel 与 ProjectAgentPanel
 * [OUTPUT]: 对外提供根布局挂载的全局工作台壳：顶部由页面渲染的 64px Header 横贯全宽，其下 Body 左侧为全局 Agent 对话、右侧为页面内容；左右两栏与拖动手柄共同读取 `--side-panel-width`，单实例侧栏从固定 Header 下沿起向下铺满并持久化宽度；公开站点改用可纵向滚动的普通文档流，Marketing Host 与 cloud mode 的首次离线页均不挂载侧栏或拖拽手柄
 * [POS]: components 的工作台全局壳；所有正常工作台路由共享同一 ProjectAgentPanel 实例（单一全局会话，不做按页面过滤），路由切换保留会话与 SSE，不再由页面各自挂载；官网与首访离线页是无侧栏的产品入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { CSSProperties, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";
import { useAgentPanelContext } from "@/lib/agent-panel-context";
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
  useEffect(() => setBrowserHost(window.location.hostname), []);
  const publicSite = isPublicSitePath(pathname) || (browserHost !== null && marketingHosts.has(browserHost));
  const hostResolved = browserHost !== null;
  const showAgentPanel = hostResolved && !publicSite && (isLocalWorkspace || servicePhase !== "offline");
  useAppInstallationEvents(apiBase, !publicSite && servicePhase === "online");
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
  return pathname === "/marketing" || pathname === "/docs" || pathname?.startsWith("/docs/") || pathname === "/blog" || pathname?.startsWith("/blog/");
}
