/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/blocks/entity-card-metrics、
 *          world-canvas/graph-theme（配色/排版单一真源）、world-canvas/blocks/vello-shared（cover/低细节）、
 *          world-canvas/text-metrics（truncateText）、world-canvas/entity-color（kind 语义色）
 * [OUTPUT]: 对外提供 EntityCardBlockV（type: entity-card）与 entityCardRectV；单一骨架「媒体区 + footer」：
 *           卡片外上方有屏幕恒定的顶部标题 = 类型前缀（kindLabel，取 kind 语义色）+ 实体名，如「人物:阿蛋」；
 *           footer 内标题只画实体名（主色），不加类型前缀（文本框不画顶部标题）；
 *           有封面 → 头图 center-cover；无封面 → 中性媒体占位槽 + 居中浅色 image 图标（预示封面区，
 *           并把拉伸出的高度吃掉，不会空一半）；footer 为标题 + 副标题 + 资料缩略图，与媒体区之间一条细分隔线；
 *           卡面整体中性（仅顶部标题的类型前缀用 kind 配色）、圆角 + 内边距，和画布底色协调。
 *           头图素材生成中/失败（coverStatus）渲染为蓝/红等待态；coverKind=video 只画占位，
 *           不把视频 URL 交给图片解码器；视口 <= LOW_DETAIL_SCALE 时只画 shape、隐藏全部文字；
 *           有效矩形与业务命中/选区/连线共用。
 * [POS]: lib/pomelo/world-canvas/blocks 的实体卡 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import {
  CARD_FILL,
  CARD_SEPARATOR,
  CARD_STROKE,
  FAILED_ACCENT,
  FAILED_FILL,
  GRAPH_COLORS,
  MEDIA_PLACEHOLDER_FILL,
  PENDING_ACCENT,
  PENDING_FILL,
  SHADOW_FILL,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TILE_FILL,
} from "../graph-theme";
import { truncateText } from "../text-metrics";
import { entityColorRgba } from "../entity-color";
import {
  ENTITY_CARD_PAD,
  ENTITY_CARD_RADIUS,
  ENTITY_CARD_THUMB,
  ENTITY_CARD_THUMB_GAP,
  ENTITY_SUMMARY_SIZE,
  ENTITY_TITLE_SIZE,
  entityCardHasCover,
  entityCardImageHeight,
  entityCardRect,
  entityCardTextTop,
  entityCardThumbBlockHeight,
  entityCardThumbColumns,
  entityCardThumbTop,
  entityCardTitleHeight,
} from "./entity-card-metrics";
import { CAPTION_TOP_OFFSET, captionOpsV, coverImageOpsV, isLowDetail, screenScaleOf } from "./vello-shared";
import { displayRefText } from "./ref-text";

const THUMB = ENTITY_CARD_THUMB;
const THUMB_GAP = ENTITY_CARD_THUMB_GAP;

function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]).filter((item) => typeof item === "string" && item) : [];
}

/**
 * 封面占位图标：实心圆角徽章 + 镂空山/太阳的「图片」符号。
 * vello op 无法填充任意路径，故把该 SVG 注册为纹理后以 image op 绘制；宽度给足（远大于显示尺寸）
 * 以便矢量栅格化后依旧清晰，颜色取自主题（和背景对比柔和）。
 */
