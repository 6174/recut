/**
 * [INPUT]: 依赖旧 OPFS 元数据与 Assets Service 返回的状态/内容哈希。
 * [OUTPUT]: 提供编辑器可渲染的 MediaAsset 类型与 image/video/audio 分类。
 * [POS]: media 的类型边界；file 是本 origin 缓存副本，status/contentHash 反映 Service Asset 真相。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { MediaAssetData } from "@/services/storage/types";

export type MediaType = "image" | "video" | "audio";

export interface MediaAsset
	extends Omit<MediaAssetData, "size" | "lastModified"> {
	file: File;
	url?: string;
	/** Assets Service 的权威状态；`loading` 仅表示当前 origin 的 OPFS 缓存尚未完成。 */
	status?: "completed" | "loading" | "deleted" | "failed" | "queued" | "running";
	contentHash?: string;
	sizeBytes?: number;
}
