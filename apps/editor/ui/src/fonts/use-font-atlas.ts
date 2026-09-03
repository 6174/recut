import { useState, useMemo, useCallback, useEffect } from "react";
import {
	getCachedFontAtlas,
	loadFontAtlas,
	clearFontAtlasCache,
} from "@/fonts/google-fonts";
import {
	getCachedFontCatalog,
	loadFontCatalog,
	clearFontCatalogCache,
} from "@/fonts/service-catalog";
import type { FontAtlas } from "@/fonts/types";
import { SYSTEM_FONTS } from "@/fonts/system-fonts";
import {
	listInstalledFonts,
	getInstalledFontsSource,
	clearInstalledFontsCache,
	type InstalledFont,
} from "@/fonts/local-fonts";

type Status = "idle" | "loading" | "error";

export interface FontSourceItem {
	family: string;
	source: "google" | "system" | "upload";
	category?: string;
	scripts?: string[];
	weights?: number[];
	uploadedId?: string;
}

export function useFontAtlas({ open }: { open: boolean }) {
	const [atlas, setAtlas] = useState<FontAtlas | null>(() =>
		getCachedFontAtlas(),
	);
	const [status, setStatus] = useState<Status>(() =>
		getCachedFontAtlas() ? "idle" : "loading",
	);

	useEffect(() => {
		if (!open || atlas) return;

		setStatus("loading");
		loadFontAtlas().then((data) => {
			if (data) {
				setAtlas(data);
				setStatus("idle");
			} else {
				setStatus("error");
			}
		});
	}, [open, atlas]);

	const retry = useCallback(() => {
		clearFontAtlasCache();
		clearFontCatalogCache();
		clearInstalledFontsCache();
		setStatus("loading");
		loadFontAtlas().then((data) => {
			if (data) {
				setAtlas(data);
				setStatus("idle");
			} else {
				setStatus("error");
			}
		});
	}, []);

	// Google 目录（来自 service）+ 已上传本地字体，缓存到目录快照加载完成。
	const [googleCatalog, setGoogleCatalog] = useState<
		FontSourceItem[] | null
	>(null);
	const [uploadedFonts, setUploadedFonts] = useState<FontSourceItem[]>([]);
	const [installedFonts, setInstalledFonts] = useState<InstalledFont[]>([]);

	useEffect(() => {
		if (!open) return;
		loadFontCatalog().then((catalog) => {
			if (catalog) {
				setGoogleCatalog(
					catalog.google.map((font) => ({
						family: font.family,
						source: "google" as const,
						category: font.category,
						scripts: font.scripts,
						weights: font.weights,
					})),
				);
				setUploadedFonts(
					catalog.local.map((font) => ({
						family: font.family,
						source: "upload" as const,
						uploadedId: font.id,
					})),
				);
			}
		});
		listInstalledFonts().then((installed) => setInstalledFonts(installed));
	}, [open]);

	const fontNames = useMemo(() => {
		const names = new Set<string>();
		if (googleCatalog) {
			for (const item of googleCatalog) names.add(item.family);
		}
		for (const item of uploadedFonts) names.add(item.family);
		for (const font of installedFonts) names.add(font.family);
		for (const family of SYSTEM_FONTS) names.add(family);
		return [...names].sort();
	}, [googleCatalog, uploadedFonts, installedFonts]);

	// Google 家族（供 Google Tab）：atlas 有 preview 则优先（含拉丁预览图），
	// CJK 家族在 atlas 中也有对应名字形预览（atlas 覆盖全部 Google Fonts）。
	const googleFonts = useMemo(() => {
		return (googleCatalog ?? []).filter((item) => item.source === "google");
	}, [googleCatalog]);

	const allItems = useMemo<FontSourceItem[]>(() => {
		const items: FontSourceItem[] = [];
		if (googleCatalog) items.push(...googleCatalog);
		for (const item of uploadedFonts) items.push(item);
		for (const font of installedFonts) {
			if (!items.some((item) => item.family === font.family)) {
				items.push({ family: font.family, source: "system" });
			}
		}
		for (const family of SYSTEM_FONTS) {
			if (!items.some((item) => item.family === family)) {
				items.push({ family, source: "system" });
			}
		}
		return items;
	}, [googleCatalog, uploadedFonts, installedFonts]);

	const installedSource = getInstalledFontsSource();

	return {
		atlas,
		status,
		fontNames,
		googleFonts,
		uploadedFonts,
		installedFonts,
		installedSource,
		allItems,
		retry,
	};
}
