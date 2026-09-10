/*
 * [INPUT]: 依赖 pixi.js、pomelo-core（PixiBlock）、arrow-geometry（节点矩形解析注册）、
 * canvas-theme/truncate-text/demo-store
 * [OUTPUT]: 对外提供 EntityCardBlock 与 entityCardRect：实体卡 Block（type: entity-card），
 * 统一视觉（深色卡面 + 细边框 + 柔和投影）；有头图时排版为图先于文——头图通铺卡片顶部（不留 padding，
 * cover-fit 裁切，attrs.coverUrl 真图或视频（coverKind=image|video）/ emoji 占位），下方为标题/副标题
 * 与资料缩略网格（photoUrls 真图 / photos emoji 占位，最多 9 格，静态无动效）；
 * 无头图 = 文本优先排版（B.6 扩展）：不放头图区，标题放大（21px）为主视觉，副标题 11px；
 * 草稿态 = 虚线卡框 + 右上角徽标
 * （B.6/D2），空简介 = 浅色「补充一句简介…」引导；卡片高度内容自适应，
 * entityCardRect 是命中/选区/连线锚点共用的有效渲染矩形；卡片左上角元素徽标为 zoom 常量
 * （1/scale 反向补偿，缩放不改变字号），卡内标题/副标题等仍随卡片内容缩放
 * [POS]: lib/pomelo/world-canvas 的实体卡 Block（demo 数据 → block record 的映射在 doc-sync.ts；
 * 真实画布 app/worlds/[worldID]/canvas 复用本 Block 并经 canvas-image.ts 传入真实图 URL）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import { setNodeRectResolver } from "../arrow-geometry";
import { truncateText, drawElementCaption } from "../truncate-text";
import { CARD_RADIUS, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, drawShadowCard, drawTile, loadPixiTexture, loadPixiVideoTexture, coverSprite } from "../canvas-theme";

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

// 无头图的文本优先排版：标题更大（B.6 扩展——没有头图时卡片以文本为主）
const TITLE_SIZE_TEXT_FIRST = 21;
const SUBTITLE_SIZE_TEXT_FIRST = 11;
// 文本优先态的标题+副标题固有高度（比有图态的文字区更高，容纳大标题）
const TEXT_BLOCK_H = 76;

// 内容固有高度：有头图 = 头图 + 文本区；无头图 = 纯文本优先；有资料时追加缩略网格行
export function entityCardContentHeight(attrs: Record<string, unknown>): number {
  const count = Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);
  const hasCover = Boolean(String(attrs.coverUrl ?? "") || String(attrs.cover ?? ""));
  const textTop = (hasCover ? IMAGE_H + 52 : TEXT_BLOCK_H) + PAD;
  if (count <= 0) return textTop;
  const rows = Math.ceil(Math.min(count, GRID_CAPACITY) / 3);
  return textTop + rows * THUMB + (rows - 1) * THUMB_GAP + PAD;
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
    if (!texture || block.isDestroyed() || container.destroyed) return;
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
  // zoom 常量：标题与元素徽标按屏幕像素渲染，缩放时重绘
  override renderOnZoom = true;
  #destroyed = false;

  override destroy() {
    this.#destroyed = true;
    super.destroy();
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  renderBlock() {
    const { x = 0, y = 0, width = 264, height = 328, title = "", cover = "", coverUrl = "", coverKind = "image", photos, photoUrls } = this.record.attrs;
    const w = Math.max(Number(width) || 264, MIN_W);
    const emojiPhotos = stringListOf(photos);
    const urlPhotos = stringListOf(photoUrls);
    const contentH = entityCardContentHeight(this.record.attrs as Record<string, unknown>);
    const cardH = Math.max(Number(height) || contentH, contentH);
    const hasCover = Boolean(String(coverUrl) || String(cover));
    const imageH = hasCover ? IMAGE_H + Math.max(0, cardH - contentH) : 0; // resize 变大时多余空间给头图

    const container = new PIXI.Container();

    // zoom 常量补偿：文字尺寸保持屏幕像素恒定（反向缩放），截断宽度按世界宽 × 视口缩放换算
    const s = this.screenScale;
    const inv = 1 / s;

    // 元素标题徽标（左上角，卡片外上方，统一中性色）
    drawElementCaption(container, { title: String(title) || "实体", icon: "◍", maxWidth: w * s, scale: inv });

    // 统一底座：柔和投影 + 深色卡面 + 细边框
    drawShadowCard(container, w, cardH, { radius: CARD_RADIUS });

    // 草稿态（B.6/D2）：虚线卡框 + 右上角「草稿」徽标（屏幕像素恒定）
    if (this.record.attrs.isProvisional) {
      // 手绘虚线矩形：沿周长等分短线（dash/gap 屏幕像素恒定）
      const dashed = new PIXI.Graphics();
      dashed.lineStyle(1 * inv, 0xfbbf24, 0.9);
      const perimeter = 2 * (w - 2 + cardH - 2);
      const dash = 6 * inv;
      const gap = 4 * inv;
      const pointAt = (dist: number): PIXI.Point => {
        const dd = ((dist % perimeter) + perimeter) % perimeter;
        const edgeW = w - 2;
        const edgeH = cardH - 2;
        if (dd < edgeW) return new PIXI.Point(1 + dd, 1);
        if (dd < edgeW + edgeH) return new PIXI.Point(w - 1, 1 + (dd - edgeW));
        if (dd < edgeW * 2 + edgeH) return new PIXI.Point(w - 1 - (dd - edgeW - edgeH), cardH - 1);
        return new PIXI.Point(1, cardH - 1 - (dd - edgeW * 2 - edgeH));
      };
      for (let cursor = 0; cursor < perimeter; cursor += dash + gap) {
        const a = pointAt(cursor);
        const b = pointAt(Math.min(cursor + dash, perimeter));
        dashed.moveTo(a.x, a.y);
        dashed.lineTo(b.x, b.y);
      }
      container.addChild(dashed);
      const badge = new PIXI.Text("草稿", {
        fontFamily: FONT,
        fontSize: 9,
        fill: 0xfbbf24,
      });
      const badgeBg = new PIXI.Graphics();
      badgeBg.beginFill(0x0f1410, 0.95);
      badgeBg.lineStyle(1, 0xfbbf24, 0.6, 1);
      badgeBg.drawRoundedRect(w - 44, 8, 34, 16, 8);
      badgeBg.endFill();
      badge.position.set(w - 37, 12);
      container.addChild(badgeBg);
      container.addChild(badge);
    }

    // 头图：通铺卡片顶部（无 padding，cover-fit；真图异步加载，占位为瓦片底 + emoji；
    // coverKind=video 走视频纹理静音循环）；无头图 = 文本优先排版（B.6 扩展）
    // TODO(RFC 背景): 统一 Entity 模型下，卡面背景默认以实体 media 属性（image/video，6–8s/张）
    // 做慢轮播、显式 `background` media 属性覆盖为静态单图。当前 renderBlock 为静态单次绘制契约
    // （无 ticker/时间驱动重绘入口），轮播需在 Block 层引入逐帧切换（如 ticker 或 re-render 调度）
    // 并由 canvas-pomelo 的 buildPomeloRecords 把 media 属性 URL 列表经 attrs（如 bgUrls）传入；
    // 本次仅落 cover fallback（background 属性 → 首个 image media 属性 → video）+ 资料格。
    const textTop = hasCover ? imageH + PAD : PAD;
    if (hasCover) {
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
      if (coverKind === "video") {
        loadPixiVideoTexture(String(coverUrl), (texture) => {
          if (!texture || this.isDestroyed() || header.destroyed) return;
          const sprite = coverSprite(texture, w, imageH);
          const mask = new PIXI.Graphics();
          mask.beginFill(0xffffff);
          topRoundedPath(mask, w, imageH, CARD_RADIUS - 1);
          mask.endFill();
          mask.position.set(0, 0);
          sprite.position.set(sprite.x, sprite.y);
          header.addChild(mask);
          sprite.mask = mask;
          header.addChild(sprite);
          placeholder.visible = false;
        });
      } else {
        loadTextureInto(this, header, String(coverUrl), 0, 0, w, imageH, CARD_RADIUS - 1, true);
      }
    }

    // 头部文本：标题 + 副标题（随卡片整体缩放，属卡片内容）；无头图时标题放大
    const titleText = new PIXI.Text(truncateText(String(title), w - PAD * 2, hasCover ? 15 : TITLE_SIZE_TEXT_FIRST), {
      fontFamily: FONT,
      fontSize: hasCover ? 15 : TITLE_SIZE_TEXT_FIRST,
      fontWeight: "600",
      fill: TEXT_PRIMARY,
    });
    titleText.position.set(PAD, textTop);
    container.addChild(titleText);

    // 副标题行：简介（desc）优先；空简介 = 浅色引导「补充一句简介」（B.6 空态引导）
    const summary = String(this.record.attrs.desc ?? "").trim();
    const subtitleSize = hasCover ? 10 : SUBTITLE_SIZE_TEXT_FIRST;
    const subtitleText = new PIXI.Text(
      truncateText(summary || "补充一句简介…", w - PAD * 2, subtitleSize),
      { fontFamily: FONT, fontSize: subtitleSize, fill: summary ? TEXT_SECONDARY : TEXT_TERTIARY },
    );
    subtitleText.position.set(PAD, textTop + (hasCover ? 24 : 30));
    container.addChild(subtitleText);

    // 资料缩略网格：真图优先（cover-fit），emoji 兜底；最多 9 格，超出末格 +N
    const totalCount = Math.max(emojiPhotos.length, urlPhotos.length);
    if (totalCount > 0) {
      const tiles = Math.min(totalCount, GRID_CAPACITY);
      const gridTop = textTop + (hasCover ? 24 + 14 : 30 + 18) + GRID_GAP_Y;
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
