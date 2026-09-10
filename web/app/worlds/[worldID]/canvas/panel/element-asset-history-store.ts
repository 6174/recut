/*
 * [INPUT]: 依赖 zustand
 * [OUTPUT]: 对外提供 useElementAssetHistoryStore（画布媒体元素的「当前 asset 指针历史」）：
 * history 的本质不是"生成历史"，而是"当前素材是什么"的历史——任何来源（AI 生成产出 / 本地上传 /
 * 素材库选择 / 从历史换回）写回元素的那一刻，都记一次指针变更（elementId → assetId 有序列表，
 * 最近优先，localStorage 持久化）。资产本体永远以 /v1/media/assets 为真相，本 store 只存指针
 * [POS]: worlds/[worldID]/canvas/panel 的元素 asset 指针历史缓存
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

type ElementAssetHistoryStore = {
  histories: Record<string, string[]>;
  // 指针切换记录（换图唯一入口：写回元素的组件都调用它）
  record: (elementId: string, assetId: string) => void;
  remove: (elementId: string, assetId: string) => void;
};

export const useElementAssetHistoryStore = create<ElementAssetHistoryStore>()(
  persist(
    (set) => ({
      histories: {},
      // 记录"当前 asset 又换成了它"：去重置顶，被换下的图自然成为历史（同一索引可多元素引用）
      record: (elementId, assetId) =>
        set((state) => ({
          histories: {
            ...state.histories,
            [elementId]: [assetId, ...(state.histories[elementId] ?? []).filter((id) => id !== assetId)].slice(0, 40),
          },
        })),
      remove: (elementId, assetId) =>
        set((state) => {
          const next = (state.histories[elementId] ?? []).filter((id) => id !== assetId);
          return { histories: { ...state.histories, [elementId]: next } };
        }),
    }),
    { name: "recut.world-canvas.element-asset-histories" },
  ),
);
