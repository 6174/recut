/*
 * [INPUT]: 依赖 Zustand 与 Agent 面板的 PageContext 类型
 * [OUTPUT]: 对外提供全局 Agent 面板上下文：当前路由的 projectID（仅用于素材上传/引导上下文）、宿主回填、绝不自动提交的输入草稿与由页面/App 上报的当前页面上下文；useReportPageContext 让页面声明式上报并在卸载时清理
 * [POS]: web/lib 的 Agent 面板全局状态；替代各页面各自挂载 ProjectAgentPanel 时的本地 draft 与 scope props，路由切换不重建面板也不切换会话
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect } from "react";
import { create } from "zustand";

import type { PageContext } from "@/components/agent-panel-types";

type AgentPanelContext = {
  projectID: string | null;
  draft: { id: string; text: string } | null;
  pageContext: PageContext | null;
  setProjectID: (projectID: string | null) => void;
  setDraft: (draft: { id: string; text: string } | null) => void;
  setPageContext: (pageContext: PageContext | null) => void;
  clearPageContext: () => void;
};

export const useAgentPanelContext = create<AgentPanelContext>((set) => ({
  projectID: null,
  draft: null,
  pageContext: null,
  setProjectID: (projectID) => set({ projectID }),
  setDraft: (draft) => set({ draft }),
  setPageContext: (pageContext) => set({ pageContext }),
  clearPageContext: () => set({ pageContext: null }),
}));

// useReportPageContext declares the current surface's page context for the
// global Agent panel. It reports on mount and clears on unmount so a stale page
// never leaks into the next route's conversation. Pass null to opt out.
export function useReportPageContext(pageContext: PageContext | null) {
  const setPageContext = useAgentPanelContext((state) => state.setPageContext);
  useEffect(() => {
    setPageContext(pageContext);
    return () => {
      useAgentPanelContext.getState().clearPageContext();
    };
  }, [pageContext, setPageContext]);
}
