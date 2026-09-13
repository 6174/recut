/*
 * [INPUT]: 无外部依赖（DOM/SVG）
 * [OUTPUT]: 对外提供 DomOverlay：渲染器无关的屏幕空间覆盖层。
 *           - 语义化：drawSelection（选框+四角手柄）、drawGuide（引导线）；
 *           - 通用图元：clear/clearAll/circle/line/roundedRect/quad/polygon，供 CanvasBindsPlugin 迁移 PIXI.Graphics overlay。
 *           一切坐标均为屏幕空间（世界→屏幕由调用方按适配器 transform 换算）。
 * [POS]: pomelo-vello / world-canvas 的 overlay 层（替代 PIXI.Graphics overlay）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export interface OverlayTransform {
  x: number;
  y: number;
  scale: number;
}

export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShapeStyle {
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  opacity?: number;
  dash?: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function cssColor(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

export class DomOverlay {
  readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly dynamic: SVGGElement;
  private readonly selection: SVGRectElement;
  private readonly handles: SVGRectElement[] = [];
  private readonly guide: SVGLineElement;
  private readonly guideDot: SVGCircleElement;

  constructor(container: HTMLElement) {
    const root = document.createElement("div");
    root.dataset.overlayRoot = "true";
    Object.assign(root.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" } as CSSStyleDeclaration);
    this.root = root;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    Object.assign(svg.style, { position: "absolute", inset: "0", overflow: "visible" } as CSSStyleDeclaration);
    this.svg = svg;

    const dynamic = document.createElementNS(SVG_NS, "g");
    dynamic.dataset.overlayDynamic = "true";
    this.dynamic = dynamic;
    svg.appendChild(dynamic);

    const selection = document.createElementNS(SVG_NS, "rect");
    selection.setAttribute("fill", "none");
    selection.setAttribute("stroke", "#4c8dff");
    selection.setAttribute("stroke-width", "2");
    selection.setAttribute("rx", "4");
    selection.dataset.overlaySelection = "true";
    selection.style.display = "none";
    this.selection = selection;
    svg.appendChild(selection);

    for (let i = 0; i < 4; i++) {
      const handle = document.createElementNS(SVG_NS, "rect");
      handle.setAttribute("width", "8");
      handle.setAttribute("height", "8");
      handle.setAttribute("fill", "#ffffff");
      handle.setAttribute("stroke", "#4c8dff");
      handle.setAttribute("stroke-width", "2");
      handle.dataset.overlayHandle = "true";
      handle.style.display = "none";
      this.handles.push(handle);
      svg.appendChild(handle);
    }

    const guide = document.createElementNS(SVG_NS, "line");
    guide.setAttribute("stroke", "#8b93a7");
    guide.setAttribute("stroke-width", "2");
    guide.setAttribute("stroke-dasharray", "6 4");
    guide.dataset.overlayGuide = "true";
    guide.style.display = "none";
    this.guide = guide;
    svg.appendChild(guide);

    const guideDot = document.createElementNS(SVG_NS, "circle");
    guideDot.setAttribute("r", "4");
    guideDot.setAttribute("fill", "#8b93a7");
    guideDot.style.display = "none";
    this.guideDot = guideDot;
    svg.appendChild(guideDot);

    root.appendChild(svg);
    container.appendChild(root);
  }

  setSize(width: number, height: number): void {
    this.svg.setAttribute("viewBox", `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
  }

  /** 清空通用图元 + 隐藏语义化元素。 */
  clearAll(): void {
    this.clearDynamic();
    this.selection.style.display = "none";
    for (const handle of this.handles) handle.style.display = "none";
    this.guide.style.display = "none";
    this.guideDot.style.display = "none";
  }

  clear(): void {
    this.clearAll();
  }

  clearDynamic(): void {
    while (this.dynamic.firstChild) this.dynamic.removeChild(this.dynamic.firstChild);
  }

  private create<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    return document.createElementNS(SVG_NS, tag);
  }

  private applyStyle(el: SVGElement, style: ShapeStyle): void {
    el.setAttribute("stroke", style.stroke ?? "none");
    if (style.strokeWidth !== undefined) el.setAttribute("stroke-width", String(style.strokeWidth));
    el.setAttribute("fill", style.fill ?? "none");
    if (style.opacity !== undefined) el.setAttribute("opacity", String(style.opacity));
    if (style.dash) el.setAttribute("stroke-dasharray", style.dash);
  }

  circle(cx: number, cy: number, r: number, style: ShapeStyle): SVGCircleElement {
    const el = this.create("circle");
    el.setAttribute("cx", String(cx));
    el.setAttribute("cy", String(cy));
    el.setAttribute("r", String(r));
    this.applyStyle(el, style);
    this.dynamic.appendChild(el);
    return el;
  }

  line(x1: number, y1: number, x2: number, y2: number, style: ShapeStyle): SVGLineElement {
    const el = this.create("line");
    el.setAttribute("x1", String(x1));
    el.setAttribute("y1", String(y1));
    el.setAttribute("x2", String(x2));
    el.setAttribute("y2", String(y2));
    el.setAttribute("stroke-linecap", "round");
    this.applyStyle(el, style);
    this.dynamic.appendChild(el);
    return el;
  }

  roundedRect(rect: OverlayRect, radius: number, style: ShapeStyle): SVGRectElement {
    const el = this.create("rect");
    el.setAttribute("x", String(rect.x));
    el.setAttribute("y", String(rect.y));
    el.setAttribute("width", String(Math.max(0, rect.width)));
    el.setAttribute("height", String(Math.max(0, rect.height)));
    el.setAttribute("rx", String(radius));
    this.applyStyle(el, style);
    this.dynamic.appendChild(el);
    return el;
  }

  path(d: string, style: ShapeStyle): SVGPathElement {
    const el = this.create("path");
    el.setAttribute("d", d);
    el.setAttribute("stroke-linecap", "round");
    this.applyStyle(el, style);
    this.dynamic.appendChild(el);
    return el;
  }

  quad(p0: { x: number; y: number }, cp: { x: number; y: number }, p2: { x: number; y: number }, style: ShapeStyle): SVGPathElement {
    return this.path(`M ${p0.x} ${p0.y} Q ${cp.x} ${cp.y} ${p2.x} ${p2.y}`, style);
  }

  polygon(points: Array<{ x: number; y: number }>, style: ShapeStyle): SVGPolygonElement {
    const el = this.create("polygon");
    el.setAttribute("points", points.map((p) => `${p.x},${p.y}`).join(" "));
    this.applyStyle(el, style);
    this.dynamic.appendChild(el);
    return el;
  }

  /** 画选区框 + 四角手柄（世界矩形 → 屏幕）。 */
  drawSelection(world: OverlayRect, transform: OverlayTransform): void {
    const x = world.x * transform.scale + transform.x;
    const y = world.y * transform.scale + transform.y;
    const width = world.width * transform.scale;
    const height = world.height * transform.scale;
    this.selection.setAttribute("x", String(x - 4));
    this.selection.setAttribute("y", String(y - 4));
    this.selection.setAttribute("width", String(width + 8));
    this.selection.setAttribute("height", String(height + 8));
    this.selection.style.display = "";
    const corners: Array<[number, number]> = [
      [x - 4, y - 4],
      [x + width + 4, y - 4],
      [x - 4, y + height + 4],
      [x + width + 4, y + height + 4],
    ];
    this.handles.forEach((handle, index) => {
      handle.setAttribute("x", String(corners[index][0] - 4));
      handle.setAttribute("y", String(corners[index][1] - 4));
      handle.style.display = "";
    });
  }

  /** 引导线（世界坐标起止 → 屏幕）。 */
  drawGuide(from: { x: number; y: number }, to: { x: number; y: number }, transform: OverlayTransform): void {
    const ax = from.x * transform.scale + transform.x;
    const ay = from.y * transform.scale + transform.y;
    const bx = to.x * transform.scale + transform.x;
    const by = to.y * transform.scale + transform.y;
    this.guide.setAttribute("x1", String(ax));
    this.guide.setAttribute("y1", String(ay));
    this.guide.setAttribute("x2", String(bx));
    this.guide.setAttribute("y2", String(by));
    this.guide.style.display = "";
    this.guideDot.setAttribute("cx", String(bx));
    this.guideDot.setAttribute("cy", String(by));
    this.guideDot.style.display = "";
  }

  destroy(): void {
    this.root.remove();
  }
}
