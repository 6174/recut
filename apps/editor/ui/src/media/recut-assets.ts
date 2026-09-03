/**
 * [INPUT]: 依赖 recut.assets SDK、浏览器 File/Blob 与本地化 toast。
 * [OUTPUT]: 提供平台素材选择结果的下载适配，文件字节始终由宿主授权的 Assets URL 取得。
 * [POS]: media 的跨平台素材导入适配层；不猜测 Service origin，也不拥有素材真相。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { toast } from "sonner";
import { t, getRecutLocale } from "@/i18n";
import { recut } from "@/recut/sdk";

export type RecutMediaKind = "image" | "video" | "audio";

export interface RecutAssetPick {
	id: string;
	name: string;
	kind: "image" | "video" | "audio" | "transcript" | "reference";
	mimeType: string;
	status: string;
}

/** 打开全局 Recut 素材选择器，返回用户挑选的图片 / 视频 / 音频素材（可多选）。 */
export async function pickRecutMediaAssets({
	multiple = true,
}: {
	multiple?: boolean;
} = {}): Promise<RecutAssetPick[]> {
	const selection = await recut.media.pick({
		kinds: ["image", "video", "audio"],
		multiple,
	});
	if (!selection) return [];
	const picks = Array.isArray(selection) ? selection : [selection];
	return picks.filter(
		(pick): pick is RecutAssetPick =>
			Boolean(
				pick &&
					typeof pick === "object" &&
					typeof pick.id === "string" &&
					(pick.kind === "image" ||
						pick.kind === "video" ||
						pick.kind === "audio"),
			),
	);
}

/** 把选中的全局素材内容下载为本地 File，供既有媒体管线处理。 */
export async function downloadRecutMediaFiles({
	assets,
}: {
	assets: RecutAssetPick[];
}): Promise<File[]> {
	const files: File[] = [];
	for (const asset of assets) {
		try {
			const response = await fetch(
				await recut.assets.contentURL({ assetId: asset.id }),
			);
			if (!response.ok) {
				throw new Error(`Failed to fetch content (${response.status})`);
			}
			const blob = await response.blob();
			const file = new File([blob], asset.name || `${asset.kind}-${asset.id}`, {
				type: asset.mimeType || inferMimeType({ name: asset.name, kind: asset.kind }),
			});
			files.push(file);
		} catch (error) {
			console.error("Failed to import Recut asset:", asset, error);
			toast.error(t(getRecutLocale(), "media.failedImport", { name: asset.name }));
		}
	}
	return files;
}

function inferMimeType({
	name,
	kind,
}: {
	name: string;
	kind: RecutAssetPick["kind"];
}): string {
	const extension = name.split(".").pop()?.toLowerCase();
	const imageExtensions: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		webp: "image/webp",
		gif: "image/gif",
		svg: "image/svg+xml",
	};
	const videoExtensions: Record<string, string> = {
		mp4: "video/mp4",
		webm: "video/webm",
		mov: "video/quicktime",
		mkv: "video/x-matroska",
	};
	const audioExtensions: Record<string, string> = {
		mp3: "audio/mpeg",
		wav: "audio/wav",
		ogg: "audio/ogg",
		m4a: "audio/mp4",
		aac: "audio/aac",
		flac: "audio/flac",
	};
	if (extension && imageExtensions[extension]) return imageExtensions[extension];
	if (extension && videoExtensions[extension]) return videoExtensions[extension];
	if (extension && audioExtensions[extension]) return audioExtensions[extension];
	if (kind === "image" || kind === "reference") return "image/png";
	if (kind === "video") return "video/mp4";
	return "audio/mpeg";
}
