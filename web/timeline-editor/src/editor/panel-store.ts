import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { PANEL_CONFIG } from "@timeline/panels/layout";

// 面板尺寸拖动时 setPanel 会每帧触发 persist；默认 storage 会同步 JSON.stringify +
// localStorage.setItem，是拖动卡顿的主要来源之一。这里把落盘合并成 300ms 一次。
type DebouncedStorage = {
	getItem: (name: string) => string | null;
	setItem: (name: string, value: string) => void;
	removeItem: (name: string) => void;
};

const pendingWrites = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingWrites() {
	flushTimer = null;
	if (typeof localStorage === "undefined") {
		pendingWrites.clear();
		return;
	}
	for (const [key, value] of pendingWrites) {
		try {
			localStorage.setItem(key, value);
		} catch {
			// 配额/隐私模式下静默失败：面板尺寸不是关键数据。
		}
	}
	pendingWrites.clear();
}

const debouncedStorage: DebouncedStorage = {
	getItem: (name) =>
		typeof localStorage === "undefined" ? null : localStorage.getItem(name),
	setItem: (name, value) => {
		pendingWrites.set(name, value);
		if (flushTimer) return;
		flushTimer = setTimeout(flushPendingWrites, 300);
	},
	removeItem: (name) => {
		pendingWrites.delete(name);
		if (typeof localStorage !== "undefined") localStorage.removeItem(name);
	},
};

export interface PanelSizes {
	tools: number;
	preview: number;
	properties: number;
	mainContent: number;
	timeline: number;
}

export type PanelId = keyof PanelSizes;

interface PanelState {
	panels: PanelSizes;
	setPanel: (args: { panel: PanelId; size: number }) => void;
	setPanels: (sizes: Partial<PanelSizes>) => void;
	resetPanels: () => void;
}

export const usePanelStore = create<PanelState>()(
	persist(
		(set) => ({
			...PANEL_CONFIG,
			setPanel: ({ panel, size }) =>
				set((state) => ({
					panels: {
						...state.panels,
						[panel]: size,
					},
				})),
			setPanels: (sizes) =>
				set((state) => ({
					panels: {
						...state.panels,
						...sizes,
					},
				})),
			resetPanels: () => set({ ...PANEL_CONFIG }),
		}),
		{
			name: "panel-sizes",
			version: 2,
			storage: createJSONStorage(() => debouncedStorage),
			migrate: (persistedState) => {
				const state = persistedState as
					| {
							panels?: Partial<PanelSizes> | null;
							toolsPanel?: number;
							previewPanel?: number;
							propertiesPanel?: number;
							mainContent?: number;
							timeline?: number;
							tools?: number;
							preview?: number;
							properties?: number;
					  }
					| undefined
					| null;

				if (!state) return { panels: { ...PANEL_CONFIG.panels } };

				if (state.panels && typeof state.panels === "object") {
					return {
						panels: {
							...PANEL_CONFIG.panels,
							...state.panels,
						},
					};
				}

				return {
					panels: {
						tools: state.tools ?? state.toolsPanel ?? PANEL_CONFIG.panels.tools,
						preview:
							state.preview ??
							state.previewPanel ??
							PANEL_CONFIG.panels.preview,
						properties:
							state.properties ??
							state.propertiesPanel ??
							PANEL_CONFIG.panels.properties,
						mainContent: state.mainContent ?? PANEL_CONFIG.panels.mainContent,
						timeline: state.timeline ?? PANEL_CONFIG.panels.timeline,
					},
				};
			},
			partialize: (state) => ({
				panels: state.panels,
			}),
		},
	),
);
