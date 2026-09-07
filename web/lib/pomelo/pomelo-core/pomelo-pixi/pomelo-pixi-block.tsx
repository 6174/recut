/*
 * [INPUT]: 依赖 pomelo-renderer（PomeloBlock / BlockProvider）
 * [OUTPUT]: 对外提供 PixiBlock：Block 的 pixi 渲染基类；原版支持 renderBlockReact（@pixi/react），
 * 因 @pixi/react 与 React 19 不兼容，迁移后仅保留 renderBlock（命令式 pixi 对象）路径，行为与原版一致
 * [POS]: lib/pomelo 的 pixi 渲染 Block 基类（world-canvas 的实体卡/便签/连线 Block 均继承自它）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { IElement } from "../pomelo-types/render.types";
import { PomeloBlock } from "../pomelo-renderer";

export abstract class PixiBlock extends PomeloBlock {
  render() {
    if (this.renderBlock) {
      const result = this.renderBlock();
      // 兼容两种返回：IElement（原版 antv 路径）与裸 PIXI.Container（原版 pixi demo 路径）
      const target = (result as IElement).el ? result : ({ el: result } as IElement);
      this.contentElement.el.removeChildren();
      this.contentElement.el.addChild(target.el);
    }
  }
}
