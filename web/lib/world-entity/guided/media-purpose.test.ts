/*
 * [INPUT]: 依赖 node:test/assert 与 guided/media-purpose
 * [OUTPUT]: 覆盖属性名→purpose/role 推断：各关键词命中、分源优先级、未知回退
 * [POS]: web 引导提示动作的媒体语义推断门禁
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { inferMediaPurpose } from "./media-purpose";

test("infers purpose and role from attribute names", () => {
  assert.deepEqual(
    { id: inferMediaPurpose({ attrLabel: "外貌与标志" }).id, role: inferMediaPurpose({ attrLabel: "外貌与标志" }).role },
    { id: "appearance", role: "character" },
  );
  assert.equal(inferMediaPurpose({ attrLabel: "服装" }).id, "wardrobe");
  assert.equal(inferMediaPurpose({ attrLabel: "场景全局图" }).id, "environment");
  assert.equal(inferMediaPurpose({ attrLabel: "场景全局图" }).role, "environment");
  assert.equal(inferMediaPurpose({ attrLabel: "色卡" }).id, "color-card");
  assert.equal(inferMediaPurpose({ attrLabel: "表情表" }).id, "expression");
  assert.equal(inferMediaPurpose({ attrLabel: "三视图" }).id, "turnaround");
  assert.equal(inferMediaPurpose({ attrLabel: "outfit" }).id, "wardrobe");
  assert.equal(inferMediaPurpose({ attrLabel: "音色" }).id, "voice");
});

test("prefers attribute label over element name and asset name", () => {
  const result = inferMediaPurpose({ attrLabel: "色卡", elementName: "外貌参考", assetName: "场景图" });
  assert.equal(result.id, "color-card");
  assert.equal(result.source, "attr-label");
});

test("falls back to element name, then asset name", () => {
  assert.equal(inferMediaPurpose({ elementName: "属性 · 服装" }).id, "wardrobe");
  assert.equal(inferMediaPurpose({ assetName: "establishing-shot" }).id, "environment");
});

test("unknown label yields fallback purpose", () => {
  const result = inferMediaPurpose({ attrLabel: "随手一拍" });
  assert.equal(result.id, "unknown");
  assert.equal(result.source, "fallback");
  assert.equal(result.confidence, 0);
});

test("resolves conflicts by most specific keyword", () => {
  // 同长度冲突按词表顺序取先命中者（色卡优先于场景）
  assert.equal(inferMediaPurpose({ attrLabel: "场景色卡" }).id, "color-card");
  // 更长关键词优先：三视图（3 字）比 外观（2 字）更具体
  assert.equal(inferMediaPurpose({ attrLabel: "外观三视图" }).id, "turnaround");
});
