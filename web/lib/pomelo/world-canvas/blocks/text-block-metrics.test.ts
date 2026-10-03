/*
 * [INPUT]: 依赖 node:test/assert 与被测文本块度量（text-block-metrics.ts）
 * [OUTPUT]: 覆盖「文本框高度封顶 16:9」契约：textElementHeight / textAttrHeight 返回值不超过
 *          宽度 × 9/16；短文本仍按内容定高且不高于上限；超长文本被裁到上限并报告溢出
 *          （textElementOverflows / textAttrOverflows），供渲染侧画「＋更多」提示
 * [POS]: lib/pomelo/world-canvas/blocks 的文本块度量的回归（画布上文本框大小与溢出提示依据）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TEXT_BLOCK_MAX_ASPECT,
  textAttrHeight,
  textAttrOverflows,
  textBlockMaxHeight,
  textElementHeight,
  textElementOverflows,
} from "./text-block-metrics";

const WIDTH = 260;

test("max height is width × 9/16", () => {
  assert.equal(textBlockMaxHeight(WIDTH), WIDTH * TEXT_BLOCK_MAX_ASPECT);
  assert.equal(textBlockMaxHeight(WIDTH), 146.25);
});

test("short text keeps content-derived height under the cap", () => {
  const height = textElementHeight("短文本", WIDTH);
  assert.ok(height <= textBlockMaxHeight(WIDTH), `${height} should be <= cap`);
  assert.ok(height > 0);
  assert.equal(textElementOverflows("短文本", WIDTH), false);
});

test("long text is clamped to the 16:9 cap and reports overflow", () => {
  const long = "长".repeat(500);
  const elementHeight = textElementHeight(long, WIDTH);
  const attrHeight = textAttrHeight(long, WIDTH);
  assert.equal(elementHeight, textBlockMaxHeight(WIDTH));
  assert.equal(attrHeight, textBlockMaxHeight(WIDTH));
  assert.equal(textElementOverflows(long, WIDTH), true);
  assert.equal(textAttrOverflows(long, WIDTH), true);
});

test("attr card cap shares the same 16:9 bound as the free text element", () => {
  const long = "长".repeat(500);
  assert.equal(textAttrHeight(long, WIDTH), textElementHeight(long, WIDTH));
});
