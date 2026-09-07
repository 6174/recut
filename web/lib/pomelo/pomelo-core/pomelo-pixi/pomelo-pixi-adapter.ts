import * as PIXI from 'pixi.js';
import { PomeloRendererAdapter } from '../pomelo-renderer/pomelo-renderer-adapter';
import { IElement } from '../pomelo-types/render.types';
import { PixiElement } from './pomelo-pixi-element';
import { PomeloBlock, PomeloRenderer } from '../pomelo-renderer';

export class PixiRendererAdapter extends PomeloRendererAdapter {
  app: PIXI.Application;
  
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
      backgroundColor: 0x1099bb,
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
    const hostElement = this.mountpointBlock.hostElement.el;
    this.transform = { x, y, scale };
    hostElement.x = x;
    hostElement.y = y;
    hostElement.scale.set(scale);
    this.onTransformEvent.emit({ x, y, scale });
  }

  /**
   * 设置容器的大小
   * @param width 
   * @param height 
   */
  setContainerSize(width: number, height: number): void {
    this.containerSize = { width, height };
    const resolution = this.app.renderer.resolution;
    this.app.renderer.resize(width, height);
    this.app.renderer.resolution = resolution;
    this.onResizeEvent.emit({ width, height });
  }
}
