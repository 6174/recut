import { fontFamilyToID, fontsAPIBase } from "@/fonts/google-fonts";

export interface ServiceGoogleFont {
	id: string;
	family: string;
	category: string;
	scripts: string[];
	weights: number[];
}

export interface ServiceLocalFont {
	id: string;
	family: string;
	file: string;
	size: number;
	createdAt: string;
}

export interface FontCatalogResponse {
	version: number;
	sources: string[];
	google: ServiceGoogleFont[];
	local: ServiceLocalFont[];
}

let cachedCatalog: FontCatalogResponse | null = null;
let catalogFetchPromise: Promise<FontCatalogResponse | null> | null = null;

export function getCachedFontCatalog(): FontCatalogResponse | null {
	return cachedCatalog;
}

export function clearFontCatalogCache(): void {
	cachedCatalog = null;
	catalogFetchPromise = null;
}

/** 从 service /v1/fonts 拉取 Google 目录 + 已上传本地字体；失败返回 null。 */
export function loadFontCatalog(): Promise<FontCatalogResponse | null> {
	if (cachedCatalog) return Promise.resolve(cachedCatalog);
	if (catalogFetchPromise) return catalogFetchPromise;

	catalogFetchPromise = fetch(`${fontsAPIBase()}/v1/fonts`, {
		cache: "no-store",
	})
		.then(async (response) => {
			if (!response.ok) return null;
			const data: FontCatalogResponse = await response.json();
			cachedCatalog = data;
			return data;
		})
		.catch(() => null);

	return catalogFetchPromise;
}

/** 拉取已上传本地字体（不命中缓存的目录快照，用于面板即时刷新）。 */
export async function listLocalFonts(): Promise<ServiceLocalFont[]> {
	const response = await fetch(`${fontsAPIBase()}/v1/fonts/local`, {
		cache: "no-store",
	});
	if (!response.ok) return [];
	try {
		return (await response.json()) as ServiceLocalFont[];
	} catch {
		return [];
	}
}

/** 上传本地字体文件，返回登记后的条目。 */
export async function uploadLocalFont(
	family: string,
	file: File,
): Promise<ServiceLocalFont> {
	const form = new FormData();
	form.append("family", family);
	form.append("file", file);
	const response = await fetch(`${fontsAPIBase()}/v1/fonts/local`, {
		method: "POST",
		body: form,
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `upload failed (HTTP ${response.status})`);
	}
	return (await response.json()) as ServiceLocalFont;
}

export async function deleteLocalFont(id: string): Promise<void> {
	await fetch(`${fontsAPIBase()}/v1/fonts/local/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

/** 把已上传字体注册到 document.fonts（渲染可用）。 */
export async function registerUploadedFont(
	family: string,
	assetID: string,
): Promise<void> {
	const url = `${fontsAPIBase()}/v1/fonts/local/${encodeURIComponent(assetID)}/content`;
	const existing = [...document.fonts];
	if (
		existing.some(
			(face) =>
				face.family === family.replace(/"/g, "") &&
				face.status === "loaded",
		)
	) {
		return;
	}
	try {
		const response = await fetch(url);
		if (!response.ok) return;
		const buffer = await response.arrayBuffer();
		const face = new FontFace(family, buffer);
		await face.load();
		document.fonts.add(face);
	} catch {
		// ignore: render falls back
	}
}

export { fontFamilyToID };
