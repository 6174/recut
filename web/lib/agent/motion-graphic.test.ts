import assert from "node:assert/strict";
import test from "node:test";

import { extractMotionGraphic, isMotionGraphicCall } from "./motion-graphic";

test("detects motion-graphic tools across canonical and alias names", () => {
  assert.equal(isMotionGraphicCall({ toolName: "recut.motion-graphic.commit" }), true);
  assert.equal(isMotionGraphicCall({ tool: "recut_recut_motion-graphic_commit" }), true);
  assert.equal(isMotionGraphicCall({ toolName: "recut.image.generate" }), false);
  assert.equal(isMotionGraphicCall(null), false);
});

test("extracts the committed component from the nested output envelope", () => {
  const call = {
    input: JSON.stringify({
      input: { name: "深夜记录卡", surface: "react", inputs: [{ key: "title", label: "主信息", type: "text" }] },
    }),
    output: JSON.stringify({
      output: JSON.stringify({ componentId: "ai-f07e186c", status: "draft", version: 1, versionId: "ai-f07e186c@1" }),
    }),
    payload: { toolName: "recut_recut_motion-graphic_commit" },
  };
  const mg = extractMotionGraphic(call);
  assert.ok(mg);
  assert.equal(mg.componentId, "ai-f07e186c");
  assert.equal(mg.name, "深夜记录卡");
  assert.equal(mg.status, "draft");
  assert.equal(mg.version, 1);
  assert.equal(mg.inputs?.[0]?.key, "title");
});

test("extracts name/brief/cover from create-style payloads", () => {
  const call = {
    input: JSON.stringify({
      input: { items: [{ nameHint: "AccentBar", brief: "一条强调线", mode: "local" }] },
    }),
    output: JSON.stringify({
      components: [
        { componentId: "ai-3bxk7850", assetId: "component:ai-3bxk7850", versionId: "ai-3bxk7850@2", status: "verified", name: "AccentBar", version: 2, surface: "html", coverUrl: "/v1/platform/files/covers/a.png" },
      ],
      assetIds: ["component:ai-3bxk7850"],
    }),
    payload: { toolName: "recut.motion-graphic.create" },
  };
  const mg = extractMotionGraphic(call);
  assert.ok(mg);
  assert.equal(mg.name, "AccentBar");
  assert.equal(mg.brief, "一条强调线");
  assert.equal(mg.status, "verified");
  assert.equal(mg.coverUrl, "/v1/platform/files/covers/a.png");
});

test("read-only ops and non-component payloads return null", () => {
  assert.equal(
    extractMotionGraphic({
      input: JSON.stringify({ input: { componentId: "ai-1" } }),
      output: JSON.stringify({ componentId: "ai-1", versionId: "ai-1@1" }),
      payload: { toolName: "recut.motion-graphic.source" },
    }),
    null,
  );
  assert.equal(
    extractMotionGraphic({ output: JSON.stringify({ ok: true }), payload: { toolName: "recut.motion-graphic.commit" } }),
    null,
  );
});
