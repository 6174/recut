/*
 * [INPUT]: 无外部依赖（浏览器 Video/Canvas 仅在调用时创建）
 * [OUTPUT]: 对外提供视频首帧的「可绘制 URL」缓存：videoFrameUrl（已就绪返回 blob URL，否则 null）、
 *           ensureVideoFrame（幂等抽取/升档：<video preload=metadata> 按需定位解码首帧 → canvas → JPEG blob URL；
 *           requiredPixels 按视口需求分档 [1024, 2048, 4096]，只升不降且不超过视频原始长边，升档完成再回调重绘）、
 *           resetVideoFrames（测试/调试用）。
 *           视频 URL 不能直接交给图片纹理管线（浏览器不会用 <img> 解码视频），必须先抽成一帧图片。
 * [POS]: lib/pomelo/world-canvas/blocks 的视频首帧抽取（渲染器无关；real-media-block-v / free-element-block-v 共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
// 首帧纹理档位（长边设备像素）：与 pomelo-vello-adapter 的图片档位同阶梯——首次 1024 快速上屏，
// 画布放大到需求超过当前档位时重抽一帧替换（只升不降，且不超过视频原始长边）。
const FRAME_TIERS = [1024, 2048, 4096] as const;
const FRAME_QUALITY = 0.92;
const LOAD_TIMEOUT_MS = 10_000;
// 就绪轮询间隔：用 readyState 轮询而不是 once 事件监听——事件可能在挂监听前已经错过（seek 后 loadeddata 只发一次）
const READY_POLL_MS = 50;

type Frame = { url: string; edge: number; native: number };

// src → 已抽取的首帧（edge = 当前纹理长边，native = 视频原始长边）。
const frames = new Map<string, Frame>();
// 抽取失败（编码不支持 / CORS 污染 canvas / 升档失败）：负缓存不再重试。
// 已有帧时失败只放弃升档，原帧继续用于渲染。
const failed = new Set<string>();
// 在途抽取（同一 src 只跑一次；升档中仍继续用旧帧，就绪后再切换）。
const pending = new Map<string, { edge: number; onReady: () => void }>();

function tierFor(requiredPixels?: number): number {
  const wanted = requiredPixels && requiredPixels > 0 ? requiredPixels : FRAME_TIERS[0];
  for (const tier of FRAME_TIERS) if (wanted <= tier) return tier;
  return FRAME_TIERS[FRAME_TIERS.length - 1];
}

/** 已抽取完成的首帧 blob URL；未就绪/失败返回 null。 */
export function videoFrameUrl(src: string): string | null {
  return src ? frames.get(src)?.url ?? null : null;
}

/** 幂等触发首帧抽取/升档；新帧就绪后回调一次（调用方在回调里 adapter.refreshBlocks() 重绘）。 */
export function ensureVideoFrame(src: string, onReady: () => void, requiredPixels?: number): void {
  if (!src || typeof document === "undefined") return;
  if (failed.has(src)) return;
  const desired = tierFor(requiredPixels);
  const current = frames.get(src);
  // 当前帧已够（或已到视频原始分辨率）：不用再抽
  if (current && current.edge >= Math.min(desired, current.native)) return;
  const inflight = pending.get(src);
  if (inflight) {
    if (inflight.edge >= desired) return;
    inflight.edge = desired;
    inflight.onReady = onReady;
    return;
  }
  pending.set(src, { edge: desired, onReady });
  void extract(src, desired);
}

/** 丢弃缓存（测试/调试）。 */
export function resetVideoFrames(): void {
  for (const frame of frames.values()) URL.revokeObjectURL(frame.url);
  frames.clear();
  failed.clear();
  pending.clear();
}

function waitUntil(ready: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const step = () => {
      if (ready()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("video wait timeout"));
        return;
      }
      setTimeout(step, READY_POLL_MS);
    };
    step();
  });
}

async function extract(src: string, desiredEdge: number): Promise<void> {
  const video = document.createElement("video");
  let objectUrl: string | null = null;
  try {
    // crossOrigin：远程 content 流要能读像素（drawImage + toBlob）；同源/blob 设置无副作用。
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    // 只要元数据 + 首帧那一段，不为一张封面下载整支视频
    video.preload = "metadata";
    video.src = src;
    await waitUntil(() => video.readyState >= 1 || Boolean(video.error), LOAD_TIMEOUT_MS);
    if (video.error) throw new Error("video load error");
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    // t=0 常是黑场/未解码帧：定位到略靠前的一帧（定位本身会按需拉取该处数据）
    if (duration > 0.2) video.currentTime = Math.min(0.1, duration / 2);
    await waitUntil(() => (video.readyState >= 2 && video.videoWidth > 0) || Boolean(video.error), LOAD_TIMEOUT_MS);
    if (video.error) throw new Error("video decode error");
    const nativeEdge = Math.max(video.videoWidth, video.videoHeight);
    if (!nativeEdge) throw new Error("video has no decodable frame");
    // 只降采样、绝不放大超过原始分辨率（放大只会得到插值出来的假细节）
    const edge = Math.min(desiredEdge, nativeEdge);
    const scale = edge / nativeEdge;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    objectUrl = await new Promise<string | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/jpeg", FRAME_QUALITY);
    });
    if (!objectUrl) throw new Error("frame encode failed");
    const request = pending.get(src);
    pending.delete(src);
    const previous = frames.get(src);
    frames.set(src, { url: objectUrl, edge, native: nativeEdge });
    // 所有权移交缓存；替换掉旧档位的 blob（适配器已解码的源 Image 不受影响）
    objectUrl = null;
    if (previous) URL.revokeObjectURL(previous.url);
    try {
      request?.onReady();
    } catch {
      // 重绘回调异常不影响已缓存的帧
    }
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    pending.delete(src);
    failed.add(src);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
