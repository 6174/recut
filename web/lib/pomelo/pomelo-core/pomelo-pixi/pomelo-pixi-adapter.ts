import * as PIXI from 'pixi.js';
import { PomeloRendererAdapter } from '../pomelo-renderer/pomelo-renderer-adapter';
import { IElement } from '../pomelo-types/render.types';
import { PixiElement } from './pomelo-pixi-element';
import { PomeloBlock, PomeloRenderer } from '../pomelo-renderer';

export class PixiRendererAdapter extends PomeloRendererAdapter {
  app: PIXI.Application = null!;
  
  /**
   * PIXI V7 初始化
   */
  async onInit(renderer: PomeloRenderer) {
    super.onInit(renderer);
    const container = this.editor.getContainerDom();
    this.app = new PIXI.Application({
      width: 800,
      height: 600,
      resizeTo: container,
      backgroundColor: 0x0b0f19,
      autoDensity: true, // 添加 autoDensity 以更好地处理显示比例
      antialias: true,    // 添加抗锯齿
      resolution: window.devicePixelRatio || 1,  // 设置分辨率以匹配设备
      // autoStart: false,
    });

    this.app.stage.addChild(this.mountpointBlock.hostElement.el);
    // @ts-ignore
    container.appendChild(this.app.view);
  }

  render() {
    super.render();
    // 新渲染的 Text 需要按当前视口缩放重设分辨率，否则缩放后模糊
    this.refreshTextResolution();
  }

  /**
   * 文字分辨率跟随视口缩放：Text 按 dpr × zoom 栅格化，避免 stage 放大后纹理拉伸发虚
   */
  refreshTextResolution() {
    if (!this.app?.renderer) return;
    const target = Math.min(4, Math.max(2, (window.devicePixelRatio || 1) * this.transform.scale));
    const visit = (container: PIXI.Container) => {
      for (const child of container.children as PIXI.Container[]) {
        if (child instanceof PIXI.Text) {
          if (child.resolution !== target) child.resolution = target;
        } else if (child.children?.length > 0) {
          visit(child);
        }
      }
    };
    visit(this.mountpointBlock.hostElement.el);
  }

  /**
   * 实现 createIElement 方法
   * @param tag 
   * @param props 
   * @returns 
   */
  createIElement(tag: string, block: PomeloBlock, props?: any): IElement {
    console.debug('Creating element', { tag, block, props });
    return new PixiElement(tag, block, props);
  }

  /**
   * 设置视图的 transform
   * @param x 
   * @param y 
   * @param scale 
   */
  setTransform(x: number, y: number, scale: number): void {
    // 对齐设备像素：亚像素偏移会让 Text 纹理采样发虚
    const dpr = window.devicePixelRatio || 1;
    x = Math.round(x * dpr) / dpr;
    y = Math.round(y * dpr) / dpr;
    const hostElement = this.mountpointBlock.hostElement.el;
    this.transform = { x, y, scale };
    hostElement.x = x;
    hostElement.y = y;
    hostElement.scale.set(scale);
    this.onTransformEvent.emit({ x, y, scale });
    // 缩放变化后重设文字分辨率
    this.refreshTextResolution();
  }

  /**
   * 设置容器的大小
   * @param width 
   * @param height 
   */
  setContainerSize(width: number, height: number): void {
    if (!this.app?.renderer) return;
    this.containerSize = { width, height };
    const resolution = this.app.renderer.resolution;
    this.app.renderer.resize(width, height);
    this.app.renderer.resolution = resolution;
    this.onResizeEvent.emit({ width, height });
  }
}
