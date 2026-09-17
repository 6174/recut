import type { TScene } from "@timeline/timeline";
import type { LibraryAudioElement } from "@timeline/timeline/types";
import { createAudioObjectUrl, loadAudioFile } from "@timeline/audio-library/cache";

/**
 * 恢复项目时间线里 library audio 的可播放 sourceUrl。
 *
 * 下载的音频加入时间线后 sourceUrl 是 blob objectURL，页面刷新即失效；
 * 保存项目时 buffer 被剥离。重新打开项目时，凭元素上的 audioId 从 OPFS
 * 缓存重建本地 objectURL，保证离线也能播放。缓存缺失时回退到 CDN URL
 * （用 audioId 推断不到 CDN url，调用方需传入 fallback 映射）。
 */
export async function restoreLibraryAudioSourceUrls({
  scenes,
  resolveCdnUrl,
}: {
  scenes: TScene[];
  resolveCdnUrl?: (audioId: string) => string | null | Promise<string | null>;
}): Promise<void> {
  const audioElements: LibraryAudioElement[] = [];
  for (const scene of scenes) {
    for (const track of scene.tracks.audio) {
      for (const element of track.elements) {
        if (
          element.type === "audio" &&
          element.sourceType === "library" &&
          element.audioId
        ) {
          audioElements.push(element);
        }
      }
    }
  }

  for (const element of audioElements) {
    // http(s) 已是稳定源，无需恢复；blob 在刷新后失效，空值也需要重建。
    const isHttpUrl = /^https?:\/\//.test(element.sourceUrl);
    if (isHttpUrl) {
      continue;
    }
    const isBlobUrl = element.sourceUrl.startsWith("blob:");

    const file = await loadAudioFile({ audioId: element.audioId });
    if (file) {
      // 释放旧的失效 blob URL（若之前创建过）。
      if (isBlobUrl) {
        try {
          URL.revokeObjectURL(element.sourceUrl);
        } catch {
          // Ignore revoke errors on invalid blob URLs.
        }
      }
      element.sourceUrl = createAudioObjectUrl(file);
      continue;
    }

    // 缓存缺失：回退到音频库 CDN URL。拿不到时保持原值，绝不做破坏性清空——
    // 否则下次 restore 会因 sourceUrl 既非 http 也非 blob 而跳过，永久失声。
    const fallback = await resolveCdnUrl?.(element.audioId);
    if (fallback) {
      if (isBlobUrl) {
        try {
          URL.revokeObjectURL(element.sourceUrl);
        } catch {
          // Ignore revoke errors.
        }
      }
      element.sourceUrl = fallback;
    }
  }
}
