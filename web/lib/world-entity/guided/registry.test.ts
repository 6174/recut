/*
 * [INPUT]: 依赖 node:test/assert、guided/context、guided/registry
 * [OUTPUT]: 覆盖动作注册表：类型/purpose 过滤、priority 排序、requires 门禁、草稿 id 稳定
 * [POS]: web 引导提示动作的注册表门禁
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorldEntity } from "@/lib/recut-worlds-client";

import { buildEntityContext, buildMediaContext, styleLockFromEntities } from "./context";
import { actionsFor, buildActionText, draftIdFor, isActionEnabled, rankActions } from "./registry";

const character = {
  id: "e1",
  typeId: "character",
  name: "林小满",
  intro: "擅长用声音的电台主播",
  detail: "",
  attrs: [
    { key: "appearance", label: "外貌与标志", type: "textarea", value: "黑色短发" },
    { key: "a1", label: "外貌参考", type: "media", value: { assetId: "asset_a1", name: "外貌参考", kind: "image" } },
  ],
  relations: [],
  references: [],
} as unknown as WorldEntity;

test("entity actions are scoped by typeId", () => {
  const ctx = buildEntityContext({ entity: character, typeLabel: "人物", worldId: "w1", worldName: "晨间电台" });
  const ids = actionsFor(ctx).map((action) => action.id);
  assert.ok(ids.includes("character.sheet"));
  assert.ok(ids.includes("character.logline"));
  assert.ok(ids.includes("generic.fill"));
  assert.ok(!ids.includes("location.sheet"));
  assert.ok(!ids.includes("media.asSheet"));
});

test("rankActions puts the flagship sheet first", () => {
  const ctx = buildEntityContext({ entity: character, typeLabel: "人物", worldId: "w1", worldName: "晨间电台" });
  const ranked = rankActions(ctx, actionsFor(ctx));
  assert.equal(ranked[0].id, "character.sheet");
});

test("media context infers purpose and unlocks matching actions", () => {
  const ctx = buildMediaContext({
    element: { name: "属性 · 外貌与标志", props: { label: "外貌与标志", media: "image", assetId: "asset_a1" } },
    modality: "image",
    owningEntity: character,
    worldId: "w1",
    worldName: "晨间电台",
  });
  assert.equal(ctx.subject.kind, "media");
  if (ctx.subject.kind !== "media") return;
  assert.equal(ctx.subject.inferred.id, "appearance");
  assert.equal(ctx.subject.inferred.role, "character");
  assert.equal(ctx.subject.owningEntity?.id, "e1");
  const ids = actionsFor(ctx).map((action) => action.id);
  assert.ok(ids.includes("media.asSheet"));
  assert.ok(ids.includes("media.reverse"));
  assert.ok(ids.includes("media.variation"));
});

test("unknown media purpose hides semantic actions but keeps generic ones", () => {
  const ctx = buildMediaContext({
    element: { name: "未命名", props: { label: "随手一拍" } },
    modality: "image",
    worldId: "w1",
    worldName: "晨间电台",
  });
  if (ctx.subject.kind !== "media") throw new Error("expected media subject");
  assert.equal(ctx.subject.inferred.id, "unknown");
  const actions = actionsFor(ctx);
  const ranked = rankActions(ctx, actions);
  const ids = actions.map((action) => action.id);
  assert.ok(!ids.includes("media.asSheet"));
  assert.ok(ids.includes("media.card.character"));
  assert.ok(ids.includes("media.variation"));
  // 三类设定卡永远靠前（不依赖推断）
  assert.equal(ranked[0].id, "media.card.character");
  const siblings = actions.find((action) => action.id === "media.siblings");
  assert.ok(siblings);
  assert.equal(isActionEnabled(siblings, ctx).ok, false);
});

test("card actions lead and emit inline reference tags", () => {
  const ctx = buildMediaContext({
    element: { name: "属性 · 外貌与标志", props: { label: "外貌与标志", media: "image", assetId: "asset_a1" } },
    modality: "image",
    owningEntity: character,
    worldId: "w1",
    worldName: "晨间电台",
  });
  const ranked = rankActions(ctx, actionsFor(ctx));
  assert.equal(ranked[0].id, "media.card.character");
  const text = buildActionText(ranked[0], ctx);
  assert.ok(text.includes('<media type="image" assetid="asset_a1"'));
  assert.ok(text.includes("人物三视图"));
});

test("entity action text emits a creation_entity chip", () => {
  const ctx = buildEntityContext({ entity: character, typeLabel: "人物", worldId: "w1", worldName: "晨间电台" });
  const action = actionsFor(ctx).find((item) => item.id === "character.sheet")!;
  const text = buildActionText(action, ctx);
  assert.ok(text.includes('<creation_entity worldid="w1" entityid="e1"'));
  assert.ok(text.includes("人物卡"));
});

test("card actions are ordered by inferred purpose", () => {
  const ctx = buildMediaContext({
    element: { name: "属性 · 场景全局图", props: { label: "场景全局图", media: "image", assetId: "asset_env" } },
    modality: "image",
    worldId: "w1",
    worldName: "晨间电台",
  });
  const ranked = rankActions(ctx, actionsFor(ctx));
  assert.equal(ranked[0].id, "media.card.environment");
});

test("visual card actions are hidden for audio media", () => {
  const ctx = buildMediaContext({
    element: { name: "属性 · 音色", props: { label: "音色", media: "audio", assetId: "asset_v" } },
    modality: "audio",
    worldId: "w1",
    worldName: "晨间电台",
  });
  const ids = actionsFor(ctx).map((action) => action.id);
  assert.ok(!ids.includes("media.card.character"));
  assert.ok(ids.includes("media.moreLines"));
});

test("generic fallbacks are excluded when a type-specific action exists", () => {
  const charIds = actionsFor(buildEntityContext({ entity: character, typeLabel: "人物", worldId: "w1", worldName: "W" })).map((action) => action.id);
  assert.ok(charIds.includes("character.consistency"));
  assert.ok(!charIds.includes("generic.consistency"));
  assert.ok(!charIds.includes("generic.translate"));

  const objectEntity = { ...character, id: "e2", typeId: "object", attrs: [] } as unknown as WorldEntity;
  const objectIds = actionsFor(buildEntityContext({ entity: objectEntity, typeLabel: "物件", worldId: "w1", worldName: "W" })).map((action) => action.id);
  assert.ok(objectIds.includes("generic.consistency"));
});

test("styleLock is derived from style entities and lands in the prompt", () => {
  const styleEntity = {
    id: "s1",
    typeId: "style",
    name: "冷峻电影感",
    attrs: [{ key: "visual", label: "视觉", type: "textarea", value: "低饱和、冷青色、硬光" }],
    relations: [],
    references: [],
  } as unknown as WorldEntity;
  const lock = styleLockFromEntities([character, styleEntity]);
  assert.equal(lock, "低饱和、冷青色、硬光");
  const ctx = buildEntityContext({ entity: character, typeLabel: "人物", worldId: "w1", worldName: "W", styleLock: lock });
  const action = actionsFor(ctx).find((item) => item.id === "character.sheet")!;
  assert.ok(buildActionText(action, ctx).includes("低饱和、冷青色、硬光"));
});

test("ranking is gap-aware: missing reference is promoted", () => {
  const bare = {
    id: "e3",
    typeId: "character",
    name: "无图角色",
    intro: "",
    detail: "",
    attrs: [{ key: "appearance", label: "外貌与标志", type: "textarea", value: "黑色短发" }],
    relations: [],
    references: [],
  } as unknown as WorldEntity;
  const ranked = rankActions(buildEntityContext({ entity: bare, typeLabel: "人物", worldId: "w1", worldName: "W" }), actionsFor(buildEntityContext({ entity: bare, typeLabel: "人物", worldId: "w1", worldName: "W" })));
  const ids = ranked.map((action) => action.id);
  assert.ok(ids.indexOf("generic.missingRef") < ids.indexOf("generic.fill"));
});

test("ranking is gap-aware: text actions promoted when media exists but text is empty", () => {
  const mediaOnly = {
    id: "e4",
    typeId: "character",
    name: "只有图",
    intro: "",
    detail: "",
    attrs: [{ key: "a1", label: "外貌参考", type: "media", value: { assetId: "asset_a1", kind: "image" } }],
    relations: [],
    references: [],
  } as unknown as WorldEntity;
  const ctx = buildEntityContext({ entity: mediaOnly, typeLabel: "人物", worldId: "w1", worldName: "W" });
  const ids = rankActions(ctx, actionsFor(ctx)).map((action) => action.id);
  assert.ok(ids.indexOf("character.logline") < ids.indexOf("character.turnaround"));
});

test("draftIdFor is stable and subject-scoped", () => {
  const ctx = buildEntityContext({ entity: character, typeLabel: "人物", worldId: "w1", worldName: "晨间电台" });
  const action = actionsFor(ctx).find((item) => item.id === "character.sheet")!;
  assert.equal(draftIdFor(action, ctx), "guided-character.sheet-e1");
});

const scriptEntity = {
  id: "sc1",
  typeId: "script",
  name: "雨夜电台开场",
  intro: "",
  detail: "",
  attrs: [
    { key: "logline", label: "一句话概括", type: "text", value: "主播在雨夜接通最后一通电话" },
    { key: "beats", label: "节拍 / 叙事结构", type: "textarea", value: "开场钩子→来电→回忆→落定" },
    { key: "vo", label: "口播 / 旁白", type: "textarea", value: "今晚，最后一通电话。" },
    { key: "durationSec", label: "目标时长", type: "number", value: 60 },
    { key: "aspectRatio", label: "画幅", type: "select", value: "9:16" },
    { key: "storyboard", label: "分镜表", type: "media", value: { assetId: "asset_sb", name: "分镜表", kind: "image" } },
  ],
  relations: [],
  references: [],
} as unknown as WorldEntity;

test("script actions are scoped to the script type", () => {
  const ctx = buildEntityContext({ entity: scriptEntity, typeLabel: "视频脚本", worldId: "w1", worldName: "晨间电台" });
  const ids = actionsFor(ctx).map((action) => action.id);
  assert.ok(ids.includes("script.storyboard"));
  assert.ok(ids.includes("script.panels"));
  assert.ok(ids.includes("script.videos"));
  assert.ok(!ids.includes("story.storyboard"));
  assert.ok(!ids.includes("character.sheet"));
});

test("script storyboard action emits a 25-panel grid sheet prompt", () => {
  const ctx = buildEntityContext({ entity: scriptEntity, typeLabel: "视频脚本", worldId: "w1", worldName: "晨间电台" });
  const action = actionsFor(ctx).find((item) => item.id === "script.storyboard")!;
  const text = buildActionText(action, ctx);
  assert.ok(text.includes("25 格"));
  assert.ok(text.includes("R1C1"));
  assert.ok(text.includes("panel manifest"));
});

test("script.panels requires a storyboard reference", () => {
  const bare = { ...scriptEntity, id: "sc2", attrs: [] } as unknown as WorldEntity;
  const ctx = buildEntityContext({ entity: bare, typeLabel: "视频脚本", worldId: "w1", worldName: "W" });
  const action = actionsFor(ctx).find((item) => item.id === "script.panels")!;
  assert.equal(isActionEnabled(action, ctx).ok, false);
});

test("story storyboard action asks for a single grid sheet with coordinates", () => {
  const story = {
    id: "st1",
    typeId: "story",
    name: "雨夜电台",
    intro: "",
    detail: "",
    attrs: [{ key: "premise", label: "前提", type: "textarea", value: "雨夜的最后来电" }],
    relations: [],
    references: [],
  } as unknown as WorldEntity;
  const ctx = buildEntityContext({ entity: story, typeLabel: "故事", worldId: "w1", worldName: "W" });
  const action = actionsFor(ctx).find((item) => item.id === "story.storyboard")!;
  const text = buildActionText(action, ctx);
  assert.ok(text.includes("R1C1"));
  assert.ok(text.includes("25 格"));
});

test("story.script proposes a script entity creation", () => {
  const story = {
    id: "st1",
    typeId: "story",
    name: "雨夜电台",
    intro: "",
    detail: "",
    attrs: [{ key: "premise", label: "前提", type: "textarea", value: "雨夜的最后来电" }],
    relations: [],
    references: [],
  } as unknown as WorldEntity;
  const ctx = buildEntityContext({ entity: story, typeLabel: "故事", worldId: "w1", worldName: "W" });
  const action = actionsFor(ctx).find((item) => item.id === "story.script")!;
  assert.equal(action.output.kind, "canon-proposal");
  assert.ok(buildActionText(action, ctx).includes("script 实体"));
});
