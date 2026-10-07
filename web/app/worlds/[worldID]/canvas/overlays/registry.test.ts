/*
 * [INPUT]: 依赖 node:test/assert、overlays/registry、overlays/types
 * [OUTPUT]: 覆盖注册/注销、按 kind 分组、match 过滤与 priority 排序
 * [POS]: web overlay 注册表纯函数单测（RFC 2026-10-07 §3.1）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeOverlaysFor, registerNodeOverlay, resetNodeOverlays } from "./registry";
import type { NodeOverlayContext, NodeOverlayPlugin } from "./types";

function ctx(): NodeOverlayContext {
  return {
    blockId: "shape:media-1",
    subject: { kind: "entity", blockId: "entity:e1", entityId: "e1", entity: { id: "e1", name: "x" } as never },
    presence: "selected",
    worldId: "w1",
    contextId: "",
    readOnly: false,
    scale: 1,
  };
}

function plugin(id: string, kind: "toolbar" | "composer", priority: number, match = true): NodeOverlayPlugin {
  return { id, kind, priority, match: () => match, render: () => null };
}

test("registry: 按 kind 分组 + match 过滤 + priority 排序", () => {
  resetNodeOverlays();
  registerNodeOverlay(plugin("t-low", "toolbar", 1));
  registerNodeOverlay(plugin("t-high", "toolbar", 9));
  registerNodeOverlay(plugin("c", "composer", 0));
  registerNodeOverlay(plugin("off", "toolbar", 100, false));
  const result = nodeOverlaysFor(ctx());
  assert.deepEqual(result.toolbar.map((p) => p.id), ["t-high", "t-low"]);
  assert.deepEqual(result.composer.map((p) => p.id), ["c"]);
});

test("registry: 注销后不再出现；match 抛错视为不出现", () => {
  resetNodeOverlays();
  const unregister = registerNodeOverlay(plugin("t", "toolbar", 0));
  assert.equal(nodeOverlaysFor(ctx()).toolbar.length, 1);
  unregister();
  assert.equal(nodeOverlaysFor(ctx()).toolbar.length, 0);
  registerNodeOverlay({ id: "boom", kind: "toolbar", match: () => { throw new Error("x"); }, render: () => null });
  assert.equal(nodeOverlaysFor(ctx()).toolbar.length, 0);
  resetNodeOverlays();
});
