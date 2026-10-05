/*
 * [INPUT]: 依赖 node:test/assert 与被测的分组容器纯逻辑（group-model.ts）
 * [OUTPUT]: 覆盖分组模型契约：成员由 props.groupId 派生（单向）、unionRect/padRect、
 *           fitGroupRect（bbox 精确贴合 / manual 只增不减 / 空组保留自身）、
 *           topGroupAtPoint（最小组优先、excludeId）、assignGroupForId（中心命中）、
 *           以及 props 读取默认值。
 * [POS]: lib/pomelo/world-canvas/group 的纯逻辑回归（交互/面板/store 的落位依据）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignGroupForId,
  fitGroupRect,
  groupIdOf,
  groupMemberIdsOf,
  groupMembersOf,
  groupPaddingOf,
  isGroupElement,
  padRect,
  topGroupAtPoint,
  unionRect,
} from "./group-model";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

test("group membership is derived from props.groupId (single source)", () => {
  const elements = [
    { id: "shape:g1", kind: "group", geometry: rect(0, 0, 100, 100) },
    { id: "shape:a", kind: "note", props: { groupId: "shape:g1" } },
    { id: "shape:b", kind: "text", props: { groupId: "shape:g1" } },
    { id: "shape:c", kind: "note", props: {} },
    { id: "shape:g2", kind: "group", geometry: rect(0, 0, 100, 100), props: {} },
  ];
  assert.equal(isGroupElement(elements[0]), true);
  assert.equal(groupIdOf(elements[1]), "shape:g1");
  assert.deepEqual(groupMembersOf(elements, "shape:g1").map((e) => e.id), ["shape:a", "shape:b"]);
  assert.deepEqual(groupMemberIdsOf(elements, "shape:g1"), ["shape:a", "shape:b"]);
  // group 元素本身不会成为自己的成员
  assert.deepEqual(groupMemberIdsOf(elements, "shape:g2"), []);
});

test("unionRect / padRect", () => {
  assert.deepEqual(unionRect([rect(0, 0, 10, 10), rect(20, 5, 10, 10)]), rect(0, 0, 30, 15));
  assert.equal(unionRect([]), null);
  assert.deepEqual(padRect(rect(10, 10, 100, 50), 24), rect(-14, -14, 148, 98));
});

test("fitGroupRect: grow mode never shrinks, only expands (default)", () => {
  const members = [rect(100, 100, 200, 100), rect(320, 150, 80, 80)];
  // bbox = (100,100) 300×130 → +24 padding = (76,76) 348×178
  // grow：无 current（新建）→ 用内容框
  assert.deepEqual(fitGroupRect(members, 24, null, "grow"), rect(76, 76, 348, 178));
  // grow：现有框比内容大 → 保持不变（元素内移绝不能把组缩小）
  assert.deepEqual(fitGroupRect(members, 24, rect(0, 0, 900, 900), "grow"), rect(0, 0, 900, 900));
  // grow：内容超出 → 自动扩到内容
  assert.deepEqual(fitGroupRect(members, 24, rect(0, 0, 100, 100), "grow"), rect(0, 0, 424, 254));
  // 默认即 grow
  assert.deepEqual(fitGroupRect(members, 24, rect(0, 0, 900, 900)), rect(0, 0, 900, 900));
});

test("fitGroupRect: fit mode hugs members exactly (panel 适应内容)", () => {
  const members = [rect(100, 100, 200, 100), rect(320, 150, 80, 80)];
  assert.deepEqual(fitGroupRect(members, 24, rect(0, 0, 900, 900), "fit"), rect(76, 76, 348, 178));
  assert.deepEqual(fitGroupRect(members, 24, rect(0, 0, 100, 100), "fit"), rect(76, 76, 348, 178));
  // 空组保留自身
  assert.deepEqual(fitGroupRect([], 24, rect(5, 5, 50, 50), "grow"), rect(5, 5, 50, 50));
  assert.equal(fitGroupRect([], 24, null), null);
});

test("topGroupAtPoint returns the first containing group (flat, no nesting)", () => {
  const groups = [
    { id: "small", rect: rect(100, 100, 200, 200) },
    { id: "big", rect: rect(0, 0, 1000, 1000) },
  ];
  // 传入顺序即优先序（调用方保证「在上者在前」）；重叠时不做面积/层叠计算
  assert.equal(topGroupAtPoint(groups, { x: 150, y: 150 }), "small");
  assert.equal(topGroupAtPoint(groups, { x: 500, y: 500 }), "big");
  assert.equal(topGroupAtPoint([groups[1]], { x: 150, y: 150 }), "big");
  assert.equal(topGroupAtPoint(groups, { x: 1500, y: 1500 }), null);
});

test("assignGroupForId uses element center", () => {
  const groups = [{ id: "g", rect: rect(100, 100, 200, 200) }];
  // 中心 (200,200) 在组内
  assert.equal(assignGroupForId(groups, rect(150, 150, 100, 100)), "g");
  // 矩形与组相交但中心在外 → 不归属
  assert.equal(assignGroupForId(groups, rect(280, 280, 100, 100)), null);
});

test("groupPaddingOf defaults and validates", () => {
  assert.equal(groupPaddingOf({ id: "g", kind: "group", props: {} }), 24);
  assert.equal(groupPaddingOf({ id: "g", kind: "group", props: { padding: 8 } }), 8);
  assert.equal(groupPaddingOf({ id: "g", kind: "group", props: { padding: -3 } }), 24);
});