const PLACEHOLDER_ICON_URL = (() => {
  const paths =
    `<path fill-rule="evenodd" clip-rule="evenodd" d="M4.68257 0.205106C7.83164 -0.0683688 10.9985 -0.0683688 14.1476 0.205106L15.6576 0.337106C16.3595 0.398572 17.0203 0.694319 17.5338 1.17678C18.0473 1.65925 18.3835 2.30039 18.4886 2.99711C18.9421 6.01348 18.9421 9.08073 18.4886 12.0971C18.4479 12.3618 18.3772 12.6131 18.2766 12.8511C18.2106 13.0081 18.0066 13.0321 17.8906 12.9061L13.4696 8.04211C13.3718 7.93458 13.2449 7.85777 13.1043 7.82102C12.9637 7.78427 12.8154 7.78917 12.6776 7.83511L10.1466 8.67911L6.47557 4.54911C6.40766 4.47271 6.32486 4.41099 6.23224 4.36776C6.13962 4.32452 6.03914 4.30067 5.93697 4.29767C5.8348 4.29468 5.7331 4.31259 5.6381 4.35033C5.54311 4.38806 5.45683 4.44482 5.38457 4.51711L0.470566 9.43111C0.437183 9.46542 0.394513 9.48925 0.347787 9.49967C0.301061 9.51009 0.252311 9.50664 0.207512 9.48977C0.162713 9.47289 0.123812 9.4433 0.0955791 9.40464C0.0673461 9.36598 0.0510076 9.31992 0.0485665 9.27211C-0.0696914 7.17563 0.0281576 5.07255 0.340567 2.99611C0.445587 2.29939 0.78188 1.65825 1.29536 1.17578C1.80884 0.693319 2.46967 0.397572 3.17157 0.336106L4.68257 0.205106ZM11.4146 4.54711C11.4146 4.14928 11.5726 3.76775 11.8539 3.48645C12.1352 3.20514 12.5167 3.04711 12.9146 3.04711C13.3124 3.04711 13.6939 3.20514 13.9752 3.48645C14.2565 3.76775 14.4146 4.14928 14.4146 4.54711C14.4146 4.94493 14.2565 5.32646 13.9752 5.60777C13.6939 5.88907 13.3124 6.04711 12.9146 6.04711C12.5167 6.04711 12.1352 5.88907 11.8539 5.60777C11.5726 5.32646 11.4146 4.94493 11.4146 4.54711Z"/>` +
    `<path d="M0.375566 11.6471C0.348559 11.6744 0.328196 11.7075 0.316057 11.7439C0.303918 11.7804 0.300328 11.8191 0.305566 11.8571L0.340566 12.0971C0.445587 12.7938 0.78188 13.435 1.29536 13.9174C1.80884 14.3999 2.46967 14.6956 3.17157 14.7571L4.68157 14.8881C7.83157 15.1621 10.9976 15.1621 14.1476 14.8881L15.6576 14.7571C16.0718 14.7221 16.4748 14.6041 16.8426 14.4101C16.9796 14.3391 17.0026 14.1581 16.8986 14.0441L12.7986 9.53411C12.766 9.4979 12.7236 9.47199 12.6765 9.45955C12.6294 9.44712 12.5798 9.4487 12.5336 9.46411L10.1516 10.2581C10.0123 10.3046 9.86246 10.3092 9.72061 10.2714C9.57875 10.2335 9.45113 10.1548 9.35357 10.0451L6.05857 6.33811C6.03588 6.31263 6.00822 6.29207 5.9773 6.27769C5.94637 6.2633 5.91282 6.2554 5.87873 6.25446C5.84463 6.25352 5.8107 6.25957 5.77903 6.27224C5.74736 6.2849 5.71861 6.30392 5.69457 6.32811L0.375566 11.6471Z"/>`;
  // width/height 给足：适配器不为位图放大，靠大尺寸 SVG 保证栅格化后清晰；group opacity 避免两路径重叠处叠暗。
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="216" viewBox="0 0 19 16"><g fill="${GRAPH_COLORS.caption}" opacity="0.55">${paths}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
})();

/** 实体卡有效渲染矩形：与业务命中/选区/连线锚点共用同一实现（见 entity-card-metrics）。 */
export const entityCardRectV = entityCardRect;

/** 实体卡：媒体区 + footer 的单骨架；无封面用中性占位槽；低缩放下退化为纯 shape。 */
export class EntityCardBlockV extends VelloBlock {
  static type = "entity-card";
  override renderOnZoom = true;

  protected blockBounds() {
    const rect = entityCardRectV(this.record.attrs as Record<string, unknown>);
    const scale = screenScaleOf(this.adapter);
    return { minX: rect.x, minY: rect.y - (CAPTION_TOP_OFFSET + 2) / scale, maxX: rect.x + rect.width, maxY: rect.y + rect.height };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const { x, y, width: w, height: h } = entityCardRectV(attrs);
    const lowDetail = isLowDetail(this.adapter);
    const title = displayRefText(String(attrs.title ?? "实体"));
    const summary = displayRefText(String(attrs.desc ?? "")).trim() || "补充一句简介…";
    // 类型前缀（如「人物:阿蛋」）：文案由宿主按 type 目录 name 注入（缺省回退 kind）；颜色取 kind 语义色，
    // 与白色标题区分，明确「这段是类型」。
    const kind = String(attrs.kind ?? "");
    const kindLabel = String(attrs.kindLabel ?? "").trim();
    const prefixText = kindLabel ? `${kindLabel}:` : "";
    const prefixFill = entityColorRgba(kind);
    const coverUrl = String(attrs.coverUrl ?? "");
    // 头图类型：video 头图不能当图片纹理加载（解码失败会触发请求风暴），只画占位。
    const coverKind = String(attrs.coverKind ?? "image");
    const hasCover = entityCardHasCover(attrs);
    const mediaH = entityCardImageHeight(attrs, h);
    const textTop = entityCardTextTop(attrs, h);
    const titleH = entityCardTitleHeight(attrs);
    const totalCount = Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);

    const ops: VelloOp[] = [
      { kind: "blurRect", x: x + 3, y: y + 7, width: w, height: h, radius: ENTITY_CARD_RADIUS, stdDev: 6, fill: SHADOW_FILL },
      { kind: "roundRect", x, y, width: w, height: h, radius: ENTITY_CARD_RADIUS, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 },
    ];
    // 实体卡的顶部标题（卡片外上方，屏幕像素恒定）——文本框不画；类型前缀同色区分
    if (!lowDetail) ops.push(...captionOpsV(this.adapter, x, y, w, title, prefixText ? { text: prefixText, fill: prefixFill } : undefined).ops);

