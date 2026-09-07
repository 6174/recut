/**
 * [INPUT]: 依赖项目设置与重命名 API、宿主项目名（useHostProject）、画布尺寸草稿、导出入口与背景设置视图。
 * [OUTPUT]: 对外提供 ProjectSettingsPanel，未选中元素时的右侧项目全局设置。
 * [POS]: properties 面板的默认视图；Header 区集中标题与导出入口，下方单列滚动承载名称、帧率、画面比例与背景，左侧素材面板不再承担设置职责。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { FPS_PRESETS } from "@/fps/presets";
import { floatToFrameRate, frameRateToFloat } from "@/fps/utils";
import { useEditor } from "@/editor/use-editor";
import type { EditorCore } from "@/core";
import {
	Section,
	SectionContent,
	SectionField,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { BackgroundContent } from "./background";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { usePropertyDraft } from "./hooks/use-property-draft";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { useEditorStore } from "@/editor/editor-store";
import { useHostProject } from "@/recut/use-host-project";
import { isDemoMode } from "@/demo/demo-store";
import { ExportButton } from "@/components/editor/export-button";
import { cn } from "@/utils/ui";
import { dimensionToAspectRatio } from "@/utils/geometry";
import { formatNumberForDisplay } from "@/utils/math";
import { OcSquarePlusIcon } from "@/components/icons";
import { t, useRecutLocale } from "@/i18n";
import type { TCanvasSize, TProject } from "@/project/types";

const PRESET_LABELS: Record<string, string> = {
	"1:1": "1:1",
	"16:9": "16:9",
	"9:16": "9:16",
	"4:3": "4:3",
};

function areCanvasSizesEqual({
	left,
	right,
}: {
	left: TCanvasSize;
	right: TCanvasSize;
}) {
	return left.width === right.width && left.height === right.height;
}

function formatCanvasDimension({ value }: { value: number }) {
	return formatNumberForDisplay({ value, maxFractionDigits: 0 });
}

function parseCanvasDimension({ input }: { input: string }): number | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) return null;

	const rounded = Math.round(parsed);
	return rounded > 0 ? rounded : null;
}

function useCanvasDimensionDraft({
	value,
	onCommit,
}: {
	value: number;
	onCommit: (value: number) => void;
}) {
	const [pendingValue, setPendingValue] = useState(value);

	return usePropertyDraft({
		displayValue: formatCanvasDimension({ value }),
		parse: (input) => parseCanvasDimension({ input }),
		onStartEditing: () => {
			setPendingValue(value);
		},
		onPreview: (nextValue) => {
			setPendingValue(nextValue);
		},
		onCommit: () => {
			if (pendingValue !== value) {
				onCommit(pendingValue);
			}
		},
	});
}

export function ProjectSettingsPanel() {
	const editor = useEditor();
	const locale = useRecutLocale();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const projectId = useMemo(
		() =>
			new URLSearchParams(window.location.search).get("projectId") ?? "",
		[],
	);
	const { name: hostName, rename: renameHostProject } = useHostProject({
		projectId,
	});

	// 项目名称内联编辑：聚焦进入草稿，Enter/失焦提交，Escape 取消。
	const [nameDraft, setNameDraft] = useState<string | null>(null);

	// 宿主项目名是真相源：内部文档名漂移时（如自动创建的「Untitled project」）
	// 采纳宿主名，保证导出文件名与 Agent 上下文和顶栏一致。
	useEffect(() => {
		if (isDemoMode() || !hostName || !activeProject) return;
		if (hostName !== activeProject.metadata.name) {
			void editor.project.renameProject({
				id: activeProject.metadata.id,
				name: hostName,
			});
		}
	}, [editor, hostName, activeProject]);

	if (!activeProject) return null;

	const docName = activeProject.metadata.name;
	const currentName = hostName ?? docName;
	const commitName = () => {
		const next = nameDraft?.trim();
		setNameDraft(null);
		if (!next || next === currentName) return;
		void renameHostProject(next)
			.then(() =>
				editor.project.renameProject({
					id: activeProject.metadata.id,
					name: next,
				}),
			)
			.catch((error) => {
				toast.error(t(locale, "project.failedRename"), {
					description:
						error instanceof Error
							? error.message
							: t(locale, "common.tryAgain"),
				});
			});
	};

	return (
		<div className="panel bg-panel flex h-full flex-col overflow-hidden rounded-none border-0">
			<div className="bg-background flex h-11 shrink-0 items-center justify-between border-b pl-3.5 pr-2">
				<span className="text-[13px] font-semibold tracking-wide text-foreground">
					{t(locale, "settings.projectSettings")}
				</span>
				<ExportButton />
			</div>
			<ScrollArea className="mt-2 min-h-0 flex-1 scrollbar-hidden">
				<div className="flex flex-col pb-3">
					<Section showTopBorder={false}>
						<SectionContent className="px-3.5 py-3">
							<SectionField label={t(locale, "common.name")}>
								<input
									aria-label={t(locale, "settings.name")}
									className="h-8 w-full min-w-0 rounded-xs border border-input bg-muted/30 px-2 text-sm font-medium outline-none transition-colors placeholder:text-muted-foreground hover:border-ring/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
									placeholder={t(locale, "project.untitled")}
									value={nameDraft ?? currentName}
									onFocus={() => setNameDraft(currentName)}
									onChange={(event) =>
										setNameDraft(event.target.value)
									}
									onBlur={commitName}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.currentTarget.blur();
										}
										if (event.key === "Escape") {
											setNameDraft(null);
										}
									}}
								/>
							</SectionField>
						</SectionContent>
					</Section>
					<ProjectInfoContent
						editor={editor}
						locale={locale}
						activeProject={activeProject}
					/>
					<BackgroundContent />
				</div>
			</ScrollArea>
		</div>
	);
}

/** 项目信息：帧率与画面比例（项目名称在上方 Section，导出在 Header）。 */
function ProjectInfoContent({
	editor,
	locale,
	activeProject,
}: {
	editor: EditorCore;
	locale: ReturnType<typeof useRecutLocale>;
	activeProject: TProject;
}) {
	const { canvasPresets } = useEditorStore();
	const currentCanvasSize = activeProject.settings.canvasSize;
	const canvasSizeMode = activeProject.settings.canvasSizeMode ?? "preset";
	const lastCustomCanvasSize =
		activeProject.settings.lastCustomCanvasSize ?? null;

	const presetItems = canvasPresets.map((preset, index) => {
		const ratio = dimensionToAspectRatio(preset);
		return {
			id: index.toString(),
			label: PRESET_LABELS[ratio] ?? ratio,
			ratio,
			canvasSize: preset,
		};
	});

	const selectedPresetId = canvasSizeMode === "preset"
		? (presetItems.find((preset) =>
				areCanvasSizesEqual({
					left: preset.canvasSize,
					right: currentCanvasSize,
				}),
			)?.id ?? null)
		: null;

	const updateCustomCanvasSize = ({
		canvasSize,
	}: {
		canvasSize: TCanvasSize;
	}) => {
		const shouldUpdateCanvasSize = !areCanvasSizesEqual({
			left: canvasSize,
			right: currentCanvasSize,
		});
		const shouldUpdateLastCustomCanvasSize =
			lastCustomCanvasSize === null ||
			!areCanvasSizesEqual({
				left: canvasSize,
				right: lastCustomCanvasSize,
			});
		const shouldUpdateCanvasSizeMode = canvasSizeMode !== "custom";

		if (
			!shouldUpdateCanvasSize &&
			!shouldUpdateLastCustomCanvasSize &&
			!shouldUpdateCanvasSizeMode
		) {
			return;
		}

		editor.project.updateSettings({
			settings: {
				...(shouldUpdateCanvasSize ? { canvasSize } : {}),
				...(shouldUpdateCanvasSizeMode
					? { canvasSizeMode: "custom" as const }
					: {}),
				lastCustomCanvasSize: canvasSize,
			},
		});
	};

	const selectPresetCanvasSize = ({
		canvasSize,
	}: {
		canvasSize: TCanvasSize;
	}) => {
		const shouldUpdateCanvasSize = !areCanvasSizesEqual({
			left: canvasSize,
			right: currentCanvasSize,
		});
		const shouldUpdateCanvasSizeMode = canvasSizeMode !== "preset";

		if (!shouldUpdateCanvasSize && !shouldUpdateCanvasSizeMode) return;

		editor.project.updateSettings({
			settings: {
				...(shouldUpdateCanvasSize ? { canvasSize } : {}),
				...(shouldUpdateCanvasSizeMode
					? { canvasSizeMode: "preset" as const }
					: {}),
			},
		});
	};

	const selectCustomCanvasSize = () => {
		updateCustomCanvasSize({
			canvasSize: lastCustomCanvasSize ?? currentCanvasSize,
		});
	};

	const widthDraft = useCanvasDimensionDraft({
		value: currentCanvasSize.width,
		onCommit: (width) =>
			updateCustomCanvasSize({
				canvasSize: { width, height: currentCanvasSize.height },
			}),
	});

	const heightDraft = useCanvasDimensionDraft({
		value: currentCanvasSize.height,
		onCommit: (height) =>
			updateCustomCanvasSize({
				canvasSize: { width: currentCanvasSize.width, height },
			}),
	});

	const isCustomSelected = canvasSizeMode === "custom";

	return (
		<div className="flex flex-col">
			<Section showTopBorder={false}>
				<SectionHeader className="justify-between">
					<SectionTitle className="flex-1">{t(locale, "settings.frameRate")}</SectionTitle>
					<Select
						value={String(Math.round(frameRateToFloat(activeProject.settings.fps)))}
						onValueChange={(value) => {
							const fps = floatToFrameRate(parseFloat(value));
							editor.project.updateSettings({ settings: { fps } });
						}}
						>
						<SelectTrigger className="bg-transparent border-none p-1 h-auto">
							<SelectValue placeholder={t(locale, "settings.selectFrameRate")} />
						</SelectTrigger>
						<SelectContent>
							{FPS_PRESETS.map((preset) => (
								<SelectItem key={preset.value} value={preset.value}>
									{preset.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SectionHeader>
			</Section>
			<Section
				showTopBorder={false}
				collapsible
				sectionKey="settings:aspect-ratio"
			>
				<SectionHeader>
					<SectionTitle className="flex-1">{t(locale, "settings.aspectRatio")}</SectionTitle>
				</SectionHeader>
				<SectionContent className="px-3.5 flex flex-col gap-2 pb-3 pt-3">
					<div className="grid grid-cols-3 gap-1.5">
						{presetItems.map((preset) => (
							<AspectRatioItem
								key={preset.id}
								label={preset.label}
								previewIcon={<AspectRatioPreview ratio={preset.ratio} />}
								isSelected={selectedPresetId === preset.id}
								onClick={() => {
									selectPresetCanvasSize({
										canvasSize: preset.canvasSize,
									});
								}}
							/>
						))}
						<AspectRatioItem
							key="custom"
							label={t(locale, "settings.custom")}
							previewIcon={<OcSquarePlusIcon />}
							isSelected={isCustomSelected}
							onClick={selectCustomCanvasSize}
						/>
					</div>
					{isCustomSelected && (
						<div className="flex items-center gap-2 text-foreground">
							<NumberField
								icon="W"
								value={widthDraft.displayValue}
								className="w-full"
								aria-label={t(locale, "settings.canvasWidth")}
								scrubStep={1}
								onFocus={widthDraft.onFocus}
								onChange={widthDraft.onChange}
								onBlur={widthDraft.onBlur}
								onScrub={widthDraft.scrubTo}
								onScrubEnd={widthDraft.commitScrub}
							/>
							<NumberField
								icon="H"
								value={heightDraft.displayValue}
								className="w-full"
								aria-label={t(locale, "settings.canvasHeight")}
								scrubStep={1}
								onFocus={heightDraft.onFocus}
								onChange={heightDraft.onChange}
								onBlur={heightDraft.onBlur}
								onScrub={heightDraft.scrubTo}
								onScrubEnd={heightDraft.commitScrub}
							/>
						</div>
					)}
				</SectionContent>
			</Section>
		</div>
	);
}

function AspectRatioItem({
	label,
	previewIcon,
	isSelected,
	onClick,
}: {
	label: string;
	previewIcon: React.ReactNode;
	isSelected: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			variant={isSelected ? "secondary" : "ghost"}
			className={cn(
				"relative flex h-16 flex-col items-center justify-center gap-1 px-1",
				!isSelected && "border border-transparent opacity-75!",
			)}
			onClick={onClick}
		>
			<div className="flex h-6 items-center justify-center">{previewIcon}</div>
			<span className="truncate text-xs">{label}</span>
			{isSelected && (
				<HugeiconsIcon
					icon={Tick02Icon}
					className="absolute right-1 top-1 size-3.5"
				/>
			)}
		</Button>
	);
}

function AspectRatioPreview({ ratio }: { ratio?: string }) {
	if (!ratio) return null;

	const [w, h] = ratio.split(":").map(Number);
	const maxSize = 16;
	const width = w >= h ? maxSize : (w / h) * maxSize;
	const height = h >= w ? maxSize : (h / w) * maxSize;

	return (
		<div
			style={{ width, height, borderWidth: 1.5 }}
			className="rounded-xs border-current opacity-60"
		/>
	);
}
