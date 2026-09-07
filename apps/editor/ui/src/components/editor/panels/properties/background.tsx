"use client";

import { useCallback, useState } from "react";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import { useEditor } from "@/editor/use-editor";
import { t, useRecutLocale } from "@/i18n";

export function BackgroundContent() {
	const locale = useRecutLocale();
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());

	const isColorBackground = activeProject.settings.background.type === "color";
	const currentBackgroundColor = isColorBackground
		? (activeProject.settings.background as { color: string }).color
		: DEFAULT_BACKGROUND_COLOR;

	const [draft, setDraft] = useState<string | null>(null);
	const shownColor = draft ?? currentBackgroundColor;

	const previewBackgroundColor = useCallback(
		async (color: string) => {
			await editor.project.updateSettings({
				settings: { background: { type: "color", color } },
				pushHistory: false,
			});
		},
		[editor.project],
	);

	const commitBackgroundColor = useCallback(
		async (color: string) => {
			setDraft(null);
			await editor.project.updateSettings({
				settings: { background: { type: "color", color } },
				pushHistory: true,
			});
		},
		[editor.project],
	);

	return (
		<div className="flex flex-col">
			<Section
				collapsible
				defaultOpen={false}
				sectionKey="settings:background-color"
				showTopBorder={false}
			>
				<SectionHeader>
					<SectionTitle className="flex-1">
						{t(locale, "settings.bg.colors")}
					</SectionTitle>
				</SectionHeader>
				<SectionContent className="px-3.5 pb-3 pt-3">
					<div className="flex items-center gap-2">
							<input
								type="color"
								aria-label={t(locale, "settings.bg.pickColor")}
								value={/^#[0-9a-fA-F]{6}$/.test(shownColor) ? shownColor : DEFAULT_BACKGROUND_COLOR}
								onInput={(e) => {
									const next = e.currentTarget.value;
									setDraft(next);
									void previewBackgroundColor(next);
								}}
								onChange={(e) => void commitBackgroundColor(e.currentTarget.value)}
								className="h-7 w-9 cursor-pointer rounded border border-input bg-transparent p-0.5"
							/>
							<input
								aria-label={t(locale, "settings.bg.pickColor")}
								value={(draft ?? currentBackgroundColor).replace(/^#/, "").toUpperCase()}
								onChange={(e) => {
									const next = `#${e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6)}`;
									setDraft(next);
									if (/^#[0-9a-fA-F]{6}$/.test(next)) void previewBackgroundColor(next);
								}}
								onBlur={(e) => {
									const next = `#${e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6)}`;
									if (/^#[0-9a-fA-F]{6}$/.test(next)) void commitBackgroundColor(next);
									else setDraft(null);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") e.currentTarget.blur();
									if (e.key === "Escape") setDraft(null);
								}}
								spellCheck={false}
								maxLength={6}
								className="h-7 w-20 rounded-xs border border-input bg-muted/30 px-1.5 font-mono text-[11px] uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
							/>
						</div>
				</SectionContent>
			</Section>
		</div>
	);
}
