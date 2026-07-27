/*
 * [INPUT]: 依赖平台注入的 ctx.sqlite 与 ctx.artifacts capability
 * [OUTPUT]: 注册 B-roll brief、资源创建、查询、归档与受依赖保护删除的 App API 与 MCP 工具处理器
 * [POS]: vox-broll 的唯一业务后端；数据表、文件和产物模型由本 App 自己定义
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

function ensureSchema(ctx) {
  ctx.sqlite.execute(
    "create table if not exists briefs (id text primary key, topic text not null, title text not null, body text not null, created_at text not null)",
  );
  ctx.sqlite.execute("create table if not exists resources (id text primary key, kind text not null, title text not null, content_json text not null, dependencies_json text not null, created_at text not null, retired_at text)");
  ctx.sqlite.execute("create table if not exists app_meta (key text primary key, value text not null)");
  try { ctx.sqlite.execute("alter table resources add column retired_at text"); } catch (_) { /* 旧数据库已有该列，无需迁移。 */ }
}

function purgeLegacyLooks(ctx) {
  const marker = ctx.sqlite.query("select value from app_meta where key = ?", ["legacy-look-purge-v1"]);
  if (marker.length) return;
  const rows = ctx.sqlite.query("select id, kind, content_json from resources where retired_at is null");
  rows.forEach((row) => {
    const content = JSON.parse(row.content_json);
    const media = content?.media;
    const invalid = String(row.kind).toLowerCase() === "look" && (!media || !media.assetId || !media.text);
    if (invalid) ctx.sqlite.execute("delete from resources where id = ?", [row.id]);
  });
  ctx.sqlite.execute("insert into app_meta (key, value) values (?, ?)", ["legacy-look-purge-v1", new Date().toISOString()]);
}

function createBrief(input, ctx) {
  ensureSchema(ctx);
  const topic = String(input.topic || "").trim();
  if (!topic) throw new Error("topic is required");

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const brief = {
    id,
    topic,
    title: `${topic}，为什么值得被看见`,
    premise: `用一个清晰的因果链解释“${topic}”。`,
    direction: "快速建立冲突，以资料拼贴和关键数字推进论点。",
    createdAt: new Date().toISOString(),
  };
  ctx.sqlite.execute(
    "insert into briefs (id, topic, title, body, created_at) values (?, ?, ?, ?, ?)",
    [id, topic, brief.title, JSON.stringify(brief), brief.createdAt],
  );
  return ctx.artifacts.publish({ type: "recut.vox.brief@1", value: brief });
}

function latestBrief(_, ctx) {
  ensureSchema(ctx);
  const rows = ctx.sqlite.query("select body from briefs order by created_at desc limit 1");
  return rows.length ? JSON.parse(rows[0].body) : null;
}

const stageOrder = ["brief", "beats", "look", "keyframes", "audio", "scenes", "delivery"];
const mediaSnapshotContract = {
  assetId: "string",
  text: "string",
  imageAssetIds: "string[]",
  audioAssetIds: "string[]",
  sourceResourceIds: "string[]",
};

const resourceContracts = {
  brief: {
    inputs: ["topic"],
    output: { topic: "string", premise: "string", direction: "string" },
  },
  beats: {
    inputs: ["approved brief"],
    output: { hook: "string", narrative: "string", beats: "Beat[]" },
    item: { field: "beats", required: ["id", "title", "narration", "visual", "purpose", "durationSec"], types: { id: "string", title: "string", narration: "string", visual: "string", purpose: "string", durationSec: "number" } },
  },
  look: {
    inputs: ["approved brief", "approved beats"],
    output: { media: "MediaSnapshot", definition: "string", palette: "string", paperTechnique: "string", typeTreatment: "string", texture: "string", mood: "string" },
    media: { field: "media", requiredAsset: true },
  },
  keyframes: {
    inputs: ["approved beats", "selected look"],
    output: { keyframes: "Keyframe[]" },
    item: { field: "keyframes", required: ["beatId", "title", "composition", "headline", "layers"], optional: ["image"], types: { beatId: "string", title: "string", composition: "string", headline: "string", layers: "string[]" }, media: { field: "image", requiredAsset: false } },
  },
  audio: {
    inputs: ["approved beats", "keyframes"],
    output: { scenes: "AudioScene[]" },
    item: { field: "scenes", required: ["beatId", "narration", "music", "soundEffects", "captions", "durationSec"], optional: ["audio"], types: { beatId: "string", narration: "string", music: "string", soundEffects: "string", captions: "string", durationSec: "number" }, media: { field: "audio", requiredAsset: false } },
  },
  scenes: {
    inputs: ["selected look", "keyframes", "approved audio"],
    output: { scenes: "Scene[]" },
    item: { field: "scenes", required: ["beatId", "title", "durationSec", "visualAction", "cutPoint"], optional: ["video"], types: { beatId: "string", title: "string", durationSec: "number", visualAction: "string", cutPoint: "string" }, media: { field: "video", requiredAsset: false } },
  },
  delivery: {
    inputs: ["approved scenes"],
    output: { aspectRatio: "string", duration: "number", format: "string", export: "string", checklist: "string[]" },
  },
};

