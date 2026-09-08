/*
 * [INPUT]: 依赖 pomelo-renderer（PomeloBlock / BlockProvider）
 * [OUTPUT]: 对外提供 PixiBlock：Block 的 pixi 渲染基类；原版支持 renderBlockReact（@pixi/react），
 * 因 @pixi/react 与 React 19 不兼容，迁移后仅保留 renderBlock（命令式 pixi 对象）路径，行为与原版一致
 * [POS]: lib/pomelo 的 pixi 渲染 Block 基类（world-canvas 的实体卡/便签/连线 Block 均继承自它）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { IElement } from "../pomelo-types/render.types";
import { IDisposable } from "../pomelo-common";
import { PomeloBlock } from "../pomelo-renderer";
import { pomeloPerf } from "../pomelo-perf";

export abstract class PixiBlock extends PomeloBlock {
  // renderBlock 产出的内容容器（在 contentElement 内，自身 position 即 block 的 x/y）
  #inner: PIXI.Container | null = null;
  #unsubTransform: IDisposable | null = null;
  #lastScale = 1;
  // zoom 常量渲染：true 时视口缩放变化会触发 renderBlock 重绘（配合 screenScale 保持屏幕像素尺寸）
  renderOnZoom = false;

  // 当前视口缩放系数；zoom 常量元素用它做 1/scale 反向补偿
  protected get screenScale(): number {
    const scale = (this as unknown as { adapter?: { transform?: { scale?: number } } }).adapter?.transform?.scale;
    return scale && scale > 0 ? scale : 1;
  }

  render() {
    if (this.renderBlock) {
      const renderBlock = this.renderBlock.bind(this);
      const result = pomeloPerf.time(`block.render:${this.type}`, () => renderBlock());
      // 兼容两种返回：IElement（原版 antv 路径）与裸 PIXI.Container（原版 pixi demo 路径）
      const target = (result as IElement).el ? result : ({ el: result } as IElement);
      // 重建前销毁旧内容：zoom 高频重绘时释放 Text/纹理，避免 GPU 资源累积
      for (const child of [...this.contentElement.el.children]) {
        child.destroy({ children: true });
      }
      this.contentElement.el.addChild(target.el);
      this.#inner = target.el;
      this.#lastScale = this.screenScale;
    }
    // 首次渲染订阅 transform：缩放（而非平移）变化时重建内容以保持 screen 常量尺寸
    if (this.renderOnZoom && !this.#unsubTransform) {
      this.#unsubTransform =
        (this as unknown as { adapter: { onTransformEvent: { on: (cb: (t: { scale: number }) => void) => IDisposable } } })
          .adapter.onTransformEvent.on(({ scale }) => {
            if (this.renderOnZoom && scale !== this.#lastScale) this.render();
          }) ?? null;
    }  }

  /**
   * 仅重定位（不重建内容容器）：供「attrs 只有 x/y 变化」的 UPDATE patch 使用，
   * 避免拖拽时每 move 全量 renderBlock（重建 + 文本重栅格）。数据写入仍走正常 transact
   */
  reposition() {
    this.#inner?.position.set(Number(this.record.attrs.x) || 0, Number(this.record.attrs.y) || 0);
  }

  override destroy() {
    this.#unsubTransform?.dispose();
    this.#unsubTransform = null;
    super.destroy();
  }
}
