/*
 * [INPUT]: 依赖 node:test/assert、overlays/subject、@/app/media/media-types 与 @/lib/recut-worlds-client 类型
 * [OUTPUT]: 覆盖 AI 生成判定、元素 → modality、subject 解析（媒体元素/属性卡/实体卡）与输入框资格
 * [POS]: web overlay subject 纯函数单测（RFC 2026-10-07 §3.4）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset } from "@/app/media/media-types";
import type { WorldCanvasElement, WorldEntity } from "@/lib/recut-worlds-client";
import { composerEligible, generationSubjectOf, isAiGeneratedAsset, mediaModalityOfElement } from "./subject";

function element(overrides: Partial<WorldCanvasElement> & { kind: string; props?: Record<string, unknown> }): WorldCanvasElement {
  return {
    id: "shape:media-1",
    worldId: "w1",
    kind: overrides.kind,
    refKind: "",
    refId: "",
    name: "媒体",
    props: overrides.props ?? {},
    geometry: { x: 0, y: 0, width: 240, height: 135 },
    createdAt: "",
    updatedAt: "",
    ...overrides,
  } as WorldCanvasElement;
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: "a1",
    kind: "image",
    name: "图",
    origin: "generated",
    status: "completed",
    createdAt: "",
    updatedAt: "",
    metadata: {},
    ...overrides,
  } as Asset;
}

test("isAiGeneratedAsset: generated / motion-graphic / proposed / 带配方 视为 AI", () => {
  assert.equal(isAiGeneratedAsset(asset({ origin: "generated" })), true);
  assert.equal(isAiGeneratedAsset(asset({ origin: "motion-graphic" })), true);
  assert.equal(isAiGeneratedAsset(asset({ status: "proposed", origin: "" })), true);
  assert.equal(isAiGeneratedAsset(asset({ origin: "", metadata: { modelId: "x" } })), true);
  assert.equal(isAiGeneratedAsset(asset({ origin: "user-upload", metadata: {} })), false);
  assert.equal(isAiGeneratedAsset(undefined), false);
});

test("mediaModalityOfElement: 素材真源优先，其次 props", () => {
  const el = element({ kind: "media", props: { modality: "image" } });
  assert.equal(mediaModalityOfElement(el, asset({ kind: "video" })), "video");
  assert.equal(mediaModalityOfElement(el, undefined), "image");
  assert.equal(mediaModalityOfElement(element({ kind: "attr", props: { media: "audio" } }), undefined), "audio");
  assert.equal(mediaModalityOfElement(element({ kind: "attr", props: { media: "text" } }), undefined), null);
});

test("generationSubjectOf: 空媒体卡 empty=true、非 AI", () => {
  const el = element({ kind: "media", props: { modality: "image" } });
  const subject = generationSubjectOf({ elements: [el], entities: [], assets: {} }, el.id);
  assert.equal(subject?.kind, "media-element");
  assert.equal(subject && subject.kind === "media-element" ? subject.empty : null, true);
  assert.equal(subject && subject.kind === "media-element" ? subject.aiGenerated : null, false);
  assert.equal(composerEligible(subject), true);
});

test("generationSubjectOf: 手动上传非空 → 输入框不显示", () => {
  const el = element({ kind: "media", props: { modality: "image", assetId: "a1" } });
  const subject = generationSubjectOf({ elements: [el], entities: [], assets: { a1: asset({ origin: "user-upload" }) } }, el.id);
  assert.equal(composerEligible(subject), false);
});

test("generationSubjectOf: AI 生成非空 → 输入框显示", () => {
  const el = element({ kind: "media", props: { modality: "video", assetId: "a1" } });
  const subject = generationSubjectOf({ elements: [el], entities: [], assets: { a1: asset({ kind: "video", origin: "generated" }) } }, el.id);
  assert.equal(composerEligible(subject), true);
});

test("generationSubjectOf: 实体卡 blockId=entity:<id>", () => {
  const entity = { id: "e1", name: "角色" } as WorldEntity;
  const subject = generationSubjectOf({ elements: [], entities: [entity], assets: {} }, "entity:e1");
  assert.equal(subject?.kind, "entity");
});

test("generationSubjectOf: 未知 block → null", () => {
  assert.equal(generationSubjectOf({ elements: [], entities: [], assets: {} }, "shape:world"), null);
  assert.equal(generationSubjectOf({ elements: [], entities: [], assets: {} }, null), null);
});
