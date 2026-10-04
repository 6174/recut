/*
 * [INPUT]: 依赖 node:test/assert 与 canvas-store 的纯函数 projectEntityAttrsIntoElements
 * [OUTPUT]: 覆盖「实体属性（单一数据源）→ 画布属性卡（引用投影）」的反向投影：
 *          文本卡经属性边/refId+field/boundEntityId 绑定；intro/detail 保留标签；schema label→key；
 *          媒体卡 assetId；skipIds（本地脏元素）与「实体无值不动」的保守语义。
 * [POS]: lib/pomelo/world-canvas 的反向投影单测（该逻辑的宿主在 app/worlds/[worldID]/canvas/canvas-store.ts）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { projectEntityAttrsIntoElements } from "@/app/worlds/[worldID]/canvas/canvas-store";
import type { WorldCanvasElement, WorldEntity, WorldEntityType } from "@/lib/recut-worlds-client";

function element(partial: Partial<WorldCanvasElement> & { id: string }): WorldCanvasElement {
  return {
    worldId: "w",
    kind: "attr",
    refKind: "",
    refId: "",
    name: "",
    props: {},
    geometry: {},
    style: {},
    layer: "0",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

function entity(partial: Partial<WorldEntity> & { id: string }): WorldEntity {
  return {
    typeId: "character",
    name: partial.id,
    intro: "",
    detail: "",
    attrs: [],
    relations: [],
    references: [],
    ...partial,
  } as WorldEntity;
}

const attrEdge = (from: string, to: string) =>
  element({ id: `shape:arrow-${to}`, kind: "arrow", props: { fromElementId: from, toElementId: to, edgeType: "attr" } });

test("edge-linked text card projects the entity attr value", () => {
  const card = element({ id: "shape:attr-1", props: { media: "text", label: "位置", text: "北京" } });
  const entityEl = element({ id: "shape:e1", kind: "entity", refKind: "entity", refId: "e1" });
  const edge = attrEdge("shape:e1", "shape:attr-1");
  const e = entity({ id: "e1", attrs: [{ key: "位置", label: "位置", type: "text", value: "上海" }] });

  const result = projectEntityAttrsIntoElements([entityEl, edge, card], [e], []);
  const projected = result.elements.find((item) => item.id === "shape:attr-1")!;
  assert.equal(projected.props.text, "上海");
  assert.deepEqual(result.changedIds, ["shape:attr-1"]);
});

test("reserved 简介/正文 labels project first-class fields", () => {
  const card = element({ id: "shape:attr-1", name: "属性 · 正文", props: { media: "text", label: "正文", text: "旧" } });
  const edge = attrEdge("shape:e1", "shape:attr-1");
  const e = entity({ id: "e1", detail: "新正文" });
  const result = projectEntityAttrsIntoElements([edge, card], [e], []);
  assert.equal(result.elements.find((item) => item.id === "shape:attr-1")!.props.text, "新正文");
});

test("schema label maps to the field key", () => {
  const card = element({ id: "shape:attr-1", props: { media: "text", label: "位置" } });
  const edge = attrEdge("shape:e1", "shape:attr-1");
  const e = entity({ id: "e1", attrs: [{ key: "location", label: "位置", type: "text", value: "上海" }] });
  const type: WorldEntityType = {
    id: "character",
    worldId: "w",
    scope: "preset",
    name: "角色",
    fields: [{ key: "location", label: "位置", type: "text" }],
    createdAt: "",
    updatedAt: "",
  };
  const result = projectEntityAttrsIntoElements([edge, card], [e], [type]);
  assert.equal(result.elements.find((item) => item.id === "shape:attr-1")!.props.text, "上海");
});

test("refId+field direct-reference model projects", () => {
  const card = element({ id: "attr:shape:note", kind: "attr", refKind: "entity", refId: "e1", props: { field: "appearance" } });
  const e = entity({ id: "e1", attrs: [{ key: "appearance", label: "外貌", type: "text", value: "建筑师" }] });
  const result = projectEntityAttrsIntoElements([card], [e], []);
  assert.equal(result.elements.find((item) => item.id === "attr:shape:note")!.props.text, "建筑师");
});

test("promote reference projection (binding=property) projects onto the visible element", () => {
  const node = element({ id: "shape:note-1", kind: "note", props: { text: "旧", binding: "property", boundEntityId: "e1", boundField: "appearance" } });
  const e = entity({ id: "e1", attrs: [{ key: "appearance", label: "外貌", type: "text", value: "新" }] });
  const result = projectEntityAttrsIntoElements([node], [e], []);
  assert.equal(result.elements.find((item) => item.id === "shape:note-1")!.props.text, "新");
});

test("media card projects assetId/url/name and never touches assetStatus", () => {
  const card = element({ id: "shape:attr-1", kind: "attr", props: { media: "image", label: "场景卡", assetId: "old", assetStatus: "generating" } });
  const edge = attrEdge("shape:e1", "shape:attr-1");
  const e = entity({ id: "e1", attrs: [{ key: "场景卡", label: "场景卡", type: "media", value: { assetId: "new", kind: "image", name: "雨夜" } }] });
  const result = projectEntityAttrsIntoElements([edge, card], [e], []);
  const projected = result.elements.find((item) => item.id === "shape:attr-1")!;
  assert.equal(projected.props.assetId, "new");
  assert.equal(projected.props.assetName, "雨夜");
  assert.equal(projected.props.assetStatus, "generating");
});

test("dirty (skipIds) cards are left untouched (local edit wins)", () => {
  const card = element({ id: "shape:attr-1", props: { media: "text", label: "位置", text: "本地未落盘" } });
  const edge = attrEdge("shape:e1", "shape:attr-1");
  const e = entity({ id: "e1", attrs: [{ key: "位置", label: "位置", type: "text", value: "远端" }] });
  const result = projectEntityAttrsIntoElements([edge, card], [e], [], new Set(["shape:attr-1"]));
  assert.equal(result.changedIds.length, 0);
  assert.equal(result.elements.find((item) => item.id === "shape:attr-1")!.props.text, "本地未落盘");
});

test("canvas-only cards (entity has no such attr) are not cleared", () => {
  const card = element({ id: "shape:attr-1", props: { media: "text", label: "临时", text: "只落节点" } });
  const edge = attrEdge("shape:e1", "shape:attr-1");
  const e = entity({ id: "e1" });
  const result = projectEntityAttrsIntoElements([edge, card], [e], []);
  assert.equal(result.changedIds.length, 0);
  assert.equal(result.elements.find((item) => item.id === "shape:attr-1")!.props.text, "只落节点");
});

test("no-op when values already match; entity cards are never touched", () => {
  const card = element({ id: "shape:attr-1", props: { media: "text", label: "位置", text: "上海" } });
  const edge = attrEdge("shape:e1", "shape:attr-1");
  const entityEl = element({ id: "shape:e1", kind: "entity", refKind: "entity", refId: "e1", name: "阿墨" });
  const e = entity({ id: "e1", attrs: [{ key: "位置", label: "位置", type: "text", value: "上海" }] });
  const result = projectEntityAttrsIntoElements([entityEl, edge, card], [e], []);
  assert.deepEqual(result.changedIds, []);
  assert.equal(result.elements, result.elements);
  assert.equal(result.elements.find((item) => item.id === "shape:e1")!.name, "阿墨");
});
