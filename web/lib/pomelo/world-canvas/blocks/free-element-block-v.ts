/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/entity-color（attrMediaLabel）、
 *          world-canvas/blocks/vello-shared
 * [OUTPUT]: 对外提供 FreeElementBlockV（type: free-element）：文本 / 形状 / 属性预览卡；
 * 属性文本卡用 pushClipRoundRect 裁剪到几何 box（文本服从 box，溢出截断）；
 * 属性媒体卡的生成提案态（proposalStatus）渲染为琥珀描边 + 「提案」徽标 + 提示词摘要；
 * 素材生成中/失败态（assetStatus）渲染为蓝/红描边 + 等待/失败提示（AI 先落 assetId 的节点）。
 * [POS]: lib/pomelo/world-canvas/blocks 的自由元素 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { attrMediaLabel } from "../entity-color";
import {
  CAPTION_TOP_OFFSET,
  CARD_FILL,
  CARD_STROKE,
  FAILED_ACCENT,
  FAILED_FILL,
  PENDING_ACCENT,
  PENDING_FILL,
  PROPOSAL_ACCENT,
  PROPOSAL_FILL,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  captionOpsV,
  coverImageOpsV,
  screenScaleOf,
} from "./vello-shared";
import { displayRefText } from "./ref-text";

/** 自由元素（type: free-element）：文本 / 形状 / 属性预览卡（v1 简化视觉）。 */
export class FreeElementBlockV extends VelloBlock {
  static type = "free-element";
  override renderOnZoom = true;

