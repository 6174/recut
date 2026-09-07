
export interface IElement<T = any> {
  // 对应真正
  el: T;
  type: string;
  props: Record<string, any>;
  children: IElement[];
  parentElement: IElement | null;
  remove(): void;
  destroy(): void;
  appendChild(child: IElement): void;
  removeChild(child: IElement): void;
  setAttribute(name: string, value: string): void;
  insertBefore(newChild: IElement, refChild: IElement): void;
  removeAttribute(name: string): void;
  replaceChild(newChild: IElement, oldChild: IElement): void;
}

export enum ElementTypes {
  Container = 'container',
  Text = 'text',
  Shape = 'shape',
  Root = 'root'
}