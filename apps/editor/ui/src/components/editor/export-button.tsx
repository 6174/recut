/**
 * [INPUT]: 依赖编辑器项目状态、导出服务、Popover 表单与基础 UI 控件
 * [OUTPUT]: 对外提供 ExportButton，使用霓虹发光触发器打开并控制项目导出流程
 * [POS]: components/editor 的导出入口；只负责导出交互，不承载项目名称或宿主导航
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/utils/ui";
import {
	getExportMimeType,
	getExportFileExtension,
	downloadBuffer,
} from "@/export";
import { Check, Copy, Download } from "lucide-react";
import {
	EXPORT_FORMAT_VALUES,
	EXPORT_QUALITY_VALUES,
	type ExportFormat,
	type ExportQuality,
} from "@/export";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { CoverPicker } from "./cover-picker";
import { useEditor } from "@/editor/use-editor";
import { DEFAULT_EXPORT_OPTIONS } from "@/export/defaults";
import { t, useRecutLocale } from "@/i18n";

function isExportFormat(value: string): value is ExportFormat {
	return EXPORT_FORMAT_VALUES.some((formatValue) => formatValue === value);
}

function isExportQuality(value: string): value is ExportQuality {
	return EXPORT_QUALITY_VALUES.some((qualityValue) => qualityValue === value);
}

/** 帧率对应的目标单帧预算（毫秒）：1000 / fps。 */
function formatTimecodeRateMs(fps: { numerator: number; denominator: number }): number {
	return (1000 * fps.denominator) / fps.numerator;
}

export function ExportButton() {
	const [isExportPopoverOpen, setIsExportPopoverOpen] = useState(false);
	const locale = useRecutLocale();
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const hasProject = !!activeProject;
	const isExporting = useEditor((e) => e.project.getExportState().isExporting);

	// 导出开始后收起设置 Popover，改由全局不可关闭模态接管，避免导出期间误编辑。
	useEffect(() => {
		if (isExporting) setIsExportPopoverOpen(false);
	}, [isExporting]);

	const handlePopoverOpenChange = ({ open }: { open: boolean }) => {
		if (!open) {
			// 导出进行中收起 Popover（由 isExporting effect 触发）时，
			// 不清导出状态，否则模态会立即关闭。只有用户手动关闭设置时才清理。
			const isExporting = editor.project.getExportState().isExporting;
			if (!isExporting) {
				editor.project.cancelExport();
				editor.project.clearExportState();
			}
		}
		setIsExportPopoverOpen(open);
	};

	return (
		<>
			<Popover
				open={isExportPopoverOpen}
				onOpenChange={(open) => handlePopoverOpenChange({ open })}
			>
				<PopoverTrigger asChild>
					<button
						type="button"
						className={cn(
							"export-neon-button group relative isolate inline-flex rounded-full p-px text-white transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97]",
							hasProject
								? "cursor-pointer hover:scale-[1.02]"
								: "cursor-not-allowed opacity-50",
						)}
						onClick={hasProject ? () => setIsExportPopoverOpen(true) : undefined}
						disabled={!hasProject}
						onKeyDown={(event) => {
							if (hasProject && (event.key === "Enter" || event.key === " ")) {
								event.preventDefault();
								setIsExportPopoverOpen(true);
							}
						}}
					>
						<span
							aria-hidden="true"
							className="export-neon-glow export-neon-ring absolute -inset-1 -z-20 rounded-full"
						/>
						<span
							aria-hidden="true"
							className="export-neon-ring absolute inset-0 -z-10 rounded-full"
						/>
						<span className="relative z-10 flex h-8 items-center rounded-full border border-[#00e5d4]/70 bg-black px-5 text-[0.875rem] font-medium text-[#ebe8ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition duration-300 group-hover:border-[#7df7eb] group-hover:text-[#e8d9ff]">
							<span>{t(locale, "export.export")}</span>
						</span>
					</button>
				</PopoverTrigger>
				{hasProject && <ExportPopover onOpenChange={setIsExportPopoverOpen} />}
			</Popover>
			{hasProject && <ExportProgressModal />}
		</>
	);
}

