"use client";

/**
 * [INPUT]: 依赖音频 catalog、筛选状态、下载缓存和素材面板的通用导航/菜单组件。
 * [OUTPUT]: 对外提供 AudioLibraryView；剪映风格卡片网格（封面主按钮 + 两行标题 +
 *          许可/时长单行 + 添加按钮）浏览本地音乐与音效，加载期显示骨架卡片。
 * [POS]: audio-library/components 的主面板，负责把音频浏览、下载与时间线插入串成单一路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { audioAssetUrl, loadAudioCatalog } from "@/audio-library/catalog";
import {
	getItemFilters,
	useAudioLibraryStore,
} from "@/audio-library/audio-library-store";
import {
	addCachedAudioToTimeline,
	downloadAudioToCache,
} from "@/audio-library/download";
import { createAudioObjectUrl, loadAudioFile } from "@/audio-library/cache";
import type { AudioLibraryItem, AudioLibraryKind } from "@/audio-library/types";
import { useResizeObserver } from "@/hooks/use-resize-observer";
import { toast } from "sonner";
import { cn } from "@/utils/ui";
import { t, useRecutLocale } from "@/i18n";
import {
	ArrowRightDoubleIcon,
	Download04Icon,
	MusicNote03Icon,
	PauseIcon,
	PlayIcon,
	PlusSignIcon,
	SpeakerIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/** 卡片网格：默认面板宽度即两列（剪映式排版），更宽时自适应增列；文字区最小可用宽度优先于列数。 */
const AUDIO_CARD_GRID: CSSProperties = {
	gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 8.5rem), 1fr))",
};

/** 封面尺寸，与骨架卡保持一致，避免加载 → 出图时的布局跳动。 */
const COVER_SIZE = "size-12";

export function AudioLibraryView() {
	const locale = useRecutLocale();
	const { kind, setKind, searchQuery, setSearchQuery, activeFilter, setActiveFilter } =
		useAudioLibraryStore();

	const [items, setItems] = useState<AudioLibraryItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		loadAudioCatalog()
			.then((catalog) => {
				if (cancelled) return;
				setItems([...catalog.music, ...catalog.sfx]);
				setError(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : t(locale, "audioLib.failedLoad"));
			})
			.finally(() => {
				if (!cancelled) setIsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const filteredItems = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		return items.filter((item) => {
			if (item.kind !== kind) return false;
			if (activeFilter && !getItemFilters({ item }).includes(activeFilter)) return false;
			if (!query) return true;
			return (
				item.name.toLowerCase().includes(query) ||
				getItemFilters({ item }).some((f) => f.toLowerCase().includes(query))
			);
		});
	}, [items, kind, searchQuery, activeFilter]);

	const allFilters = useMemo(() => {
		const set = new Set<string>();
		for (const item of items) {
			if (item.kind !== kind) continue;
			for (const f of getItemFilters({ item })) set.add(f);
		}
		return [...set].sort();
	}, [items, kind]);

	const handleTabChange = (value: string) => {
		setKind(value as AudioLibraryKind);
		setActiveFilter(null);
	};

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 px-3 pt-3">
				<Tabs value={kind} onValueChange={handleTabChange}>
					<TabsList>
						<TabsTrigger value="music">
							<HugeiconsIcon icon={MusicNote03Icon} className="mr-1.5 size-4" />
							{t(locale, "audioLib.music")}
						</TabsTrigger>
						<TabsTrigger value="sfx">
							<HugeiconsIcon icon={SpeakerIcon} className="mr-1.5 size-4" />
							{t(locale, "audioLib.soundEffects")}
						</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			<div className="shrink-0 px-3 pt-3">
				<Input
					placeholder={kind === "music" ? t(locale, "audioLib.searchMusic") : t(locale, "audioLib.searchSfx")}
					className="w-full"
					containerClassName="w-full"
					value={searchQuery}
					onChange={({ currentTarget }) =>
						setSearchQuery(currentTarget.value)
					}
					showClearIcon
					onClear={() => setSearchQuery("")}
				/>
			</div>

			{allFilters.length > 0 && (
				<div className="shrink-0 px-3 pt-3">
					<AudioFilterNavigation
						filters={allFilters}
						activeFilter={activeFilter}
						onSelect={(filter) =>
							setActiveFilter(activeFilter === filter ? null : filter)
						}
					/>
				</div>
			)}

			<div className="relative min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-3">
				<ScrollArea className="h-full">
					{/* pr-1：给滚动条留出独立槽位，避免贴住卡片边缘。 */}
					<div className="pr-1">
						{isLoading ? (
							<AudioLibrarySkeleton />
						) : error ? (
							<div className="text-destructive px-4 py-10 text-center text-sm">
								{error}
							</div>
						) : filteredItems.length === 0 ? (
							<div className="text-muted-foreground px-4 py-10 text-center text-sm">
								{searchQuery ? t(locale, "audioLib.noAudio") : t(locale, "audioLib.noAudioAvailable")}
							</div>
						) : (
							<div className="grid gap-2" style={AUDIO_CARD_GRID}>
								{filteredItems.map((item) => (
									<AudioLibraryItemCard key={item.id} item={item} />
								))}
							</div>
						)}
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}