  protected blockBounds() {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 120;
    const h = Number(attrs.height) || 60;
    if (String(attrs.elementKind ?? "") === "attr") {
      const scale = screenScaleOf(this.adapter);
      return { minX: x, minY: y - (CAPTION_TOP_OFFSET + 2) / scale, maxX: x + w, maxY: y + h };
    }
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 120;
    const h = Number(attrs.height) || 60;
    const elementKind = String(attrs.elementKind ?? "shape");
    const shapeType = String(attrs.shapeType ?? "rectangle");
    const text = displayRefText(String(attrs.text ?? ""));
    const media = String(attrs.attrMedia ?? "text");
    const mediaSrc = String(attrs.mediaSrc ?? "");

    const ops: VelloOp[] = [];
    if (elementKind === "text") {
      ops.push(textOp({ text: text || "（空文本）", x, y, size: 13, maxWidth: Math.max(40, w), lineHeight: 20, fill: [212, 212, 216, 255] }));
    } else if (elementKind === "attr") {
      // 属性名（label）优先于媒体类型标签，让「环境卡」等具名属性在卡片上可读
      const label = `${String(attrs.label ?? "") || attrMediaLabel(media)}${text ? ` · ${text.slice(0, 12)}` : ""}`;
      const caption = captionOpsV(this.adapter, x, y, w, label);
      const proposalStatus = String(attrs.proposalStatus ?? "");
      const isProposal = proposalStatus === "pending" || proposalStatus === "generating" || proposalStatus === "failed";
      // 素材生成中/失败（AI 先落 assetId）：与提案态区分，单独渲染等待态
      const assetStatus = String(attrs.assetStatus ?? "");
      const isGenerating = !isProposal && assetStatus === "generating";
      const isFailed = !isProposal && assetStatus === "failed";
      const accent = isProposal ? PROPOSAL_ACCENT : isGenerating ? PENDING_ACCENT : isFailed ? FAILED_ACCENT : CARD_STROKE;
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: accent, strokeWidth: isProposal || isGenerating || isFailed ? 2 : 1 });
      ops.push(...caption.ops);
      if (isGenerating) {
        ops.push({ kind: "roundRect", x: x + 8, y: y + 8, width: 48, height: 16, radius: 8, fill: PENDING_FILL, stroke: PENDING_ACCENT, strokeWidth: 1 });
        ops.push(textOp({ text: "生成中", x: x + 16, y: y + 11, size: 9, maxWidth: 36, fill: PENDING_ACCENT }));
        ops.push(textOp({ text: "生成中…", x: x + 10, y: y + 32, size: 11, maxWidth: w - 20, fill: TEXT_PRIMARY }));
        ops.push(textOp({ text: "完成后自动显示", x: x + 10, y: y + 49, size: 9, maxWidth: w - 20, fill: TEXT_TERTIARY }));
      } else if (isFailed) {
        ops.push({ kind: "roundRect", x: x + 8, y: y + 8, width: 40, height: 16, radius: 8, fill: FAILED_FILL, stroke: FAILED_ACCENT, strokeWidth: 1 });
        ops.push(textOp({ text: "失败", x: x + 17, y: y + 11, size: 9, maxWidth: 28, fill: FAILED_ACCENT }));
        ops.push(textOp({ text: "生成失败", x: x + 10, y: y + 32, size: 11, maxWidth: w - 20, fill: TEXT_PRIMARY }));
        ops.push(textOp({ text: "在详情面板重试", x: x + 10, y: y + 49, size: 9, maxWidth: w - 20, fill: TEXT_TERTIARY }));
      } else if (isProposal) {
        // 生成提案（待确认）：媒体属性卡的提案态
        const refs = Number(attrs.proposalRefs ?? 0);
        const prompt = String(attrs.proposalPrompt ?? "").replace(/\s+/g, " ").trim();
        const snippet = prompt.length > 34 ? `${prompt.slice(0, 34)}…` : prompt || "（未填写提示词）";
        ops.push({ kind: "roundRect", x: x + 8, y: y + 8, width: 48, height: 16, radius: 8, fill: PROPOSAL_FILL, stroke: PROPOSAL_ACCENT, strokeWidth: 1 });
        ops.push(textOp({ text: "提案", x: x + 16, y: y + 11, size: 9, maxWidth: 36, fill: PROPOSAL_ACCENT }));
        ops.push(textOp({ text: "待确认生成", x: x + 10, y: y + 32, size: 11, maxWidth: w - 20, fill: TEXT_PRIMARY }));
        ops.push(textOp({ text: snippet, x: x + 10, y: y + 49, size: 10, lineHeight: 14, maxWidth: w - 20, fill: TEXT_SECONDARY }));
        ops.push(textOp({ text: `${refs} 参考`, x: x + 10, y: y + h - 20, size: 9, maxWidth: w - 20, fill: TEXT_TERTIARY }));
      } else if (media === "image" && mediaSrc) {
        ops.push(...coverImageOpsV(this.adapter, mediaSrc, { x, y, width: w, height: h }, { x, y, width: w, height: h, radius: 12 }));
      } else if (text) {
        // 文本服从 box：裁剪到卡片圆角内，溢出直接截断（双击就地编辑改为内滚动 + 全屏放大）
        ops.push({ kind: "pushClipRoundRect", x, y, width: w, height: h, radius: 12 });
        ops.push(textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: w - 20, lineHeight: 17, fill: TEXT_PRIMARY }));
        ops.push({ kind: "popClip" });
      } else if (media !== "text") {
        // 空媒体属性卡 placeholder：点击选中后在右侧详情面板选来源
        const placeholder = media === "video" ? "＋ 点击添加视频" : media === "audio" ? "＋ 点击添加音频" : "＋ 点击添加图片";
        ops.push(textOp({ text: placeholder, x: x + 10, y: y + 10, size: 11, maxWidth: w - 20, fill: TEXT_TERTIARY }));
      }
    } else {
      const radius = shapeType === "ellipse" || shapeType === "diamond" ? Math.min(w, h) / 2 : 8;
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius, fill: [255, 255, 255, 8], stroke: [82, 82, 91, 255], strokeWidth: 1.5 });
      if (text) ops.push(textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: w - 16, fill: TEXT_TERTIARY }));
    }

    return { ops, bounds: this.blockBounds() };
  }
}
