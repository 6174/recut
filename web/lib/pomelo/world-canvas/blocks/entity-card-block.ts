/*
 * [INPUT]: 依赖 pixi.js、pomelo-core（PixiBlock）、arrow-geometry（节点矩形解析注册）、
 * canvas-theme/truncate-text/demo-store
 * [OUTPUT]: 对外提供 EntityCardBlock 与 entityCardRect：实体卡 Block（type: entity-card），
 * 统一视觉（深色卡面 + 细边框 + 柔和投影）；排版为图先于文——头图通铺卡片顶部（不留 padding，
 * cover-fit 裁切，attrs.coverUrl 真图 / emoji 占位），下方为标题/副标题与资料缩略网格
 * （photoUrls 真图 / photos emoji 占位，最多 9 格，静态无动效）；卡片高度内容自适应，
 * entityCardRect 是命中/选区/连线锚点共用的有效渲染矩形
 * [POS]: lib/pomelo/world-canvas 的实体卡 Block（demo 数据 → block record 的映射在 doc-sync.ts；
 * 真实画布 app/worlds/[worldID]/canvas 复用本 Block 并经 canvas-image.ts 传入真实图 URL）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import { setNodeRectResolver } from "../arrow-geometry";
import { truncateText, drawElementCaption } from "../truncate-text";
import { CARD_RADIUS, TEXT_PRIMARY, TEXT_SECONDARY, drawShadowCard, drawTile, loadPixiTexture, coverSprite } from "../canvas-theme";
import { kindLabel } from "../demo-store";

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';
const PAD = 14;
const IMAGE_H = 160;
const THUMB = 30;
const THUMB_GAP = 5;
const GRID_GAP_Y = 12;
const MIN_W = 240;
const GRID_CAPACITY = 9;
const TILE_FILL = 0x1d231e;

function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]).filter((item) => typeof item === "string" && item) : [];
}

// 内容固有高度：头图 + 文本区（无资料）；有资料时追加缩略网格行
export function entityCardContentHeight(attrs: Record<string, unknown>): number {
  const count = Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);
  const base = IMAGE_H + 52 + PAD;
  if (count <= 0) return base;
  const rows = Math.ceil(Math.min(count, GRID_CAPACITY) / 3);
  return IMAGE_H + 64 + rows * THUMB + (rows - 1) * THUMB_GAP + PAD;
}

// 实体卡的有效渲染矩形（attrs 可能存有旧的更小尺寸；命中/选区/连线锚点必须与渲染一致）
export function entityCardRect(attrs: Record<string, unknown>): { x: number; y: number; width: number; height: number } {
  return {
    x: Number(attrs.x) || 0,
    y: Number(attrs.y) || 0,
    width: Math.max(Number(attrs.width) || 264, MIN_W),
    height: Math.max(Number(attrs.height) || 0, entityCardContentHeight(attrs)),
  };
}

// 注册连线几何的实体卡有效矩形解析（箭头锚点/边界与渲染所见一致）
setNodeRectResolver((record) => (record.type === "entity-card" ? entityCardRect(record.attrs as Record<string, unknown>) : null));

// 顶部两角圆角、底部直角的路径（头图通铺卡片顶部）
function topRoundedPath(g: PIXI.Graphics, w: number, h: number, radius: number): void {
  g.moveTo(0, h);
  g.lineTo(0, radius);
  g.arc(radius, radius, radius, Math.PI, Math.PI * 1.5);
  g.lineTo(w - radius, 0);
  g.arc(w - radius, radius, radius, Math.PI * 1.5, Math.PI * 2);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
}

// 异步加载纹理并盖一张 cover-fit 图（失败保持占位）；block 销毁后放弃回调
function loadTextureInto(
  block: { isDestroyed(): boolean },
  container: PIXI.Container,
  url: string,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  topRounded: boolean,
): void {
  loadPixiTexture(url, (texture) => {
    if (!texture || block.isDestroyed()) return;
    const sprite = coverSprite(texture, w, h);
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    if (topRounded) topRoundedPath(mask, w, h, radius);
    else mask.drawRoundedRect(0, 0, w, h, radius);
    mask.endFill();
    mask.position.set(x, y);
    sprite.position.set(x + sprite.x, y + sprite.y);
    container.addChild(mask);
    sprite.mask = mask;
    container.addChild(sprite);
  });
}

export class EntityCardBlock extends PixiBlock {
  static type = "entity-card";
  #destroyed = false;

  override destroy() {
    this.#destroyed = true;
    super.destroy();
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  renderBlock() {
    const { x = 0, y = 0, width = 264, height = 328, title = "", subtitle = "", kind = "", tags, cover = "", coverUrl = "", photos, photoUrls } = this.record.attrs;
    const w = Math.max(Number(width) || 264, MIN_W);
    const emojiPhotos = stringListOf(photos);
    const urlPhotos = stringListOf(photoUrls);
    const contentH = entityCardContentHeight(this.record.attrs as Record<string, unknown>);
    const cardH = Math.max(Number(height) || contentH, contentH);
    const imageH = IMAGE_H + Math.max(0, cardH - contentH); // resize 变大时多余空间给头图

    const container = new PIXI.Container();

    // 元素标题徽标（左上角，卡片外上方，统一中性色）
    drawElementCaption(container, { title: String(title) || "实体", icon: "◍", maxWidth: w });

    // 统一底座：柔和投影 + 深色卡面 + 细边框
    drawShadowCard(container, w, cardH, { radius: CARD_RADIUS });

    // 头图：通铺卡片顶部（无 padding，cover-fit；真图异步加载，占位为瓦片底 + emoji）
    const header = new PIXI.Container();
    const headerBg = new PIXI.Graphics();
    headerBg.beginFill(TILE_FILL);
    topRoundedPath(headerBg, w, imageH, CARD_RADIUS - 1);
    headerBg.endFill();
    header.addChild(headerBg);
    const placeholder = new PIXI.Text(cover || "🖼️", { fontFamily: FONT, fontSize: 40, fill: 0x6b7280 });
    placeholder.anchor.set(0.5);
    placeholder.position.set(w / 2, imageH / 2);
    header.addChild(placeholder);
    container.addChild(header);
    if (coverUrl) {
      loadTextureInto(this, header, coverUrl, 0, 0, w, imageH, CARD_RADIUS - 1, true);
    }

    // 头部文本：标题 + 副标题（标签摘要优先，回退类型名）
    const textTop = imageH + PAD;
    const titleText = new PIXI.Text(truncateText(String(title), w - PAD * 2, 15), {
      fontFamily: FONT,
      fontSize: 15,
      fontWeight: "600",
      fill: TEXT_PRIMARY,
    });
    titleText.position.set(PAD, textTop);
    container.addChild(titleText);

    const tagList = Array.isArray(tags) ? (tags as string[]) : [];
    const subtitleText = new PIXI.Text(
      truncateText(
        String(subtitle) || (tagList.length ? tagList.slice(0, 3).join(" · ") : kindLabel(String(kind))) + (this.record.attrs.isProvisional ? " · 草稿" : ""),
        w - PAD * 2,
        10,
      ),
      { fontFamily: FONT, fontSize: 10, fill: TEXT_SECONDARY },
    );
    subtitleText.position.set(PAD, textTop + 24);
    container.addChild(subtitleText);

    // 资料缩略网格：真图优先（cover-fit），emoji 兜底；最多 9 格，超出末格 +N
    const totalCount = Math.max(emojiPhotos.length, urlPhotos.length);
    if (totalCount > 0) {
      const tiles = Math.min(totalCount, GRID_CAPACITY);
      const gridTop = textTop + 24 + 14 + GRID_GAP_Y;
      for (let index = 0; index < tiles; index += 1) {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const tx = PAD + col * (THUMB + THUMB_GAP);
        const ty = gridTop + row * (THUMB + THUMB_GAP);
        drawTile(container, tx, ty, THUMB, THUMB, 8);
        const url = urlPhotos[index];
        const emoji = emojiPhotos[index];
        if (url) {
          loadTextureInto(this, container, url, tx, ty, THUMB, THUMB, 8, false);
        } else if (emoji) {
          const glyph = new PIXI.Text(emoji, { fontFamily: FONT, fontSize: 14 });
          glyph.anchor.set(0.5);
          glyph.position.set(tx + THUMB / 2, ty + THUMB / 2);
          container.addChild(glyph);
        }
      }
      if (totalCount > GRID_CAPACITY) {
        const lastIndex = tiles - 1;
        const tx = PAD + (lastIndex % 3) * (THUMB + THUMB_GAP);
        const ty = gridTop + Math.floor(lastIndex / 3) * (THUMB + THUMB_GAP);
        const veil = new PIXI.Graphics();
        veil.beginFill(0x000000, 0.55);
        veil.drawRoundedRect(tx, ty, THUMB, THUMB, 8);
        veil.endFill();
        container.addChild(veil);
        const more = new PIXI.Text(`+${totalCount - GRID_CAPACITY + 1}`, { fontFamily: FONT, fontSize: 10, fill: TEXT_PRIMARY });
        more.anchor.set(0.5);
        more.position.set(tx + THUMB / 2, ty + THUMB / 2);
        container.addChild(more);
      }
    }

    container.position.set(Number(x), Number(y));
    container.eventMode = "none";
    return container;
  }
}
