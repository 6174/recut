/**
 * [INPUT]: 依赖元素选择、属性注册表和属性面板 Store。
 * [OUTPUT]: 对外提供带“画面/动画”真正 Tab 切换的 PropertiesPanel。
 * [POS]: properties 的根容器；画面与动画内容互斥渲染，动画 Tab 内再按 Enter/Exit/Loop 分组。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { getPropertiesConfig } from "./registry";
import { cn } from "@/utils/ui";
import { EmptyView } from "./empty-view";
import { t, useRecutLocale } from "@/i18n";

export function PropertiesPanel() {
	const [activeNav, setActiveNav] = useState<"visual" | "motion">("visual");
	const editor = useEditor();
	useEditor((e) => e.scenes.getActiveSceneOrNull());
	useEditor((e) => e.media.getAssets());
	const { selectedElements } = useElementSelection();
	const locale = useRecutLocale();

	if (selectedElements.length === 0) {
		return (
			<div className="panel bg-background flex h-full flex-col items-center justify-center overflow-hidden rounded-sm border">
				<EmptyView />
			</div>
		);
	}

	if (selectedElements.length > 1) {
		return (
			<div className="panel bg-background flex h-full flex-col items-center justify-center overflow-hidden rounded-sm border">
				<p className="text-muted-foreground text-sm">
					{t(locale, "prop.elementsSelected", {
						count: selectedElements.length,
					})}
				</p>
			</div>
		);
	}

	const mediaAssets = editor.media.getAssets();

	const elementsWithTracks = editor.timeline.getElementsWithTracks({
		elements: selectedElements,
	});
	const elementWithTrack = elementsWithTracks[0];

	if (!elementWithTrack) return null;

	const { element, track } = elementWithTrack;
	const config = getPropertiesConfig({ element, locale, mediaAssets });
	const visibleTabs = config.tabs;
	const motionTab = visibleTabs.find((tab) => tab.id === "motion-presets");
	const visualTabs = visibleTabs.filter((tab) => tab.id !== "motion-presets");
	const activeTab = activeNav === "motion" && motionTab ? "motion" : "visual";
	const activeMotionTab = activeTab === "motion" ? motionTab : undefined;

	return (
		<div className="panel bg-background flex h-full flex-col overflow-hidden rounded-sm border">
			<div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background/95 p-1" role="tablist" aria-label="属性面板" data-properties-nav>
				<button
					type="button"
					role="tab"
					id="properties-tab-visual"
					aria-controls="properties-panel-visual"
					aria-selected={activeTab === "visual"}
					className={cn(
						"h-8 w-20 shrink-0 rounded-xs px-3 text-sm font-medium transition-colors",
						activeTab === "visual" ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground",
					)}
					onClick={() => setActiveNav("visual")}
					data-properties-nav-target="visual"
					data-properties-nav-active={activeTab === "visual" ? "true" : "false"}
				>
					画面
				</button>
				{motionTab ? (
					<button
						type="button"
						role="tab"
						id="properties-tab-motion"
						aria-controls="properties-panel-motion"
						aria-selected={activeTab === "motion"}
						className={cn(
							"h-8 w-20 shrink-0 rounded-xs px-3 text-sm font-medium transition-colors",
							activeTab === "motion" ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground",
						)}
						onClick={() => setActiveNav("motion")}
						data-properties-nav-target="motion"
						data-properties-nav-active={activeTab === "motion" ? "true" : "false"}
					>
						动画
					</button>
				) : null}
			</div>
			<ScrollArea className="min-h-0 flex-1 scrollbar-hidden">
				{activeMotionTab ? (
					<section id="properties-panel-motion" role="tabpanel" aria-labelledby="properties-tab-motion" className="properties-block-motion" data-properties-block="motion">
						{activeMotionTab.content({ trackId: track.id })}
					</section>
				) : (
					<section id="properties-panel-visual" role="tabpanel" aria-labelledby="properties-tab-visual" className="properties-block-visual" data-properties-block="visual">
						{visualTabs.map((tab) => (
							<div key={tab.id}>{tab.content({ trackId: track.id })}</div>
						))}
					</section>
				)}
			</ScrollArea>
		</div>
	);
}
