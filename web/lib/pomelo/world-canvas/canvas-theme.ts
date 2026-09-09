/*
 * [INPUT]: 依赖 pixi.js
 * [OUTPUT]: 对外提供画布统一视觉常量与 drawShadowCard / drawTile / loadPixiTexture / loadPixiVideoTexture 辅助：所有节点（实体卡/便签/
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
// 成功纹理常驻缓存（zoom/resize 重渲染同步命中，不闪占位图）；失败只在 promise 层短期保留供重试，
// 不污染成功缓存。HEAD 拿不到宽高时 texture.width=0，调用方 coverSprite 已兜底。

const textureCache = new Map<string, PIXI.Texture>();
const texturePromises = new Map<string, Promise<PIXI.Texture | null>>();
const TEXTURE_RETRY_DELAYS_MS = [2000, 6000];

function loadTextureOnce(url: string): Promise<PIXI.Texture | null> {
  const cached = textureCache.get(url);
  if (cached) return Promise.resolve(cached);
  let promise = texturePromises.get(url);
  if (!promise) {
    promise = new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          const texture = PIXI.Texture.from(image);
          if (texture) textureCache.set(url, texture);
          resolve(texture);
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
    // 结算后剔除 in-flight 记录：null 也要剔除，保证重试能重新发起加载
    void promise.then(() => texturePromises.delete(url));
    texturePromises.set(url, promise);
  }
  return promise;
}

export function loadPixiTexture(url: string, onLoad: (texture: PIXI.Texture | null) => void): void {
  // 同步命中：已成功的纹理直接回调，重渲染零闪烁
  const cached = textureCache.get(url);
  if (cached) {
    onLoad(cached);
    return;
  }
  const attempt = (retry: number): void => {
    void loadTextureOnce(url).then((texture) => {
      if (texture) {
        onLoad(texture);
        return;
      }
      if (retry < TEXTURE_RETRY_DELAYS_MS.length) {
        setTimeout(() => attempt(retry + 1), TEXTURE_RETRY_DELAYS_MS[retry]);
      } else {
        console.warn("[canvas-theme] texture load failed:", url);
      }
    });
  };
  attempt(0);
}

// ---- 视频纹理：头图允许视频素材（muted/loop/playsinline 静音循环首帧起播）----

const videoTextureCache = new Map<string, PIXI.Texture>();
const videoTexturePromises = new Map<string, Promise<PIXI.Texture | null>>();
const VIDEO_RETRY_DELAYS_MS = [2000, 6000];

function loadVideoOnce(url: string): Promise<PIXI.Texture | null> {
  const cached = videoTextureCache.get(url);
  if (cached) return Promise.resolve(cached);
  let promise = videoTexturePromises.get(url);
  if (!promise) {
    promise = new Promise((resolve) => {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.crossOrigin = "anonymous";
      video.onloadeddata = () => {
        try {
          void video.play().catch(() => undefined);
          const texture = PIXI.Texture.from(video);
          if (texture) videoTextureCache.set(url, texture);
          resolve(texture);
        } catch {
          resolve(null);
        }
      };
      video.onerror = () => resolve(null);
      video.src = url;
    });
    void promise.then(() => videoTexturePromises.delete(url));
    videoTexturePromises.set(url, promise);
  }
  return promise;
}

export function loadPixiVideoTexture(url: string, onLoad: (texture: PIXI.Texture | null) => void): void {
  const cached = videoTextureCache.get(url);
  if (cached) {
    onLoad(cached);
    return;
  }
  const attempt = (retry: number): void => {
    void loadVideoOnce(url).then((texture) => {
      if (texture) {
        onLoad(texture);
        return;
      }
      if (retry < VIDEO_RETRY_DELAYS_MS.length) {
        setTimeout(() => attempt(retry + 1), VIDEO_RETRY_DELAYS_MS[retry]);
      } else {
        console.warn("[canvas-theme] video texture load failed:", url);
      }
    });
  };
  attempt(0);
}

// cover-fit：等比铺满目标矩形后居中裁切
export function coverSprite(texture: PIXI.Texture, w: number, h: number): PIXI.Sprite {
  const sprite = new PIXI.Sprite(texture);
  const scale = Math.max(w / (texture.width || 1), h / (texture.height || 1));
  sprite.scale.set(scale);
  sprite.position.set((w - texture.width * scale) / 2, (h - texture.height * scale) / 2);
  return sprite;
}
