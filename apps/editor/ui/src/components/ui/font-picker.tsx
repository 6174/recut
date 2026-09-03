"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loadFullFont } from "@/fonts/google-fonts";
import {
	uploadLocalFont,
	deleteLocalFont,
	registerUploadedFont,
} from "@/fonts/service-catalog";
import { SYSTEM_FONTS } from "@/fonts/system-fonts";
import {
	useFontAtlas,
	type FontSourceItem,
} from "@/fonts/use-font-atlas";
import { cn } from "@/utils/ui";
import { ChevronDown, Search, Upload, Trash2 } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { TextIcon } from "@hugeicons/core-free-icons";
import { t, useRecutLocale, type I18nKey } from "@/i18n";

const CATEGORIES = [
	{ key: "all", labelKey: "font.category.all" },
	{ key: "sans-serif", labelKey: "font.category.sansSerif" },
	{ key: "serif", labelKey: "font.category.serif" },
	{ key: "display", labelKey: "font.category.display" },
	{ key: "handwriting", labelKey: "font.category.handwriting" },
	{ key: "monospace", labelKey: "font.category.monospace" },
	{ key: "zh", labelKey: "font.category.zh" },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

const COL_COUNT = 3;

interface FontPickerProps {
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	className?: string;
}

export function FontPicker({
	defaultValue,
	onValueChange,
	className,
}: FontPickerProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [activeTab, setActiveTab] = useState<"google" | "local">("google");
	const [category, setCategory] = useState<CategoryKey>("all");
	const [uploading, setUploading] = useState(false);
	const [localList, setLocalList] = useState<FontSourceItem[]>([]);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const {
		status,
		googleFonts,
		installedFonts,
		retry: handleRetry,
	} = useFontAtlas({ open });

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const load = async () => {
			const { listLocalFonts: list } = await import(
				"@/fonts/service-catalog"
			);
			const items = await list();
			if (cancelled) return;
			setLocalList(
				items.map((font) => ({
					family: font.family,
					source: "upload" as const,
					uploadedId: font.id,
				})),
			);
		};
		load();
		return () => {
			cancelled = true;
		};
	}, [open]);

	const query = search.trim().toLowerCase();

	const filteredGoogle = useMemo(() => {
		let items = googleFonts;
		if (category !== "all") {
			items = items.filter((item) => {
				if (category === "zh") return item.scripts?.includes("zh");
				return item.category === category;
			});
		}
		if (query) {
			items = items.filter((item) =>
				item.family.toLowerCase().includes(query),
			);
		}
		return items;
	}, [googleFonts, category, query]);

	const systemItems = useMemo(() => {
		const seen = new Set<string>();
		const items: FontSourceItem[] = [];
		for (const font of installedFonts) {
			if (seen.has(font.family)) continue;
			seen.add(font.family);
			items.push({ family: font.family, source: "system" });
		}
		for (const family of SYSTEM_FONTS) {
			if (seen.has(family)) continue;
			seen.add(family);
			items.push({ family, source: "system" });
		}
		return items;
	}, [installedFonts]);

	const localItems = useMemo(() => {
		const seen = new Set<string>();
		const items: FontSourceItem[] = [];
		for (const font of [...localList, ...systemItems]) {
			if (seen.has(font.family)) continue;
			seen.add(font.family);
			items.push(font);
		}
		if (query) {
			return items.filter((item) =>
				item.family.toLowerCase().includes(query),
			);
		}
		return items;
	}, [localList, systemItems, query]);

	const handleSelect = useCallback(
		async ({ family }: { family: string }) => {
			if (!SYSTEM_FONTS.has(family)) {
				try {
					await loadFullFont({ family });
				} catch {
					// ignore load failure, font will fall back to system default
				}
			}
			onValueChange?.(family);
			setOpen(false);
		},
		[onValueChange],
	);

	const handleUpload = useCallback(
		async (file: File) => {
			if (!file) return;
			const family =
				file.name.replace(/\.(woff2?|ttf|otf)$/i, "") || "Custom Font";
			setUploading(true);
			try {
				const entry = await uploadLocalFont(family, file);
				await registerUploadedFont(entry.family, entry.id);
				setLocalList((prev) => [
					{
						family: entry.family,
						source: "upload" as const,
						uploadedId: entry.id,
					},
					...prev,
				]);
				onValueChange?.(entry.family);
			} finally {
				setUploading(false);
			}
		},
		[onValueChange],
	);

	const handleDelete = useCallback(
		async (item: FontSourceItem) => {
			if (!item.uploadedId) return;
			await deleteLocalFont(item.uploadedId);
			setLocalList((prev) =>
				prev.filter((font) => font.uploadedId !== item.uploadedId),
			);
		},
		[],
	);

	useEffect(() => {
		if (!open) {
			setSearch("");
			setCategory("all");
			setActiveTab("google");
		}
	}, [open]);

	const locale = useRecutLocale();

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				className={cn(
					"border-border bg-accent flex h-7 w-full cursor-pointer items-center justify-between gap-1 rounded-md border px-2.5 text-sm whitespace-nowrap focus-visible:border-primary focus-visible:ring-0 focus:outline-hidden",
					className,
				)}
			>
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="text-muted-foreground [&_svg]:size-3.5 shrink-0">
						<HugeiconsIcon icon={TextIcon} />
					</span>
					<span className="truncate" style={{ fontFamily: defaultValue }}>
						{defaultValue ?? t(locale, "font.selectPlaceholder")}
					</span>
				</div>
				<ChevronDown className="size-3 shrink-0 opacity-50" />
			</PopoverTrigger>
			<PopoverContent
				className="w-[420px] p-0 overflow-hidden"
				align="start"
				side="left"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					searchInputRef.current?.focus();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					event.stopPropagation();
				}}
			>
				<div className="relative px-3 py-1.5">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 shrink-0 opacity-50" />
					<Input
						ref={searchInputRef}
						placeholder={t(locale, "font.searchPlaceholder")}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						size="xs"
						className="w-full pl-5 bg-transparent border-none! shadow-none!"
					/>
				</div>
				<div className="flex border-b px-3">
					{(
						[
							{ key: "google", label: t(locale, "ui.googleFonts") },
							{ key: "local", label: t(locale, "font.localTab") },
						] as const
					).map((tab) => (
						<button
							key={tab.key}
							type="button"
							className={cn(
								"px-3 py-1.5 text-xs border-b-2 -mb-px",
								activeTab === tab.key
									? "border-foreground text-foreground"
									: "border-transparent text-muted-foreground hover:text-foreground",
							)}
							onClick={() => setActiveTab(tab.key)}
						>
							{tab.label}
						</button>
					))}
				</div>
				{activeTab === "google" && (
					<div className="flex gap-1 border-b px-3 py-1.5 flex-wrap">
						{CATEGORIES.map((cat) => (
							<button
								key={cat.key}
								type="button"
								className={cn(
									"rounded px-2 py-0.5 text-[11px]",
									category === cat.key
										? "bg-foreground text-background"
										: "text-muted-foreground hover:bg-popover-hover",
								)}
								onClick={() => setCategory(cat.key)}
							>
								{t(locale, cat.labelKey)}
							</button>
						))}
					</div>
				)}
				{status === "loading" && (
					<div className="py-8 text-center text-sm text-muted-foreground">
						{t(locale, "font.loading")}
					</div>
				)}
				{status === "error" && (
					<div className="flex flex-col items-center gap-3 py-8 px-4">
						<p className="text-sm text-muted-foreground text-center">
							{t(locale, "font.loadFailed")}
						</p>
						<Button variant="outline" size="sm" onClick={handleRetry}>
							{t(locale, "font.retry")}
						</Button>
					</div>
				)}
				{activeTab === "google" &&
					status !== "loading" &&
					filteredGoogle.length === 0 && (
						<div className="py-6 text-center text-sm text-muted-foreground">
							{t(locale, "font.noMatch")}
						</div>
					)}
				{activeTab === "local" && (
					<div className="flex items-center gap-2 border-b px-3 py-1.5">
						<Button
							variant="outline"
							size="sm"
							disabled={uploading}
							onClick={() => fileInputRef.current?.click()}
						>
							<Upload className="size-3.5" />
							{t(locale, "font.upload")}
						</Button>
						<input
							ref={fileInputRef}
							type="file"
							accept=".woff2,.woff,.ttf,.otf"
							className="hidden"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (file) void handleUpload(file);
								event.target.value = "";
							}}
						/>
						<span className="text-[11px] text-muted-foreground">
							.ttf / .otf / .woff2
						</span>
					</div>
				)}
				{status === "idle" && (
					<div
						className="overflow-y-auto px-2 py-1"
						style={{ maxHeight: 320 }}
					>
						{activeTab === "google" ? (
							<GoogleGrid
								fonts={filteredGoogle}
								selectedFont={defaultValue}
								onSelect={handleSelect}
							/>
						) : (
							<LocalGrid
								fonts={localItems}
								selectedFont={defaultValue}
								onSelect={handleSelect}
								onDelete={handleDelete}
							/>
						)}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

function GoogleGrid({
	fonts,
	selectedFont,
	onSelect,
}: {
	fonts: FontSourceItem[];
	selectedFont: string | undefined;
	onSelect: (params: { family: string }) => void;
}) {
	return (
		<div
			className="grid gap-2"
			style={{
				gridTemplateColumns: `repeat(${COL_COUNT}, minmax(0, 1fr))`,
			}}
		>
			{fonts.map((item) => {
				return (
					<FontCard
						key={item.family}
						item={item}
						isSelected={item.family === selectedFont}
						onSelect={onSelect}
					/>
				);
			})}
		</div>
	);
}

function LocalGrid({
	fonts,
	selectedFont,
	onSelect,
	onDelete,
}: {
	fonts: FontSourceItem[];
	selectedFont: string | undefined;
	onSelect: (params: { family: string }) => void;
	onDelete: (item: FontSourceItem) => void;
}) {
	return (
		<div
			className="grid gap-2"
			style={{
				gridTemplateColumns: `repeat(${COL_COUNT}, minmax(0, 1fr))`,
			}}
		>
			{fonts.map((item) => (
				<FontCard
					key={`${item.source}-${item.family}`}
					item={item}
					isSelected={item.family === selectedFont}
					onSelect={onSelect}
					onDelete={item.source === "upload" ? onDelete : undefined}
				/>
			))}
		</div>
	);
}

function FontCard({
	item,
	isSelected,
	onSelect,
	onDelete,
}: {
	item: FontSourceItem;
	isSelected: boolean;
	onSelect: (params: { family: string }) => void;
	onDelete?: (item: FontSourceItem) => void;
}) {
	const [previewFamily, setPreviewFamily] = useState(item.family);
	const isSystem = item.source === "system";
	const locale = useRecutLocale();

	useEffect(() => {
		if (!isSystem && item.source !== "upload") {
			loadFullFont({ family: item.family })
				.then(() => setPreviewFamily(item.family))
				.catch(() => {});
		}
	}, [item.family, isSystem, item.source]);

	return (
		<div
			className={cn(
				"group relative cursor-pointer rounded-md border p-1.5 hover:border-primary",
				isSelected ? "border-primary bg-popover-hover" : "border-transparent",
			)}
			onClick={() => onSelect({ family: item.family })}
			role="button"
			tabIndex={0}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onSelect({ family: item.family });
				}
			}}
			aria-label={item.family}
		>
			<div className="h-9 w-full overflow-hidden text-ellipsis whitespace-nowrap text-[22px] leading-9 text-foreground/85">
				<span style={{ fontFamily: previewFamily }}>{item.family}</span>
			</div>
			<div className="mt-0.5 truncate text-[10px] text-muted-foreground">
				{item.family}
			</div>
			{onDelete && (
				<button
					type="button"
					className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground hover:bg-popover-hover group-hover:block"
					onClick={(event) => {
						event.stopPropagation();
						onDelete(item);
					}}
					aria-label={t(locale, "font.delete", { name: item.family })}
				>
					<Trash2 className="size-3" />
				</button>
			)}
		</div>
	);
}
