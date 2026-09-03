/**
 * [INPUT]: 依赖编辑器项目渲染能力（renderFrameDataUrl）、Recut cover.* 操作与全局素材选择器
 * [OUTPUT]: 对外提供 CoverPicker，导出面板里的封面选择区：seek 预览帧、把某一帧设为封面、
 *           从全局素材库选图片作为封面、恢复自动首帧模式
 * [POS]: components/editor 的封面交互；只负责封面选择，不承载导出编码或素材上传
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Image, Film, RefreshCw, Check } from "lucide-react";
import { recut } from "@/recut/sdk";
import { mediaTimeToSeconds } from "@/wasm";
import { useEditor } from "@/editor/use-editor";
import { isDemoMode } from "@/demo/demo-store";
import { t, useRecutLocale, type I18nKey } from "@/i18n";

type CoverMode = "auto" | "frame" | "asset";

const MODE_LABEL_KEY: Record<CoverMode, I18nKey> = {
	auto: "cover.mode.auto",
	frame: "cover.mode.frame",
	asset: "cover.mode.asset",
};

interface CoverPref {
	mode?: CoverMode;
	frameSec?: number | null;
	assetId?: string | null;
	cover?: { source?: string; assetId?: string; kind?: string; filePath?: string; mimeType?: string } | null;
}

function coverPreviewURL(pref: CoverPref | null): string | null {
	const cover = pref?.cover;
	if (!cover) return null;
	if (cover.source === "file") {
		return `${window.location.origin}/v1/projects/${new URLSearchParams(window.location.search).get("projectId") ?? ""}/cover`;
	}
	if (cover.assetId) {
		return `${window.location.origin}/v1/media/assets/${encodeURIComponent(cover.assetId)}/content`;
	}
	return null;
}

export function CoverPicker() {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const [pref, setPref] = useState<CoverPref | null>(null);
	const [seekSec, setSeekSec] = useState(0);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [applied, setApplied] = useState(false);
	const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const locale = useRecutLocale();

	const durationSec = useMemo(() => {
		const duration = editor.timeline.getTotalDuration();
		return Math.max(0, mediaTimeToSeconds({ time: duration }));
	}, [editor, activeProject]);

	// 初始读取当前封面模式与平台封面，并把 seek 指针放到当前播放头。
	useEffect(() => {
		if (isDemoMode()) return;
		let cancelled = false;
		void recut.background
			.call("cover.get", {})
			.then((result) => {
				if (cancelled) return;
				setPref((result as CoverPref | null) ?? null);
			})
			.catch((error) => {
				console.warn("[cover-picker] cover.get failed:", error);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// seek 变更：防抖渲染该时间点的帧作为预览。
	useEffect(() => {
		if (isDemoMode()) return;
		if (previewTimer.current) clearTimeout(previewTimer.current);
		previewTimer.current = setTimeout(() => {
			setBusy(true);
			void editor.project
				.renderFrameDataUrl({ time: seekSec })
				.then((url) => {
					setPreviewUrl(url);
				})
				.catch(() => setPreviewUrl(null))
				.finally(() => setBusy(false));
		}, 180);
		return () => {
			if (previewTimer.current) clearTimeout(previewTimer.current);
		};
	}, [seekSec, editor, activeProject]);

	const handleUseFrame = async () => {
		if (isDemoMode()) return;
		setBusy(true);
		try {
			const url = await editor.project.renderFrameDataUrl({ time: seekSec });
			if (!url) {
				console.warn("[cover-picker] failed to render frame at", seekSec);
				return;
			}
			const fileBase64 = url.split(",")[1] ?? "";
			const result = await recut.background.call("cover.set-frame", {
				fileBase64,
				mimeType: "image/png",
				frameSec: seekSec,
			});
			setPref((result as CoverPref | null) ?? null);
			setPreviewUrl(url);
			setApplied(true);
		} catch (error) {
			console.warn("[cover-picker] cover.set-frame failed:", error);
		} finally {
			setBusy(false);
		}
	};

	const handlePickAsset = async () => {
		if (isDemoMode()) return;
		try {
			const selection = await recut.media.pick({
				kinds: ["image"],
				multiple: false,
			});
			const asset = Array.isArray(selection) ? selection[0] : selection;
			if (!asset?.id) return;
			const result = await recut.background.call("cover.set-asset", {
				assetId: asset.id,
			});
			setPref((result as CoverPref | null) ?? null);
			setApplied(true);
		} catch (error) {
			console.warn("[cover-picker] cover.set-asset failed:", error);
		}
	};

	const handleAuto = async () => {
		if (isDemoMode()) return;
		try {
			const result = await recut.background.call("cover.set-auto", {});
			setPref((result as CoverPref | null) ?? null);
			setApplied(true);
		} catch (error) {
			console.warn("[cover-picker] cover.set-auto failed:", error);
		}
	};

	const currentURL = coverPreviewURL(pref);
	const mode = pref?.mode ?? "auto";
	const showURL = mode === "asset" ? (currentURL ?? previewUrl) : (previewUrl ?? currentURL);

	return (
		<div className="flex flex-col gap-2.5">
			<div className="relative aspect-[16/9] w-full overflow-hidden rounded-md border bg-black">
				{showURL ? (
					<img
						alt={t(locale, "cover.previewAlt")}
						className="block size-full object-contain"
						src={showURL}
					/>
				) : (
					<div className="grid size-full place-items-center text-muted-foreground">
						<Film className="size-6" />
					</div>
				)}
				<span className="absolute bottom-1 right-1 flex items-center gap-1 rounded-sm bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
					{busy
						? t(locale, "cover.rendering")
						: `${mode === "frame" ? t(locale, "cover.framePrefix") : ""}${
								mode !== "asset" ? seekSec.toFixed(1) + "s" : ""
							}`}
				</span>
			</div>

			{mode !== "asset" && durationSec > 0 ? (
				<div className="px-1">
					<Slider
						max={durationSec}
						min={0}
						step={0.1}
						value={[Math.min(seekSec, durationSec)]}
						onValueChange={([value]) => setSeekSec(value)}
						aria-label={t(locale, "cover.seekLabel")}
					/>
				</div>
			) : null}

			<div className="grid grid-cols-2 gap-1.5">
				<Button
					className="h-7 text-xs"
					disabled={busy || isDemoMode() || durationSec <= 0}
					onClick={handleUseFrame}
					size="sm"
					variant="outline"
				>
					<Image className="size-3.5" />
					{t(locale, "cover.useFrame")}
				</Button>
				<Button
					className="h-7 text-xs"
					disabled={isDemoMode()}
					onClick={handlePickAsset}
					size="sm"
					variant="outline"
				>
					<Film className="size-3.5" />
					{t(locale, "cover.pickAsset")}
				</Button>
			</div>

			<div className="flex items-center justify-between">
				<span className="text-[11px] text-muted-foreground">
					{t(locale, "cover.current", { mode: t(locale, MODE_LABEL_KEY[mode]) })}
				</span>
				<Button
					className="h-6 px-2 text-[11px]"
					disabled={isDemoMode() || mode === "auto"}
					onClick={handleAuto}
					size="sm"
					variant="ghost"
				>
					<RefreshCw className="size-3" />
					{t(locale, "cover.restoreAuto")}
				</Button>
			</div>

			{applied ? (
				<p className="flex items-center gap-1 text-[11px] text-constructive">
					<Check className="size-3" /> {t(locale, "cover.updated")}
				</p>
			) : null}
		</div>
	);
}
