/*
 * [INPUT]: 依赖 pixi.js
 * [OUTPUT]: 对外提供画布统一视觉常量与 drawShadowCard / drawTile 辅助：所有节点（实体卡/便签/
 * World 节点/基础媒体节点）共用「深色卡面 + 统一细边框 + 柔和投影」的高级感样式，
 * 不再按 kind 着色；色彩语义只保留在右侧详情面板
 * [POS]: lib/pomelo/world-canvas 的统一视觉层（各 block 与 grid-plugin 共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";

// 对齐 app 全局主题（globals.css）：画布背景由容器使用 var(--background)（pixi 透明），
// 卡面=--card，瓦片=--muted
export const CARD_FILL = 0x0f1410;
export const CARD_STROKE = 0xffffff;
export const CARD_STROKE_ALPHA = 0.08;
export const CARD_STROKE_STRONG_ALPHA = 0.16;
export const CARD_RADIUS = 14;
export const TILE_FILL = 0x1d231e;
export const TILE_STROKE_ALPHA = 0.06;
export const TEXT_PRIMARY = 0xf4f4f5;
export const TEXT_SECONDARY = 0x8b93a7;
export const TEXT_TERTIARY = 0x6b7280;

// 统一卡片底座：柔和投影（BlurFilter 模拟）+ 深色卡面 + 细边框；返回卡面 Graphics
export function drawShadowCard(
  container: PIXI.Container,
  w: number,
  h: number,
  options: { radius?: number; strokeAlpha?: number } = {},
): PIXI.Graphics {
  const radius = options.radius ?? CARD_RADIUS;
  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x000000, 0.28);
  shadow.drawRoundedRect(3, 7, w, h, radius);
  shadow.endFill();
  const blur = new PIXI.BlurFilter();
  blur.blur = 12;
  blur.quality = 2;
  shadow.filters = [blur];
  container.addChild(shadow);

  const card = new PIXI.Graphics();
  card.beginFill(CARD_FILL, 0.98);
  card.lineStyle(1, CARD_STROKE, options.strokeAlpha ?? CARD_STROKE_ALPHA, 1);
  card.drawRoundedRect(0, 0, w, h, radius);
  card.endFill();
  container.addChild(card);
  return card;
}

// 统一图片瓦片：主图 / 缩略格共用
export function drawTile(
  container: PIXI.Container,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 10,
): PIXI.Graphics {
  const tile = new PIXI.Graphics();
  tile.beginFill(TILE_FILL);
  tile.lineStyle(1, CARD_STROKE, TILE_STROKE_ALPHA, 1);
  tile.drawRoundedRect(x, y, w, h, radius);
  tile.endFill();
  container.addChild(tile);
  return tile;
}

// ---- 真实图片纹理加载：Image 元素 + crossOrigin（不依赖扩展名，PIXI.Assets 对无后缀 URL 无法选解析器） ----

const texturePromises = new Map<string, Promise<PIXI.Texture | null>>();

export function loadPixiTexture(url: string, onLoad: (texture: PIXI.Texture | null) => void): void {
  let promise = texturePromises.get(url);
  if (!promise) {
    promise = new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          resolve(PIXI.Texture.from(image));
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
    texturePromises.set(url, promise);
  }
  void promise.then(onLoad);
}

// cover-fit：等比铺满目标矩形后居中裁切
export function coverSprite(texture: PIXI.Texture, w: number, h: number): PIXI.Sprite {
  const sprite = new PIXI.Sprite(texture);
  const scale = Math.max(w / (texture.width || 1), h / (texture.height || 1));
  sprite.scale.set(scale);
  sprite.position.set((w - texture.width * scale) / 2, (h - texture.height * scale) / 2);
  return sprite;
}
