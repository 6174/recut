/*
 * [INPUT]: 依赖 pixi.js 与 pomelo-core（PixiBlock）、canvas-theme/truncate-text
 * [OUTPUT]: 对外提供 NoteBlock（type: note）与 WorldNodeBlock（type: world-node）：
 * 统一视觉重设计——深色卡面 + 细边框 + 柔和投影，不再使用彩色描边；
 * World 节点用外圈蓝色光环 + 蓝色图标瓦片 + 更大默认尺寸（320×104）做根节点层级区分
 * [POS]: lib/pomelo/world-canvas 的便签/World 节点 Block（demo 数据 → block record 的映射在 doc-sync.ts）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import { truncateText, drawElementCaption } from "../truncate-text";
import { CARD_FILL, CARD_STROKE_ALPHA, CARD_STROKE_STRONG_ALPHA, TEXT_PRIMARY, drawShadowCard } from "../canvas-theme";

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';
// World 根节点 accent：与 app 主题 --primary 同源的绿色（亮化一档便于暗底识别）
const WORLD_NODE_ACCENT = 0x5d9d75;

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
  // zoom 常量：仅元素徽标按屏幕像素渲染；卡内标题随卡片缩放
  override renderOnZoom = true;

  renderBlock() {
    const { x = 0, y = 0, width = 200, height = 200, title = "" } = this.record.attrs;
    const w = Number(width);
    const h = Number(height);
    const s = this.screenScale;
    const inv = 1 / s;

    const container = new PIXI.Container();

    drawElementCaption(container, { title: String(title) || "World", icon: "◍", maxWidth: w * s, scale: inv });

    // World 根节点 = 圆：默认尺寸下即 inscribed 大圆，随 resize 缩放；
    // 文字尺寸跟随直径（resize scale），居中断行
    const d = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const r = d / 2;

    // 主题色光环（外圈 glow 同心）：与 app 主题 --primary（oklch 0.68 0.18 151）同源
    const glow = new PIXI.Graphics();
    glow.lineStyle({ width: 8, color: WORLD_NODE_ACCENT, alpha: 0.09, alignment: 1 });
    glow.drawCircle(cx, cy, r + 5);
    container.addChild(glow);

    // 圆形卡面：柔和投影（BlurFilter 圆）+ 深色圆底 + 细边框（drawShadowCard 是矩形，不用）
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.28);
    shadow.drawCircle(cx + 3, cy + 7, r);
    shadow.endFill();
    const blur = new PIXI.BlurFilter();
    blur.blur = 12;
    blur.quality = 2;
    shadow.filters = [blur];
    container.addChild(shadow);

    const card = new PIXI.Graphics();
    card.beginFill(CARD_FILL, 0.98);
    card.lineStyle(1, 0xffffff, CARD_STROKE_STRONG_ALPHA, 1);
    card.drawCircle(cx, cy, r);
    card.endFill();
    container.addChild(card);

    const ring = new PIXI.Graphics();
    ring.lineStyle(1.5, WORLD_NODE_ACCENT, 0.4, 1);
    ring.drawCircle(cx, cy, r + 3);
    container.addChild(ring);

    // 世界名：字号随直径缩放，必须完全落在圆内（内接方形区域），居中
    const content = Math.max(20, d * 0.72); // 圆内安全区（内接尺寸）
    const fontSize = Math.max(14, Math.round(d * 0.3));
    const text = String(title) || "World";
    const label = new PIXI.Text(text, {
      fontFamily: FONT,
      fontSize,
      fontWeight: "600",
      lineHeight: fontSize * 1.25,
      fill: TEXT_PRIMARY,
      wordWrap: true,
      wordWrapWidth: content,
      breakWords: true,
      align: "center",
    });
    // 超出安全区（过高/过宽）则整体降字号至恰好放下
    const fit = Math.min(content / Math.max(1, label.height), content / Math.max(1, label.width), 1);
    if (fit < 1) {
      const size = Math.max(14, Math.floor(fontSize * fit));
      label.style.fontSize = size;
      label.style.lineHeight = size * 1.25;
    }
    label.anchor.set(0.5);
    label.position.set(cx, cy);
    container.addChild(label);

    container.position.set(Number(x), Number(y));
    container.eventMode = "none";
    return container;
  }
}

export { CARD_STROKE_ALPHA };
