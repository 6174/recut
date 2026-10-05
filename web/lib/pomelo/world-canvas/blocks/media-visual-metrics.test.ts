/*
 * [INPUT]: 依赖 node:test/assert 与被测的视觉媒体块尺寸策略（media-visual-metrics.ts）
 * [OUTPUT]: 覆盖「横竖同一缩放因子」契约：16:9 与 9:16（及极端比例）都按最长边锚 240 定尺，
 *          同分辨率素材的缩放一致、最长边恒为 240、空素材 16:9 与比例定尺同一档
 * [POS]: lib/pomelo/world-canvas/blocks 的视觉媒体尺寸回归（画布上图片/视频元素的大小依据）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MEDIA_VISUAL_HEIGHT, MEDIA_VISUAL_LONG_SIDE, MEDIA_VISUAL_SIZE, MEDIA_VISUAL_WIDTH, mediaAspectKey, mediaVisualSizeForRatio } from "./media-visual-metrics";

test("landscape 16:9 keeps the reference size", () => {
  assert.deepEqual(mediaVisualSizeForRatio(1920 / 1080), { width: MEDIA_VISUAL_WIDTH, height: MEDIA_VISUAL_HEIGHT });
});

test("portrait 9:16 anchors the long side instead of the width", () => {
  assert.deepEqual(mediaVisualSizeForRatio(1080 / 1920), { width: 135, height: 240 });
});

test("equal-resolution landscape and portrait media share one scale factor", () => {
  const landscape = mediaVisualSizeForRatio(1920 / 1080);
  const portrait = mediaVisualSizeForRatio(1080 / 1920);
  // 世界单位 / 素材像素：两者相等，画布上浏览时大小才齐
  assert.equal(landscape.width / 1920, portrait.height / 1920);
  assert.equal(landscape.height / 1080, portrait.width / 1080);
});

test("the longest side is always the anchor, whatever the ratio", () => {
  for (const ratio of [4, 2, 1.85, 16 / 9, 1, 9 / 16, 0.5, 0.25]) {
    const { width, height } = mediaVisualSizeForRatio(ratio);
    assert.equal(Math.max(width, height), MEDIA_VISUAL_LONG_SIDE, `ratio=${ratio}`);
    assert.ok(Math.abs(width / height - ratio) < 0.02, `ratio=${ratio} → ${width}×${height}`);
  }
});

test("the empty 16:9 placeholder matches an aspect-derived 16:9", () => {
  assert.deepEqual(mediaVisualSizeForRatio(16 / 9), MEDIA_VISUAL_SIZE);
});

test("the aspect identity key prefers the content hash so a replaced asset re-measures", () => {
  // 同一 assetId、内容哈希变化 = 内容被替换（视频重新生成/重新上传）→ key 必须变化，
  // 否则旧 visualAspect（如 9:16）会被 needsAspectMeasure 永久信任，节点尺寸不随新内容（16:9）更新。
  assert.notEqual(mediaAspectKey("a1", "", "hash-9x16"), mediaAspectKey("a1", "", "hash-16x9"));
  assert.equal(mediaAspectKey("a1", "", "hash-9x16"), "a1:hash-9x16");
});

test("the aspect identity key falls back to assetId then url", () => {
  // proposed 资产无内容哈希（尚未生成）→ 用 assetId；url-only 元素 → 用 url；空引用 → 空串。
  assert.equal(mediaAspectKey("a1", "", undefined), "a1");
  assert.equal(mediaAspectKey("a1", "", ""), "a1");
  assert.equal(mediaAspectKey("", "https://cdn/x.mp4", undefined), "https://cdn/x.mp4");
  assert.equal(mediaAspectKey("", "", undefined), "");
});
