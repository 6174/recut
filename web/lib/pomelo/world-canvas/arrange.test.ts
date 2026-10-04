/*
 * [INPUT]: 依赖 node:test/assert 与被测的多选对齐纯几何（arrange.ts）
 * [OUTPUT]: 覆盖对齐/分布/网格/树形排布契约：六向对齐沿并集包围盒落位且只改一个轴、首尾不参与位移、
 *          分布首尾不动且间隙均等、网格排布按顶边邻近聚类成行（高卡片不吞并后续行；行内顶对齐 + 等间隙、
 *          锚定左上角）、树形排布按关系边竖/横成树（同级有序、森林、无边退化单排）、
 *          结果与输入同序、选中数不足返回 null
 * [POS]: lib/pomelo/world-canvas 的对齐几何回归（画布工具栏「对齐」菜单的落位依据）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ARRANGE_GAP, TREE_LAYER_GAP, arrangeMinCount, computeArrange, computeTreeLayout, type ArrangeEdge, type ArrangeNode, type ArrangeRect } from "./arrange";

// 三个不等宽/不等高的矩形：并集包围盒 = (0,0) 700×200
const rects: ArrangeRect[] = [
  { x: 0, y: 0, width: 100, height: 40 },
  { x: 300, y: 80, width: 200, height: 60 },
  { x: 600, y: 160, width: 100, height: 40 },
];

test("horizontal alignment pins the requested edge and keeps y", () => {
  assert.deepEqual(computeArrange(rects, "left"), [
    { x: 0, y: 0 },
    { x: 0, y: 80 },
    { x: 0, y: 160 },
  ]);
  assert.deepEqual(computeArrange(rects, "right"), [
    { x: 600, y: 0 },
    { x: 500, y: 80 },
    { x: 600, y: 160 },
  ]);
  // 水平居中：x = 包围盒左 + (盒宽 - 自身宽) / 2
  assert.deepEqual(computeArrange(rects, "center-x"), [
    { x: 300, y: 0 },
    { x: 250, y: 80 },
    { x: 300, y: 160 },
  ]);
});

test("vertical alignment pins the requested edge and keeps x", () => {
  assert.deepEqual(computeArrange(rects, "top"), [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 600, y: 0 },
  ]);
  assert.deepEqual(computeArrange(rects, "bottom"), [
    { x: 0, y: 160 },
    { x: 300, y: 140 },
    { x: 600, y: 160 },
  ]);
  assert.deepEqual(computeArrange(rects, "center-y"), [
    { x: 0, y: 80 },
    { x: 300, y: 70 },
    { x: 600, y: 80 },
  ]);
});

test("distribute-x keeps both ends and equalizes gaps", () => {
  const targets = computeArrange(rects, "distribute-x");
  assert.ok(targets);
  // 首尾不动
  assert.deepEqual(targets[0], { x: 0, y: 0 });
  assert.deepEqual(targets[2], { x: 600, y: 160 });
  // 间隙 = (700 - 400) / 2 = 150 → 中项左移/右移后两段间距均等
  assert.deepEqual(targets[1], { x: 250, y: 80 });
  const gapLeft = targets[1].x - (targets[0].x + rects[0].width);
  const gapRight = targets[2].x - (targets[1].x + rects[1].width);
  assert.equal(gapLeft, gapRight);
});

test("distribute-y keeps both ends and equalizes gaps", () => {
  const targets = computeArrange(rects, "distribute-y");
  assert.ok(targets);
  assert.deepEqual(targets[0], { x: 0, y: 0 });
  assert.deepEqual(targets[2], { x: 600, y: 160 });
  const gapTop = targets[1].y - (targets[0].y + rects[0].height);
  const gapBottom = targets[2].y - (targets[1].y + rects[1].height);
  assert.equal(gapTop, gapBottom);
});

test("grid packs a single visual row into even gaps anchored at the group's top-left", () => {
  const row: ArrangeRect[] = [
    { x: 0, y: 10, width: 100, height: 50 },
    { x: 300, y: 10, width: 60, height: 80 },
    { x: 700, y: 10, width: 40, height: 30 },
  ];
  const targets = computeArrange(row, "grid");
  assert.ok(targets);
  // 行内顶对齐（y = 包围盒上边）、等间隙、按原 x 顺序从左排开
  assert.deepEqual(targets, [
    { x: 0, y: 10 },
    { x: 100 + ARRANGE_GAP, y: 10 },
    { x: 100 + ARRANGE_GAP + 60 + ARRANGE_GAP, y: 10 },
  ]);
});

test("grid keeps the existing row structure and equalizes gaps within and between rows", () => {
  const twoRows: ArrangeRect[] = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 200, y: 0, width: 100, height: 50 },
    { x: 0, y: 200, width: 80, height: 40 },
    { x: 300, y: 200, width: 80, height: 40 },
  ];
  const targets = computeArrange(twoRows, "grid");
  assert.ok(targets);
  const rowGap = 50 + ARRANGE_GAP;
  assert.deepEqual(targets, [
    { x: 0, y: 0 },
    { x: 126, y: 0 },
    { x: 0, y: rowGap },
    { x: 106, y: rowGap },
  ]);
});

test("grid does not let a tall card swallow the rows beneath it", () => {
  // 回归：旧算法用「中心点落进行的纵向包围盒」判定，高卡片会把下面一行整体吞掉（塌成一条横排）
  const cascade: ArrangeRect[] = [
    { x: 0, y: 0, width: 100, height: 400 }, // 高卡片
    { x: 0, y: 300, width: 80, height: 60 }, // 下一行
    { x: 300, y: 300, width: 80, height: 60 },
  ];
  const targets = computeArrange(cascade, "grid");
  assert.ok(targets);
  const secondRowY = 400 + ARRANGE_GAP;
  // 第一行只放高卡片；下面一行单独成行，不再被高卡片吞并
  assert.deepEqual(targets, [
    { x: 0, y: 0 },
    { x: 0, y: secondRowY },
    { x: 80 + ARRANGE_GAP, y: secondRowY },
  ]);
});

test("insufficient selection returns null and the required count matches the mode", () => {
  const pair = rects.slice(0, 2);
  assert.equal(computeArrange([rects[0]], "left"), null);
  assert.equal(computeArrange(pair, "distribute-x"), null);
  assert.ok(computeArrange(pair, "grid"));
  assert.equal(arrangeMinCount("left"), 2);
  assert.equal(arrangeMinCount("distribute-y"), 3);
});

test("tree mode is not handled by computeArrange", () => {
  assert.equal(computeArrange(rects, "tree-down"), null);
  assert.equal(computeArrange(rects, "tree-right"), null);
});

// 树形排布夹具：A 为根，B/C 为其子（父 A 居两子上方/左侧居中）
const treeNodes: ArrangeNode[] = [
  { id: "a", x: 0, y: 0, width: 100, height: 40 },
  { id: "b", x: 0, y: 200, width: 80, height: 40 },
  { id: "c", x: 300, y: 200, width: 120, height: 40 },
];
const treeEdges: ArrangeEdge[] = [
  { from: "a", to: "b" },
  { from: "a", to: "c" },
];

test("tree layout (vertical) stacks children below and centers the parent", () => {
  const targets = computeTreeLayout(treeNodes, treeEdges, "vertical");
  assert.ok(targets);
  const span = 80 + ARRANGE_GAP + 120;
  const rowY = 40 + TREE_LAYER_GAP;
  assert.deepEqual(targets, [
    { x: (span - 100) / 2, y: 0 },
    { x: 0, y: rowY },
    { x: 80 + ARRANGE_GAP, y: rowY },
  ]);
});

test("tree layout (horizontal) stacks children to the right and centers the parent", () => {
  const targets = computeTreeLayout(treeNodes, treeEdges, "horizontal");
  assert.ok(targets);
  const colX = 100 + TREE_LAYER_GAP;
  const span = 40 + ARRANGE_GAP + 40;
  assert.deepEqual(targets, [
    { x: 0, y: (span - 40) / 2 },
    { x: colX, y: 0 },
    { x: colX, y: 40 + ARRANGE_GAP },
  ]);
});

test("disconnected nodes degrade to a single row and never overlap", () => {
  const forest: ArrangeNode[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 40 },
    { id: "b", x: 300, y: 0, width: 60, height: 40 },
  ];
  const targets = computeTreeLayout(forest, [], "vertical");
  assert.ok(targets);
  assert.deepEqual(targets, [
    { x: 0, y: 0 },
    { x: 100 + ARRANGE_GAP * 2, y: 0 },
  ]);
});

test("tree layout needs at least two nodes", () => {
  assert.equal(computeTreeLayout([treeNodes[0]], [], "vertical"), null);
});

test("alignment never touches the untouched axis or the sizes", () => {
  const targets = computeArrange(rects, "left");
  assert.ok(targets);
  targets.forEach((target, index) => {
    assert.equal(target.y, rects[index].y);
  });
});
