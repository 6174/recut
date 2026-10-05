/*
 * [INPUT]: 依赖 canvas-store（canvasRectOf / CanvasPatchEntry / canvasElementIdOfBlock）、
 *          world-canvas/group/group-model（成员派生 / 归属命中 / 组框自适应）、arrow-geometry（blockRect）
 * [OUTPUT]: 对外提供画布分组交互的宿主侧纯逻辑：
 *           - blockIdOfCanvasId / groupMoveExpansion：把「命中组」展开为「组 + 全部成员」（整组移动）；
 *           - groupReconcileEntries：一次拖拽提交后，算出「成员归属变更 + 组框自适应」的字段补丁；
 *           - groupResizeRect：组 resize 的最终框 = union(请求框, 成员 bbox + padding)；
 *           - groupAbsorbEntries：组 resize 结束后，把新框「圈进来」的未分组元素自动归入该组。
 *           全部无副作用，由 CanvasBindsPlugin 在指针会话里消费（Group 交互不侵入 move/resize 主体）。
 * [POS]: worlds/[worldID]/canvas 的分组交互适配层（把 lib 的纯 group 模型接到 pomelo/store）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditor } from "@/lib/pomelo/pomelo-core/pomelo-editor";
import type { WorldCanvasElement } from "@/lib/recut-worlds-client";
import {
  assignGroupForId,
  fitGroupRect,
  groupFitModeOf,
  groupIdOf,
  groupMembersOf,
  groupPaddingOf,
  isGroupElement,
  rectOfElement,
  type GroupRect,
} from "@/lib/pomelo/world-canvas/group/group-model";
import { canvasRectOf, type CanvasPatchEntry } from "./canvas-store";

/** 画布元素 id → pomelo block id（实体投影 shape:<id> → entity:<id>；其余即元素 id）。 */
export function blockIdOfCanvasId(elements: WorldCanvasElement[], canvasId: string): string {
  const element = elements.find((item) => item.id === canvasId);
  if (element && (element.kind === "entity" || element.refKind === "entity") && element.refId) return `entity:${element.refId}`;
  return canvasId;
}

/** 拖动展开：命中分组时整组移动（组 + 全部成员）；否则只拖命中块。返回画布元素 id 列表。 */
export function groupMoveExpansion(elements: WorldCanvasElement[], canvasId: string): string[] {
  const element = elements.find((item) => item.id === canvasId);
  if (!element || !isGroupElement(element)) return [canvasId];
  return [canvasId, ...groupMembersOf(elements, canvasId).map((member) => member.id)];
}

/**
 * 一次拖拽提交后的分组自适应补丁：
 *   ① 被移动元素按中心点重新判定归属（进入/离开组 → 写 props.groupId）；
 *   ② 受影响的组（旧组 + 新组）按 union(成员 bbox + padding, 当前框)（manual）或精确 bbox+padding（bbox）重算组框。
 * 返回可直接 applyElementPatch 的补丁（调用方合并进同一条撤销）。
 */
