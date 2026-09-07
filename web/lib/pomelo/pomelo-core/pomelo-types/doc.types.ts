import { PomeloBlockRecord } from "../pomelo-renderer"

export type PomeloDoc = {
  id: string,
  // Type 字段也许有用，可能有不同的 Doc 类型，类似 <!DOCTYPE HTML
  type?: string,
  attrs?: any;
  children: PomeloBlockRecord[]
}

export type PomeloTransform = { x: number, y: number, scale: number }