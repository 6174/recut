/*
 * [INPUT]: 无渲染/无 store 依赖（纯几何与归属判定），输入为元素形态对象与矩形
 * [OUTPUT]: 对外提供分组容器模型的单一实现：
 *           - 归属：isGroupElement / groupIdOf / groupMemberIdsOf / groupMembersOf（成员由 props.groupId 派生，单向真源）；
 *           - 几何：unionRect / padRect / bboxOfRects / fitGroupRect（union(userRect, membersBBox+padding)，见 RFC §4.4）；
 *           - 归属判定：topGroupAtPoint / assignGroupForId（元素中心命中；**不做嵌套**，组永远是扁平一层）；
 *           - 属性读取：groupPaddingOf / groupBackgroundOf / groupFitModeOf / groupLayoutOf（带默认值）。
 *           所有函数零副作用、零渲染，配 group-model.test.ts（node:test）。
 * [POS]: lib/pomelo/world-canvas/group 的纯逻辑真源（渲染 block / 交互行为 / store 动作 / 面板共用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { GROUP_PADDING, type GroupLayoutMode } from "./group-metrics";

export type GroupRect = { x: number; y: number; width: number; height: number };
export type GroupPoint = { x: number; y: number };
// grow = 只在内容装不下时扩大（默认；绝不自动缩小）；fit = 内容组，精确贴合成员 bbox + padding。
export type GroupFitMode = "grow" | "fit";

export type GroupElementLike = {
  id: string;
  kind?: string;
  name?: string;
  props?: Record<string, unknown> | null;
  geometry?: { x?: number; y?: number; width?: number; height?: number } | null;
};

export function isGroupElement(element: GroupElementLike | null | undefined): boolean {
  return String(element?.kind ?? "") === "group";
}

/** 成员归属：元素 props.groupId（用户所说的 node.group_id）。空串/缺失 = 未分组。 */
export function groupIdOf(element: GroupElementLike | null | undefined): string {
  const raw = element?.props?.groupId;
  return typeof raw === "string" ? raw : "";
}

/** 组元素的 id 集合（只含 group），供归属判定排除自身。 */
export function groupElementsOf<T extends GroupElementLike>(elements: T[]): T[] {
  return elements.filter(isGroupElement);
}

/** 组成员（派生）：members = elements where groupId === groupId。 */
export function groupMembersOf<T extends GroupElementLike>(elements: T[], groupId: string): T[] {
  if (!groupId) return [];
  return elements.filter((element) => !isGroupElement(element) && groupIdOf(element) === groupId);
}

export function groupMemberIdsOf<T extends GroupElementLike>(elements: T[], groupId: string): string[] {
  return groupMembersOf(elements, groupId).map((element) => element.id);
}

export function rectOfElement(element: GroupElementLike): GroupRect {
  const geometry = element.geometry ?? {};
  return {
    x: Number(geometry.x) || 0,
    y: Number(geometry.y) || 0,
    width: Number(geometry.width) || 0,
    height: Number(geometry.height) || 0,
  };
}

/** 并集包围盒；空集返回 null。 */
export function unionRect(rects: GroupRect[]): GroupRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    if (!(rect.width > 0) && !(rect.height > 0)) continue;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 向外扩 padding（内边距）。 */
export function padRect(rect: GroupRect, padding: number): GroupRect {
  return { x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 };
}

export function bboxOfRects(rects: GroupRect[]): GroupRect | null {
  return unionRect(rects);
}

function containsPoint(rect: GroupRect, point: GroupPoint): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/**
 * 分组容器的最终矩形：
 *   final = union(userRect, membersBBox + padding)
 * - mode="grow"（默认）：容器只在**内容装不下**时扩大，绝不自动缩小——用户手动定过的大小不会被元素移动悄悄改掉；
 * - mode="fit"：精确贴合成员 bbox + padding（可增可减，供面板「适应内容」显式触发）；
 * - 无成员：返回 current（空组保留自身尺寸），两者都无则 null。
 */
export function fitGroupRect(
  memberRects: GroupRect[],
  padding: number,
  current: GroupRect | null,
  mode: GroupFitMode = "grow",
): GroupRect | null {
  const bbox = unionRect(memberRects);
  if (!bbox) return current;
  const padded = padRect(bbox, padding);
  if (mode === "fit") return padded;
  return current ? unionRect([padded, current])! : padded;
}

/**
 * 点命中的分组：返回包含该点的第一个组（按传入顺序，调用方保证「在上者在前」）。
 * **分组不做嵌套**（不是 Figma）——组永远是扁平一层；两个组框偶然重叠时按顺序取第一个，
 * 不做面积/层叠计算。归属写的是元素自身的 props.groupId，天然不属于任何组才是常态。
 */
export function topGroupAtPoint(
  groups: Array<{ id: string; rect: GroupRect }>,
  point: GroupPoint,
): string | null {
  for (const group of groups) if (containsPoint(group.rect, point)) return group.id;
  return null;
}

/**
 * 一个矩形（元素）应归属到哪个组：以元素中心点命中判定；没有命中返回 null（= 清除归属）。
 */
export function assignGroupForId(
  groups: Array<{ id: string; rect: GroupRect }>,
  elementRect: GroupRect,
): string | null {
  const center = { x: elementRect.x + elementRect.width / 2, y: elementRect.y + elementRect.height / 2 };
  return topGroupAtPoint(groups, center);
}

/* ---------- group props 读取（带默认值） ---------- */

export function groupPaddingOf(element: GroupElementLike): number {
  const value = Number(element?.props?.padding);
  return Number.isFinite(value) && value >= 0 ? value : GROUP_PADDING;
}

export function groupBackgroundOf(element: GroupElementLike): string {
  const value = element?.props?.background;
  return typeof value === "string" ? value : "";
}

export function groupFitModeOf(element: GroupElementLike): GroupFitMode {
  // 默认 grow（只扩不缩）；只有显式 fit="fit" 才精确贴合。旧值 bbox/manual 一律按 grow 处理（向后兼容）。
  return element?.props?.fit === "fit" ? "fit" : "grow";
}

export function groupLayoutOf(element: GroupElementLike): GroupLayoutMode {
  const value = String(element?.props?.layout ?? "free");
  return (["free", "grid", "tree-down", "tree-right"] as const).includes(value as GroupLayoutMode)
    ? (value as GroupLayoutMode)
    : "free";
}

/** 缩略标题：一等字段 name 优先，其次 props.name，最后回退「分组」。 */
export function groupTitleOf(element: GroupElementLike): string {
  if (typeof element?.name === "string" && element.name) return element.name;
  const name = element?.props?.name;
  return typeof name === "string" && name ? name : "分组";
}
