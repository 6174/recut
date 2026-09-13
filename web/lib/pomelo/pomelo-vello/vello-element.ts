/*
 * [INPUT]: 依赖 pomelo-types/render.types（IElement）
 * [OUTPUT]: 对外提供 VelloElement：pomelo 的 IElement 实现，承载 block 树（host/content/children），
 *           自身不做绘制（绘制由 VelloBlock 产出 op）。
 * [POS]: pomelo-vello 的渲染器无关元素层（替代 PixiElement）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ElementTypes, IElement } from "../pomelo-core/pomelo-types/render.types";
import type { PomeloBlock } from "../pomelo-core/pomelo-renderer";

export class VelloElement implements IElement {
  type: string;
  props: Record<string, unknown>;
  children: VelloElement[] = [];
  parentElement: VelloElement | null = null;
  el: unknown = null;
  block: PomeloBlock;

  constructor(type: string, block: PomeloBlock, props: Record<string, unknown> = {}) {
    this.type = type;
    this.props = props;
    this.block = block;
    this.el = block;
  }

  remove(): void {
    this.parentElement?.removeChild(this);
  }

  destroy(): void {
    this.el = null;
    this.children.forEach((child) => child.destroy());
    this.children = [];
  }

  appendChild(child: VelloElement): void {
    this.children.push(child);
    child.parentElement = this;
  }

  removeChild(child: VelloElement): void {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.props[name] = value;
  }

  insertBefore(newChild: VelloElement, refChild: VelloElement): void {
    const index = this.children.indexOf(refChild);
    if (index !== -1) {
      this.children.splice(index, 0, newChild);
      newChild.parentElement = this;
    }
  }

  removeAttribute(name: string): void {
    delete this.props[name];
  }

  replaceChild(newChild: VelloElement, oldChild: VelloElement): void {
    const index = this.children.indexOf(oldChild);
    if (index !== -1) {
      this.children[index] = newChild;
      newChild.parentElement = this;
      oldChild.parentElement = null;
    }
  }
}

export type { ElementTypes };
