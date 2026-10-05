/*
 * [INPUT]: 无外部依赖
 * [OUTPUT]: 对外提供画布 block 四角 resize 的**支持名单**（白名单）单一真源：
 *           RESIZABLE_BLOCK_KINDS（支持 resize 的 block 类别）+ blockKindOf（block → 类别 token）
 *           + blockSupportsResize（名单内才给手柄）。
 *           名单外的 block 不显示、不响应 resize 手柄，但仍可选中与拖拽位移。
 *           实体卡（封面比例定尺）、文本块（高度随内容自适应）、图片/视频块（素材比例定尺）与音频块（播放器定尺）刻意不在名单内。
 * [POS]: lib/pomelo/world-canvas 的交互策略（宿主 CanvasBindsPlugin 的 overlay / 命中与未来插件共用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// 支持四角 resize 的 block 类别白名单（类别见 blockKindOf）：
//   note / world-node / media-node（基础占位节点）/ free-element:shape（形状）
// 刻意不含：entity-card（有封面按封面比例定尺、无封面按占位保底 + footer）、
//   free-element:text 与 free-element:attr-text（文本块高度随内容自适应）、
//   media:image|video|audio、free-element:attr-image|video|audio——这些卡片都由内容定尺，不给 resize。
export const RESIZABLE_BLOCK_KINDS = [
  "note",
  "world-node",
  "media-node",
  "free-element:shape",
  // 分组容器可四角调整（最终框会与成员 bbox merge，见 group-behavior）
  "group",
] as const;

export type ResizableBlockKind = (typeof RESIZABLE_BLOCK_KINDS)[number];

const RESIZABLE = new Set<string>(RESIZABLE_BLOCK_KINDS);

type RecordLike = { type?: string; attrs: Record<string, unknown> };

/** block → 类别 token（用于查 resize 名单）；无法归类返回 null。 */
export function blockKindOf(record: RecordLike | null | undefined): string | null {
  if (!record) return null;
  const type = String(record.type ?? "");
  if (type === "media") return `media:${String(record.attrs.modality ?? "image")}`;
  if (type === "free-element") {
    const elementKind = String(record.attrs.elementKind ?? "shape");
    return elementKind === "attr" ? `free-element:attr-${String(record.attrs.attrMedia ?? "text")}` : `free-element:${elementKind}`;
  }
  return type || null;
}

/** 该 block 是否支持四角 resize（名单内才给手柄）；实体卡、文本块与图片/视频/音频块返回 false，只能选中移动。 */
export function blockSupportsResize(record: RecordLike | null | undefined): boolean {
  const kind = blockKindOf(record);
  return kind !== null && RESIZABLE.has(kind);
}
