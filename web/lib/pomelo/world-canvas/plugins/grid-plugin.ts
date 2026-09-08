/*
 * [INPUT]: 依赖 pixi.js、pomelo-core（PomeloPlugin / PixiRendererAdapter）
 * [OUTPUT]: 对外提供 GridPlugin：世界坐标对齐的点状网格背景（屏幕空间绘制，
 * transform 变化自动重绘，zoom 过小时自动隐藏避免摩尔纹）
 * [POS]: lib/pomelo/world-canvas 的背景网格插件（index.tsx 组合，stage 最底层）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import type { PixiRendererAdapter } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";

export const GRID_STEP = 26;

export class GridPlugin extends PomeloPlugin {
  Name = "GridPlugin";
  #grid = new PIXI.Graphics();
  #cleanup?: () => void;

  onEditorDidMount(editor: PomeloEditor) {
    const adapter = editor.renderAdapter as PixiRendererAdapter;
    // 最底层：置于全部内容之下
    adapter.app.stage.addChildAt(this.#grid, 0);
    this.draw(adapter);
    const unsubTransform = adapter.onTransformEvent.on(() => this.draw(adapter));
    this.#cleanup = () => {
      unsubTransform.dispose();
      this.#grid.destroy();
    };
  }

  // 屏幕空间点阵：世界网格 multiples of GRID_STEP 投影到屏幕
  draw(adapter: PixiRendererAdapter) {
    const g = this.#grid;
    g.clear();
    const t = adapter.transform;
    const step = GRID_STEP * t.scale;
    if (step < 10) return;
    const width = adapter.app.screen.width;
    const height = adapter.app.screen.height;
    const fromX = Math.floor(-t.x / step) * step + t.x;
    const fromY = Math.floor(-t.y / step) * step + t.y;
    for (let x = fromX; x <= width; x += step) {
      for (let y = fromY; y <= height; y += step) {
        g.beginFill(0xffffff, 0.07);
        g.drawCircle(x, y, 1);
        g.endFill();
      }
    }
    // 点阵数量可达数千个圆：栅格化为位图缓存，拖拽等无 transform 变化的帧
    // GPU 只需提交 1 个 quad 采样，不再逐圆重绘（transform 变化时本函数重画即重建缓存）
    // g.cacheAsBitmap = true;
  }

  onEditorWillUnmount() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }

  dispose() {
    this.#cleanup?.();
  }
}
