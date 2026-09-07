import * as PIXI from 'pixi.js';
import { IElement, ElementTypes } from '../pomelo-types/render.types';
import { PomeloBlock } from '../pomelo-renderer';

export class PixiElement implements IElement<PIXI.Container> {
  type: string;
  props: Record<string, any>;
  children: PixiElement[] = [];
  parentElement: PixiElement | null = null;
  el: PIXI.Container = null!;
  block: PomeloBlock;

  constructor(type: string, block: PomeloBlock, props: Record<string, any> = {}) {
    this.type = type;
    this.props = props;
    this.block = block;
    this.createPixiObject();
    (this.el as any).__block__ = block;
  }

  private createPixiObject() {
    switch (this.type) {
      case ElementTypes.Container:
        this.el = new PIXI.Container();
        break;
      default:
        this.el = new PIXI.Container();
    }
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  destroy() {
    this.el.destroy();
    this.children.forEach(child => child.destroy());
  }

  appendChild(child: PixiElement) {
    this.children.push(child);
    child.parentElement = this;
    (this.el as PIXI.Container).addChild(child.el);
  }

  removeChild(child: PixiElement) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentElement = null;
      (this.el as PIXI.Container).removeChild(child.el);
    }
  }

  setAttribute(name: string, value: string) {
    this.props[name] = value;
    // 根据属性类型更新 PIXI 对象
    if (this.el instanceof PIXI.Text && name === 'text') {
      this.el.text = value;
    }
    // 可以添加更多属性的处理
  }

  insertBefore(newChild: PixiElement, refChild: PixiElement) {
    const index = this.children.indexOf(refChild);
    if (index !== -1) {
      this.children.splice(index, 0, newChild);
      newChild.parentElement = this;
      (this.el as PIXI.Container).addChildAt(newChild.el, index);
    }
  }

  removeAttribute(name: string) {
    delete this.props[name];
    // 根据需要处理 PIXI 对象的属性移除
  }

  replaceChild(newChild: PixiElement, oldChild: PixiElement) {
    const index = this.children.indexOf(oldChild);
    if (index !== -1) {
      this.children[index] = newChild;
      newChild.parentElement = this;
      (this.el as PIXI.Container).removeChild(oldChild.el);
      (this.el as PIXI.Container).addChildAt(newChild.el, index);
      oldChild.parentElement = null;
    }
  }
}