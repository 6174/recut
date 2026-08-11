/*
 * [INPUT]: 依赖 service-store 的 endpoint/online、agent-panel-context 的全局 projectID/草稿/headerHeight、useResizableSidePanel 与 ProjectAgentPanel
 * [OUTPUT]: 对外提供根布局挂载的全局工作台壳：顶部由页面渲染的 Header 横贯全宽，其下 Body 左侧为全局 Agent 对话、右侧为页面内容；左右两栏与拖动手柄共同读取 `--side-panel-width`，单实例侧栏从 headerHeight 起向下铺满并持久化宽度，只经 context 声明素材上下文与草稿
 * [POS]: components 的工作台全局壳；所有路由共享同一 ProjectAgentPanel 实例（单一全局会话，不做按页面过滤），路由切换保留会话与 SSE，不再由页面各自挂载
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { CSSProperties } from "react";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";
import { useAgentPanelContext } from "@/lib/agent-panel-context";
import { useServiceStore } from "@/lib/service-store";

export function AgentPanelHost({ children }: Readonly<{ children: React.ReactNode }>) {
  const apiBase = useServiceStore((state) => state.endpoint);
  const online = useServiceStore((state) => state.service.phase === "online");
  const projectID = useAgentPanelContext((state) => state.projectID);
  const headerHeight = useAgentPanelContext((state) => state.headerHeight);
  const draft = useAgentPanelContext((state) => state.draft);
  const pageContext = useAgentPanelContext((state) => state.pageContext);
  const { handlePointerDown, isDragging, layoutRef, panelWidth } = useResizableSidePanel({ storageKey: "recut.agent-panel-width" });
  return (
    <div className="relative flex min-h-screen min-w-0 flex-col overflow-hidden bg-background md:h-screen" ref={layoutRef} style={{ "--side-panel-width": `${panelWidth}px` } as CSSProperties}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      {isDragging && <div aria-hidden="true" className="absolute inset-0 z-[5] cursor-col-resize" />}
      <button aria-label="拖动调整对话面板宽度" className="group absolute bottom-0 left-[calc(var(--side-panel-width)_-_0.25rem)] z-10 hidden w-2 cursor-col-resize border-0 bg-transparent p-0 focus:outline-none md:block" onPointerDown={handlePointerDown} style={{ top: headerHeight }} type="button"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-foreground group-focus:w-0.5 group-focus:bg-foreground" /></button>
      <aside className="absolute bottom-0 left-0 z-0 hidden md:block" style={{ top: headerHeight, width: "var(--side-panel-width)" }}>
        <ProjectAgentPanel apiBase={apiBase} draft={draft} online={online} pageContext={pageContext} projectID={projectID} />
      </aside>
    </div>
  );
}