/** 导出期间/失败时的全局模态：只能通过 Cancel（或失败时的关闭）退出，屏蔽编辑区。 */
function ExportProgressModal() {
	const locale = useRecutLocale();
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const exportState = useEditor((e) => e.project.getExportState());
	const { isExporting, progress, frameTimeMs, result } = exportState;
	const failed = !isExporting && !!result && !result.success && !result.cancelled;

	return (
		<Dialog
			open={isExporting || failed}
			onOpenChange={() => {
				// 导出模态不可通过点击外部 / Esc / X 关闭，只能走业务按钮。
			}}
		>
			<DialogContent
				className="flex flex-col gap-4 sm:max-w-md"
				hideCloseButton
				onInteractOutside={(event) => event.preventDefault()}
				onEscapeKeyDown={(event) => event.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle className="pr-6">
						{isExporting
							? t(locale, "export.exporting")
							: t(locale, "export.exportFailed")}
					</DialogTitle>
				</DialogHeader>

				{isExporting ? (
					<div className="space-y-4 p-6">
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between text-center">
								<p className="text-muted-foreground text-sm">
									{Math.round(progress * 100)}%
								</p>
								<p className="text-muted-foreground text-sm">100%</p>
							</div>
							<Progress value={progress * 100} className="w-full" />
							<p className="text-muted-foreground text-center font-mono text-[11px]">
								{t(locale, "export.frameRender", {
									ms: frameTimeMs.toFixed(0),
								})}{" "}
								{t(locale, "export.targetFrame", {
									ms: formatTimecodeRateMs(activeProject.settings.fps).toFixed(0),
								})}
							</p>
							<p className="text-muted-foreground text-center text-xs">
								{t(locale, "export.lockedHint")}
							</p>
						</div>

						<Button
							variant="outline"
							className="w-full rounded-md"
							onClick={() => editor.project.cancelExport()}
						>
							{t(locale, "export.cancel")}
						</Button>
					</div>
				) : (
					<ExportError
						error={result?.error || t(locale, "export.unknownError")}
						onClose={() => editor.project.clearExportState()}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ExportPopover({
	onOpenChange,
}: {
	onOpenChange: (open: boolean) => void;
}) {
	const locale = useRecutLocale();
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const [format, setFormat] = useState<ExportFormat>(
		DEFAULT_EXPORT_OPTIONS.format,
	);
	const [quality, setQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_OPTIONS.quality,
	);
	const [shouldIncludeAudio, setShouldIncludeAudio] = useState<boolean>(
		DEFAULT_EXPORT_OPTIONS.includeAudio ?? true,
	);

	const handleExport = async () => {
		if (!activeProject) return;

		const result = await editor.project.export({
			options: {
				format,
				quality,
				fps: activeProject.settings.fps,
				includeAudio: shouldIncludeAudio,
			},
		});

		if (result.cancelled) {
			editor.project.clearExportState();
			return;
		}

		if (result.success && result.buffer) {
			downloadBuffer({
				buffer: result.buffer,
				filename: `${activeProject.metadata.name}${getExportFileExtension({ format })}`,
				mimeType: getExportMimeType({ format }),
			});

			editor.project.clearExportState();
			onOpenChange(false);
		}
	};

	return (
		<PopoverContent className="bg-background mr-4 flex w-80 flex-col p-0">
			<div className="flex items-center justify-between p-3 border-b">
				<h3 className="font-medium text-sm">{t(locale, "export.exportProject")}</h3>
			</div>

			<div className="flex flex-col gap-4">
				<div className="flex flex-col">
					<Section
						collapsible
						defaultOpen={false}
						showTopBorder={false}
					>
						<SectionHeader>
							<SectionTitle>{t(locale, "export.format")}</SectionTitle>
						</SectionHeader>
						<SectionContent>
							<RadioGroup
								value={format}
								onValueChange={(value) => {
									if (isExportFormat(value)) {
										setFormat(value);
									}
								}}
							>
								<div className="flex items-center space-x-2">
									<RadioGroupItem value="mp4" id="mp4" />
									<Label htmlFor="mp4">
										{t(locale, "export.mp4Hint")}
									</Label>
								</div>
								<div className="flex items-center space-x-2">
									<RadioGroupItem value="webm" id="webm" />
									<Label htmlFor="webm">
										{t(locale, "export.webmHint")}
									</Label>
								</div>
							</RadioGroup>
						</SectionContent>
					</Section>

					<Section collapsible defaultOpen={false}>
						<SectionHeader>
							<SectionTitle>{t(locale, "export.quality")}</SectionTitle>
						</SectionHeader>
						<SectionContent>
							<RadioGroup
								value={quality}
								onValueChange={(value) => {
									if (isExportQuality(value)) {
										setQuality(value);
									}
								}}
							>
								<div className="flex items-center space-x-2">
									<RadioGroupItem value="low" id="low" />
									<Label htmlFor="low">{t(locale, "export.qLow")}</Label>
								</div>
								<div className="flex items-center space-x-2">
									<RadioGroupItem value="medium" id="medium" />
									<Label htmlFor="medium">{t(locale, "export.qMedium")}</Label>
								</div>
								<div className="flex items-center space-x-2">
									<RadioGroupItem value="high" id="high" />
									<Label htmlFor="high">{t(locale, "export.qHigh")}</Label>
								</div>
								<div className="flex items-center space-x-2">
									<RadioGroupItem value="very_high" id="very_high" />
									<Label htmlFor="very_high">
										{t(locale, "export.qVeryHigh")}
									</Label>
								</div>
							</RadioGroup>
						</SectionContent>
					</Section>

					<Section collapsible defaultOpen={false}>
						<SectionHeader>
							<SectionTitle>{t(locale, "export.audio")}</SectionTitle>
						</SectionHeader>
						<SectionContent>
							<div className="flex items-center space-x-2">
								<Checkbox
									id="include-audio"
									checked={shouldIncludeAudio}
									onCheckedChange={(checked) =>
										setShouldIncludeAudio(!!checked)
									}
								/>
								<Label htmlFor="include-audio">
									{t(locale, "export.includeAudio")}
								</Label>
							</div>
						</SectionContent>
					</Section>

					<Section collapsible defaultOpen={false}>
						<SectionHeader>
							<SectionTitle>{t(locale, "export.cover")}</SectionTitle>
						</SectionHeader>
						<SectionContent>
							<CoverPicker />
						</SectionContent>
					</Section>
				</div>

				<div className="p-3 pt-0">
					<Button onClick={handleExport} className="w-full gap-2">
						<Download className="size-4" />
						{t(locale, "export.export")}
					</Button>
				</div>
			</div>
		</PopoverContent>
	);
}

function ExportError({
	error,
	onClose,
}: {
	error: string;
	onClose: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const locale = useRecutLocale();

	const handleCopy = async () => {
		await navigator.clipboard.writeText(error);
		setCopied(true);
		setTimeout(() => setCopied(false), 1000);
	};

	return (
		<div className="space-y-4 p-3">
			<div className="flex flex-col gap-1.5">
				<p className="text-destructive text-sm font-medium">{t(locale, "export.exportFailed")}</p>
				<p className="text-muted-foreground text-xs">{error}</p>
			</div>

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={handleCopy}
				>
					{copied ? <Check className="text-constructive" /> : <Copy />}
					{t(locale, "export.copy")}
				</Button>
				<Button
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onClose}
				>
					{t(locale, "export.close")}
				</Button>
			</div>
		</div>
	);
}
