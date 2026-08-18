/*
 * [INPUT]: 依赖 Zustand 与 Agent 面板的 Work Surface/Focus 类型
 * [OUTPUT]: 对外提供全局 Agent 面板上下文：路由签发的稳定 Work Surface、App 上报的瞬态 Focus、素材 project scope 与绝不自动提交的草稿；路由切换时清理 Focus
 * [POS]: web/lib 的全局工作面真相；路由切换不重建会话，但绝不让 iframe 选区泄漏到另一个目标
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect } from "react";
import { create } from "zustand";

import type { WorkFocusContext, WorkSurfaceContext } from "@/components/agent-panel-types";

type AgentPanelContext = {
  projectID: string | null;
  draft: { id: string; text: string } | null;
  workSurface: WorkSurfaceContext | null;
  workFocus: WorkFocusContext | null;
  setProjectID: (projectID: string | null) => void;
  setDraft: (draft: { id: string; text: string } | null) => void;
  setWorkSurface: (workSurface: WorkSurfaceContext | null) => void;
  setWorkFocus: (workFocus: WorkFocusContext | null) => void;
  clearWorkSurface: () => void;
  clearWorkFocus: () => void;
};

export const useAgentPanelContext = create<AgentPanelContext>((set) => ({
  projectID: null,
  draft: null,
  workSurface: null,
  workFocus: null,
  setProjectID: (projectID) => set({ projectID }),
  setDraft: (draft) => set({ draft }),
  setWorkSurface: (workSurface) => set({ workSurface }),
  setWorkFocus: (workFocus) => set({ workFocus }),
  clearWorkSurface: () => set({ workSurface: null }),
  clearWorkFocus: () => set({ workFocus: null }),
}));

// useReportWorkSurface declares the current route's stable target. Focus is
// deliberately cleared whenever the route changes so an iframe selection can
// never leak into a different Project, App, or World.
export function useReportWorkSurface(workSurface: WorkSurfaceContext | null) {
  const setWorkSurface = useAgentPanelContext((state) => state.setWorkSurface);
  useEffect(() => {
    setWorkSurface(workSurface);
    useAgentPanelContext.getState().clearWorkFocus();
    return () => {
      useAgentPanelContext.getState().clearWorkSurface();
      useAgentPanelContext.getState().clearWorkFocus();
    };
  }, [workSurface, setWorkSurface]);
}
