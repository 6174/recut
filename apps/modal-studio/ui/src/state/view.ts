/**
 * [INPUT]: 依赖 zustand（persist 中间件）
 * [OUTPUT]: useViewStore：工作区视图状态（当前 Tab、Right 面板聚焦的任务 id）+ 原子动作；persist 到 localStorage
 * [POS]: modal-studio UI 的持久视图状态；App 订阅，下次打开直接回到上次的 Tab 与预览目标
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WorkbenchTab = "run" | "records";

interface ViewState {
  tab: WorkbenchTab;
  selectedTaskId: string | null;
  setTab: (tab: WorkbenchTab) => void;
  setSelectedTaskId: (id: string | null) => void;
}

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      tab: "run",
      selectedTaskId: null,
      setTab: (tab) => set({ tab }),
      setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),
    }),
    { name: "modal-studio.view" },
  ),
);
