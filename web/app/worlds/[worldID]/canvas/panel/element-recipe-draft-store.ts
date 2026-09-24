/*
 * [INPUT]: 依赖 zustand（含 persist）
 * [OUTPUT]: 对外提供 useElementRecipeDraftStore（画布媒体元素的「生成配方草稿」）：
 * 按 elementId 保存 prompt / modelId / withCurrentRef / references / params / voiceId 与 edited 标记，
 * localStorage 持久化。用于「手动生成」面板在切换节点（面板卸载重挂）后恢复用户已填内容，
 * 并在换图继承 metadata 时区分「用户已编辑」与「程序化回填」
 * [POS]: worlds/[worldID]/canvas/panel 的生成配方草稿缓存（资产真相仍在 /v1/media/assets）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RecipeReference = { id: string; name?: string; kind?: string };

export type RecipeDraft = {
  prompt: string;
  modelId: string;
  withCurrentRef: boolean;
  references: RecipeReference[];
  params: Record<string, unknown>;
  voiceId: string;
  // 用户是否亲手编辑过配方：为真时换图继承的 metadata 不再覆盖
  edited: boolean;
};

type ElementRecipeDraftStore = {
  drafts: Record<string, RecipeDraft>;
  setDraft: (elementId: string, patch: Partial<RecipeDraft>) => void;
  clearDraft: (elementId: string) => void;
};

export const EMPTY_RECIPE_DRAFT: RecipeDraft = {
  prompt: "",
  modelId: "",
  withCurrentRef: true,
  references: [],
  params: {},
  voiceId: "",
  edited: false,
};

export const useElementRecipeDraftStore = create<ElementRecipeDraftStore>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (elementId, patch) =>
        set((state) => ({
          drafts: {
            ...state.drafts,
            [elementId]: { ...(state.drafts[elementId] ?? EMPTY_RECIPE_DRAFT), ...patch },
          },
        })),
      clearDraft: (elementId) =>
        set((state) => {
          const next = { ...state.drafts };
          delete next[elementId];
          return { drafts: next };
        }),
    }),
    { name: "recut.world-canvas.element-recipe-drafts" },
  ),
);
