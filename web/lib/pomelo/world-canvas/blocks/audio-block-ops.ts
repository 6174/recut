/*
 * [INPUT]: 依赖 pomelo-vello（PomeloRendererAdapter / VelloOp / vello-text）、graph-theme（音频配色单一真源）、
 *          world-canvas/audio-waveform（懒加载真实峰值）
 * [OUTPUT]: 对外提供 audioPlayerOpsV：把音频画成「音频卡」——强调色圆形标记（有源=音符♪，空态=加号）
 *           + 波形（有源且已懒加载解码 → 真实解码峰值；解码中/空态 → 骨架柱）+ 时间
 *           （空态「--:-- / --:--」与「双击添加音频」提示）。
 *           刻意**不画播放三角/音量/下载等可点击控件**：画布上这些按钮点不动，画出来是误导。
 *           音频块为固定尺寸（见 audio-block-metrics），故只有一种布局。
 * [POS]: lib/pomelo/world-canvas/blocks 的音频 block 绘制辅助（real-media-block-v / free-element-block-v 共用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloRendererAdapter } from "../../pomelo-core/pomelo-renderer";
import type { Rgba, VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { AUDIO_ACCENT, AUDIO_ON_ACCENT, AUDIO_SKELETON, AUDIO_WAVE, TEXT_SECONDARY, TEXT_TERTIARY } from "../graph-theme";
import { ensureWaveform, waveformPeaks } from "../audio-waveform";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AudioPlayerOptions {
  /** 空态（无媒体源）：加号标记 + 骨架波形 + 「双击添加音频」。 */
  empty?: boolean;
}

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_MIN_HEIGHT = 3;
const BAR_SKELETON_VALUE = 0.38;
const BOTTOM_TEXT_SIZE = 11;
const BOTTOM_ROW_HEIGHT = 13;
const EMPTY_HINT = "双击添加音频";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 圆形标记：强调色圆底 + 居中图形（音符 ♪ / 加号）。 */
function circleButtonOps(x: number, y: number, diameter: number, glyph: "note" | "add"): VelloOp[] {
  const cx = x + diameter / 2;
  const cy = y + diameter / 2;
  const ops: VelloOp[] = [
    { kind: "roundRect", x, y, width: diameter, height: diameter, radius: diameter / 2, fill: AUDIO_ACCENT, stroke: [0, 0, 0, 0], strokeWidth: 0 },
  ];
  if (glyph === "note") {
    const headRadius = diameter * 0.13;
    const headCx = cx - diameter * 0.11;
    const headCy = cy + diameter * 0.25;
    const stemWidth = Math.max(1.4, diameter * 0.055);
    const stemLeft = headCx + headRadius - stemWidth / 2;
    const stemTop = cy - diameter * 0.28;
    ops.push({ kind: "rectFill", x: stemLeft, y: stemTop, width: stemWidth, height: headCy - stemTop, fill: AUDIO_ON_ACCENT });
    ops.push({ kind: "roundRect", x: headCx - headRadius, y: headCy - headRadius, width: headRadius * 2, height: headRadius * 2, radius: headRadius, fill: AUDIO_ON_ACCENT, stroke: [0, 0, 0, 0], strokeWidth: 0 });
    ops.push({ kind: "quadStroke", p0: [stemLeft + stemWidth, stemTop], cp: [stemLeft + diameter * 0.26, stemTop + diameter * 0.08], p1: [stemLeft + diameter * 0.06, stemTop + diameter * 0.34], stroke: AUDIO_ON_ACCENT, strokeWidth: stemWidth });
  } else {
    const span = diameter * 0.34;
    const thickness = Math.max(1.4, diameter * 0.07);
    ops.push({ kind: "rectFill", x: cx - span / 2, y: cy - thickness / 2, width: span, height: thickness, fill: AUDIO_ON_ACCENT });
    ops.push({ kind: "rectFill", x: cx - thickness / 2, y: cy - span / 2, width: thickness, height: span, fill: AUDIO_ON_ACCENT });
  }
  return ops;
}

