import { OPFSAdapter } from "@/services/storage/opfs-adapter";
import { storageService } from "@/services/storage/service";

/**
 * 音频素材内部缓存（OPFS）。
 *
 * 下载的 CDN 音频存进浏览器 OPFS 全局目录 `audio-library`（不带 projectId，
 * 跨项目共享），key 为音频 id。播放与时间线都从缓存取 File，不进入「素材」面板。
 *
 * 缓存 File 通过 `URL.createObjectURL` 转成可播放 URL；为防泄漏，调用方应
 * 在不再使用时 revoke。项目重开时用 `loadAudioFile` 从缓存恢复 sourceUrl。
 */
const CACHE_DIR = "audio-library";

let adapter: OPFSAdapter | null = null;

function cacheAdapter(): OPFSAdapter {
  if (!adapter) {
    adapter = new OPFSAdapter(CACHE_DIR);
  }
  return adapter;
}

export async function isAudioCacheSupported(): Promise<boolean> {
  return OPFSAdapter.isSupported() && storageService.isIndexedDBSupported();
}

/** 把下载的音频 File 写入缓存。 */
export async function saveAudioFile({
  audioId,
  file,
}: {
  audioId: string;
  file: File;
}): Promise<void> {
  await cacheAdapter().set({ key: audioId, value: file });
}

/** 从缓存读取音频 File；未缓存返回 null。 */
export async function loadAudioFile({
  audioId,
}: {
  audioId: string;
}): Promise<File | null> {
  return cacheAdapter().get(audioId);
}

/** 缓存中是否存在该音频。 */
export async function hasAudioFile({ audioId }: { audioId: string }): Promise<boolean> {
  return (await cacheAdapter().get(audioId)) !== null;
}

/** 删除缓存中的音频。 */
export async function deleteAudioFile({ audioId }: { audioId: string }): Promise<void> {
  await cacheAdapter().remove(audioId);
}

/** 列出所有已缓存音频 id。 */
export async function listAudioFiles(): Promise<string[]> {
  return cacheAdapter().list();
}

/** 从缓存 File 生成临时可播放 URL（调用方负责 URL.revokeObjectURL）。 */
export function createAudioObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * 把缓存音频转成时间线可用的 sourceUrl。
 * 优先返回 objectURL（可立即播放）；调用方需在 element 生命周期结束后 revoke。
 */
export async function resolveCachedAudioUrl({
  audioId,
}: {
  audioId: string;
}): Promise<string | null> {
  const file = await loadAudioFile({ audioId });
  if (!file) return null;
  return createAudioObjectUrl(file);
}
