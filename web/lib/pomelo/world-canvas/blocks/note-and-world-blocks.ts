/*
 * [INPUT]: 依赖 pixi.js 与 pomelo-core（PixiBlock）、canvas-theme/truncate-text
 * [OUTPUT]: 对外提供 NoteBlock（type: note）与 WorldNodeBlock（type: world-node）：
 * 统一视觉重设计——深色卡面 + 细边框 + 柔和投影，不再使用彩色描边；
 * World 节点用略强的边框与图标瓦片做轻量层级区分
 * [POS]: lib/pomelo/world-canvas 的便签/World 节点 Block（demo 数据 → block record 的映射在 doc-sync.ts）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import { truncateText, drawElementCaption } from "../truncate-text";
import { CARD_RADIUS, CARD_STROKE_ALPHA, CARD_STROKE_STRONG_ALPHA, TILE_FILL, TEXT_PRIMARY, TEXT_SECONDARY, drawShadowCard, drawTile } from "../canvas-theme";

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';

export class NoteBlock extends PixiBlock {
  static type = "note";
  // zoom 常量：元素标题徽标按屏幕像素渲染
  override renderOnZoom = true;

  renderBlock() {
    const { x = 0, y = 0, width = 160, height = 110, text = "" } = this.record.attrs;
    const w = Number(width);
    const h = Number(height);
    const s = this.screenScale;
    const inv = 1 / s;

    const container = new PIXI.Container();

    drawElementCaption(container, { title: "便签", icon: "✒️", maxWidth: w * s, scale: inv });

    drawShadowCard(container, w, h, { radius: 12 });

    const textObj = new PIXI.Text(String(text) || "空便签", {
      fontFamily: FONT,
      fontSize: 11,
      lineHeight: 16,
      fill: 0x9ca3af,
      wordWrap: true,
      wordWrapWidth: w - 20,
      breakWords: true,
    });
    textObj.position.set(10, 10);
    container.addChild(textObj);

    container.position.set(Number(x), Number(y));
    container.eventMode = "none";
    return container;
  }
}

export class WorldNodeBlock extends PixiBlock {
  static type = "world-node";
  // zoom 常量：标题与元素徽标按屏幕像素渲染
  override renderOnZoom = true;

  renderBlock() {
    const { x = 0, y = 0, width = 260, height = 96, title = "" } = this.record.attrs;
    const w = Number(width);
    const h = Number(height);
    const s = this.screenScale;
    const inv = 1 / s;

    const container = new PIXI.Container();

    drawElementCaption(container, { title: String(title) || "World", icon: "◍", maxWidth: (w - 20) * s, scale: inv });

    // 略强边框：World 节点做轻量层级强调
    drawShadowCard(container, w, h, { radius: CARD_RADIUS, strokeAlpha: CARD_STROKE_STRONG_ALPHA });

    const ICON = 44;
    const icon = drawTile(container, 16, h / 2 - ICON / 2, ICON, ICON, 12);
    icon.tint = TILE_FILL;

    const glyph = new PIXI.Text("◍", { fontFamily: FONT, fontSize: 20, fill: TEXT_SECONDARY });
    glyph.anchor.set(0.5);
    glyph.position.set(16 + ICON / 2, h / 2);
    container.addChild(glyph);

    const titleText = new PIXI.Text(truncateText(String(title), (w - 96) * s, 16), {
      fontFamily: FONT,
      fontSize: 16,
      fontWeight: "600",
      fill: TEXT_PRIMARY,
    });
    titleText.position.set(72, h / 2 - 18);
    titleText.scale.set(inv);
    container.addChild(titleText);

    const sub = new PIXI.Text("World 核心节点 · 点击查看", { fontFamily: FONT, fontSize: 11, fill: TEXT_SECONDARY });
    sub.position.set(72, h / 2 + 4);
    container.addChild(sub);

    container.position.set(Number(x), Number(y));
    container.eventMode = "none";
    return container;
  }
}

export { CARD_STROKE_ALPHA };
