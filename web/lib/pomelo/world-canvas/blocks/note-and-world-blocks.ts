/*
 * [INPUT]: 依赖 pixi.js 与 pomelo-core（PixiBlock）
 * [OUTPUT]: 对外提供 NoteBlock（type: note）与 WorldNodeBlock（type: world-node）：便签与 World 核心节点
 * [POS]: lib/pomelo/world-canvas 的便签/World 节点 Block（demo 数据 → block record 的映射在 doc-sync.ts）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import { truncateText } from "../truncate-text";

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';

export class NoteBlock extends PixiBlock {
  static type = "note";

  renderBlock() {
    const { x = 0, y = 0, width = 160, height = 110, text = "" } = this.record.attrs;
    const w = Number(width);
    const h = Number(height);

    const container = new PIXI.Container();
    const card = new PIXI.Graphics();
    card.beginFill(0x3a3320, 0.96);
    card.lineStyle(1.5, 0xf5c451, 1, 1);
    card.drawRoundedRect(0, 0, w, h, 8);
    card.endFill();
    container.addChild(card);

    const textObj = new PIXI.Text(String(text) || "空便签", {
      fontFamily: FONT,
      fontSize: 11,
      lineHeight: 16,
      fill: 0xfde68a,
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

  renderBlock() {
    const { x = 0, y = 0, width = 260, height = 96, title = "" } = this.record.attrs;
    const w = Number(width);
    const h = Number(height);

    const container = new PIXI.Container();
    const card = new PIXI.Graphics();
    card.beginFill(0x171e2e, 0.98);
    card.lineStyle(2, 0x7c9cff, 1, 1);
    card.drawRoundedRect(0, 0, w, h, 14);
    card.endFill();
    container.addChild(card);

    const icon = new PIXI.Graphics();
    icon.beginFill(0x7c9cff, 0.18);
    icon.drawRoundedRect(16, h / 2 - 20, 40, 40, 12);
    icon.endFill();
    container.addChild(icon);

    const glyph = new PIXI.Text("◍", { fontFamily: FONT, fontSize: 20, fill: 0x7c9cff });
    glyph.anchor.set(0.5);
    glyph.position.set(36, h / 2);
    container.addChild(glyph);

    const titleText = new PIXI.Text(truncateText(String(title), w - 96, 16), {
      fontFamily: FONT,
      fontSize: 16,
      fontWeight: "600",
      fill: 0xf4f6fb,
    });
    titleText.position.set(68, h / 2 - 18);
    container.addChild(titleText);

    const sub = new PIXI.Text("World 核心节点 · 点击查看", { fontFamily: FONT, fontSize: 11, fill: 0x8b93a7 });
    sub.position.set(68, h / 2 + 4);
    container.addChild(sub);

    container.position.set(Number(x), Number(y));
    container.eventMode = "none";
    return container;
  }
}