function requiredFields(contract) {
  return Object.keys(contract.output);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function hasExpectedType(value, type) {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string[]") return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim());
  if (type.endsWith("[]")) return Array.isArray(value);
  return true;
}

function validateMediaSnapshot(label, snapshot, requiredAsset) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error(`${label} must be a MediaSnapshot object`);
  const missing = Object.entries(mediaSnapshotContract).filter(([field]) => field !== "assetId" && (snapshot[field] === undefined || snapshot[field] === null || snapshot[field] === "")).map(([field]) => field);
  if (requiredAsset && !hasValue(snapshot.assetId)) missing.push("assetId");
  if (missing.length) throw new Error(`${label} is missing required fields: ${missing.join(", ")}`);
  const invalid = Object.entries(mediaSnapshotContract).filter(([field, type]) => snapshot[field] !== undefined && !hasExpectedType(snapshot[field], type)).map(([field]) => field);
  if (invalid.length) throw new Error(`${label} has invalid field types: ${invalid.join(", ")}`);
}

function validateResourceContent(kind, content) {
  const contract = resourceContracts[kind];
  const missing = requiredFields(contract).filter((field) => !hasValue(content[field]));
  if (missing.length) throw new Error(`${kind} is missing required fields: ${missing.join(", ")}`);
  const invalid = Object.entries(contract.output).filter(([field, type]) => !hasExpectedType(content[field], type)).map(([field]) => field);
  if (invalid.length) throw new Error(`${kind} has invalid field types: ${invalid.join(", ")}`);
  if (contract.media) validateMediaSnapshot(`${kind}.${contract.media.field}`, content[contract.media.field], contract.media.requiredAsset);
  if (!contract.item) return;

  const items = content[contract.item.field];
  if (!Array.isArray(items)) throw new Error(`${kind}.${contract.item.field} must be an array`);
  items.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${kind}.${contract.item.field}[${index}] must be an object`);
    const itemMissing = contract.item.required.filter((field) => !hasValue(item[field]));
    if (itemMissing.length) throw new Error(`${kind}.${contract.item.field}[${index}] is missing required fields: ${itemMissing.join(", ")}`);
    const itemInvalid = Object.entries(contract.item.types || {}).filter(([field, type]) => !hasExpectedType(item[field], type)).map(([field]) => field);
    if (itemInvalid.length) throw new Error(`${kind}.${contract.item.field}[${index}] has invalid field types: ${itemInvalid.join(", ")}`);
    if (item[contract.item.media?.field] !== undefined) validateMediaSnapshot(`${kind}.${contract.item.field}[${index}].${contract.item.media.field}`, item[contract.item.media.field], contract.item.media.requiredAsset);
  });
}

function workflowContext(_, ctx) {
  ensureSchema(ctx);
  purgeLegacyLooks(ctx);
  const resources = listResources({}, ctx);
  const byKind = Object.fromEntries(stageOrder.map((kind) => [kind, resources.filter((item) => String(item.kind).toLowerCase() === kind)]));
  const storedBrief = latestBrief({}, ctx);
  if (storedBrief && byKind.brief.length === 0) byKind.brief = [{ id: storedBrief.id, kind: "brief", title: storedBrief.title, content: storedBrief, dependencies: [], createdAt: storedBrief.createdAt }];
  const latest = (kind) => byKind[kind][0] || null;
  const nextStage = stageOrder.find((kind) => !latest(kind)) || null;
  const brief = latest("brief");
  const beats = latest("beats");
  const look = latest("look");
  return {
    revision: `${resources.length}:${resources[0]?.createdAt || "empty"}`,
    stage: nextStage || "delivery",
    nextAction: nextStage ? `create_${nextStage}` : "review_delivery",
    gates: { beatsReady: Boolean(beats), lookReady: Boolean(look) },
    inputs: { brief, beats, look },
    resourceContracts,
    mediaSnapshotContract,
    resources: Object.fromEntries(stageOrder.map((kind) => [kind, byKind[kind].map((item) => ({ id: item.id, title: item.title, createdAt: item.createdAt }))])),
    allowedActions: nextStage ? [`create_${nextStage}`] : ["review_delivery"],
    inFlight: null,
  };
}

function prepareResource(input, ctx) {
  const kind = String(input.kind || "").trim();
  if (!kind) throw new Error("resource kind is required");
  const dependencies = Array.isArray(input.dependencies) ? input.dependencies : [];
  const instruction = String(input.instruction || "无额外要求");
  const stageWorkflow = {
    brief: "一份短而明确的创作简报：主题、受众、论点、核心张力与编辑方向。",
    beats: "一个可审阅的叙事弧：三秒钩子、逐段节拍、每段的观众理解与画面证据。",
    look: "3 个明显不同的视觉方向。每个方向都需要一张 16:9 风格参考图和原始画面描述；图里不要有可读正文、Logo 或水印。完成后停下，等待选择。",
    keyframes: "每个节拍一张关键画面：主体、构图、标题区域、纸层和叙事证据；与已选 Look 保持一致。",
    audio: "每个场景的旁白、音乐与音效关系；声音必须帮助观众理解，而不是填满空白。",
    scenes: "基于已确认声音和关键画面的一组短场景视频；每段声音对应一个清楚的信息变化、镜头动作与切点。",
    delivery: "最终时间线、画幅、时长、格式和可执行的导出前检查表。",
  }[kind.toLowerCase()] || "一份面向审阅的清晰创作产出。";
  const contract = resourceContracts[kind.toLowerCase()];
  const outputFields = contract ? Object.entries(contract.output).map(([field, type]) => `${field}: ${type}`).join("；") : "一份可审阅的阶段资源";
  const itemFields = contract?.item ? `\n数组项：${contract.item.field}[] 每项为 { ${Object.entries(contract.item.types || {}).map(([field, type]) => `${field}: ${type}`).join("；")} }${contract.item.optional?.length ? `；可选 ${contract.item.optional.join("、")}` : ""}` : "";
  const interfaceText = contract ? `输入：${contract.inputs.join("；")}\n输出对象：${outputFields}${itemFields}` : "输出：一份可审阅的阶段资源。";
  return {
    intent: "resource.create",
    prompt: `创作阶段：${kind}\n已有输入：${dependencies.join("、") || "由当前创作上下文决定"}\n用户要求：${instruction}\n本阶段交付：${stageWorkflow}\n资源接口：\n${interfaceText}\n只完成这个阶段；产出必须可供下一阶段使用。`,
  };
}

function createResource(input, ctx) {
  ensureSchema(ctx);
  const kind = String(input.kind || "").toLowerCase();
  if (!kind) throw new Error("resource kind is required");
  const contract = resourceContracts[kind];
  if (!contract) throw new Error(`unknown resource kind ${kind}`);
  if (!input.content || typeof input.content !== "object") throw new Error(`${kind} requires structured content`);
  validateResourceContent(kind, input.content);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const resource = { id, kind, title: String(input.title), content: input.content, dependencies: Array.isArray(input.dependencies) ? input.dependencies : [], createdAt: new Date().toISOString() };
  ctx.sqlite.execute("insert into resources (id, kind, title, content_json, dependencies_json, created_at, retired_at) values (?, ?, ?, ?, ?, ?, null)", [resource.id, resource.kind, resource.title, JSON.stringify(resource.content), JSON.stringify(resource.dependencies), resource.createdAt]);
  return ctx.artifacts.publish({ type: `recut.vox.${resource.kind.toLowerCase()}@1`, value: resource });
}

function listResources(_, ctx) {
  ensureSchema(ctx);
  purgeLegacyLooks(ctx);
  return ctx.sqlite.query("select id, kind, title, content_json, dependencies_json, created_at from resources where retired_at is null order by created_at desc").map((row) => ({ id: row.id, kind: row.kind, title: row.title, content: JSON.parse(row.content_json), dependencies: JSON.parse(row.dependencies_json), createdAt: row.created_at }));
}

function retireResource(input, ctx) {
  ensureSchema(ctx);
  const id = String(input.id || "").trim();
  if (!id) throw new Error("resource id is required");
  ctx.sqlite.execute("update resources set retired_at = ? where id = ?", [new Date().toISOString(), id]);
  return { id, retired: true };
}

function deleteResource(input, ctx) {
  ensureSchema(ctx);
  const id = String(input.id || "").trim();
  if (!id) throw new Error("resource id is required");
  const dependents = ctx.sqlite.query("select title, dependencies_json from resources where retired_at is null and id != ?", [id]).filter((row) => JSON.parse(row.dependencies_json).includes(id));
  if (dependents.length) throw new Error(`无法删除：仍被“${dependents[0].title}”引用。请先处理下游资源。`);
  ctx.sqlite.execute("delete from resources where id = ?", [id]);
  return { id, deleted: true };
}

recut.operation.register("brief.create", createBrief);
recut.operation.register("brief.latest", latestBrief);
recut.operation.register("workflow.context", workflowContext);
recut.operation.register("resource.prepare", prepareResource);
recut.operation.register("resource.create", createResource);
recut.operation.register("resource.list", listResources);
recut.operation.register("resource.retire", retireResource);
recut.operation.register("resource.delete", deleteResource);
