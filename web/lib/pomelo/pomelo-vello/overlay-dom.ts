/*
 * [INPUT]: 无外部依赖（DOM/SVG）
 * [OUTPUT]: 对外提供 DomOverlay：渲染器无关的屏幕空间覆盖层（选区框 + 四角手柄 + 引导线），
 *           挂在画布容器之上，按适配器 transform（pan/zoom）把世界矩形映射到屏幕。
 * [POS]: pomelo-vello 的 overlay 层（替代 PIXI.Graphics overlay），供 CanvasBindsPlugin 迁移使用。
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

export class DomOverlay {
  readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly selection: SVGRectElement;
  private readonly handles: SVGRectElement[] = [];
  private readonly guide: SVGLineElement;
  private readonly guideDot: SVGCircleElement;

  constructor(container: HTMLElement) {
    const root = document.createElement("div");
    root.dataset.overlayRoot = "true";
    Object.assign(root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      overflow: "hidden",
    } as CSSStyleDeclaration);
    this.root = root;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    Object.assign(svg.style, { position: "absolute", inset: "0", overflow: "visible" } as CSSStyleDeclaration);
    this.svg = svg;

    const selection = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    selection.setAttribute("fill", "none");
    selection.setAttribute("stroke", "#4c8dff");
    selection.setAttribute("stroke-width", "2");
    selection.setAttribute("rx", "4");
    selection.dataset.overlaySelection = "true";
    selection.style.display = "none";
    this.selection = selection;
    svg.appendChild(selection);

    for (let i = 0; i < 4; i++) {
      const handle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
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

    const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
    guide.setAttribute("stroke", "#8b93a7");
    guide.setAttribute("stroke-width", "2");
    guide.setAttribute("stroke-dasharray", "6 4");
    guide.dataset.overlayGuide = "true";
    guide.style.display = "none";
    this.guide = guide;
    svg.appendChild(guide);

    const guideDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
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

  clear(): void {
    this.selection.style.display = "none";
    for (const handle of this.handles) handle.style.display = "none";
    this.guide.style.display = "none";
    this.guideDot.style.display = "none";
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
