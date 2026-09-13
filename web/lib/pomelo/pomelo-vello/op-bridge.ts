/*
 * [INPUT]: 无外部依赖
 * [OUTPUT]: 对外提供 VelloOp 词汇与 encodeOps()：把 chunk 的绘制编码为小端字节流，
 *           与 pomelo-vello-wasm/src/ops.rs 的格式一一对应（无总数头，可拼接）。
 * [POS]: pomelo-vello 的 JS→WASM 绘制 op 桥。
 * [PROTOCOL]: 变更时更新此头部；修改格式必须同步 Rust ops.rs。
 */
export const OP_KIND = {
  RoundRect: 1,
  QuadStroke: 2,
  TriangleFill: 3,
  RectFill: 4,
  Text: 5,
  Image: 6,
  BlurRect: 7,
  PushClipRoundRect: 8,
  PopClip: 9,
} as const;

export type Rgba = [number, number, number, number];
export type Vec2 = [number, number];

export type VelloOp =
  | {
      kind: "roundRect";
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      fill: Rgba;
      stroke: Rgba;
      strokeWidth: number;
    }
  | {
      kind: "quadStroke";
      p0: Vec2;
      cp: Vec2;
      p1: Vec2;
      stroke: Rgba;
      strokeWidth: number;
    }
  | { kind: "triangleFill"; points: [Vec2, Vec2, Vec2]; fill: Rgba }
  | { kind: "rectFill"; x: number; y: number; width: number; height: number; fill: Rgba }
  | {
      kind: "text";
      fontId: number;
      x: number;
      y: number;
      size: number;
      maxWidth?: number;
      lineHeight?: number;
      align?: "left" | "center" | "right";
      fill: Rgba;
      text: string;
    }
  | { kind: "image"; imageId: number; x: number; y: number; width: number; height: number }
  | { kind: "blurRect"; x: number; y: number; width: number; height: number; radius: number; stdDev: number; fill: Rgba }
  | { kind: "pushClipRoundRect"; x: number; y: number; width: number; height: number; radius: number }
  | { kind: "popClip" };

const TRANSPARENT: Rgba = [0, 0, 0, 0];
const TEXT_ENCODER = new TextEncoder();
const ALIGN_CODE: Record<string, number> = { left: 0, center: 1, right: 2 };

export function encodeOps(ops: VelloOp[]): Uint8Array {
  const out: number[] = [];
  const view = new DataView(new ArrayBuffer(4));
  const pushF32 = (value: number) => {
    view.setFloat32(0, value, true);
    out.push(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  };
  const pushRgba = (color: Rgba) => out.push(color[0], color[1], color[2], color[3]);
  const pushPair = (p: Vec2) => {
    pushF32(p[0]);
    pushF32(p[1]);
  };

  for (const op of ops) {
    switch (op.kind) {
      case "roundRect":
        out.push(OP_KIND.RoundRect);
        pushF32(op.x);
        pushF32(op.y);
        pushF32(op.width);
        pushF32(op.height);
        pushF32(op.radius);
        pushRgba(op.fill);
        pushRgba(op.stroke ?? TRANSPARENT);
        pushF32(op.strokeWidth ?? 0);
        break;
      case "quadStroke":
        out.push(OP_KIND.QuadStroke);
        pushPair(op.p0);
        pushPair(op.cp);
        pushPair(op.p1);
        pushRgba(op.stroke);
        pushF32(op.strokeWidth);
        break;
      case "triangleFill":
        out.push(OP_KIND.TriangleFill);
        pushPair(op.points[0]);
        pushPair(op.points[1]);
        pushPair(op.points[2]);
        pushRgba(op.fill);
        break;
      case "rectFill":
        out.push(OP_KIND.RectFill);
        pushF32(op.x);
        pushF32(op.y);
        pushF32(op.width);
        pushF32(op.height);
        pushRgba(op.fill);
        break;
      case "pushClipRoundRect":
        out.push(OP_KIND.PushClipRoundRect);
        pushF32(op.x);
        pushF32(op.y);
        pushF32(op.width);
        pushF32(op.height);
        pushF32(op.radius);
        break;
      case "popClip":
        out.push(OP_KIND.PopClip);
        break;
      case "blurRect":
        out.push(OP_KIND.BlurRect);
        pushF32(op.x);
        pushF32(op.y);
        pushF32(op.width);
        pushF32(op.height);
        pushF32(op.radius);
        pushF32(op.stdDev);
        pushRgba(op.fill);
        break;
      case "image":
        out.push(OP_KIND.Image);
        out.push(op.imageId & 0xff, (op.imageId >>> 8) & 0xff, (op.imageId >>> 16) & 0xff, (op.imageId >>> 24) & 0xff);
        pushF32(op.x);
        pushF32(op.y);
        pushF32(op.width);
        pushF32(op.height);
        break;
      case "text": {
        out.push(OP_KIND.Text);
        out.push(op.fontId & 0xff, (op.fontId >>> 8) & 0xff, (op.fontId >>> 16) & 0xff, (op.fontId >>> 24) & 0xff);
        pushF32(op.x);
        pushF32(op.y);
        pushF32(op.size);
        pushF32(op.maxWidth ?? 0);
        pushF32(op.lineHeight ?? 0);
        out.push(ALIGN_CODE[op.align ?? "left"] ?? 0);
        pushRgba(op.fill);
        const encoded = TEXT_ENCODER.encode(op.text);
        out.push(encoded.length & 0xff, (encoded.length >>> 8) & 0xff, (encoded.length >>> 16) & 0xff, (encoded.length >>> 24) & 0xff);
        for (const byte of encoded) out.push(byte);
        break;
      }
    }
  }
  return new Uint8Array(out);
}
