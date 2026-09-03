import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useReducer, useRef, useState, useEffect, useCallback } from "react";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { extractTimelineAudio } from "@/media/mediabunny";
import { timelineHasAudio } from "@/media/audio";
import type { MediaAsset } from "@/media/types";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@/transcription/diagnostics";
import type { CaptionChunk, TranscriptionSegment } from "@/transcription/types";
import { buildCaptionChunks } from "@/transcription/caption";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import type { CaptionSource } from "@/subtitles/types";
import { parseSubtitleFile } from "@/subtitles/parse";
import {
	fetchRecutSubtitleCues,
	pickRecutSubtitle,
} from "@/subtitles/from-recut";
import { recut } from "@/recut/sdk";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { Spinner } from "@/components/ui/spinner";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@/components/section";
import { AlertCircleIcon, CloudUploadIcon, LibraryIcon, Rocket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DiagnosticSeverity } from "@/diagnostics/types";
import { t, useRecutLocale } from "@/i18n";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

const FALLBACK_LANGUAGES: string[] = ["auto", "zh", "en"];
/** 伪目标：把整条时间线混音提取后转写（CapCut 式“全轨字幕”）。 */
const TIMELINE_MIX_ASSET_ID = "__timeline__";

type CaptionCapabilities = {
	appId: string;
	ready: boolean;
	envReady: boolean;
	asrModels: string[];
	installedModels: string[];
	languages: string[];
	status: string;
	reason: "not-installed" | "stale" | "env" | "no-model" | "ready" | "unknown";
	code?: string;
	message?: string;
	action?: string;
	envError?: string;
	install?: { appId: string; name?: string; repository?: string } | null;
};

type CaptionTarget = {
	assetId: string;
	kind: "audio" | "video";
	name: string;
	startTimeTicks: number;
};

type ProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; warnings: string[] }
	| { type: "fail"; error: string };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return { status: "idle", error: null, warnings: action.warnings };
		case "fail":
			return { status: "idle", error: action.error, warnings: [] };
	}
}
/* eslint-enable opencut/prefer-object-params */

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 收集时间线上带音频的可转写目标素材（P0 单素材：由用户在生成下拉里选择，cue 自动对齐 clip 起始）。 */
function collectCaptionTargets(editor: EditorCore): CaptionTarget[] {
	const assetById = new Map<string, { name: string; hasAudio?: boolean }>();
	for (const asset of editor.media.getAssets()) {
		assetById.set(asset.id, { name: asset.name, hasAudio: asset.hasAudio });
	}
	const candidates: CaptionTarget[] = [];
	const scene = editor.scenes.getActiveScene();
	const tracks = scene
		? [scene.tracks.main, ...(scene.tracks.overlay ?? []), ...(scene.tracks.audio ?? [])]
		: [];
	for (const track of tracks) {
		if (!track) continue;
		for (const el of track.elements ?? []) {
			if (el.type === "video") {
				const asset = assetById.get(el.mediaId);
				// 严格：只有明确带音频的视频才算可转写目标，避免把无声素材放进 ASR 队列。
				if (!asset || asset.hasAudio !== true) continue;
				candidates.push({
					assetId: el.mediaId,
					kind: "video",
					name: el.name || asset.name,
					startTimeTicks: el.startTime as unknown as number,
				});
			} else if (el.type === "audio" && el.sourceType === "upload") {
				const asset = assetById.get(el.mediaId);
				candidates.push({
					assetId: el.mediaId,
					kind: "audio",
					name: el.name || asset?.name || el.mediaId,
					startTimeTicks: el.startTime as unknown as number,
				});
			}
		}
	}
	const byAsset = new Map<string, CaptionTarget>();
	for (const candidate of candidates) {
		const existing = byAsset.get(candidate.assetId);
		if (!existing || candidate.startTimeTicks < existing.startTimeTicks) {
			byAsset.set(candidate.assetId, candidate);
		}
	}
	return Array.from(byAsset.values()).sort((a, b) => a.startTimeTicks - b.startTimeTicks);
}

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] = useState<string>("auto");
	const [selectedModel, setSelectedModel] = useState<string>("");
	const [capabilities, setCapabilities] = useState<CaptionCapabilities | null>(null);
	const [hasRefreshed, setHasRefreshed] = useState(false);
	const [targetAssetId, setTargetAssetId] = useState<string>("");
	const [rangeStart, setRangeStart] = useState("");
	const [rangeEnd, setRangeEnd] = useState("");
	const [processing, dispatch] = useReducer(processingReducer, IDLE_STATE);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const jobIdRef = useRef<string | null>(null);
	const cancelledRef = useRef(false);
	const editor = useEditor();
	const locale = useRecutLocale();

	const isProcessing = processing.status === "processing";
	const clipTargets = collectCaptionTargets(editor);
	const targets: CaptionTarget[] = [
		{ assetId: TIMELINE_MIX_ASSET_ID, kind: "audio", name: t(locale, "captions.targetTimeline"), startTimeTicks: 0 },
		...clipTargets,
	];
	const target = targets.find((item) => item.assetId === targetAssetId) ?? targets[0] ?? null;

	// 能力快照每次实时取（挂载、切回字幕 Tab、点生成、手动“重新检测”都会刷新），
	// 避免 audio-studio 安装/升级/停止后旧快照一直误导 UI。
	const loadCapabilities = useCallback(async (): Promise<CaptionCapabilities> => {
		const caps = await recut.background.call("subtitle.capabilities", {});
		const raw = (caps ?? {}) as Partial<CaptionCapabilities>;
		const value: CaptionCapabilities = {
			appId: typeof raw.appId === "string" ? raw.appId : "recut.audio-studio",
			ready: raw.ready === true,
			envReady: raw.envReady === true,
			asrModels: Array.isArray(raw.asrModels) ? raw.asrModels.map(String) : [],
			installedModels: Array.isArray(raw.installedModels) ? raw.installedModels.map(String) : [],
			languages: Array.isArray(raw.languages) ? raw.languages.length > 0 ? raw.languages.map(String) : [...FALLBACK_LANGUAGES] : [...FALLBACK_LANGUAGES],
			status: String(raw.status ?? "unknown"),
			reason: ["not-installed", "stale", "env", "no-model", "ready", "unknown"].includes(raw.reason as string)
				? (raw.reason as CaptionCapabilities["reason"])
				: "unknown",
			code: raw.code ? String(raw.code) : undefined,
			message: raw.message ? String(raw.message) : undefined,
			action: raw.action ? String(raw.action) : undefined,
			envError: raw.envError ? String(raw.envError) : undefined,
			install: raw.install && typeof raw.install === "object" ? raw.install : null,
		};
		setCapabilities(value);
		setHasRefreshed(true);
		if (value.installedModels.length > 0) {
			setSelectedModel(value.installedModels[0]);
		}
		return value;
	}, []);

	useEffect(() => {
		loadCapabilities().catch((cause: unknown) => {
			console.warn("subtitle.capabilities failed to load:", cause);
			setHasRefreshed(true);
			setCapabilities({
				appId: "recut.audio-studio",
				ready: false,
				envReady: false,
				asrModels: [],
				installedModels: [],
				languages: [...FALLBACK_LANGUAGES],
				status: "unavailable",
				reason: "unknown",
				install: null,
			});
		});
	}, [loadCapabilities]);

	// 切回字幕 Tab 时重新检测（安装/升级后无需刷新整个页面）。
	const activeTab = useAssetsPanelStore((store) => store.activeTab);
	const lastActiveTabRef = useRef(activeTab);
	useEffect(() => {
		if (activeTab === "captions" && lastActiveTabRef.current !== "captions") {
			loadCapabilities().catch(() => undefined);
		}
		lastActiveTabRef.current = activeTab;
	}, [activeTab, loadCapabilities]);

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);

	const insertCaptions = ({
		captions,
		source,
		captionSource,
		startOffsetTicks,
	}: {
		captions: CaptionChunk[];
		source: "srt" | "ass" | "transcript";
		captionSource?: CaptionSource;
		startOffsetTicks?: number;
	}): boolean => {
		const trackId = insertCaptionChunksAsTextTrack({
			editor,
			captions,
			options: {
				source,
				captionSource,
				startOffsetTicks,
			},
		});
		return trackId !== null;
	};

	const requestInstall = useCallback(() => {
		const install = capabilities?.install;
		void recut.apps
			.requestInstall({
				appId: install?.appId ?? capabilities?.appId ?? "recut.audio-studio",
				name: install?.name ?? "Audio Studio",
				repository: install?.repository ?? undefined,
			})
			.catch((cause: unknown) => {
				console.warn("Install guide request not delivered to the host:", cause);
			});
	}, [capabilities]);

	const handleGenerateTranscript = useCallback(async () => {
		// 动作时重新实时检测能力，避免旧快照（安装/升级前抓取的）一直挡着。
		let fresh: CaptionCapabilities;
		try {
			fresh = await loadCapabilities();
		} catch (cause) {
			console.warn("subtitle.capabilities refresh failed before generate:", cause);
			fresh = capabilities ?? { appId: "recut.audio-studio", ready: false, envReady: false, asrModels: [], installedModels: [], languages: [...FALLBACK_LANGUAGES], status: "unavailable", reason: "unknown", install: null };
		}
		const currentTarget = targets.find((item) => item.assetId === targetAssetId) ?? targets[0] ?? null;
		if (!fresh.ready) {
			dispatch({
				type: "fail",
				error: t(locale, fresh.reason === "no-model" ? "captions.noModelInstalled" : "captions.installRequired"),
			});
			return;
		}
		if (fresh.installedModels.length === 0) {
			dispatch({
				type: "fail",
				error: t(locale, "captions.noModelInstalled"),
			});
			return;
		}
		if (!currentTarget) {
			dispatch({
				type: "fail",
				error: t(locale, "captions.noSpeechAssets"),
			});
			return;
		}
		dispatch({ type: "start", step: t(locale, "captions.extractingAudio") });
		try {
			let effectiveTarget = currentTarget;
			if (currentTarget.assetId === TIMELINE_MIX_ASSET_ID) {
				// 整轨/局部混音：先守卫时间线是否有声，再提取（可选区间）→ 上传为全局 audio 素材 → 转写。
				if (!timelineHasAudio({ tracks: editor.scenes.getActiveScene().tracks, mediaAssets: editor.media.getAssets() })) {
					throw new Error(t(locale, "captions.noSpeechAssets"));
				}
				const fromParsed = Number.parseFloat(rangeStart);
				const toParsed = Number.parseFloat(rangeEnd);
				const fromSeconds = Number.isFinite(fromParsed) && fromParsed >= 0 ? fromParsed : undefined;
				const toSeconds = Number.isFinite(toParsed) && toParsed > 0 ? toParsed : undefined;
				const mixBlob = await extractTimelineAudio({
					tracks: editor.scenes.getActiveScene().tracks,
					mediaAssets: editor.media.getAssets(),
					totalDuration: editor.timeline.getTotalDuration(),
					fromSeconds,
					toSeconds,
				});
				dispatch({ type: "update_step", step: t(locale, "captions.preparingAudio") });
				const mixFile = new File([mixBlob], `timeline-mix-${Date.now()}.wav`, { type: mixBlob.type || "audio/wav" });
				const uploaded = await recut.assets.upload({ file: mixFile });
				const mixAssetId = uploaded && uploaded.asset && typeof uploaded.asset.id === "string" ? uploaded.asset.id : "";
				if (!mixAssetId) {
					throw new Error(t(locale, "captions.unexpectedError"));
				}
				effectiveTarget = { assetId: mixAssetId, kind: "audio", name: "Timeline mix", startTimeTicks: 0 };
			}

			const generate = await recut.background.call("subtitle.generate", {
				// 以「用户点生成」的授权来源提交到能力桥；平台签名后注入给 audio.transcribe。
				targetAssetId: effectiveTarget.assetId,
				kind: effectiveTarget.kind,
				model: effectiveModel,
				language: selectedLanguage,
				authorization: "user-generated-captions",
			});
			if (!generate || generate.ok === false) {
				const reason = generate && typeof generate.message === "string" ? generate.message : t(locale, "captions.unexpectedError");
				throw new Error(reason);
			}
			const jobId = generate.jobId;
			if (typeof jobId !== "string" || !jobId) {
				throw new Error(t(locale, "captions.unexpectedError"));
			}

			const dispatchState = (action: ProcessingAction) => dispatch(action);

			dispatchState({ type: "update_step", step: t(locale, "captions.transcribing") });
			jobIdRef.current = jobId;
			cancelledRef.current = false;
			let outcome: Record<string, unknown> | null = null;
			let errorPolls = 0;
			for (;;) {
				if (cancelledRef.current) {
					throw new Error(t(locale, "captions.cancelled"));
				}
				const status = await recut.background.call("subtitle.status", { jobId });
				const raw = (status ?? {}) as { status?: unknown; error?: unknown; retryable?: unknown };
				const state = String(raw.status || "running");
				if (state === "completed") {
					outcome = status as Record<string, unknown>;
					break;
				}
				if (state === "failed") {
					const message = raw.error ? String(raw.error) : t(locale, "captions.noneGenerated");
					throw new Error(message);
				}
				if (state === "cancelled") {
					throw new Error(t(locale, "captions.cancelled"));
				}
				if (state === "error") {
					// 提供方查询失败：非重试直接停；可重试连错 3 次也停，避免无限转圈。
					errorPolls += 1;
					if (raw.retryable !== true || errorPolls >= 3) {
						throw new Error(raw.error ? String(raw.error) : t(locale, "captions.unexpectedError"));
					}
				}
				if (errorPolls > 0 && state !== "error") {
					errorPolls = 0;
				}
				await sleep(1800);
			}
			jobIdRef.current = null;

			dispatch({ type: "update_step", step: t(locale, "captions.generating") });
			let captions: CaptionChunk[] = [];
			const warnings: string[] = [];
			const srt = typeof outcome?.srt === "string" ? outcome.srt : "";
			const segments = Array.isArray(outcome?.segments) ? outcome.segments as TranscriptionSegment[] : [];
			if (srt) {
				const parsed = parseSubtitleFile({ fileName: "transcript.srt", input: srt });
				captions = parsed.captions;
				if (parsed.skippedCueCount > 0) {
					warnings.push(t(locale, "captions.importedCues", { n: parsed.captions.length, m: parsed.skippedCueCount }));
				}
			}
			if (captions.length === 0 && segments.length > 0) {
				captions = buildCaptionChunks({ segments });
				warnings.push(t(locale, "captions.approxTimings"));
			}
			if (captions.length === 0) {
				dispatch({ type: "fail", error: t(locale, "captions.noneGenerated") });
				return;
			}

			let transcriptAssetId = typeof outcome?.transcriptAssetId === "string" ? outcome.transcriptAssetId : "";
			// 部分成功 repair：转写完成但懒终态入库为空时，重读一次补 save；仍失败则提示但不丢字幕。
			if (!transcriptAssetId) {
				const retry = await recut.background
					.call("subtitle.retry-save", { jobId })
					.catch(() => null);
				if (retry && retry.ok === true && typeof retry.transcriptAssetId === "string" && retry.transcriptAssetId) {
					transcriptAssetId = retry.transcriptAssetId;
				} else {
					warnings.push(t(locale, "captions.saveFailedHint"));
				}
			}
			const captionSource: CaptionSource = {
				assetId: transcriptAssetId || effectiveTarget.assetId,
				sourceAssetId: effectiveTarget.assetId,
				model: selectedModel,
				language: selectedLanguage,
				generatedAt: new Date().toISOString(),
			};
			if (!insertCaptions({
				captions,
				source: "transcript",
				captionSource,
				startOffsetTicks: effectiveTarget.startTimeTicks,
			})) {
				dispatch({ type: "fail", error: t(locale, "captions.noneGenerated") });
				return;
			}

			if (transcriptAssetId) {
				await recut.background.call("subtitle.commit", { transcriptAssetId }).catch(() => null);
			}
			jobIdRef.current = null;
			dispatch({ type: "succeed", warnings });
		} catch (error) {
			jobIdRef.current = null;
			cancelledRef.current = false;
			console.error("Caption generation failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: t(locale, "captions.unexpectedError"),
			});
		}
	}, [capabilities, editor, locale, loadCapabilities, rangeEnd, rangeStart, selectedLanguage, selectedModel, targetAssetId, targets]);

	const handleCancelTranscript = useCallback(async () => {
		const jobId = jobIdRef.current;
		cancelledRef.current = true;
		if (!jobId) {
			dispatch({ type: "fail", error: t(locale, "captions.cancelled") });
			return;
		}
		dispatch({ type: "update_step", step: t(locale, "captions.cancelling") });
		try {
			await recut.background.call("subtitle.cancel", { jobId }).catch(() => null);
		} finally {
			jobIdRef.current = null;
			cancelledRef.current = false;
		}
		dispatch({ type: "fail", error: t(locale, "captions.cancelled") });
	}, [locale]);

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleImportFromRecut = useCallback(async () => {
		dispatch({ type: "start", step: t(locale, "captions.selectingAsset") });
		try {
			const selection = await pickRecutSubtitle();
			if (!selection) {
				dispatch({ type: "succeed", warnings: [] });
				return;
			}

			dispatch({ type: "update_step", step: t(locale, "captions.fetching") });
			const result = await fetchRecutSubtitleCues({ assetId: selection.id });

			if (result.captions.length === 0) {
				dispatch({
					type: "fail",
					error: t(locale, "captions.noneFound"),
				});
				return;
			}

			dispatch({ type: "update_step", step: t(locale, "captions.importing") });

			const captionSource: CaptionSource = { assetId: selection.id, generatedAt: new Date().toISOString() };
			if (!insertCaptions({ captions: result.captions, source: "transcript", captionSource })) {
				dispatch({ type: "fail", error: t(locale, "captions.noneGenerated") });
				return;
			}

			dispatch({ type: "succeed", warnings: result.warnings });
		} catch (error) {
			console.error("Recut subtitle import failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: t(locale, "captions.unexpectedError"),
			});
		}
	}, [locale]);

	const handleImportFile = useCallback(async ({ file }: { file: File }) => {
		dispatch({ type: "start", step: t(locale, "captions.readingFile") });
		try {
			const input = await file.text();
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				dispatch({
					type: "fail",
					error: t(locale, "captions.noValidCues"),
				});
				return;
			}

			dispatch({ type: "update_step", step: t(locale, "captions.importing") });

			const fileExtension = file.name.split(".").pop()?.toLowerCase();
			if (
				!insertCaptions({
					captions: result.captions,
					source: fileExtension === "ass" ? "ass" : "srt",
				})
			) {
				dispatch({ type: "fail", error: t(locale, "captions.noneGenerated") });
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					t(locale, "captions.importedCues", { n: result.captions.length, m: result.skippedCueCount }),
				);
			}

			dispatch({ type: "succeed", warnings: nextWarnings });
		} catch (error) {
			console.error("Subtitle import failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: t(locale, "captions.unexpectedError"),
			});
		}
	}, [locale]);

	const handleFileChange = useCallback(async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	}, [handleImportFile]);

	const handleLanguageChange = ({ value }: { value: string }) => {
		const available = capabilities?.languages ?? FALLBACK_LANGUAGES;
		if (available.includes(value)) {
			setSelectedLanguage(value);
		}
	};

	const handleModelChange = ({ value }: { value: string }) => {
		if ((capabilities?.installedModels ?? []).includes(value)) {
			setSelectedModel(value);
		}
	};

	const openAudioStudio = useCallback(() => {
		recut.navigation.openAppDetail("recut.audio-studio");
	}, []);

	const languages = capabilities?.languages ?? [...FALLBACK_LANGUAGES];
	// 模型列表只显示 audio-studio 已安装的模型（候选但未装的选不了、也跑不起来）。
	const models = capabilities?.installedModels ?? [];
	const effectiveModel = models.includes(selectedModel) ? selectedModel : (models[0] ?? "");
	const generateDisabled = isProcessing || activeDiagnostics.length > 0 || !capabilities?.ready || (capabilities?.installedModels.length ?? 0) === 0 || !target;

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	return (
		<PanelView
			title={t(locale, "captions.title")}
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
										>
											<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={isProcessing}
									className="items-center justify-center gap-1.5"
								>
									<HugeiconsIcon icon={CloudUploadIcon} />
									{t(locale, "captions.import")}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onClick={handleImportClick}
									disabled={isProcessing}
								>
									<HugeiconsIcon icon={CloudUploadIcon} />
									{t(locale, "captions.importFile")}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => void handleImportFromRecut()}
									disabled={isProcessing}
								>
									<HugeiconsIcon icon={LibraryIcon} />
									{t(locale, "captions.fromRecut")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					{hasRefreshed && capabilities && !capabilities.ready && (
						<div className="rounded-md border border-caution/40 bg-caution/15 p-3">
							<p className="text-sm text-foreground">
								{capabilities.reason === "stale"
									? t(locale, "captions.staleApp")
									: capabilities.reason === "env"
										? capabilities.action || capabilities.envError || t(locale, "captions.installRequired")
										: t(locale, "captions.installRequired")}
							</p>
							<div className="mt-2 flex flex-col gap-2">
								{capabilities.reason === "stale" || capabilities.reason === "env" ? (
									<Button type="button" variant="outline" className="w-full" onClick={openAudioStudio}>
										<HugeiconsIcon icon={Rocket01Icon} />
										{t(locale, "captions.openAudioStudio")}
									</Button>
								) : (
									<Button type="button" variant="outline" className="w-full" onClick={requestInstall}>
										<HugeiconsIcon icon={Rocket01Icon} />
										{t(locale, "captions.installButton")}
									</Button>
								)}
								<Button type="button" variant="ghost" className="w-full" onClick={() => void loadCapabilities().catch(() => undefined)}>
									{t(locale, "captions.retryDetect")}
								</Button>
							</div>
						</div>
					)}
					{capabilities?.ready && capabilities.installedModels.length === 0 && (
						<div className="rounded-md border border-caution/40 bg-caution/15 p-3">
							<p className="text-sm text-foreground">{t(locale, "captions.noModelInstalled")}</p>
							<Button
								type="button"
								variant="outline"
								className="mt-2 w-full"
								onClick={openAudioStudio}
							>
								<HugeiconsIcon icon={Rocket01Icon} />
								{t(locale, "captions.installModel")}
							</Button>
						</div>
					)}
					<SectionFields>
						<SectionField label={t(locale, "captions.target")}>
							<Select
								value={target?.assetId ?? ""}
								onValueChange={(value) => setTargetAssetId(value)}
								disabled={targets.length === 0}
							>
								<SelectTrigger>
									<SelectValue placeholder={t(locale, "captions.selectTarget")} />
								</SelectTrigger>
								<SelectContent>
									{targets.map((item) => (
										<SelectItem key={item.assetId} value={item.assetId}>
											{item.name}（{item.kind}）
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{target?.assetId === TIMELINE_MIX_ASSET_ID && (
								<div className="mt-2 flex items-center gap-2">
									<input
										type="number"
										className="h-8 w-20 rounded-sm border border-input bg-background px-2 text-xs"
										min={0}
										placeholder={t(locale, "captions.rangeStartPlaceholder")}
										value={rangeStart}
										onChange={(event) => setRangeStart(event.target.value)}
										aria-label={t(locale, "captions.rangeStart")}
									/>
									<span className="text-xs text-muted-foreground">→</span>
									<input
										type="number"
										className="h-8 w-20 rounded-sm border border-input bg-background px-2 text-xs"
										min={0}
										placeholder={t(locale, "captions.rangeEndPlaceholder")}
										value={rangeEnd}
										onChange={(event) => setRangeEnd(event.target.value)}
										aria-label={t(locale, "captions.rangeEnd")}
									/>
									<span className="text-[10px] leading-3 text-muted-foreground">{t(locale, "captions.rangeHint")}</span>
								</div>
							)}
						</SectionField>
						<SectionField label={t(locale, "captions.language")}>
							<Select
								value={selectedLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder={t(locale, "captions.selectLanguage")} />
								</SelectTrigger>
								<SelectContent>
									{languages.map((code) => (
										<SelectItem key={code} value={code}>
											{code === "auto" ? t(locale, "captions.autoDetect") : code === "zh" ? "中文" : code === "en" ? "English" : code}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
						<SectionField label={t(locale, "captions.model")}>
							<Select
								value={selectedModel}
								onValueChange={(value) => handleModelChange({ value })}
								disabled={(capabilities?.installedModels.length ?? 0) === 0}
							>
								<SelectTrigger>
									<SelectValue placeholder={t(locale, "captions.selectModel")} />
								</SelectTrigger>
								<SelectContent>
									{models.map((model) => (
										<SelectItem key={model} value={model}>
											{model}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{models.length > 0 && (
								<p className="mt-1 text-xs leading-4 text-foreground/70">{t(locale, "captions.modelInstalledHint")}</p>
							)}
						</SectionField>
					</SectionFields>

					<Button
						type="button"
						className="mt-auto w-full"
						onClick={() => void handleGenerateTranscript()}
						disabled={generateDisabled}
					>
						{isProcessing && <Spinner className="mr-1" />}
						{isProcessing ? processing.step : t(locale, "captions.generateTranscript")}
					</Button>
					{isProcessing && (
						<Button type="button" variant="ghost" className="w-full" onClick={() => void handleCancelTranscript()}>
							{t(locale, "captions.cancel")}
						</Button>
					)}
					{error && (
						<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
							<p className="text-destructive text-sm">{error}</p>
						</div>
					)}
					{warnings.length > 0 && (
						<div className="rounded-md border border-caution/40 bg-caution/15 p-3">
							<ul className="space-y-1 text-sm text-foreground">
								{warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
		</PanelView>
	);
}