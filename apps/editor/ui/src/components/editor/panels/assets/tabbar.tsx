"use client";

/**
 * [INPUT]: 依赖 assets-panel-store 的顶层入口元数据与当前分类，依赖菜单组件收纳低频入口。
 * [OUTPUT]: 对外提供固定可见的顶部核心分类导航和“更多”入口菜单。
 * [POS]: editor/panels/assets 的顶层导航视图；每个入口直接决定素材面板内容，永不横向滚动。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";
import { useResizeObserver } from "@/hooks/use-resize-observer";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowRightDoubleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
	TAB_KEYS,
	type Tab,
	tabs,
	useAssetsPanelStore,
} from "@/components/editor/panels/assets/assets-panel-store";
import { t, useRecutLocale, type I18nKey } from "@/i18n";

const TAB_WIDTH = 58;
const MORE_TAB_WIDTH = 40;

export function TopNavigation() {
	const { activeTab, setActiveTab } = useAssetsPanelStore();
	const navRef = useRef<HTMLElement>(null);
	const [navWidth, setNavWidth] = useState(0);
	const { visibleTabs, moreTabs } = useVisibleTabs({ navWidth });
	const isMoreActive = moreTabs.includes(activeTab);
	const locale = useRecutLocale();

	useResizeObserver({
		ref: navRef,
		onResize: useCallback((entry) => setNavWidth(entry.contentRect.width), []),
	});

	return (
		<nav
			ref={navRef}
			aria-label={t(locale, "panel.tabbar.coreCategories")}
			className="shrink-0 overflow-hidden border-b"
		>
			<div className="flex h-16 items-stretch">
				{visibleTabs.map((tabKey) => (
					<TopNavigationItem
						key={tabKey}
						tabKey={tabKey}
						isActive={activeTab === tabKey}
						onSelect={setActiveTab}
					/>
				))}
				{moreTabs.length > 0 && (
					<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							aria-label={t(locale, "panel.tabbar.moreCategories")}
							aria-current={isMoreActive ? "page" : undefined}
							className={cn(
								"relative h-full w-10 shrink-0 rounded-none px-0",
								"after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
								isMoreActive
									? "bg-primary/8 text-primary after:bg-primary"
									: "text-muted-foreground hover:bg-accent hover:text-foreground",
							)}
						>
							<HugeiconsIcon icon={ArrowRightDoubleIcon} className="size-5" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" side="bottom">
						{moreTabs.map((tabKey) => {
							const tab = tabs[tabKey];
							return (
								<DropdownMenuItem
									key={tabKey}
									onSelect={() => setActiveTab(tabKey)}
									icon={<tab.icon />}
								>
									{t(locale, tabLabelKey(tabKey))}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
				)}
			</div>
		</nav>
	);
}

function useVisibleTabs({ navWidth }: { navWidth: number }) {
	return useMemo(() => {
		if (navWidth === 0 || navWidth >= TAB_KEYS.length * TAB_WIDTH) {
			return { visibleTabs: TAB_KEYS, moreTabs: [] as Tab[] };
		}

		const visibleCount = Math.max(
			1,
			Math.floor((navWidth - MORE_TAB_WIDTH) / TAB_WIDTH),
		);
		return {
			visibleTabs: TAB_KEYS.slice(0, visibleCount),
			moreTabs: TAB_KEYS.slice(visibleCount),
		};
	}, [navWidth]);
}

function TopNavigationItem({
	tabKey,
	isActive,
	onSelect,
}: {
	tabKey: Tab;
	isActive: boolean;
	onSelect: (tab: Tab) => void;
}) {
	const tab = tabs[tabKey];
	const locale = useRecutLocale();

	return (
		<Button
			variant="ghost"
			aria-current={isActive ? "page" : undefined}
			className={cn(
				"relative h-full min-w-14 flex-1 basis-0 flex-col gap-0.5 rounded-none px-1 text-xs font-medium",
				"after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
				isActive
					? "bg-primary/8 text-primary after:bg-primary"
					: "text-muted-foreground hover:bg-accent hover:text-foreground",
			)}
			onClick={() => onSelect(tabKey)}
		>
			<tab.icon className="size-5" />
			<span>{t(locale, tabLabelKey(tabKey))}</span>
		</Button>
	);
}

function tabLabelKey(tabKey: Tab): I18nKey {
	switch (tabKey) {
		case "media":
			return "panel.tab.media";
		case "sounds":
			return "panel.tab.sounds";
		case "text":
			return "panel.tab.text";
		case "effects":
			return "panel.tab.effects";
		case "components":
			return "panel.tab.components";
		case "captions":
			return "panel.tab.captions";
		case "settings":
			return "panel.tab.settings";
	}
}
