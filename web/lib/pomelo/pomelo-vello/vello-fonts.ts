/*
 * [INPUT]: 依赖浏览器 fetch 与 Cache Storage（无第三方依赖）
 * [OUTPUT]: 对外提供：
 *           - FONT_URLS：世界画布字体资源地址（拉丁 / 完整中文 / 内置中文子集）
 *           - loadFontBytes(url)：先命中 Cache Storage，未命中才走网络并回填缓存
 *           - 字体加载进度快照 subscribeFontLoad / getFontLoadSnapshot（React 经 useSyncExternalStore 订阅）
 * [POS]: pomelo-vello 的字体资源层。完整中文字体约 16MB，而 /vello-wasm/* 由静态站以
 *        `Cache-Control: public, max-age=0` 提供——HTTP 缓存每次都要回源校验，devtools「禁用缓存」、
 *        无痕模式或缓存被逐出时更是整包重下。这里用 Cache Storage 把「只下载一次」变成显式契约：
 *        命中后零网络、与页面生命周期无关，并能在首次下载时给出确定进度。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const FONT_URLS = {
  latin: "/vello-wasm/space-grotesk.ttf",
  cjk: "/vello-wasm/noto-sans-sc.otf",
  cjkSubset: "/vello-wasm/noto-cjk-subset.otf",
} as const;

// 字体文件本身变化（重新 subset / 换版本）时递增，避免命中旧字节。
const CACHE_VERSION = "1";
const CACHE_NAME = `recut-vello-fonts-v${CACHE_VERSION}`;

export type FontLoadPhase = "idle" | "loading" | "ready" | "failed";

export interface FontLoadSnapshot {
  phase: FontLoadPhase;
  /** 当前文件已接收字节（命中缓存时为 1/1 表示瞬时完成）。 */
  loadedBytes: number;
  /** 当前文件总字节；content-length 缺失时为 0。 */
  totalBytes: number;
  /** 本轮是否全部来自浏览器缓存（无网络下载）。 */
  fromCache: boolean;
}

const IDLE: FontLoadSnapshot = { phase: "idle", loadedBytes: 0, totalBytes: 0, fromCache: false };

let snapshot: FontLoadSnapshot = IDLE;
const listeners = new Set<() => void>();

function emit(next: FontLoadSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeFontLoad(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFontLoadSnapshot(): FontLoadSnapshot {
  return snapshot;
}

export function beginFontLoad(): void {
  emit({ phase: "loading", loadedBytes: 0, totalBytes: 0, fromCache: false });
}

export function reportFontProgress(loadedBytes: number, totalBytes: number): void {
  emit({ ...snapshot, phase: "loading", loadedBytes, totalBytes });
}

export function finishFontLoad(fromCache: boolean): void {
  emit({ phase: "ready", loadedBytes: 0, totalBytes: 0, fromCache });
}

export function failFontLoad(): void {
  emit({ phase: "failed", loadedBytes: 0, totalBytes: 0, fromCache: false });
}

export interface FontBytes {
  bytes: Uint8Array;
  fromCache: boolean;
}

// Cache Storage 以绝对 URL 为键；相对路径在不同页面上会解析成不同键，故先绝对化。
function fontCacheKey(url: string): string {
  return new URL(url, window.location.href).href;
}

async function openFontCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(CACHE_NAME);
  } catch {
    // 非安全上下文 / 隐私模式禁用 Cache Storage：退化为普通网络请求。
    return null;
  }
}

/** 流式读取响应体并上报进度；流不可用时退化为整体读取。 */
async function readWithProgress(response: Response, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  // content-length 是压缩后长度（静态站对 otf 走 gzip），解码后可能更大——进度只作参考。
  const total = Number(response.headers.get("content-length") ?? 0) || 0;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * 读取字体字节：命中 Cache Storage 直接返回（零网络），否则下载并回填缓存。
 * 资源缺失（404）返回 null，由调用方决定回退；网络/缓存异常向上抛出。
 */
export async function loadFontBytes(url: string, onProgress?: (loaded: number, total: number) => void): Promise<FontBytes | null> {
  const cache = await openFontCache();
  const key = fontCacheKey(url);
  let hit: Response | undefined;
  if (cache) {
    try {
      hit = await cache.match(key);
    } catch {
      // 缓存读取失败按未命中处理
    }
  }
  // 命中路径必须在 try 之外处理进度回调：调用方抛错时不得被误判成「缓存未命中」而重下整包字体。
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    onProgress?.(bytes.length, bytes.length);
    return { bytes, fromCache: true };
  }
  const response = await fetch(url);
  if (!response.ok) return null;
  // 先 clone 落缓存再读原响应：缓存里存的是原始字节，后续访问不再走网络。
  if (cache) {
    try {
      await cache.put(key, response.clone());
    } catch {
      // 配额不足 / 隐私模式：忽略，本次仍可正常渲染。
    }
  }
  return { bytes: await readWithProgress(response, (loaded, total) => onProgress?.(loaded, total)), fromCache: false };
}
