/*
 * [INPUT]: 依赖 pixi.js 与 pomelo-core（PixiBlock）
 * [OUTPUT]: 对外提供 EntityCardBlock：实体卡 Block（type: entity-card），渲染类型描边、标题、
 * kind 标签与两行简述；attrs 精简为 { x, y, width, height, title, kind, summary } 以驱动增量渲染
 * [POS]: lib/pomelo/world-canvas 的实体卡 Block（demo 数据 → block record 的映射在 doc-sync.ts）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import { truncateText } from "../truncate-text";
import { entityColor } from "../entity-color";
import { kindLabel } from "../demo-store";

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';
const RADIUS = 10;
const PAD = 14;

export class EntityCardBlock extends PixiBlock {
  static type = "entity-card";

  renderBlock() {
    const { x = 0, y = 0, width = 200, height = 110, title = "", kind = "", summary = "" } = this.record.attrs;
    const color = entityColor(String(kind));
    const w = Number(width);
    const h = Number(height);

    const container = new PIXI.Container();

    const card = new PIXI.Graphics();
    card.beginFill(0x161c2b, 0.96);
    card.lineStyle(2, color, 1, 1);
    card.drawRoundedRect(0, 0, w, h, RADIUS);
    card.endFill();
    container.addChild(card);

    const stripe = new PIXI.Graphics();
    stripe.beginFill(color);
    stripe.drawRoundedRect(PAD, PAD, 34, 5, 2.5);
    stripe.endFill();
    container.addChild(stripe);

    const titleText = new PIXI.Text(truncateText(String(title), w - PAD * 2, 15), {
      fontFamily: FONT,
      fontSize: 15,
      fontWeight: "600",
      fill: 0xf4f6fb,
    });
    titleText.position.set(PAD, PAD + 14);
    container.addChild(titleText);

    const kindText = new PIXI.Text(truncateText(kindLabel(String(kind)) + (this.record.attrs.isProvisional ? " · 草稿" : ""), w - PAD * 2, 11), {
      fontFamily: FONT,
      fontSize: 11,
      fill: 0x8b93a7,
    });
    kindText.position.set(PAD, PAD + 40);
    container.addChild(kindText);

    const summaryText = new PIXI.Text(
      truncateText(String(summary) || "（无简述）", w - PAD * 2, 10).slice(0, 44),
      {
        fontFamily: FONT,
        fontSize: 10,
        lineHeight: 14,
        fill: 0x6f7688,
        wordWrap: true,
        wordWrapWidth: w - PAD * 2,
        breakWords: true,
      },
    );
    summaryText.position.set(PAD, PAD + 62);
    container.addChild(summaryText);

    container.position.set(Number(x), Number(y));
    container.eventMode = "none";
    return container;
  }
}
