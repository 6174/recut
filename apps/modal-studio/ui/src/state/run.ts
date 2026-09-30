/**
 * [INPUT]: 依赖 zustand（persist 中间件）与 types（MediaAsset）
 * [OUTPUT]: useRunStore：**按预设包分片**的表单状态容器（activeId + forms[modalappId] = { functionId, values, references, gpuTier }）
 *           与原子动作（selectModalapp 已有分片即恢复、applyForm 覆盖回填、其余动作只改当前分片）；persist 到 localStorage，
 *           切预设包/切函数/切 Tab/刷新后各预设包都恢复上次的表单与 GPU 档位（v0 扁平结构一次性迁移成分片，不丢用户已填内容）
 * [POS]: modal-studio UI 的持久表单状态；RunTab 订阅，App 的编辑/返修回填经 store 写入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaAsset } from "../types";

/** 单个预设包的表单分片：字段值 + 参考素材 + 该预设包自己记住的 GPU 档位。 */
export interface AppForm {
  functionId: string;
  values: Record<string, string>;
  references: Record<string, MediaAsset[]>;
  gpuTier: string;
}

/** 稳定的空分片：预设包还没有分片时供渲染只读读取（避免每次渲染新建对象）。 */
export const EMPTY_FORM: AppForm = { functionId: "", values: {}, references: {}, gpuTier: "" };

interface RunState {
  activeId: string;
  forms: Record<string, AppForm>;
  /** 切到某预设包：已有分片直接恢复（不覆盖用户填过的内容），没有才用 defaults 建一个。 */
  selectModalapp: (modalappId: string, functionId: string, defaults: Record<string, string>) => void;
  /** 预设包内换函数：只重置字段与参考素材（函数间表单结构不同），GPU 档位保留。 */
  selectFunction: (functionId: string, defaults: Record<string, string>) => void;
  /** 用一份现成表单覆盖目标预设包的分片（编辑/返修回填用）并把 activeId 切过去。 */
  applyForm: (modalappId: string, functionId: string, values: Record<string, string>) => void;
  setValue: (key: string, value: string) => void;
  mergeValues: (patch: Record<string, string>) => void;
  setValues: (values: Record<string, string>) => void;
  setFieldReferences: (field: string, assets: MediaAsset[] | ((prev: MediaAsset[]) => MediaAsset[])) => void;
  setReferences: (references: Record<string, MediaAsset[]>) => void;
  setGpuTier: (gpuTier: string) => void;
}

/** 只改当前选中的分片；还没有分片时保持原状（不会凭空造出一个空分片）。 */
function patchActive(state: RunState, update: (form: AppForm) => AppForm): Partial<RunState> {
  const current = state.forms[state.activeId];
  if (!current) return {};
  return { forms: { ...state.forms, [state.activeId]: update(current) } };
}

export const useRunStore = create<RunState>()(
  persist(
    (set) => ({
      activeId: "",
      forms: {},
      selectModalapp: (modalappId, functionId, defaults) => set((state) => (
        state.forms[modalappId]
          ? { activeId: modalappId }
          : { activeId: modalappId, forms: { ...state.forms, [modalappId]: { functionId, values: defaults, references: {}, gpuTier: "" } } }
      )),
      selectFunction: (functionId, defaults) => set((state) => patchActive(state, (form) => ({ ...form, functionId, values: defaults, references: {} }))),
      applyForm: (modalappId, functionId, values) => set((state) => ({
        activeId: modalappId,
        forms: { ...state.forms, [modalappId]: { functionId, values, references: {}, gpuTier: state.forms[modalappId]?.gpuTier ?? "" } },
      })),
      setValue: (key, value) => set((state) => patchActive(state, (form) => ({ ...form, values: { ...form.values, [key]: value } }))),
      mergeValues: (patch) => set((state) => patchActive(state, (form) => ({ ...form, values: { ...form.values, ...patch } }))),
      setValues: (values) => set((state) => patchActive(state, (form) => ({ ...form, values }))),
      setFieldReferences: (field, assets) => set((state) => patchActive(state, (form) => {
        const previous = form.references[field] ?? [];
        const next = typeof assets === "function" ? assets(previous) : assets;
        return { ...form, references: { ...form.references, [field]: next } };
      })),
      setReferences: (references) => set((state) => patchActive(state, (form) => ({ ...form, references }))),
      setGpuTier: (gpuTier) => set((state) => patchActive(state, (form) => ({ ...form, gpuTier }))),
    }),
    {
      name: "modal-studio.run.form",
      version: 1,
      // v0 是扁平结构（单个 modalappId + values/references/gpuTier），v1 起按预设包分片。
      // 折成一份分片即可，免得升级后第一次打开把用户刚填的表单丢掉。
      migrate: (persisted, version) => {
        const legacy = persisted as Partial<{ modalappId: string; functionId: string; values: Record<string, string>; references: Record<string, MediaAsset[]>; gpuTier: string }> | undefined;
        const modalappId = legacy?.modalappId ?? "";
        if (version >= 1 || !modalappId) return { activeId: "", forms: {} };
        return {
          activeId: modalappId,
          forms: {
            [modalappId]: {
              functionId: legacy?.functionId ?? "",
              values: legacy?.values ?? {},
              references: legacy?.references ?? {},
              gpuTier: legacy?.gpuTier ?? "",
            },
          },
        };
      },
      partialize: (state) => ({ activeId: state.activeId, forms: state.forms }),
    },
  ),
);
