"use client";

/**
 * [INPUT]: 依赖素材面板 Store 决定当前入口，依赖各内容视图提供对应能力。
 * [OUTPUT]: 对外提供 AssetsPanel，核心分类直达内容的左侧编辑器面板。
 * [POS]: editor 的资源工作区容器；连接顶部核心分类与实际内容视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import { type Tab, useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { TopNavigation } from "./tabbar";
import { Captions } from "@/subtitles/components/assets-view";
import { MediaView } from "./views/assets";
import { TextView } from "@/text/components/assets-view";
import { AudioLibraryView } from "@/audio-library/components/audio-library-view";
import { ComponentLibraryView, EffectLibraryView } from "./views/component-library";

export function AssetsPanel() {
	const { activeTab } = useAssetsPanelStore();

	const viewMap: Record<Tab, React.ReactNode> = {
		media: <MediaView />,
		sounds: <AudioLibraryView />,
		text: <TextView />,
		effects: <EffectLibraryView />,
		components: <ComponentLibraryView />,
		captions: <Captions />,
	};

	return (
		<div className="panel bg-panel flex h-full flex-col overflow-hidden rounded-none border-0">
			<TopNavigation />
			<div className="min-w-0 flex-1 overflow-hidden">{viewMap[activeTab]}</div>
		</div>
	);
}
