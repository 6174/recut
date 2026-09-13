/*
 * [INPUT]: 依赖 pomelo-core（PomeloPlugin / PomeloRendererAdapter）
 * [OUTPUT]: 对外提供 GridPlugin：世界坐标对齐的点状网格背景，绘制在**独立的 plain canvas 层**
 *           （插入编辑器容器最底层，与主渲染器完全解耦），transform/resize 变化重绘，
 *           zoom 过小时自动隐藏避免摩尔纹。
 * [POS]: lib/pomelo/world-canvas 的背景网格插件（独立图层，不进入主渲染栈）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import type { PomeloRendererAdapter } from "../../pomelo-core/pomelo-renderer/pomelo-renderer-adapter";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";

export const GRID_STEP = 26;

export class GridPlugin extends PomeloPlugin {
  Name = "GridPlugin";
  // 工具栏「对齐到网格」开关：false 时清空并不再绘制点阵（纯视觉，不影响命中/吸附）
  enabled = true;
  #canvas: HTMLCanvasElement | null = null;
  #ctx: CanvasRenderingContext2D | null = null;
  #cleanup?: () => void;

  onEditorDidMount(editor: PomeloEditor) {
    const container = editor.getContainerDom();
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const canvas = document.createElement("canvas");
    canvas.dataset.gridLayer = "true";
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    } as CSSStyleDeclaration);
    container.insertBefore(canvas, container.firstChild);
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d");

    const adapter = editor.renderAdapter;
    const draw = () => this.draw(adapter);
    draw();
    const unsubTransform = adapter.onTransformEvent.on(draw);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
    observer?.observe(container);
    this.#cleanup = () => {
      unsubTransform.dispose();
      observer?.disconnect();
      canvas.remove();
      this.#canvas = null;
      this.#ctx = null;
    };
  }

  // 屏幕空间点阵：世界网格 multiples of GRID_STEP 投影到屏幕（独立 2D canvas，不占主渲染）
  draw(adapter: PomeloRendererAdapter) {
    const canvas = this.#canvas;
    const ctx = this.#ctx;
    if (!canvas || !ctx) return;
    const { width, height } = adapter.getScreenSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const deviceWidth = Math.max(1, Math.round(width * dpr));
    const deviceHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.enabled) return;
    const t = adapter.transform;
    const step = GRID_STEP * t.scale;
    if (step < 10) return;
    const fromX = Math.floor(-t.x / step) * step + t.x;
    const fromY = Math.floor(-t.y / step) * step + t.y;
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    for (let x = fromX; x <= width; x += step) {
      for (let y = fromY; y <= height; y += step) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  onEditorWillUnmount() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }

  dispose() {
    this.#cleanup?.();
  }
}
