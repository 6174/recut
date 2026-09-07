import * as PIXI from "pixi.js"
import { Delta, LayoutResult, TextAttributes } from "./pixi-rich-text.types";
import { LayoutManager } from "./pixi-rich-text-layout";
import { TextTileManager } from "./rich-text-atlas";

export class PixiRichText {
  private delta: Delta;
  private width: number;
  private height: number;
  private layoutManager: LayoutManager;
  private textTileManager: TextTileManager;
  private layoutResult?: LayoutResult;
  private textures: PIXI.Texture[];

  constructor(delta: Delta, width: number, height: number) {
    this.delta = delta;
    this.width = width;
    this.height = height;
    this.layoutManager = new LayoutManager();
    this.textTileManager = new TextTileManager();
    this.textures = [];
  }

  public render(): void {
    // 获取布局结果
    this.layoutResult = this.layoutManager.calculateLayout(this.delta, { width: this.width, height: this.height });

    // 根据布局结果渲染文本
    this.renderText(this.layoutResult);
  }

  private renderText(layoutResult: LayoutResult): void {
    // 清空之前的纹理
    this.releaseTextures();

    // 渲染新的文本
    for (const line of layoutResult.lines) {
      for (const text of line.texts) {
        const texture = this.textTileManager.getTextTexture(text.text, text.attributes);
        this.textures.push(texture); // 将纹理保存起来
        // 示例：使用 PIXI.js 渲染文本
        // container.addChild(texture);
        // texture.position.set(text.position.x, text.position.y);
        console.log(`Rendered text "${text.text}" at position (${text.position.x}, ${text.position.y})`);
      }
    }
  }

  private releaseTextures(): void {
    for (const texture of this.textures) {
      this.textTileManager.releaseTexture(texture);
    }
    this.textures = [];
  }

  public updateDelta(delta: Delta): void {
    this.delta = delta;
    this.clearCache(); // 清除缓存以确保更新后重新计算布局和渲染
    this.render(); // 重新渲染文本
  }

  public clearCache(): void {
    this.layoutManager.clearCache();
  }

  public destroy(): void {
    this.releaseTextures(); // 释放所有纹理
    this.clearCache(); // 清除缓存
  }

  public getLayoutResult(): LayoutResult | undefined {
    return this.layoutResult;
  }
}

