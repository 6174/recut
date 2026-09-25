/**
 * [INPUT]: 依赖 zustand（persist 中间件）与 types（MediaAsset）
 * [OUTPUT]: useRunStore：预设包/函数表单状态容器（modalappId/functionId/字段值/参考图/权重来源/GPU 档位）+ 原子动作；persist 到 localStorage，刷新与切 Tab 后恢复
 * [POS]: modal-studio UI 的持久表单状态；RunTab 订阅，App 的编辑/返修回填经 store 写入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaAsset } from "../types";

interface RunState {
  modalappId: string;
  functionId: string;
  values: Record<string, string>;
  references: MediaAsset[];
  source: string;
  gpuTier: string;
  selectModalapp: (modalappId: string, functionId: string, defaults: Record<string, string>) => void;
  selectFunction: (functionId: string, defaults: Record<string, string>) => void;
  setValue: (key: string, value: string) => void;
  mergeValues: (patch: Record<string, string>) => void;
  setValues: (values: Record<string, string>) => void;
  setReferences: (references: MediaAsset[] | ((prev: MediaAsset[]) => MediaAsset[])) => void;
  setSource: (source: string) => void;
  setGpuTier: (gpuTier: string) => void;
}

export const useRunStore = create<RunState>()(
  persist(
    (set) => ({
      modalappId: "",
      functionId: "",
      values: {},
      references: [],
      source: "automatic",
      gpuTier: "",
      selectModalapp: (modalappId, functionId, defaults) => set({ modalappId, functionId, values: defaults, references: [] }),
      selectFunction: (functionId, defaults) => set({ functionId, values: defaults, references: [] }),
      setValue: (key, value) => set((state) => ({ values: { ...state.values, [key]: value } })),
      mergeValues: (patch) => set((state) => ({ values: { ...state.values, ...patch } })),
      setValues: (values) => set({ values }),
      setReferences: (references) => set((state) => ({ references: typeof references === "function" ? references(state.references) : references })),
      setSource: (source) => set({ source }),
      setGpuTier: (gpuTier) => set({ gpuTier }),
    }),
    {
      name: "modal-studio.run.form",
      partialize: (state) => ({ modalappId: state.modalappId, functionId: state.functionId, values: state.values, references: state.references, source: state.source, gpuTier: state.gpuTier }),
    },
  ),
);
