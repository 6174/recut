import { EditorCore } from "@/core";
import { mediaTimeFromSeconds } from "@/wasm";
import { buildLibraryAudioElement } from "@/timeline/element-utils";
import type { AudioLibraryItem } from "@/audio-library/types";
import { audioAssetUrl } from "@/audio-library/catalog";
import {
  createAudioObjectUrl,
  loadAudioFile,
  saveAudioFile,
} from "@/audio-library/cache";

/**
 * 从 CDN 下载音频到编辑器内部 OPFS 缓存（跨项目共享，不进「素材」面板）。
 *
 * 流程：fetch CDN mp3 → 构造 File → 存 OPFS cache（key = item.id）→ 返回
 * 可播放 objectURL。下载成功后该音频在「音频」面板直接可播放、可加入时间线。
 */
export async function downloadAudioToCache({
  item,
  onProgress,
}: {
  item: AudioLibraryItem;
  onProgress?: ({ progress }: { progress: number }) => void;
}): Promise<{ url: string; file: File }> {
  const url = audioAssetUrl(item.url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("Content-Length") ?? 0);
  const reader = response.body?.getReader();
  let received = 0;
  const chunks: BlobPart[] = [];

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value as unknown as BlobPart);
        received += value.length;
        if (contentLength > 0 && onProgress) {
          onProgress({
            progress: Math.round((received / contentLength) * 100),
          });
        }
      }
    }
  } else {
    const arrayBuffer = await response.arrayBuffer();
    chunks.push(arrayBuffer);
  }

  const blob = new Blob(chunks, { type: "audio/mpeg" });
  const file = new File([blob], `${item.id}.mp3`, { type: "audio/mpeg" });

  await saveAudioFile({ audioId: item.id, file });
  return { url: createAudioObjectUrl(file), file };
}

/**
 * 把已下载（缓存中的）音频加入时间线，走 library audio element（sourceUrl +
 * buffer，不依赖 media assets）。已缓存文件优先本地 URL；否则回退 CDN URL。
 */
export async function addCachedAudioToTimeline({
  item,
}: {
  item: AudioLibraryItem;
}): Promise<void> {
  const editor = EditorCore.getInstance();
  const currentTime = editor.playback.getCurrentTime();

  const cached = await loadAudioFile({ audioId: item.id });
  const sourceUrl = cached
    ? createAudioObjectUrl(cached)
    : audioAssetUrl(item.url);

  const element = buildLibraryAudioElement({
    sourceUrl,
    name: item.name,
    duration: mediaTimeFromSeconds({ seconds: item.duration }),
    startTime: currentTime,
    audioId: item.id,
  });

  editor.timeline.insertElement({
    placement: { mode: "auto", trackType: "audio" },
    element,
  });
}
