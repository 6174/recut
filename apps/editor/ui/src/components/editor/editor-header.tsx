/**
 * [INPUT]: 依赖宿主工作台导航桥及导出、主题控制组件
 * [OUTPUT]: 对外提供 EditorHeader，呈现产品详情入口与编辑器工具
 * [POS]: components/editor 的顶栏；不重复渲染宿主全局标题或项目名称，只呈现应用内产品入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ExportButton } from "./export-button";
import { ThemeToggle } from "../theme-toggle";
import { recut } from "@/recut/sdk";
import { t, useRecutLocale } from "@/i18n";

export function EditorHeader() {
	const locale = useRecutLocale();
	return (
		<header className="bg-background flex h-[3.4rem] items-center justify-between px-3 pt-0.5">
			<div>
				<button
					aria-label={t(locale, "header.openAppDetail")}
					className="h-8 rounded-sm px-2 text-[0.9rem] font-medium hover:bg-accent hover:text-accent-foreground"
					onClick={() => recut.navigation.openAppDetail("recut.editor")}
					type="button"
				>
					{t(locale, "header.appName")}
				</button>
			</div>
			<nav className="flex items-center gap-2">
				<ExportButton />
				<ThemeToggle />
			</nav>
		</header>
	);
}
