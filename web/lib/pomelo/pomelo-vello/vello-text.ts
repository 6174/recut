/*
 * [INPUT]: 依赖 pomelo-renderer（adapter.transform 取视口缩放）、op-bridge（VelloOp/Rgba）
 * [OUTPUT]: 对外提供 vello 文本绘制单一入口：textOp/drawTextCanvas（world 坐标文本，wasm 侧自动换行、
 *           canvas 侧本地换行）与 screenTextOp/drawScreenTextCanvas（屏幕像素恒定文本：font_size 保持屏幕
 *           ppem 由轮廓高精度生成，glyphScale=1/scale 抵消视口缩放，坐标预乘 scale）；附 wrapCanvasText。
 * [POS]: pomelo-vello 的可复用文本绘制层（world-canvas 各 block 共用，避免每处重复处理加粗/换行/屏幕恒定）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloRendererAdapter } from "../pomelo-core/pomelo-renderer";
import type { Rgba, VelloOp } from "./op-bridge";

export type VelloTextAlign = "left" | "center" | "right";

const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", sans-serif';

export interface VelloTextRun {
  text: string;
  /** world x（align=left 左端 / center 中心 / right 右端）。 */
  x: number;
  /** world y（文本顶）。 */
  y: number;
  /** world 字号；wasm 侧据此 shaping/换行。 */
  size: number;
  /** world 换行/对齐宽度；<=0 或缺省不换行。 */
  maxWidth?: number;
  lineHeight?: number;
  align?: VelloTextAlign;
  /** 合成加粗（em 比例，0/缺省不加粗）。 */
  embolden?: number;
  fill: Rgba;
  fontId?: number;
}

export interface VelloScreenTextRun {
  text: string;
  /** world 锚点（内部预乘 scale）。 */
  x: number;
  y: number;
  /** 屏幕字号（px）。 */
  screenSize: number;
  /** 屏幕换行/对齐宽度（px）。 */
  maxScreenWidth?: number;
  align?: VelloTextAlign;
  embolden?: number;
  fill: Rgba;
  fontId?: number;
}

function adapterScale(adapter: PomeloRendererAdapter): number {
  const scale = adapter.transform?.scale;
  return scale && scale > 0 ? scale : 1;
}

function rgbaToCss(color: Rgba): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${(color[3] / 255).toFixed(3)})`;
}

/** world 坐标文本 op。 */
export function textOp(run: VelloTextRun): VelloOp {
  return {
    kind: "text",
    fontId: run.fontId ?? 1,
    x: run.x,
    y: run.y,
    size: run.size,
    ...(run.maxWidth !== undefined ? { maxWidth: run.maxWidth } : {}),
    ...(run.lineHeight !== undefined ? { lineHeight: run.lineHeight } : {}),
    align: run.align ?? "left",
    ...(run.embolden ? { embolden: run.embolden } : {}),
    fill: run.fill,
    text: run.text,
  };
}

/**
 * 屏幕像素恒定文本 op：font_size 用屏幕 ppem（轮廓高精度，避免小字号放大发虚），
 * glyphScale=1/scale 抵消视口缩放，坐标预乘 scale（拖动平移时 VelloBlock 会按 glyphScale 反算）。
 */
export function screenTextOp(adapter: PomeloRendererAdapter, run: VelloScreenTextRun): VelloOp {
  const scale = adapterScale(adapter);
  return {
    kind: "text",
    fontId: run.fontId ?? 1,
    x: run.x * scale,
    y: run.y * scale,
    size: run.screenSize,
    ...(run.maxScreenWidth !== undefined ? { maxWidth: run.maxScreenWidth } : {}),
    align: run.align ?? "left",
    ...(run.embolden ? { embolden: run.embolden } : {}),
    glyphScale: 1 / scale,
    fill: run.fill,
    text: run.text,
  };
}

/** Canvas2D 贪心换行（调用前需先设置 ctx.font 作为度量字体）。 */
export function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!(maxWidth > 0)) return text.split("\n");
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const ch of raw) {
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) {
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

function canvasFont(size: number, embolden?: number): string {
  return `${embolden && embolden > 0 ? 600 : 400} ${size}px ${FONT_STACK}`;
}

/** Canvas2D 回退：world 坐标文本（本地换行）。 */
export function drawTextCanvas(ctx: CanvasRenderingContext2D, run: VelloTextRun): void {
  ctx.fillStyle = rgbaToCss(run.fill);
  ctx.font = canvasFont(run.size, run.embolden);
  ctx.textBaseline = "top";
  ctx.textAlign = run.align ?? "left";
  const lines = run.maxWidth !== undefined ? wrapCanvasText(ctx, run.text, run.maxWidth) : run.text.split("\n");
  const lineHeight = run.lineHeight ?? run.size * 1.2;
  lines.forEach((line, index) => ctx.fillText(line, run.x, run.y + index * lineHeight));
  ctx.textAlign = "left";
}

/** Canvas2D 回退：屏幕像素恒定文本（字号/宽度除以 scale，绘制在 world 变换下）。 */
export function drawScreenTextCanvas(ctx: CanvasRenderingContext2D, adapter: PomeloRendererAdapter, run: VelloScreenTextRun): void {
  const scale = adapterScale(adapter);
  drawTextCanvas(ctx, {
    text: run.text,
    x: run.x,
    y: run.y,
    size: run.screenSize / scale,
    ...(run.maxScreenWidth !== undefined ? { maxWidth: run.maxScreenWidth / scale } : {}),
    align: run.align,
    embolden: run.embolden,
    fill: run.fill,
    fontId: run.fontId,
  });
}
