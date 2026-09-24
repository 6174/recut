/**
 * [INPUT]: 依赖 zustand（persist 中间件）与 types（MediaAsset）
 * [OUTPUT]: useGenerateStore：生成表单状态容器（modelId/字段值/参考图/下载源）+ 原子动作（selectModel/setValue/mergeValues/setReferences/setSource）；persist 到 localStorage，刷新与切 Tab 后恢复
 * [POS]: 生成工坊 UI 的持久表单状态；GenerateTab 订阅，App 的编辑/返修回填经 store 写入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaAsset } from "../types";

interface GenerateState {
  modelId: string;
  values: Record<string, string>;
  references: MediaAsset[];
  source: string;
  selectModel: (modelId: string, defaults: Record<string, string>) => void;
  setModelId: (modelId: string) => void;
  setValue: (key: string, value: string) => void;
  mergeValues: (patch: Record<string, string>) => void;
  setValues: (values: Record<string, string>) => void;
  setReferences: (references: MediaAsset[] | ((prev: MediaAsset[]) => MediaAsset[])) => void;
  setSource: (source: string) => void;
}

export const useGenerateStore = create<GenerateState>()(
  persist(
    (set) => ({
      modelId: "",
      values: {},
      references: [],
      source: "automatic",
      selectModel: (modelId, defaults) => set({ modelId, values: defaults, references: [] }),
      setModelId: (modelId) => set({ modelId }),
      setValue: (key, value) => set((state) => ({ values: { ...state.values, [key]: value } })),
      mergeValues: (patch) => set((state) => ({ values: { ...state.values, ...patch } })),
      setValues: (values) => set({ values }),
      setReferences: (references) => set((state) => ({ references: typeof references === "function" ? references(state.references) : references })),
      setSource: (source) => set({ source }),
    }),
    {
      name: "gen-studio.generate.form",
      partialize: (state) => ({ modelId: state.modelId, values: state.values, references: state.references, source: state.source }),
    },
  ),
);
