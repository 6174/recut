/*
 * [INPUT]: 浏览器 fetch + WebAudio decodeAudioData（无第三方依赖）
 * [OUTPUT]: 对外提供 waveformPeaks(src)（已解码的归一化峰值与时长；未就绪返回 null）与
 *           ensureWaveform(src, onReady)（懒加载入口：首次调用触发 fetch + 解码，就绪/失败后回调一次）。
 *           峰值固定 160 桶、按全局峰值归一化（绘制侧再按柱子数重采样）；并发解码上限 2，其余排队，
 *           避免打开世界时所有音频 block 一次性解码；解码失败（跨域/非音频）负缓存，不重试。
 * [POS]: lib/pomelo/world-canvas 的音频波形懒加载缓存（供音频 block 绘制真实波形；非图片纹理路径）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export interface WaveformPeaks {
  /** 归一化峰值（0..1），长度固定为 BUCKETS。 */
  peaks: number[];
  /** 音频时长（秒）；无法取得时为 0。 */
  durationSec: number;
}

const BUCKETS = 160;
const MAX_IN_FLIGHT = 2;

const decoded = new Map<string, WaveformPeaks>();
const pending = new Set<string>();
/** 解码失败（跨域/非音频/404）负缓存：不再重复请求。 */
const failed = new Set<string>();
/** src → 就绪回调（单一槽位：同一渲染器下多个 block 共享一次重绘，见 ensureWaveform 注释）。 */
const callbacks = new Map<string, () => void>();
const queue: string[] = [];
let inFlight = 0;
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;
  const ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!ctor) return null;
  try {
    audioContext = new ctor();
  } catch {
    return null;
  }
  return audioContext;
}

/** 已解码的波形；未命中返回 null（不触发加载，请配合 ensureWaveform）。 */
export function waveformPeaks(src: string): WaveformPeaks | null {
  return src ? decoded.get(src) ?? null : null;
}

/**
 * 懒加载波形：首次调用触发下载 + 解码，就绪（或失败）后回调一次。
 * 同一 src 只保留一个回调：同一渲染器下「重绘」会重跑全部 block 的 renderBlock，
 * 因此一个回调足以让同源的所有音频 block 一起换成真实波形；已就绪/已失败则不注册。
 */
export function ensureWaveform(src: string, onReady: () => void): void {
  if (!src || decoded.has(src) || failed.has(src) || callbacks.has(src)) return;
  callbacks.set(src, onReady);
  if (pending.has(src)) return;
  pending.add(src);
  queue.push(src);
  pump();
}

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
    const src = queue.shift()!;
    inFlight += 1;
    void decode(src).finally(() => {
      inFlight -= 1;
      pump();
    });
  }
}

async function decode(src: string): Promise<void> {
  let result: WaveformPeaks | null = null;
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const context = getAudioContext();
    if (!context) throw new Error("AudioContext unavailable");
    const buffer = await context.decodeAudioData(bytes);
    result = { peaks: bucketPeaks(buffer), durationSec: Number.isFinite(buffer.duration) ? buffer.duration : 0 };
  } catch {
    result = null;
  }
  pending.delete(src);
  if (result) decoded.set(src, result);
  else failed.add(src);
  const callback = callbacks.get(src);
  callbacks.delete(src);
  if (callback) {
    try {
      callback();
    } catch {
      // 回调可能指向已卸载的画布：忽略
    }
  }
}

/** 多声道混单后按桶取绝对值峰值，再按全局峰值归一化。 */
function bucketPeaks(buffer: AudioBuffer): number[] {
  const length = buffer.length;
  const channels = Math.min(buffer.numberOfChannels, 2);
  const peaks = new Array<number>(BUCKETS).fill(0);
  if (length <= 0 || channels <= 0) return peaks;
  const data: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel++) data.push(buffer.getChannelData(channel));
  const perBucket = length / BUCKETS;
  let max = 0;
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const start = Math.floor(bucket * perBucket);
    const end = Math.min(length, Math.max(start + 1, Math.floor((bucket + 1) * perBucket)));
    let peak = 0;
    for (let index = start; index < end; index++) {
      for (let channel = 0; channel < channels; channel++) {
        const value = Math.abs(data[channel][index]);
        if (value > peak) peak = value;
      }
    }
    peaks[bucket] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) {
    for (let bucket = 0; bucket < BUCKETS; bucket++) peaks[bucket] /= max;
  }
  return peaks;
}
