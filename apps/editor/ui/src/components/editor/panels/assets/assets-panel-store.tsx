/**
 * [INPUT]: 依赖 Zustand 持久化素材面板的视图偏好，依赖 Hugeicons 提供顶层入口图标。
 * [OUTPUT]: 对外提供素材面板顶层分类、入口元数据与状态 Store。
 * [POS]: editor/panels/assets 的导航单一真相源，被顶部导航、分类栏和面板内容共同消费。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import type { ElementType } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	ClosedCaptionIcon,
	ComponentIcon,
	Folder03Icon,
	MagicWand05Icon,
	MusicNote03Icon,
	Settings01Icon,
	CursorTextIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

export const TAB_KEYS = [
	"media",
	"text",
	"effects",
	"components",
	"sounds",
	"captions",
	"settings",
] as const;

export type Tab = (typeof TAB_KEYS)[number];

const createHugeiconsIcon =
	({ icon }: { icon: IconSvgElement }) =>
	({ className }: { className?: string }) => (
		<HugeiconsIcon icon={icon} className={className} />
	);

// TODO(i18n): 下列 tab 中文 label 仅作数据层 fallback；可见渲染已由 tabbar.tsx 走 i18n 字典（tabLabelKey）。
export const tabs = {
	media: {
		icon: createHugeiconsIcon({ icon: Folder03Icon }),
		label: "素材",
	},
	sounds: {
		icon: createHugeiconsIcon({ icon: MusicNote03Icon }),
		label: "音频",
	},
	text: {
		icon: createHugeiconsIcon({ icon: CursorTextIcon }),
		label: "文本",
	},
	effects: {
		icon: createHugeiconsIcon({ icon: MagicWand05Icon }),
		label: "特效",
	},
	components: {
		icon: createHugeiconsIcon({ icon: ComponentIcon }),
		label: "组件",
	},
	captions: {
		icon: createHugeiconsIcon({ icon: ClosedCaptionIcon }),
		label: "字幕",
	},
	settings: {
		icon: createHugeiconsIcon({ icon: Settings01Icon }),
		label: "设置",
	},
} satisfies Record<
	Tab,
	{
		icon: ElementType<{ className?: string }>;
		label: string;
	}
>;

export type MediaViewMode = "grid" | "list";
export type MediaSortKey = "name" | "type" | "duration" | "size";
export type MediaSortOrder = "asc" | "desc";

interface AssetsPanelStore {
	activeTab: Tab;
	setActiveTab: (tab: Tab) => void;
	highlightMediaId: string | null;
	requestRevealMedia: (mediaId: string) => void;
	clearHighlight: () => void;

	/* Media */
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
	mediaSortBy: MediaSortKey;
	mediaSortOrder: MediaSortOrder;
	setMediaSort: (args: { key: MediaSortKey; order: MediaSortOrder }) => void;
}

export const useAssetsPanelStore = create<AssetsPanelStore>()(
	persist(
		(set) => ({
			activeTab: "media",
			setActiveTab: (tab) => set({ activeTab: tab }),
			highlightMediaId: null,
			requestRevealMedia: (mediaId) =>
				set({ activeTab: "media", highlightMediaId: mediaId }),
			clearHighlight: () => set({ highlightMediaId: null }),
			mediaViewMode: "grid",
			setMediaViewMode: (mode) => set({ mediaViewMode: mode }),
			mediaSortBy: "name",
			mediaSortOrder: "asc",
			setMediaSort: ({ key, order }) =>
				set({ mediaSortBy: key, mediaSortOrder: order }),
		}),
		{
			name: "assets-panel",
			partialize: (state) => ({
				mediaViewMode: state.mediaViewMode,
				mediaSortBy: state.mediaSortBy,
				mediaSortOrder: state.mediaSortOrder,
			}),
		},
	),
);
