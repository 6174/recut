/**
 * [INPUT]: 依赖 zustand（persist 中间件）与 types（MediaAsset）
 * [OUTPUT]: useRunStore：**预设包分片 + 分片内再按函数分片**的表单状态容器
 *           （activeId + forms[modalappId] = { functionId, functions[functionId] = { values, references }, gpuTier }）
 *           与原子动作（selectModalapp 已有分片即恢复、selectFunction 已有函数分片即保留其输入、applyForm 覆盖回填、其余动作只改当前函数分片）；
 *           persist 到 localStorage，**切函数不再重置用户输入**，切预设包/切函数/切 Tab/刷新后各自恢复上次的表单与 GPU 档位
 *           （v0 扁平 / v1 单函数分片一次性迁移到 v2 的函数级分片，不丢用户已填内容）
 * [POS]: modal-studio UI 的持久表单状态；RunTab 订阅，App 的编辑/返修回填经 store 写入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaAsset } from "../types";

/** 单个函数在自己预设包下的表单分片：字段值 + 参考素材。 */
export interface FunctionForm {
  values: Record<string, string>;
  references: Record<string, MediaAsset[]>;
}

/** 单个预设包的分片：当前选中函数 + 每个函数各自的分片 + 该预设包记住的 GPU 档位。 */
export interface AppForm {
  functionId: string;
  functions: Record<string, FunctionForm>;
  gpuTier: string;
}

/** 稳定的空分片：预设包还没有分片时供渲染只读读取（避免每次渲染新建对象）。 */
export const EMPTY_FORM: AppForm = { functionId: "", functions: {}, gpuTier: "" };

/** 稳定的空函数分片：函数还没有分片时供渲染只读读取。 */
export const EMPTY_FN: FunctionForm = { values: {}, references: {} };

interface RunState {
  activeId: string;
  forms: Record<string, AppForm>;
  /** 切到某预设包：已有分片直接恢复（不覆盖用户填过的内容），没有才用 defaults 建一个。 */
  selectModalapp: (modalappId: string, functionId: string, defaults: Record<string, string>) => void;
  /** 预设包内切函数：已有该函数分片就保留其输入，没有才用 defaults 建一个。 */
  selectFunction: (functionId: string, defaults: Record<string, string>) => void;
  /** 用一份现成表单覆盖目标函数的输入分片（编辑/返修回填用）并把 activeId 切过去。 */
  applyForm: (modalappId: string, functionId: string, values: Record<string, string>) => void;
  setValue: (key: string, value: string) => void;
  mergeValues: (patch: Record<string, string>) => void;
  setValues: (values: Record<string, string>) => void;
  setFieldReferences: (field: string, assets: MediaAsset[] | ((prev: MediaAsset[]) => MediaAsset[])) => void;
  setReferences: (references: Record<string, MediaAsset[]>) => void;
  setGpuTier: (gpuTier: string) => void;
}

function emptyFunctionForm(defaults?: Record<string, string>): FunctionForm {
  return { values: defaults ?? {}, references: {} };
}

/** 只改当前选中的预设包分片；还没有分片时保持原状（不会凭空造出一个空分片）。 */
function patchActive(state: RunState, update: (form: AppForm) => AppForm): Partial<RunState> {
  const current = state.forms[state.activeId];
  if (!current) return {};
  return { forms: { ...state.forms, [state.activeId]: update(current) } };
}

/** 在预设包分片内改当前选中函数的分片（没有该函数分片则用空分片起步）。 */
function patchFunction(form: AppForm, update: (shard: FunctionForm) => FunctionForm): AppForm {
  const id = form.functionId;
  return { ...form, functions: { ...form.functions, [id]: update(form.functions[id] ?? emptyFunctionForm()) } };
}

