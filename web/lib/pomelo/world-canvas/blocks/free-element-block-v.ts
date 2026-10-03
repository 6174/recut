/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/entity-color（attrMediaLabel）、
 *          world-canvas/graph-theme（配色单一真源）、world-canvas/blocks/vello-shared（cover/徽标/低细节）、
 *          world-canvas/blocks/audio-block-ops（音频属性卡的播放器外观）
 * [OUTPUT]: 对外提供 FreeElementBlockV（type: free-element）：文本 / 形状 / 属性预览卡；
 * 文本框（elementKind=text，或 attr 且 attrMedia=text）无背景、圆角描边框、无徽标——就是画布上的文本（文本服从 box，
 * 溢出截断；host 置 attrs.editing 时就地编辑中只留框、藏文字，避免与 DOM 编辑器重影），与实体卡区分开；
 * 只有媒体属性卡（image/audio/video）才画卡面与徽标；音频属性卡（attrMedia=audio 且有源）
 * 画播放器外观（圆形播放钮 + 真实波形 + 时间 + 音量/下载，波形懒加载，与媒体元素同源）；
 * 视频属性卡（attrMedia=video 且有源）画首帧 center-cover（video-frame 抽帧；悬停播放由 VideoPreviewPlugin 承担）；
 * 媒体属性卡的图/视频与媒体元素、实体卡头图同一卡面语法：内容在卡面内缩 MEDIA_PAD、自带 MEDIA_RADIUS 圆角，
 * 四周露出卡面底色成「框」（音频属性卡是整卡播放器 UI，保持满卡不内缩）；
 * 媒体属性卡的生成提案「待确认」态（proposalStatus=pending）渲染为弱灰描边 + 「提案」徽标 + 提示词摘要；
 * 计划态（planStatus，proposed 但无配方）渲染为弱灰描边 + 「计划中」+ 说明摘要；
 * 生成中/失败态（proposalStatus=generating/failed，或 AI 先落 assetId 的 assetStatus）渲染为蓝/红描边 + 等待/失败提示；
 * 视口 <= LOW_DETAIL_SCALE 时隐藏文字（文本框不再退化出占位块）。
 * [POS]: lib/pomelo/world-canvas/blocks 的自由元素 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import { TRANSPARENT, type VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { attrMediaLabel } from "../entity-color";
import {
  CAPTION_FILL,
  CARD_FILL,
  CARD_STROKE,
  CARD_STROKE_STRONG,
  FAILED_ACCENT,
  FAILED_FILL,
  PENDING_ACCENT,
  PENDING_FILL,
  PLAN_ACCENT,
  PLAN_FILL,
  PROPOSAL_ACCENT,
  PROPOSAL_FILL,
  SHAPE_FILL,
  SHAPE_STROKE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from "../graph-theme";
import { CAPTION_TOP_OFFSET, captionOpsV, coverImageOpsV, isLowDetail, screenScaleOf } from "./vello-shared";
import { audioPlayerOpsV } from "./audio-block-ops";
import { TEXT_ATTR_LINE_HEIGHT, TEXT_ATTR_PAD, TEXT_ATTR_SIZE, TEXT_ELEMENT_LINE_HEIGHT, TEXT_ELEMENT_PAD, TEXT_ELEMENT_SIZE } from "./text-block-metrics";
import { audioBlockRect, isAudioBlockRecord } from "./audio-block-metrics";
import { displayRefText } from "./ref-text";
import { ensureVideoFrame, videoFrameUrl } from "./video-frame";

// 媒体卡内容盒内缩/圆角：与媒体元素（real-media-block-v）、实体卡头图（entity-card-block-v）同一卡面语法，
// 但属性卡自身的卡面圆角是 12——图在卡内再圆一次 8，四周留出卡面底色成「框」。
const MEDIA_PAD = 6;
const MEDIA_RADIUS = 8;

// 文本框（文本元素 / 文本属性卡）：无背景、圆角描边框（fill 透明，只画 stroke）
const TEXT_BOX_RADIUS = 8;

/** 自由元素（type: free-element）：文本 / 形状 / 属性预览卡（v1 简化视觉）。 */
export class FreeElementBlockV extends VelloBlock {
  static type = "free-element";
  override renderOnZoom = true;

  protected blockBounds() {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    // 音频属性卡固定尺寸（不支持 resize）：渲染/命中/选区都用同一固定矩形
    const audio = isAudioBlockRecord(this.record) ? audioBlockRect(attrs) : null;
    const w = audio?.width ?? (Number(attrs.width) || 120);
    const h = audio?.height ?? (Number(attrs.height) || 60);
    if (String(attrs.elementKind ?? "") === "attr" && String(attrs.attrMedia ?? "text") !== "text") {
      const scale = screenScaleOf(this.adapter);
      return { minX: x, minY: y - (CAPTION_TOP_OFFSET + 2) / scale, maxX: x + w, maxY: y + h };
    }
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    // 音频属性卡固定尺寸（不支持 resize）：忽略旧数据里存的宽高
    const audio = isAudioBlockRecord(this.record) ? audioBlockRect(attrs) : null;
    const w = audio?.width ?? (Number(attrs.width) || 120);
    const h = audio?.height ?? (Number(attrs.height) || 60);
    const elementKind = String(attrs.elementKind ?? "shape");
    const shapeType = String(attrs.shapeType ?? "rectangle");
    const text = displayRefText(String(attrs.text ?? ""));
    const media = String(attrs.attrMedia ?? "text");
    const mediaSrc = String(attrs.mediaSrc ?? "");
    const lowDetail = isLowDetail(this.adapter);
    // 就地编辑中（宿主 stage 已置 editing）：隐藏画布文字——文本框无背景，DOM 编辑器直接叠在框位，
    // 不隐藏会与画布文字重影（框本身仍画，编辑时保持描边可见）
    const editing = attrs.editing === true;

    const ops: VelloOp[] = [];
    if (elementKind === "text") {
      // 文本元素：无背景、圆角描边框，就是画布上的文本（低缩放下整体隐藏；就地编辑中藏文字留框）
      if (!lowDetail) {
        ops.push({ kind: "roundRect", x, y, width: w, height: h, radius: TEXT_BOX_RADIUS, fill: TRANSPARENT, stroke: CARD_STROKE_STRONG, strokeWidth: 1 });
        if (!editing) ops.push(textOp({ text: text || "（空文本）", x: x + TEXT_ELEMENT_PAD, y: y + TEXT_ELEMENT_PAD, size: TEXT_ELEMENT_SIZE, maxWidth: Math.max(20, w - TEXT_ELEMENT_PAD * 2), lineHeight: TEXT_ELEMENT_LINE_HEIGHT, fill: CAPTION_FILL }));
      }
    } else if (elementKind === "attr") {
      // 文本框（media=text）：无背景、圆角描边框、无徽标——和实体卡区分开，只是画布上的文本
      if (media === "text") {
        if (!lowDetail) {
          ops.push({ kind: "roundRect", x, y, width: w, height: h, radius: TEXT_BOX_RADIUS, fill: TRANSPARENT, stroke: CARD_STROKE_STRONG, strokeWidth: 1 });
          if (!editing) {
            if (text) {
              ops.push({ kind: "pushClipRoundRect", x, y, width: w, height: h, radius: TEXT_BOX_RADIUS });
              ops.push(textOp({ text, x: x + TEXT_ATTR_PAD, y: y + TEXT_ATTR_PAD, size: TEXT_ATTR_SIZE, maxWidth: Math.max(20, w - TEXT_ATTR_PAD * 2), lineHeight: TEXT_ATTR_LINE_HEIGHT, fill: TEXT_PRIMARY }));
              ops.push({ kind: "popClip" });
            } else {
              ops.push(textOp({ text: "＋ 文本", x: x + TEXT_ATTR_PAD, y: y + TEXT_ATTR_PAD, size: TEXT_ATTR_SIZE, maxWidth: Math.max(20, w - TEXT_ATTR_PAD * 2), fill: TEXT_TERTIARY }));
            }
          }
        }
        return { ops, bounds: this.blockBounds() };
      }
      // 媒体属性卡：属性名（label）优先于媒体类型标签，让「环境卡」等具名属性在卡片上可读
      const label = `${String(attrs.label ?? "") || attrMediaLabel(media)}${text ? ` · ${text.slice(0, 12)}` : ""}`;
      // 内容盒（图/视频/等待态用）：在卡面内缩 MEDIA_PAD，四周露出卡面底色成「框」
      const mediaBox = { x: x + MEDIA_PAD, y: y + MEDIA_PAD, width: Math.max(0, w - MEDIA_PAD * 2), height: Math.max(0, h - MEDIA_PAD * 2) };
      const proposalStatus = String(attrs.proposalStatus ?? "");
      // 只有「待确认」（pending）才是提案卡：确认后资产转 queued/running，proposalStatus 也随之变 generating，
      // 此时必须按「生成中/失败」渲染，否则会把已提交的生成误显示成「待确认生成」。
      const isProposal = proposalStatus === "pending";
      // 素材生成中/失败（AI 先落 assetId，或提案已确认仍在异步生成）：单独渲染等待态
      const assetStatus = String(attrs.assetStatus ?? "");
      const isPlan = !isProposal && Boolean(attrs.planStatus);
      const isGenerating = !isProposal && !isPlan && (proposalStatus === "generating" || assetStatus === "generating");
      const isFailed = !isProposal && !isPlan && (proposalStatus === "failed" || assetStatus === "failed");
      const accent = isProposal ? PROPOSAL_ACCENT : isPlan ? PLAN_ACCENT : isGenerating ? PENDING_ACCENT : isFailed ? FAILED_ACCENT : CARD_STROKE;
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: accent, strokeWidth: isProposal || isPlan || isGenerating || isFailed ? 2 : 1 });
      if (!lowDetail) ops.push(...captionOpsV(this.adapter, x, y, w, label).ops);
      if (!lowDetail && isPlan) {
        // 计划（content-first）：弱灰徽标 + 计划摘要，待 AI 补生成配方
        const prompt = String(attrs.planPrompt ?? "").replace(/\s+/g, " ").trim();
        const snippet = prompt.length > 34 ? `${prompt.slice(0, 34)}…` : prompt || "（仅说明，暂无生成配方）";
        ops.push({ kind: "roundRect", x: x + 8, y: y + 8, width: 48, height: 16, radius: 8, fill: PLAN_FILL, stroke: PLAN_ACCENT, strokeWidth: 1 });
        ops.push(textOp({ text: "计划", x: x + 16, y: y + 11, size: 9, maxWidth: 36, fill: PLAN_ACCENT }));
        ops.push(textOp({ text: "计划中", x: x + 10, y: y + 32, size: 11, maxWidth: w - 20, fill: TEXT_PRIMARY }));
        ops.push(textOp({ text: snippet, x: x + 10, y: y + 49, size: 10, lineHeight: 14, maxWidth: w - 20, fill: TEXT_SECONDARY }));
      } else if (!lowDetail && isGenerating) {
        ops.push({ kind: "roundRect", x: x + 8, y: y + 8, width: 48, height: 16, radius: 8, fill: PENDING_FILL, stroke: PENDING_ACCENT, strokeWidth: 1 });
        ops.push(textOp({ text: "生成中", x: x + 16, y: y + 11, size: 9, maxWidth: 36, fill: PENDING_ACCENT }));
        ops.push(textOp({ text: "生成中…", x: x + 10, y: y + 32, size: 11, maxWidth: w - 20, fill: TEXT_PRIMARY }));
        ops.push(textOp({ text: "完成后自动显示", x: x + 10, y: y + 49, size: 9, maxWidth: w - 20, fill: TEXT_TERTIARY }));
      } else if (!lowDetail && isFailed) {
        ops.push({ kind: "roundRect", x: x + 8, y: y + 8, width: 40, height: 16, radius: 8, fill: FAILED_FILL, stroke: FAILED_ACCENT, strokeWidth: 1 });
        ops.push(textOp({ text: "失败", x: x + 17, y: y + 11, size: 9, maxWidth: 28, fill: FAILED_ACCENT }));
        ops.push(textOp({ text: "生成失败", x: x + 10, y: y + 32, size: 11, maxWidth: w - 20, fill: TEXT_PRIMARY }));
        ops.push(textOp({ text: "在详情面板重试", x: x + 10, y: y + 49, size: 9, maxWidth: w - 20, fill: TEXT_TERTIARY }));
      } else if (!lowDetail && isProposal) {
        // 生成提案（待确认）：媒体属性卡的提案态
        const refs = Number(attrs.proposalRefs ?? 0);
        const prompt = String(attrs.proposalPrompt ?? "").replace(/\s+/g, " ").trim();
        const snippet = prompt.length > 34 ? `${prompt.slice(0, 34)}…` : prompt || "（未填写提示词）";
        ops.push({ kind: "roundRect", x: x + 8, y: y + 8, width: 48, height: 16, radius: 8, fill: PROPOSAL_FILL, stroke: PROPOSAL_ACCENT, strokeWidth: 1 });
        ops.push(textOp({ text: "提案", x: x + 16, y: y + 11, size: 9, maxWidth: 36, fill: PROPOSAL_ACCENT }));
        ops.push(textOp({ text: "待确认生成", x: x + 10, y: y + 32, size: 11, maxWidth: w - 20, fill: TEXT_PRIMARY }));
        ops.push(textOp({ text: snippet, x: x + 10, y: y + 49, size: 10, lineHeight: 14, maxWidth: w - 20, fill: TEXT_SECONDARY }));
        ops.push(textOp({ text: `${refs} 参考`, x: x + 10, y: y + h - 20, size: 9, maxWidth: w - 20, fill: TEXT_TERTIARY }));
      } else if (media === "audio") {
        // 音频属性卡：播放器外观（圆形按钮 + 波形 + 时间 + 音量/下载）；无源时为空态（加号 + 骨架波形 + 提示）
        if (!lowDetail) ops.push(...audioPlayerOpsV(this.adapter, { x, y, width: w, height: h }, mediaSrc, { empty: !mediaSrc }));
      } else if (media === "image" && mediaSrc) {
        ops.push(...coverImageOpsV(this.adapter, mediaSrc, mediaBox, { ...mediaBox, radius: MEDIA_RADIUS }));
      } else if (media === "video" && mediaSrc) {
        // 视频属性卡：默认画首帧（按视口需求分档升档，放大不发糊；未就绪/失败退化为双击提示）；
        // 播放由 VideoPreviewPlugin 悬停承担
        const frame = videoFrameUrl(mediaSrc);
        ensureVideoFrame(mediaSrc, () => this.adapter.refreshBlocks(), Math.max(w, h) * this.adapter.getImagePixelRatio());
        if (frame) {
          // 画首帧即可：不再叠文字——播放器悬停时会盖住卡面，卡内文字会让 hover 前后看起来不一致
          ops.push(...coverImageOpsV(this.adapter, frame, mediaBox, { ...mediaBox, radius: MEDIA_RADIUS }));
        } else if (!lowDetail) {
          ops.push(textOp({ text: "▶ 视频 · 双击预览", x: x + 10, y: y + 10, size: 11, maxWidth: w - 20, fill: TEXT_TERTIARY }));
        }
      } else if (!lowDetail && text) {
        // 文本服从 box：裁剪到卡片圆角内，溢出直接截断（双击就地编辑改为内滚动 + 全屏放大）
        ops.push({ kind: "pushClipRoundRect", x, y, width: w, height: h, radius: 12 });
        ops.push(textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: w - 20, lineHeight: 17, fill: TEXT_PRIMARY }));
        ops.push({ kind: "popClip" });
      } else if (!lowDetail && media !== "text") {
        // 空媒体属性卡 placeholder：点击选中后在右侧详情面板选来源
        const placeholder = media === "video" ? "＋ 点击添加视频" : media === "audio" ? "＋ 点击添加音频" : "＋ 点击添加图片";
        ops.push(textOp({ text: placeholder, x: x + 10, y: y + 10, size: 11, maxWidth: w - 20, fill: TEXT_TERTIARY }));
      }
    } else {
      const radius = shapeType === "ellipse" || shapeType === "diamond" ? Math.min(w, h) / 2 : 8;
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius, fill: SHAPE_FILL, stroke: SHAPE_STROKE, strokeWidth: 1.5 });
      if (!lowDetail && text) ops.push(textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: w - 16, fill: TEXT_TERTIARY }));
    }

    return { ops, bounds: this.blockBounds() };
  }
}
