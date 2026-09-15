/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/blocks/vello-shared
 * [OUTPUT]: 对外提供 RealMediaBlockV（type: media）：图 center-cover / 视频音频占位 + 元素徽标；
 * 生成提案态（proposalStatus）渲染为琥珀描边 + 「提案」徽标 + 提示词摘要 + 参考/模型信息。
 * [POS]: lib/pomelo/world-canvas/blocks 的媒体元素 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import {
  CAPTION_TOP_OFFSET,
  CARD_FILL,
  CARD_STROKE,
  PROPOSAL_ACCENT,
  PROPOSAL_FILL,
  SHADOW_FILL,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  captionOpsV,
  coverImageOpsV,
  screenScaleOf,
} from "./vello-shared";

/** 媒体元素（type: media）：图 center-cover / 视频音频占位 + 元素徽标。 */
export class RealMediaBlockV extends VelloBlock {
  static type = "media";
  override renderOnZoom = true;

  protected blockBounds() {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 220;
    const h = Number(attrs.height) || 150;
    const scale = screenScaleOf(this.adapter);
    return { minX: x, minY: y - (CAPTION_TOP_OFFSET + 2) / scale, maxX: x + w, maxY: y + h };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 220;
    const h = Number(attrs.height) || 150;
    const modality = String(attrs.modality ?? "image");
    const src = String(attrs.src ?? "");
    const label = String(attrs.label ?? "媒体");
    const attached = Boolean(attrs.attached);
    const proposalStatus = String(attrs.proposalStatus ?? "");
    const isProposal = proposalStatus === "pending" || proposalStatus === "generating" || proposalStatus === "failed";
    const innerH = h - (attached ? 18 : 0);
    const caption = captionOpsV(this.adapter, x, y, w, label);

    const ops: VelloOp[] = [
      { kind: "roundRect", x: x + 2, y: y + 6, width: w, height: h, radius: 12, fill: SHADOW_FILL, stroke: [0, 0, 0, 0], strokeWidth: 0 },
      { kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: isProposal ? PROPOSAL_ACCENT : CARD_STROKE, strokeWidth: isProposal ? 2 : 1 },
      ...caption.ops,
    ];
    if (isProposal) {
      // 生成提案（待确认）：琥珀徽标 + 提示词摘要 + 参考/模型信息，提示用户确认后才生成
      const refs = Number(attrs.proposalRefs ?? 0);
      const model = String(attrs.proposalModel ?? "");
      const prompt = String(attrs.proposalPrompt ?? "").replace(/\s+/g, " ").trim();
      const snippet = prompt.length > 46 ? `${prompt.slice(0, 46)}…` : prompt || "（未填写提示词）";
      ops.push({ kind: "roundRect", x: x + 10, y: y + 10, width: 56, height: 18, radius: 9, fill: PROPOSAL_FILL, stroke: PROPOSAL_ACCENT, strokeWidth: 1 });
      ops.push(textOp({ text: "提案", x: x + 20, y: y + 14, size: 10, maxWidth: 40, fill: PROPOSAL_ACCENT }));
      ops.push(textOp({ text: "待确认生成", x: x + 12, y: y + 38, size: 12, maxWidth: w - 24, fill: TEXT_PRIMARY }));
      ops.push(textOp({ text: snippet, x: x + 12, y: y + 58, size: 10, lineHeight: 15, maxWidth: w - 24, fill: TEXT_SECONDARY }));
      ops.push(textOp({ text: `${refs} 参考${model ? ` · ${model}` : ""}`, x: x + 12, y: y + h - 24, size: 9, maxWidth: w - 24, fill: TEXT_TERTIARY }));
      return { ops, bounds: this.blockBounds() };
    }
    if (modality === "image" && src) {
      ops.push(...coverImageOpsV(this.adapter, src, { x: x + 6, y: y + 6, width: w - 12, height: innerH - 12 }, { x: x + 6, y: y + 6, width: w - 12, height: innerH - 12, radius: 8 }));
    } else if (src) {
      // 已有源的视频/音频：提示双击预览
      ops.push(textOp({ text: modality === "video" ? "▶ 视频 · 双击预览" : "♪ 音频 · 双击预览", x: x + 12, y: y + innerH / 2 - 10, size: 14, maxWidth: w - 24, fill: TEXT_TERTIARY }));
    } else {
      // 空素材 placeholder：点击选中后在右侧详情面板选来源 / 本地上传
      const placeholder = modality === "video" ? "＋ 点击添加视频" : modality === "audio" ? "＋ 点击添加音频" : "＋ 点击添加图片";
      ops.push(textOp({ text: placeholder, x: x + 12, y: y + innerH / 2 - 10, size: 13, maxWidth: w - 24, fill: TEXT_TERTIARY }));
    }
    if (attached) ops.push(textOp({ text: "◈ 参考素材", x: x + 10, y: y + h - 16, size: 9, maxWidth: w - 20, fill: TEXT_SECONDARY }));

    return { ops, bounds: this.blockBounds() };
  }
}
