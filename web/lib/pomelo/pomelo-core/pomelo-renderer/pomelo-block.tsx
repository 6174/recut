// pomelo-block.ts
import { createContext, useContext } from "react";
import { ElementTypes, IElement } from "../pomelo-types/render.types";
import { PomeloRendererAdapter } from "./pomelo-renderer-adapter";
import * as Y from "yjs";
import { PomeloEditorState, PomeloStateSelector } from "../pomelo-state";
import { shallowEqual } from "../pomelo-common/shallow";

export type PomeloBlockProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotate?: number;
  color?: string;
  [_: string]: any;
}
;
export type PomeloBlockRecord = {
  id: string;
  pid?: string;
  type: string;
  isRoot?: boolean;
  attrs: PomeloBlockProps;
  children?: PomeloBlockRecord[];
  state?: any;
}

export type YPomeloBlockRecord = Y.Map<PomeloBlockRecord>

export type Constructor<T> = new (...args: any[]) => T;

export type IPomeloBlockConstructor = Constructor<PomeloBlock> & { type: string }

export abstract class PomeloBlock {
  static type = "abstractPomeloBlock";

  type: string;
  hostElement: IElement;
  contentElement: IElement;
  childrenElement: IElement;
  children: PomeloBlock[] = [];
  blockStateSelector: PomeloStateSelector<any> = (state) => null;
  blockState: any;

  constructor(
    public record: PomeloBlockRecord,
    protected adapter: PomeloRendererAdapter
  ) {
    this.type = record.type;
    this.hostElement = this.adapter.createIElement(ElementTypes.Container, this);
    this.contentElement = this.adapter.createIElement(ElementTypes.Container, this);
    this.childrenElement = this.adapter.createIElement(ElementTypes.Container, this);
    this.hostElement.appendChild(this.contentElement);
    this.hostElement.appendChild(this.childrenElement);
    this.computeBlockState(this.adapter.editor.state);
  }

  computeBlockState(state: PomeloEditorState): boolean {
    const newBlockState = this.blockStateSelector(state);
    const ret = shallowEqual(this.blockState, newBlockState)
    this.blockState = newBlockState;
    return !ret;
  }

  /**
   * @description 渲染 block 的内容，不包含孩子节点的渲染，孩子节点会在构造的时候自己渲染自己的内容
   */
  abstract render(): void;

  renderBlockReact?(): JSX.Element;
  renderBlock?(): any;

  get parent() {
    return this.adapter.renderedBlockMap.get(this.record.pid!);
  }

  get props() {
    return this.record.attrs;
  }

  get attrs() {
    return this.record.attrs;
  }

  updateProps(props: Record<string, any>) {
    for (const [key, value] of Object.entries(props)) {
      if (this.record.attrs[key] !== value) {
        this.record.attrs[key] = value;
      }
    }
  }

  insertChild(child: PomeloBlock, index: number) {
    this.children.splice(index, 0, child);
    if (index === this.children.length - 1) {
      this.childrenElement.appendChild(child.hostElement);
    } else {
      this.childrenElement.insertBefore(child.hostElement, this.children[index + 1].hostElement);
    }
  }

  removeChild(index: number) {
    const child = this.children[index];
    this.children.splice(index, 1);
    this.childrenElement.removeChild(child.hostElement);
    child.destroy();
  }

  replaceWith(newBlock: PomeloBlock) {
    this.hostElement.parentElement!.replaceChild(newBlock.hostElement, this.hostElement);
    this.destroy();
  }

  destroy() {
    this.children.forEach(child => child.destroy());
    this.hostElement.remove();
  }

  layout(): void {
    // 默认不做任何操作
  }
}


// 因为 context 必须要有默认值，所以这里先用 null 代替
export const BlockContext = createContext<PomeloBlock | null>(null);
export const BlockProvider = BlockContext.Provider;

// 在真实使用 editor 渲染 view 的时候，顶层需要保证先有 editor，再有 view
export function useBlockContext(): PomeloBlock {
  return useContext(BlockContext)!;
}