/** v0/v1 的单函数结构 → v2 的函数级分片（同一份表单折到它当时的 functionId 下）。 */
function legacyAppForm(functionId: string, values?: Record<string, string>, references?: Record<string, MediaAsset[]>, gpuTier?: string): AppForm {
  return {
    functionId,
    gpuTier: gpuTier ?? "",
    functions: functionId ? { [functionId]: { values: values ?? {}, references: references ?? {} } } : {},
  };
}

export const useRunStore = create<RunState>()(
  persist(
    (set) => ({
      activeId: "",
      forms: {},
      selectModalapp: (modalappId, functionId, defaults) => set((state) => (
        state.forms[modalappId]
          ? { activeId: modalappId }
          : { activeId: modalappId, forms: { ...state.forms, [modalappId]: { functionId, gpuTier: "", functions: { [functionId]: emptyFunctionForm(defaults) } } } }
      )),
      selectFunction: (functionId, defaults) => set((state) => patchActive(state, (form) => (
        form.functions[functionId]
          ? { ...form, functionId }
          : { ...form, functionId, functions: { ...form.functions, [functionId]: emptyFunctionForm(defaults) } }
      ))),
      applyForm: (modalappId, functionId, values) => set((state) => {
        const previous = state.forms[modalappId];
        return {
          activeId: modalappId,
          forms: {
            ...state.forms,
            [modalappId]: {
              functionId,
              gpuTier: previous?.gpuTier ?? "",
              functions: { ...(previous?.functions ?? {}), [functionId]: { values, references: {} } },
            },
          },
        };
      }),
      setValue: (key, value) => set((state) => patchActive(state, (form) => patchFunction(form, (shard) => ({ ...shard, values: { ...shard.values, [key]: value } })))),
      mergeValues: (patch) => set((state) => patchActive(state, (form) => patchFunction(form, (shard) => ({ ...shard, values: { ...shard.values, ...patch } })))),
      setValues: (values) => set((state) => patchActive(state, (form) => patchFunction(form, (shard) => ({ ...shard, values })))),
      setFieldReferences: (field, assets) => set((state) => patchActive(state, (form) => patchFunction(form, (shard) => {
        const previous = shard.references[field] ?? [];
        const next = typeof assets === "function" ? assets(previous) : assets;
        return { ...shard, references: { ...shard.references, [field]: next } };
      }))),
      setReferences: (references) => set((state) => patchActive(state, (form) => patchFunction(form, (shard) => ({ ...shard, references })))),
      setGpuTier: (gpuTier) => set((state) => patchActive(state, (form) => ({ ...form, gpuTier }))),
    }),
    {
      name: "modal-studio.run.form",
      version: 2,
      // v0 是扁平结构（单个 modalappId + values/references/gpuTier），v1 起按预设包分片，
      // v2 起在每个预设包分片内再按「函数」分片——切函数不再把用户输入重置成默认值。
      migrate: (persisted, version) => {
        const raw = persisted as Record<string, unknown> | undefined;
        if (version < 1) {
          const legacy = raw as { modalappId?: string; functionId?: string; values?: Record<string, string>; references?: Record<string, MediaAsset[]>; gpuTier?: string } | undefined;
          const modalappId = legacy?.modalappId ?? "";
          if (!modalappId) return { activeId: "", forms: {} };
          return { activeId: modalappId, forms: { [modalappId]: legacyAppForm(legacy?.functionId ?? "", legacy?.values, legacy?.references, legacy?.gpuTier) } };
        }
        const forms: Record<string, AppForm> = {};
        for (const [id, slice] of Object.entries((raw?.forms ?? {}) as Record<string, { functionId?: string; values?: Record<string, string>; references?: Record<string, MediaAsset[]>; gpuTier?: string }>)) {
          forms[id] = legacyAppForm(slice?.functionId ?? "", slice?.values, slice?.references, slice?.gpuTier);
        }
        return { activeId: (raw?.activeId as string) ?? "", forms };
      },
      partialize: (state) => ({ activeId: state.activeId, forms: state.forms }),
    },
  ),
);