export function groupReconcileEntries(
  editor: PomeloEditor | null,
  elements: WorldCanvasElement[],
  movedCanvasIds: string[],
): CanvasPatchEntry[] {
  const groups = elements
    .filter(isGroupElement)
    .map((group) => ({ id: group.id, rect: canvasRectOf(editor, elements, group.id) }))
    .filter((group): group is { id: string; rect: GroupRect } => group.rect !== null);
  const entries: CanvasPatchEntry[] = [];
  // 虚拟归属（仅本批变更的元素覆盖），供组框重算使用「变更后」的成员集合
  const virtualGroup = new Map<string, string>();
  // 受影响的组 = 被移动元素的原组 + 新组：即便归属没变，成员尺寸/位置变化也要重算组框
  const affected = new Set<string>();
  for (const canvasId of movedCanvasIds) {
    const element = elements.find((item) => item.id === canvasId);
    if (!element || isGroupElement(element)) continue;
    const rect = canvasRectOf(editor, elements, canvasId);
    if (!rect) continue;
    const current = groupIdOf(element);
    // 分组容器自身不参与归属（组永远扁平一层，不做嵌套）
    const next = assignGroupForId(groups, rect) ?? "";
    if (current) affected.add(current);
    if (next) affected.add(next);
    if (next === current) continue;
    entries.push({ id: canvasId, before: { props: { groupId: current } }, after: { props: { groupId: next } } });
    virtualGroup.set(canvasId, next);
  }
  const groupIdVirtual = (element: WorldCanvasElement): string =>
    virtualGroup.has(element.id) ? virtualGroup.get(element.id)! : groupIdOf(element);
  for (const groupId of affected) {
    const group = elements.find((item) => item.id === groupId && isGroupElement(item));
    if (!group) continue;
    const members = elements.filter((element) => !isGroupElement(element) && groupIdVirtual(element) === groupId);
    const rects = members
      .map((member) => canvasRectOf(editor, elements, member.id))
      .filter((rect): rect is GroupRect => rect !== null);
    const fitted = fitGroupRect(rects, groupPaddingOf(group), rectOfElement(group), groupFitModeOf(group));
    if (!fitted) continue;
    const before = rectOfElement(group);
    const geometry = { x: Math.round(fitted.x), y: Math.round(fitted.y), width: Math.round(fitted.width), height: Math.round(fitted.height) };
    if (before.x === geometry.x && before.y === geometry.y && before.width === geometry.width && before.height === geometry.height) continue;
    entries.push({ id: groupId, before: { geometry: { x: before.x, y: before.y, width: before.width, height: before.height } }, after: { geometry } });
  }
  return entries;
}

/** 组 resize 的最终框：永远不小于成员 bbox + padding（union 请求框）。无成员时用请求框。 */
export function groupResizeRect(
  editor: PomeloEditor | null,
  elements: WorldCanvasElement[],
  groupId: string,
  requested: GroupRect,
): GroupRect {
  const group = elements.find((item) => item.id === groupId && isGroupElement(item));
  if (!group) return requested;
  const members = groupMembersOf(elements, groupId);
  const rects = members
    .map((member) => canvasRectOf(editor, elements, member.id))
    .filter((rect): rect is GroupRect => rect !== null);
  // 用户拖拽 resize：请求框作为下限，只在成员装不下时扩（grow），绝不因拖动把组缩到小于内容
  return fitGroupRect(rects, groupPaddingOf(group), requested, "grow") ?? requested;
}

/**
 * 组 resize 结束后的「吸入」：新框把某些**未分组**元素包进来了，就把它们直接算进该组。
 * 判定用元素中心点落在组框内（与拖拽归属同一口径），只处理 groupId 为空、非 group 的元素；
 * 返回可直接 applyElementPatch 的 props 补丁。已属于其他组的元素不抢（保持拖拽时才有明确切换意图）。
 */
export function groupAbsorbEntries(
  editor: PomeloEditor | null,
  elements: WorldCanvasElement[],
  groupId: string,
): CanvasPatchEntry[] {
  const group = elements.find((item) => item.id === groupId && isGroupElement(item));
  const rect = group ? canvasRectOf(editor, elements, groupId) : null;
  if (!group || !rect) return [];
  const entries: CanvasPatchEntry[] = [];
  for (const element of elements) {
    if (isGroupElement(element)) continue;
    if (groupIdOf(element)) continue; // 已有归属：不抢组
    const elementRect = canvasRectOf(editor, elements, element.id);
    if (!elementRect) continue;
    const center = { x: elementRect.x + elementRect.width / 2, y: elementRect.y + elementRect.height / 2 };
    const inside = center.x >= rect.x && center.x <= rect.x + rect.width && center.y >= rect.y && center.y <= rect.y + rect.height;
    if (inside) entries.push({ id: element.id, before: { props: { groupId: "" } }, after: { props: { groupId } } });
  }
  return entries;
}
