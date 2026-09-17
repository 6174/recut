"use client";

/**
 * [INPUT]: 依赖素材面板 Store 决定当前入口，依赖各内容视图提供对应能力。
 * [OUTPUT]: 对外提供 AssetsPanel，核心分类直达内容的左侧编辑器面板。
 * [POS]: editor 的资源工作区容器；连接顶部核心分类与实际内容视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import { type Tab, useAssetsPanelStore } from "@timeline/components/editor/panels/assets/assets-panel-store";
import { TopNavigation } from "./tabbar";
import { Captions } from "@timeline/subtitles/components/assets-view";
import { MediaView } from "./views/assets";
import { TextView } from "@timeline/text/components/assets-view";
import { AudioLibraryView } from "@timeline/audio-library/components/audio-library-view";
import { ComponentLibraryView, EffectLibraryView } from "./views/component-library";

export function AssetsPanel() {
	// 只订阅 activeTab：整店订阅会让任何面板 store 变更都重渲染整个面板，
	// 而且每次渲染都会重建 6 个视图元素。
	const activeTab = useAssetsPanelStore((state) => state.activeTab);

	return (
		<div className="panel bg-panel flex h-full flex-col overflow-hidden rounded-none border-0">
			<TopNavigation />
			<div className="min-w-0 flex-1 overflow-hidden">{renderView(activeTab)}</div>
		</div>
	);
}

function renderView(tab: Tab): React.ReactNode {
	switch (tab) {
		case "media":
			return <MediaView />;
		case "sounds":
			return <AudioLibraryView />;
		case "text":
			return <TextView />;
		case "effects":
			return <EffectLibraryView />;
		case "components":
			return <ComponentLibraryView />;
		case "captions":
			return <Captions />;
	}
}
