/**
 * [INPUT]: 依赖 zustand（persist 中间件）与 types（MediaAsset）
 * [OUTPUT]: useGenerateStore：工作流表单状态容器（appId/字段值/参考图/下载源）+ 原子动作（selectApp/setValue/mergeValues/setReferences/setSource）；persist 到 localStorage，刷新与切 Tab 后恢复
 * [POS]: comfyui-studio UI 的持久表单状态；WorkflowTab 订阅，App 的编辑/返修回填经 store 写入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaAsset } from "../types";

interface GenerateState {
  appId: string;
  values: Record<string, string>;
  references: MediaAsset[];
  source: string;
  selectApp: (appId: string, defaults: Record<string, string>) => void;
  setAppId: (appId: string) => void;
  setValue: (key: string, value: string) => void;
  mergeValues: (patch: Record<string, string>) => void;
  setValues: (values: Record<string, string>) => void;
  setReferences: (references: MediaAsset[] | ((prev: MediaAsset[]) => MediaAsset[])) => void;
  setSource: (source: string) => void;
}

export const useGenerateStore = create<GenerateState>()(
  persist(
    (set) => ({
      appId: "",
      values: {},
      references: [],
      source: "automatic",
      selectApp: (appId, defaults) => set({ appId, values: defaults, references: [] }),
      setAppId: (appId) => set({ appId }),
      setValue: (key, value) => set((state) => ({ values: { ...state.values, [key]: value } })),
      mergeValues: (patch) => set((state) => ({ values: { ...state.values, ...patch } })),
      setValues: (values) => set({ values }),
      setReferences: (references) => set((state) => ({ references: typeof references === "function" ? references(state.references) : references })),
      setSource: (source) => set({ source }),
    }),
    {
      name: "comfyui-studio.workflow.form",
      partialize: (state) => ({ appId: state.appId, values: state.values, references: state.references, source: state.source }),
    },
  ),
);
