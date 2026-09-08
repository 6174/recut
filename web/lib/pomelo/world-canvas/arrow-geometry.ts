/*
 * [INPUT]: 无 pixi 依赖（纯几何），输入为 block record（attrs）与端点卡片记录
 * [OUTPUT]: 对外提供连线几何的单一实现：锚点解析（fromAnchor/toAnchor 归一化，默认节点中心）、
 * 端点在节点边界的裁剪（boundaryPoint）、二次贝塞尔（控制点 = 直线中点 + bend 偏移），
 * 以及 relationGeometry 汇总（t1/t2/a/b/cp/labelPos；边界交点经二分细化，保证端点精确落在
 * 节点矩形边缘，箭头头部不会被节点卡面盖住）；Block 渲染、选中 overlay、命中检测、
 * 连线草稿共用这一份几何，保证四者所见一致
 * [POS]: lib/pomelo/world-canvas 的连线几何模块（对应 tldraw 的 normalizedAnchor + bend 概念）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type Point = { x: number; y: number };
export type Anchor = { x: number; y: number };
export type RectLike = { x: number; y: number; width: number; height: number };

export type BlockLike = {
  type?: string;
  attrs: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fromAnchor?: Anchor;
    toAnchor?: Anchor;
    bend?: { dx: number; dy: number };
    [key: string]: unknown;
  };
} | null | undefined;

// 节点有效矩形解析器：Block（如实体卡）可能有渲染固有尺寸 > attrs 存储尺寸，
// 由 block 模块注册（setNodeRectResolver），保证几何与渲染所见一致；未注册时回退 attrs
type NodeRectResolver = (record: NonNullable<BlockLike>) => RectLike | null;
let nodeRectResolver: NodeRectResolver | null = null;
export function setNodeRectResolver(resolver: NodeRectResolver) {
  nodeRectResolver = resolver;
}

function rectFor(block: NonNullable<BlockLike>): RectLike {
  const resolved = nodeRectResolver?.(block);
  if (resolved) return resolved;
  return {
    x: Number(block.attrs.x) || 0,
    y: Number(block.attrs.y) || 0,
    width: Number(block.attrs.width) || 200,
    height: Number(block.attrs.height) || 110,
  };
}

export function centerOf(block: BlockLike): Point | null {
  if (!block) return null;
  return anchorPoint(block, { x: 0.5, y: 0.5 });
}

export function anchorPoint(block: BlockLike, anchor: Anchor): Point | null {
  if (!block) return null;
  const rect = rectFor(block);
  return { x: rect.x + rect.width * anchor.x, y: rect.y + rect.height * anchor.y };
}

// 从节点内的锚点出发、朝 target 方向与节点边界求交（锚点在边界上时返回锚点本身）
export function boundaryPoint(rect: RectLike, inside: Point, target: Point): Point {
  const dx = target.x - inside.x;
  const dy = target.y - inside.y;
  if (dx === 0 && dy === 0) return inside;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (rect.x + rect.width - inside.x) / dx);
  else if (dx < 0) t = Math.min(t, (rect.x - inside.x) / dx);
  if (dy > 0) t = Math.min(t, (rect.y + rect.height - inside.y) / dy);
  else if (dy < 0) t = Math.min(t, (rect.y - inside.y) / dy);
  t = Math.max(0, t);
  return { x: inside.x + dx * t, y: inside.y + dy * t };
}

export function bezierPoint(p0: Point, cp: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * cp.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * cp.y + t * t * p2.y,
  };
}

export function bezierTangent(p0: Point, cp: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: 2 * u * (cp.x - p0.x) + 2 * t * (p2.x - cp.x),
    y: 2 * u * (cp.y - p0.y) + 2 * t * (p2.y - cp.y),
  };
}

// 二次贝塞尔在参数 t 处拆分（de Casteljau），用于把曲线按节点边界切成「节点内/节点外」两段
export type QuadCurve = { p0: Point; cp: Point; p2: Point };

export function splitQuadratic(curve: QuadCurve, t: number): { left: QuadCurve; right: QuadCurve } {
  const q0 = { x: curve.p0.x + (curve.cp.x - curve.p0.x) * t, y: curve.p0.y + (curve.cp.y - curve.p0.y) * t };
  const q1 = { x: curve.cp.x + (curve.p2.x - curve.cp.x) * t, y: curve.cp.y + (curve.p2.y - curve.cp.y) * t };
  const r = bezierPoint(curve.p0, curve.cp, curve.p2, t);
  return {
    left: { p0: curve.p0, cp: q0, p2: r },
    right: { p0: r, cp: q1, p2: curve.p2 },
  };
}

function pointInRect(point: Point, rect: RectLike): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

// 二次贝塞尔的等价控制点：曲线从 t1（锚点，默认节点中心）到 t2（锚点），cp = 中点 + bend，
// 中间控制点拖拽存的就是 bend；ta/tb 为曲线穿出起点节点 / 进入目标节点的参数（节点内段画虚线）
export type RelationGeometry = {
  t1: Point;
  t2: Point;
  a: Point;
  b: Point;
  ta: number;
  tb: number;
  cp: Point;
  mid: Point;
  curve: QuadCurve;
  fromRect: RectLike;
  toRect: RectLike;
};

// 在 (lo, hi) 间二分细化曲线穿入/穿出矩形的边界参数：采样步长（1/96）在长曲线上可达十几 px，
// 会让端点 a/b 与箭头头部埋进节点内部——节点 z 序高于箭头时头部被卡面盖住，表现为「箭头不到节点边缘」
function refineBoundaryT(curve: QuadCurve, rect: RectLike, lo: number, hi: number, entering: boolean): number {
  const insideAt = (t: number) => pointInRect(bezierPoint(curve.p0, curve.cp, curve.p2, t), rect);
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (insideAt(mid) === entering) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function relationGeometry(from: BlockLike, to: BlockLike, arrowAttrs?: { fromAnchor?: Anchor; toAnchor?: Anchor; bend?: { dx: number; dy: number } }): RelationGeometry | null {
  if (!from || !to) return null;
  const fromRect: RectLike = rectFor(from);
  const toRect: RectLike = rectFor(to);
  const t1 = anchorPoint(from, arrowAttrs?.fromAnchor ?? { x: 0.5, y: 0.5 })!;
  const t2 = anchorPoint(to, arrowAttrs?.toAnchor ?? { x: 0.5, y: 0.5 })!;
  const bend = arrowAttrs?.bend ?? { dx: 0, dy: 0 };
  const cp = { x: (t1.x + t2.x) / 2 + bend.dx, y: (t1.y + t2.y) / 2 + bend.dy };
  const curve: QuadCurve = { p0: t1, cp, p2: t2 };
  // 采样找曲线与两节点边界的交点参数，再二分细化到精确边界
  let ta = 0;
  let tb = 1;
  const samples = 96;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    if (ta === 0 && !pointInRect(bezierPoint(t1, cp, t2, t), fromRect)) ta = refineBoundaryT(curve, fromRect, (i - 1) / samples, t, false);
    if (pointInRect(bezierPoint(t1, cp, t2, t), toRect)) {
      tb = refineBoundaryT(curve, toRect, (i - 1) / samples, t, true);
      break;
    }
  }
  // 曲线退化（两端都不可见）时兜底为全长
  if (tb <= ta) {
    ta = 0;
    tb = 1;
  }
  const a = bezierPoint(t1, cp, t2, ta);
  const b = bezierPoint(t1, cp, t2, tb);
  const mid = bezierPoint(t1, cp, t2, 0.5);
  return { t1, t2, a, b, ta, tb, cp, mid, curve, fromRect, toRect };
}

export function curveSegment(geo: RelationGeometry, fromT: number, toT: number): QuadCurve {
  const { curve } = geo;
  if (fromT > 0) {
    const right = splitQuadratic(curve, fromT).right;
    const localT = toT >= 1 ? 1 : (toT - fromT) / (1 - fromT);
    return splitQuadratic(right, localT).left;
  }
  return splitQuadratic(curve, toT >= 1 ? 1 : toT).left;
}

// 命中检测：采样贝塞尔成折线后求点到折线的最小距离
export function distanceToRelation(geo: RelationGeometry, p: Point): number {
  let min = Infinity;
  let prev = geo.curve.p0;
  for (let i = 1; i <= 24; i++) {
    const point = bezierPoint(geo.curve.p0, geo.curve.cp, geo.curve.p2, i / 24);
    min = Math.min(min, distanceToSegment(p, prev, point));
    prev = point;
  }
  return min;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

type CurveWriter = { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void };

// 沿曲线按弧长画短虚线（节点内段）：dash/gap 以像素为单位，默认 4/4
export function drawDashedCurve(g: CurveWriter, curve: QuadCurve, dashPx = 4, gapPx = 4) {
  const steps = 64;
  let cursor = bezierPoint(curve.p0, curve.cp, curve.p2, 0);
  let dash = true;
  let remain = dashPx;
  for (let i = 1; i <= steps; i++) {
    const point = bezierPoint(curve.p0, curve.cp, curve.p2, i / steps);
    let segLen = Math.hypot(point.x - cursor.x, point.y - cursor.y);
    const total = segLen;
    while (segLen > 0) {
      const step = Math.min(segLen, remain);
      const dirX = total > 0 ? (point.x - cursor.x) / total : 0;
      const dirY = total > 0 ? (point.y - cursor.y) / total : 0;
      const next = { x: cursor.x + dirX * step, y: cursor.y + dirY * step };
      if (dash) {
        g.moveTo(cursor.x, cursor.y);
        g.lineTo(next.x, next.y);
      }
      remain -= step;
      segLen -= step;
      cursor = next;
      if (remain <= 0.0001) {
        dash = !dash;
        remain = dash ? dashPx : gapPx;
      }
    }
    cursor = point;
  }
}