/** 把已解码峰值重采样到 `count` 根柱子；peaks=null 时画均匀骨架柱。 */
function samplePeak(peaks: number[], index: number, count: number): number {
  const start = Math.floor((index / count) * peaks.length);
  const end = Math.max(start + 1, Math.floor(((index + 1) / count) * peaks.length));
  let peak = 0;
  for (let cursor = start; cursor < end && cursor < peaks.length; cursor++) {
    if (peaks[cursor] > peak) peak = peaks[cursor];
  }
  return peak;
}

/** 波形柱（以 centerY 为基线上下对称）。 */
function waveBarsOps(left: number, centerY: number, width: number, maxHeight: number, peaks: number[] | null): VelloOp[] {
  if (width < BAR_WIDTH) return [];
  const step = BAR_WIDTH + BAR_GAP;
  const count = Math.max(1, Math.floor((width + BAR_GAP) / step));
  const span = count * step - BAR_GAP;
  const startX = left + (width - span) / 2;
  const ops: VelloOp[] = [];
  for (let index = 0; index < count; index++) {
    const value = peaks ? samplePeak(peaks, index, count) : BAR_SKELETON_VALUE;
    const barHeight = Math.max(BAR_MIN_HEIGHT, value * maxHeight);
    ops.push({
      kind: "roundRect",
      x: startX + index * step,
      y: centerY - barHeight / 2,
      width: BAR_WIDTH,
      height: barHeight,
      radius: BAR_WIDTH / 2,
      fill: peaks ? AUDIO_WAVE : AUDIO_SKELETON,
      stroke: [0, 0, 0, 0],
      strokeWidth: 0,
    });
  }
  return ops;
}

/**
 * 音频卡外观：上排「圆形标记 + 波形」，下排「时间」（空态为 --:-- / --:-- 与「双击添加音频」提示）。
 * 有源时波形按真实解码峰值懒加载：本帧未就绪时画骨架，并在就绪后触发 adapter.refreshBlocks() 重绘。
 */
export function audioPlayerOpsV(adapter: PomeloRendererAdapter, box: Box, src: string, options: AudioPlayerOptions = {}): VelloOp[] {
  const paddingX = Math.min(14, box.width * 0.08);
  const paddingY = Math.min(12, box.height * 0.14);
  const left = box.x + paddingX;
  const top = box.y + paddingY;
  const width = Math.max(0, box.width - paddingX * 2);
  const height = Math.max(0, box.height - paddingY * 2);
  if (width < 24 || height < 20) return [];

  const empty = options.empty ?? !src;
  const waveform = empty ? null : waveformPeaks(src);
  if (!empty && !waveform) ensureWaveform(src, () => adapter.refreshBlocks());
  const peaks = waveform?.peaks ?? null;
  const timeText = empty || !waveform || waveform.durationSec <= 0 ? "--:-- / --:--" : `0:00 / ${formatClock(waveform.durationSec)}`;

  const ops: VelloOp[] = [];
  const diameter = clamp(Math.min(height * 0.38, width * 0.22), 24, 56);
  const centerY = top + height * 0.42;
  ops.push(...circleButtonOps(left, centerY - diameter / 2, diameter, empty ? "add" : "note"));

  const waveLeft = left + diameter + Math.max(12, diameter * 0.32);
  ops.push(...waveBarsOps(waveLeft, centerY, left + width - waveLeft, Math.min(height * 0.5, 64), peaks));

  const bottomTop = top + height - BOTTOM_ROW_HEIGHT;
  ops.push(textOp({ text: timeText, x: left, y: bottomTop, size: BOTTOM_TEXT_SIZE, maxWidth: width, fill: empty ? TEXT_TERTIARY : TEXT_SECONDARY }));
  if (empty) {
    // wasm 侧 align=right 的 x 是「布局盒左端」，右端落在 x + maxWidth（见 ops.rs emit_glyphs）
    ops.push(textOp({ text: EMPTY_HINT, x: left, y: bottomTop, size: BOTTOM_TEXT_SIZE, maxWidth: width, align: "right", fill: TEXT_SECONDARY }));
  }
  return ops;
}