const FILTER_TAB_WIDTH = 76;
const MORE_TAB_WIDTH = 40;
const INITIAL_VISIBLE_FILTERS = 4;

function AudioFilterNavigation({
	filters,
	activeFilter,
	onSelect,
}: {
	filters: string[];
	activeFilter: string | null;
	onSelect: (filter: string | null) => void;
}) {
	const navRef = useRef<HTMLDivElement>(null);
	const [navWidth, setNavWidth] = useState(0);
	const { visibleFilters, moreFilters } = useVisibleFilters({
		filters,
		activeFilter,
		navWidth,
	});
	const isMoreActive =
		activeFilter !== null && moreFilters.includes(activeFilter);
	const locale = useRecutLocale();

	useResizeObserver({
		ref: navRef,
		onResize: useCallback((entry) => setNavWidth(entry.contentRect.width), []),
	});

	return (
		<nav
			ref={navRef}
			aria-label={t(locale, "audio.categories")}
			className="flex h-9 shrink-0 overflow-hidden border-b"
		>
			{visibleFilters.map((filter) => (
				<Button
					key={filter ?? "all"}
					variant="ghost"
					aria-current={activeFilter === filter ? "page" : undefined}
					className={cn(
						"relative h-full w-19 shrink-0 rounded-none px-2.5 text-xs font-medium",
						"after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full",
						activeFilter === filter
							? "bg-primary/8 text-primary after:bg-primary"
							: "text-muted-foreground hover:bg-accent hover:text-foreground",
					)}
					onClick={() => onSelect(filter)}
				>
					<span className="truncate">{filter ?? t(locale, "audioLib.all")}</span>
				</Button>
			))}
			{moreFilters.length > 0 && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							aria-label={t(locale, "audio.moreCategories")}
							aria-current={isMoreActive ? "page" : undefined}
							className={cn(
								"relative ml-auto h-full w-10 shrink-0 rounded-none px-0",
								"after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
								isMoreActive
									? "bg-primary/8 text-primary after:bg-primary"
									: "text-muted-foreground hover:bg-accent hover:text-foreground",
							)}
						>
							<HugeiconsIcon icon={ArrowRightDoubleIcon} className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{moreFilters.map((filter) => (
							<DropdownMenuItem key={filter} onSelect={() => onSelect(filter)}>
								{filter}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</nav>
	);
}

function useVisibleFilters({
	filters,
	activeFilter,
	navWidth,
}: {
	filters: string[];
	activeFilter: string | null;
	navWidth: number;
}) {
	return useMemo(() => {
		const options = [null, ...filters];
		const visibleCount =
			navWidth === 0
				? INITIAL_VISIBLE_FILTERS
				: Math.max(1, Math.floor((navWidth - MORE_TAB_WIDTH) / FILTER_TAB_WIDTH));
		const visibleFilters = options.slice(0, visibleCount);

		if (
			activeFilter !== null &&
			!visibleFilters.includes(activeFilter) &&
			visibleFilters.length > 1
		) {
			visibleFilters[visibleFilters.length - 1] = activeFilter;
		}

		return {
			visibleFilters,
			moreFilters: filters.filter((filter) => !visibleFilters.includes(filter)),
		};
	}, [filters, activeFilter, navWidth]);
}

/** 加载骨架：与真实卡片同网格、同封面尺寸，出图后无布局跳动。 */
function AudioLibrarySkeleton() {
	return (
		<div aria-hidden="true" className="grid gap-2" style={AUDIO_CARD_GRID}>
			{Array.from({ length: 8 }).map((_, index) => (
				<div key={index} className="rounded-lg border border-border/50 bg-muted/25 p-2">
					<div className="flex gap-2">
						<Skeleton className={cn("shrink-0 rounded-md", COVER_SIZE)} />
						<div className="flex min-w-0 flex-1 flex-col pt-1">
							<Skeleton className="h-3.5 w-11/12" />
							<Skeleton className="mt-1 h-3.5 w-2/3" />
							<div className="mt-auto flex justify-end pt-1.5">
								<Skeleton className="size-6 rounded-md" />
							</div>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

function AudioLibraryItemCard({ item }: { item: AudioLibraryItem }) {
	const locale = useRecutLocale();
	const [isPlaying, setIsPlaying] = useState(false);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const { downloadStates, setDownloadState } = useAudioLibraryStore();
	const state = downloadStates[item.id] ?? { status: "idle" };
	/** 已下载缓存的本地可播放 URL（objectURL）。 */
	const [cachedUrl, setCachedUrl] = useState<string | null>(null);

	const url = useMemo(() => audioAssetUrl(item.url), [item.url]);

	// 刷新后下载状态仍为 downloaded：从 OPFS 缓存恢复本地播放 URL。
	useEffect(() => {
		let cancelled = false;
		if (state.status === "downloaded" && !cachedUrl) {
			loadAudioFile({ audioId: item.id }).then((file) => {
				if (cancelled || !file) return;
				setCachedUrl(createAudioObjectUrl(file));
			});
		}
		return () => {
			cancelled = true;
		};
	}, [state.status, cachedUrl, item.id]);

	useEffect(() => {
		return () => {
			audioRef.current?.pause();
			if (cachedUrl) URL.revokeObjectURL(cachedUrl);
		};
	}, [cachedUrl]);

	const handleDownload = useCallback(async () => {
		setDownloadState({ itemId: item.id, state: { status: "downloading", progress: 0 } });
		try {
			const { url: localUrl } = await downloadAudioToCache({
				item,
				onProgress: ({ progress }) =>
					setDownloadState({
						itemId: item.id,
						state: { status: "downloading", progress },
					}),
			});
			setCachedUrl(localUrl);
			setDownloadState({ itemId: item.id, state: { status: "downloaded" } });
			toast.success(t(locale, "audioLib.downloaded", { name: item.name }));
		} catch (err) {
			console.error("Failed to download audio:", err);
			setDownloadState({
				itemId: item.id,
				state: {
					status: "error",
					message: err instanceof Error ? err.message : t(locale, "audioLib.downloadFailed"),
				},
			});
			toast.error(t(locale, "audioLib.downloadFailed"));
		}
	}, [item, setDownloadState]);

	// 剪映模式：未下载时播放按钮位置即「下载」，下载完成后点击才是播放。
	const handlePrimaryAction = useCallback(() => {
		const current = downloadStates[item.id] ?? { status: "idle" };
		if (current.status === "downloading") return;
		if (current.status !== "downloaded") {
			handleDownload();
			return;
		}

		// 已下载：播放本地缓存（回退 CDN 预览）。
		if (isPlaying) {
			audioRef.current?.pause();
			setIsPlaying(false);
			return;
		}
		if (!audioRef.current) {
			const audio = new Audio(cachedUrl ?? url);
			audio.preload = "metadata";
			audio.addEventListener("ended", () => setIsPlaying(false));
			audio.addEventListener("error", () => {
				setIsPlaying(false);
				toast.error(t(locale, "audioLib.playFailed"));
			});
			audioRef.current = audio;
		}
		audioRef.current.play().catch(() => setIsPlaying(false));
		setIsPlaying(true);
	}, [item, downloadStates, isPlaying, cachedUrl, url, handleDownload]);

	const handleAddToTimeline = useCallback(() => {
		const current = downloadStates[item.id] ?? { status: "idle" };
		if (current.status !== "downloaded") {
			toast.info(t(locale, "audioLib.downloadFirst"));
			return;
		}
		addCachedAudioToTimeline({ item }).catch((err: unknown) => {
			console.error("Failed to add audio to timeline:", err);
			toast.error(t(locale, "audioLib.addFailed"));
		});
	}, [item, downloadStates]);

	const isDownloaded = state.status === "downloaded";
	const isDownloading = state.status === "downloading";
	const isError = state.status === "error";
	const progress = isDownloading ? state.progress : 0;

	const primaryTitle = isDownloaded
		? isPlaying
			? t(locale, "audioLib.pause")
			: t(locale, "audioLib.play")
		: isDownloading
			? t(locale, "audioLib.downloading", { progress })
			: isError
				? t(locale, "audioLib.retryDownload")
				: t(locale, "audioLib.downloadToLibrary");

	return (
		<div className="group min-w-0 rounded-lg border border-border/60 bg-muted/25 p-2 text-foreground transition-colors hover:border-border hover:bg-muted/40">
			<div className="flex min-w-0 gap-2">
				<button
					type="button"
					className={cn("bg-accent relative flex shrink-0 items-center justify-center overflow-hidden rounded-md", COVER_SIZE)}
					onClick={handlePrimaryAction}
					title={primaryTitle}
				>
					<div className="from-primary/20 absolute inset-0 bg-gradient-to-br to-transparent" />
					{isDownloading ? (
						<span className="relative text-[11px] font-semibold">{progress}%</span>
					) : isDownloaded ? (
						<HugeiconsIcon
							icon={isPlaying ? PauseIcon : PlayIcon}
							className="relative size-4"
						/>
					) : (
						<HugeiconsIcon icon={Download04Icon} className="relative size-4" />
					)}
				</button>

				<div className="flex min-w-0 flex-1 flex-col">
					<p
						className="line-clamp-2 min-h-[36px] text-[13px] leading-snug font-medium text-foreground"
						title={item.attribution}
					>
						{item.name}
					</p>
					<span className="mt-0.5 flex min-w-0 items-center justify-between gap-1.5 text-xs">
						<span className="text-muted-foreground min-w-0 truncate" title={item.license}>
							{item.license}
						</span>
						<span className="text-muted-foreground/80 shrink-0 tabular-nums">
							{formatDuration({ duration: item.duration })}
						</span>
					</span>
					<div className="mt-auto flex items-center justify-end pt-0.5">
						<Button
							variant="text"
							size="icon"
							className="text-muted-foreground hover:text-foreground size-6"
							onClick={handleAddToTimeline}
							disabled={isDownloading}
							title={isDownloaded ? t(locale, "audioLib.addToTimeline") : t(locale, "audioLib.downloadFirstToAdd")}
						>
							<HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

function formatDuration({ duration }: { duration: number }) {
	if (duration < 60) return `${Math.round(duration * 10) / 10}s`;
	const min = Math.floor(duration / 60);
	const sec = Math.floor(duration % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
}