    // 媒体区整体裁剪到卡面圆角内（顶部两角），避免占位槽/等待态/视频占位的直角溢出圆角
    ops.push({ kind: "pushClipRoundRect", x, y, width: w, height: h, radius: ENTITY_CARD_RADIUS });
    if (hasCover) {
      // 头图素材仍在生成 / 失败：不请求未就绪 URL，改渲染等待态（就绪后由画布自动切换）
      const coverStatus = String(attrs.coverStatus ?? "");
      if (coverStatus === "generating" || coverStatus === "failed") {
        const failed = coverStatus === "failed";
        const accent = failed ? FAILED_ACCENT : PENDING_ACCENT;
        ops.push({ kind: "roundRect", x, y, width: w, height: mediaH, radius: 0, fill: failed ? FAILED_FILL : PENDING_FILL, stroke: accent, strokeWidth: 2 });
        if (!lowDetail) {
          ops.push(textOp({ text: failed ? "生成失败" : "生成中…", x: x + ENTITY_CARD_PAD, y: y + Math.max(6, mediaH / 2 - 8), size: 12, maxWidth: w - ENTITY_CARD_PAD * 2, fill: failed ? accent : TEXT_PRIMARY }));
        }
      } else if (coverKind === "video") {
        // 视频头图：不以图片方式加载，画深色区 + 提示（避免把视频 URL 交给图片解码器）
        ops.push({ kind: "roundRect", x, y, width: w, height: mediaH, radius: 0, fill: TILE_FILL, stroke: [0, 0, 0, 0], strokeWidth: 0 });
        if (!lowDetail) {
          ops.push(textOp({ text: "▶ 视频头图", x: x + ENTITY_CARD_PAD, y: y + Math.max(6, mediaH / 2 - 8), size: 12, maxWidth: w - ENTITY_CARD_PAD * 2, fill: TEXT_SECONDARY }));
        }
      } else {
        // 头图：在媒体区矩形内 center-cover
        ops.push(...coverImageOpsV(this.adapter, coverUrl, { x, y, width: w, height: mediaH }, { x, y, width: w, height: mediaH, radius: 0 }));
      }
    } else {
      // 无封面：中性媒体占位槽（略深凹槽）+ 居中浅色 image 图标，预示「这里是封面区」
      ops.push({ kind: "rectFill", x, y, width: w, height: mediaH, fill: MEDIA_PLACEHOLDER_FILL });
      const iconW = Math.min(88, Math.min(w, mediaH) * 0.42);
      const iconH = (iconW * 16) / 19;
      // 首帧纹理未就绪返回 null，就绪后适配器会自动重绘本块补上图标
      const iconId = this.adapter.ensureImage(PLACEHOLDER_ICON_URL, Math.max(iconW, iconH) * this.adapter.getImagePixelRatio());
      if (iconId !== null) {
        ops.push({ kind: "image", imageId: iconId, x: x + (w - iconW) / 2, y: y + (mediaH - iconH) / 2, width: iconW, height: iconH });
      }
    }
    ops.push({ kind: "popClip" });

    // 媒体区与 footer 之间的细分隔线（有封面时图片边缘已给出分界，仅无封面需要）
    if (!hasCover) ops.push({ kind: "rectFill", x, y: y + mediaH, width: w, height: 1, fill: CARD_SEPARATOR });

    if (!lowDetail) {
      const textW = Math.max(0, w - ENTITY_CARD_PAD * 2);
      ops.push(textOp({ text: truncateText(title, textW, ENTITY_TITLE_SIZE), x: x + ENTITY_CARD_PAD, y: y + textTop, size: ENTITY_TITLE_SIZE, maxWidth: textW, embolden: 0.035, fill: TEXT_PRIMARY }));
      ops.push(textOp({ text: truncateText(summary, textW, ENTITY_SUMMARY_SIZE), x: x + ENTITY_CARD_PAD, y: y + textTop + titleH, size: ENTITY_SUMMARY_SIZE, maxWidth: textW, fill: TEXT_SECONDARY }));
    }

    // 资料缩略图：按卡片宽度自适应换行
    const columns = entityCardThumbColumns(attrs);
    const thumbsTop = y + entityCardThumbTop(attrs, h);
    const urlPhotos = stringListOf(attrs.photoUrls);
    for (let index = 0; index < totalCount; index++) {
      const tx = x + ENTITY_CARD_PAD + (index % columns) * (THUMB + THUMB_GAP);
      const ty = thumbsTop + Math.floor(index / columns) * (THUMB + THUMB_GAP);
      ops.push({ kind: "roundRect", x: tx, y: ty, width: THUMB, height: THUMB, radius: 8, fill: TILE_FILL, stroke: [0, 0, 0, 0], strokeWidth: 0 });
      ops.push(...coverImageOpsV(this.adapter, urlPhotos[index] ?? "", { x: tx, y: ty, width: THUMB, height: THUMB }, { x: tx, y: ty, width: THUMB, height: THUMB, radius: 8 }));
    }

    return { ops, bounds: this.blockBounds() };
  }
}
