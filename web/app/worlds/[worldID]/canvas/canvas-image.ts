/*
 * [INPUT]: 依赖 pixi.js 与 recut-worlds-client（WorldEvidence 类型）
 * [OUTPUT]: 对外提供 entityImageUrls / evidenceSource / loadPixiTexture / addCoverImage：
 * 实体证据（modality=image）→ 可渲染 URL（asset 行走媒体库 content 流，url 行直连远程资源）；
 * PIXI 纹理异步加载（URL 级缓存，失败返回 null）；cover-fit 精灵 + 圆角遮罩工具
 * [POS]: worlds/[worldID]/canvas 的画布图片辅助（canvas-pomelo.tsx 组装 attrs，EntityCardBlock 渲染）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import type { WorldEntity, WorldEvidence } from "@/lib/recut-worlds-client";

// 证据双源解析为可渲染 URL（与 world-detail-panels.tsx 的 evidenceSource 同一约定）
export function evidenceSource(apiBase: string, item: WorldEvidence): string {
  if (item.source === "url" || (!item.assetId && item.url)) return item.url ?? "";
  return item.assetId ? `${apiBase}/v1/media/assets/${encodeURIComponent(item.assetId)}/content` : "";
}

// 实体图片证据 → URL 列表（primary/appearance 优先，archived 排除）
export function entityImageUrls(apiBase: string, entity: WorldEntity): string[] {
  const images = (entity.references ?? []).filter(
    (item) => item.modality === "image" && item.status !== "archived" && evidenceSource(apiBase, item),
  );
  const rank = (item: WorldEvidence) => (item.status === "primary" ? 0 : 1) * 10 + (item.purpose === "appearance" ? 0 : 1);
  return images.sort((a, b) => rank(a) - rank(b)).map((item) => evidenceSource(apiBase, item));
}

// PIXI 纹理异步加载：URL 级去重缓存，失败回 null（占位符兜底）
const texturePromises = new Map<string, Promise<PIXI.Texture | null>>();
export function loadPixiTexture(url: string, onLoad: (texture: PIXI.Texture | null) => void): void {
  let promise = texturePromises.get(url);
  if (!promise) {
    promise = PIXI.Assets.load<PIXI.Texture>(url).catch(() => null);
    texturePromises.set(url, promise);
  }
  void promise.then(onLoad);
}

// cover-fit：等比铺满目标矩形后居中裁切
function coverSprite(texture: PIXI.Texture, w: number, h: number): PIXI.Sprite {
  const sprite = new PIXI.Sprite(texture);
  const scale = Math.max(w / (texture.width || 1), h / (texture.height || 1));
  sprite.scale.set(scale);
  sprite.position.set((w - texture.width * scale) / 2, (h - texture.height * scale) / 2);
  return sprite;
}

// 顶部两角圆角、底部直角的矩形路径（卡片头图用）
export function topRoundedRectPath(g: PIXI.Graphics, w: number, h: number, radius: number): void {
  g.moveTo(0, h);
  g.lineTo(0, radius);
  g.arc(radius, radius, radius, Math.PI, Math.PI * 1.5);
  g.lineTo(w - radius, 0);
  g.arc(w - radius, radius, radius, Math.PI * 1.5, Math.PI * 2);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
}

// 在 container 内异步绘制一张 cover-fit 图片：先画占位底，加载完成后盖图（圆角遮罩，父容器需已定位）
export function addCoverImage(
  container: PIXI.Container,
  url: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: { radius?: number; topRounded?: boolean; placeholderEmoji?: string } = {},
): void {
  const radius = options.radius ?? 8;
  const bg = new PIXI.Graphics();
  bg.beginFill(0x1d231e);
  if (options.topRounded) topRoundedRectPath(bg, w, h, radius);
  else bg.drawRoundedRect(0, 0, w, h, radius);
  bg.endFill();
  bg.position.set(x, y);
  container.addChild(bg);
  if (options.placeholderEmoji) {
    const placeholder = new PIXI.Text(options.placeholderEmoji, { fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif', fontSize: 36, fill: 0x6b7280 });
    placeholder.anchor.set(0.5);
    placeholder.position.set(x + w / 2, y + h / 2);
    container.addChild(placeholder);
  }
  loadPixiTexture(url, (texture) => {
    if (!texture) return;
    const sprite = coverSprite(texture, w, h);
    sprite.position.set(sprite.x + x, sprite.y + y);
    const mask = new PIXI.Graphics();
    if (options.topRounded) topRoundedRectPath(mask, w, h, radius);
    else mask.drawRoundedRect(0, 0, w, h, radius);
    mask.position.set(x, y);
    container.addChild(mask);
    sprite.mask = mask;
    container.addChild(sprite);
    bg.renderable = false;
  });
}
