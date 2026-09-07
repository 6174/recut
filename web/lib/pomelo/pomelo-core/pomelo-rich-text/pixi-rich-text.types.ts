import * as PIXI from "pixi.js"
export interface DeltaSegment {
  insert: string;
  attributes: TextAttributes;
}
export type Delta = DeltaSegment[];

export interface TextAttributes {
  fontSize: number;
  fontFamily: string;
  color: number;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
}

export interface AtlasInfo {
  texture: PIXI.BaseTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lastUsed: number;
}

export interface LayoutManagerOptions {
  width: number;
  height: number;
}

export interface LayoutResult {
  lines: LayoutLine[];
  width: number;
  height: number;
}

export interface LayoutLine {
  texts: LayoutText[];
  width?: number;
  height?: number;
  position?: { x: number; y: number };
}

export interface LayoutText {
  text: string;
  attributes: TextAttributes;
  position: { x: number; y: number };
}
