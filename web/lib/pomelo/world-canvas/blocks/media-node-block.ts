/*
 * [INPUT]: 依赖 pixi.js、pomelo-core（PixiBlock）、canvas-theme/truncate-text
 * [OUTPUT]: 对外提供 MediaNodeBlock（type: media-node）：基础素材节点（文本/图片/音频/视频），
 * 结构参考生成工作台的空态——顶部居中「类型 + 上传」标签、圆角空画框（类型图标占位）、
 * 左右两侧「+」引导按钮；上传与生成能力后续接入，当前仅 UI 结构与选择/拖拽/删除链路
 * [POS]: lib/pomelo/world-canvas 的基础素材节点 Block（demo 数据 → block record 的映射在 doc-sync.ts）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import { CARD_RADIUS, CARD_STROKE_ALPHA, CARD_STROKE, TILE_FILL, TEXT_SECONDARY, TEXT_TERTIARY, drawShadowCard, drawTile } from "../canvas-theme";

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';

export const MEDIA_META: Record<string, { label: string; icon: string }> = {
  text: { label: "文本", icon: "¶" },
  image: { label: "图片", icon: "🖼" },
  audio: { label: "音频", icon: "♪" },
  video: { label: "视频", icon: "▶" },
};

export function mediaMeta(media: string) {
  return MEDIA_META[media] ?? MEDIA_META.image;
}

export class MediaNodeBlock extends PixiBlock {
  static type = "media-node";

  renderBlock() {
    const { x = 0, y = 0, width = 220, height = 150, media = "image" } = this.record.attrs;
    const w = Number(width);
    const h = Number(height);
    const meta = mediaMeta(String(media));

    const container = new PIXI.Container();

    // 顶部居中标签：类型名 + 上传入口（空态结构，后续接上传/生成）
    const label = new PIXI.Text(`${meta.icon} ${meta.label}`, { fontFamily: FONT, fontSize: 11, fill: TEXT_SECONDARY });
    const upload = new PIXI.Text("上传", { fontFamily: FONT, fontSize: 11, fill: TEXT_TERTIARY });
    const gap = 56;
    const total = label.width + gap + upload.width;
    label.position.set((w - total) / 2, -24);
    upload.position.set((w - total) / 2 + label.width + gap, -24);
    container.addChild(label);
    container.addChild(upload);

    // 空画框：统一投影 + 细边框；已填充时只画瓦片底（图片素材后续替换）
    drawShadowCard(container, w, h, { radius: CARD_RADIUS, strokeAlpha: CARD_STROKE_ALPHA });
    drawTile(container, 1, 1, w - 2, h - 2, CARD_RADIUS - 1).tint = TILE_FILL;

    // 居中占位图标（有内容后由图片/波形等真实渲染替换）
    const glyph = new PIXI.Text(meta.icon, {
      fontFamily: FONT,
      fontSize: 34,
      fill: TEXT_TERTIARY,
    });
    glyph.anchor.set(0.5);
    glyph.position.set(w / 2, h / 2);
    container.addChild(glyph);

    // 左右「+」引导按钮（连接生成/上传的占位，屏幕像素语义随画布缩放）
    for (const cx of [-24, w + 24]) {
      const btn = new PIXI.Graphics();
      btn.lineStyle(1, CARD_STROKE, 0.18, 1);
      btn.drawCircle(cx, h / 2, 11);
      btn.moveTo(cx - 5, h / 2);
      btn.lineTo(cx + 5, h / 2);
      btn.moveTo(cx, h / 2 - 5);
      btn.lineTo(cx, h / 2 + 5);
      container.addChild(btn);
    }

    container.position.set(Number(x), Number(y));
    container.eventMode = "none";
    return container;
  }
}
