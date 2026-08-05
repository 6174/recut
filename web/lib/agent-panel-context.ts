/*
 * [INPUT]: 依赖 Zustand
 * [OUTPUT]: 对外提供全局 Agent 面板上下文：当前路由的 projectID（仅用于素材上传/引导上下文）、顶部 Header 高度与宿主回填、绝不自动提交的输入草稿；页面只声明这些上下文，面板由根布局唯一挂载且为单一全局会话，不做按页面的会话过滤
 * [POS]: web/lib 的 Agent 面板全局状态；替代各页面各自挂载 ProjectAgentPanel 时的本地 draft 与 scope props，路由切换不重建面板也不切换会话
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { create } from "zustand";

type AgentPanelContext = {
  projectID: string | null;
  headerHeight: number;
  draft: { id: string; text: string } | null;
  setProjectID: (projectID: string | null) => void;
  setHeaderHeight: (headerHeight: number) => void;
  setDraft: (draft: { id: string; text: string } | null) => void;
  setContext: (context: { projectID?: string | null; headerHeight?: number }) => void;
};

export const useAgentPanelContext = create<AgentPanelContext>((set) => ({
  projectID: null,
  headerHeight: 56,
  draft: null,
  setProjectID: (projectID) => set({ projectID }),
  setHeaderHeight: (headerHeight) => set({ headerHeight }),
  setDraft: (draft) => set({ draft }),
  setContext: (context) =>
    set((state) => ({
      projectID: context.projectID !== undefined ? context.projectID : state.projectID,
      headerHeight: context.headerHeight !== undefined ? context.headerHeight : state.headerHeight,
    })),
}));
