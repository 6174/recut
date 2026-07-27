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

function purgeInvalidMediaResources(ctx) {
  const marker = ctx.sqlite.query("select value from app_meta where key = ?", ["invalid-media-resource-purge-v2"]);
  if (marker.length) return;
  const rows = ctx.sqlite.query("select id, kind, content_json from resources where retired_at is null");
  rows.forEach((row) => {
    const content = JSON.parse(row.content_json);
    const kind = String(row.kind).toLowerCase();
    const media = content?.media;
    const scenes = Array.isArray(content?.scenes) ? content.scenes : [];
    const invalidLook = kind === "look" && (!media || !media.assetId || !media.text);
    const invalidAudio = kind === "audio" && (!scenes.length || scenes.some((scene) => !scene?.audio?.assetId));
    const invalid = invalidLook || invalidAudio;
    if (invalid) ctx.sqlite.execute("delete from resources where id = ?", [row.id]);
  });
  ctx.sqlite.execute("insert into app_meta (key, value) values (?, ?)", ["invalid-media-resource-purge-v2", new Date().toISOString()]);
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
    item: { field: "keyframes", required: ["beatId", "title", "composition", "headline", "layers", "image"], types: { beatId: "string", title: "string", composition: "string", headline: "string", layers: "string[]" }, media: { field: "image", requiredAsset: true } },
  },
  audio: {
    inputs: ["approved beats", "keyframes"],
    output: { scenes: "AudioScene[]" },
    item: { field: "scenes", required: ["beatId", "narration", "music", "soundEffects", "captions", "durationSec", "audio"], types: { beatId: "string", narration: "string", music: "string", soundEffects: "string", captions: "string", durationSec: "number" }, media: { field: "audio", requiredAsset: true } },
  },
  scenes: {
    inputs: ["selected look", "keyframes", "approved audio"],
    output: { beatId: "string", title: "string", durationSec: "number", visualAction: "string", cutPoint: "string", video: "MediaSnapshot" },
    media: { field: "video", requiredAsset: true },
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
  const missing = Object.entries(mediaSnapshotContract).filter(([field, type]) => field !== "assetId" && (snapshot[field] === undefined || snapshot[field] === null || (type === "string" && snapshot[field] === ""))).map(([field]) => field);
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
  purgeInvalidMediaResources(ctx);
  const resources = listResources({}, ctx);
  const byKind = Object.fromEntries(stageOrder.map((kind) => [kind, resources.filter((item) => String(item.kind).toLowerCase() === kind)]));
  const storedBrief = latestBrief({}, ctx);
  if (storedBrief && byKind.brief.length === 0) byKind.brief = [{ id: storedBrief.id, kind: "brief", title: storedBrief.title, content: storedBrief, dependencies: [], createdAt: storedBrief.createdAt }];
  const latest = (kind) => byKind[kind][0] || null;
  const brief = latest("brief");
  const beats = latest("beats");
  const look = latest("look");
  const audio = latest("audio");
  const keyframes = latest("keyframes");
  const audioScenes = Array.isArray(audio?.content?.scenes) ? audio.content.scenes : [];
  const completedSceneBeatIDs = new Set(byKind.scenes.map((item) => item.content?.beatId).filter((id) => typeof id === "string"));
  const pendingSceneTargets = audioScenes.filter((scene) => scene?.beatId && !completedSceneBeatIDs.has(scene.beatId)).map((scene) => ({ beatId: scene.beatId, narration: scene.narration, durationSec: scene.durationSec, audio: scene.audio, keyframe: Array.isArray(keyframes?.content?.keyframes) ? keyframes.content.keyframes.find((frame) => frame?.beatId === scene.beatId)?.image : null }));
  const stage = !latest("brief") ? "brief" : !latest("beats") ? "beats" : !latest("look") ? "look" : !latest("keyframes") ? "keyframes" : !latest("audio") ? "audio" : pendingSceneTargets.length ? "scenes" : !latest("delivery") ? "delivery" : "delivery";
  return {
    revision: `${resources.length}:${resources[0]?.createdAt || "empty"}`,
    stage,
    nextAction: stage === "delivery" && latest("delivery") ? "review_delivery" : `create_${stage}`,
    gates: { beatsReady: Boolean(beats), lookReady: Boolean(look) },
    inputs: { brief, beats, look, keyframes, audio },
    resourceContracts,
    mediaSnapshotContract,
    resources: Object.fromEntries(stageOrder.map((kind) => [kind, byKind[kind].map((item) => ({ id: item.id, title: item.title, createdAt: item.createdAt }))])),
    allowedActions: stage === "delivery" && latest("delivery") ? ["review_delivery"] : [`create_${stage}`],
   pendingSceneTargets,
    mediaExecution: {
      keyframes: { kind: "platform-media-generation", generate: "recut.image.generate", complete: "assetId" },
      audio: { kind: "platform-media-generation", generate: "recut.speech.generate_async", complete: "accepted -> queued assetIds[0] -> resource.create; Daemon updates Asset status" },
      scenes: { kind: "platform-media-generation", generate: "recut.video.generate_async", complete: "accepted -> queued assetIds[0] -> resource.create; Daemon updates Asset status; for Seedance use output.generateAudio=true unless the user explicitly requests silent video", alternatives: "Use a composition extension only when the user explicitly requests that composition; do not substitute it for generated video." },
    },
   inFlight: null,
  };
}

function prepareResource(input, ctx) {
  const kind = String(input.kind || "").trim();
  if (!kind) throw new Error("resource kind is required");
  const dependencies = Array.isArray(input.dependencies) ? input.dependencies : [];
  const instruction = String(input.instruction || "无额外要求");
  const sceneTargets = (() => {
    if (kind.toLowerCase() !== "scenes") return [];
    const resources = listResources({}, ctx);
    const audio = resources.find((item) => item.kind === "audio");
    const keyframes = resources.find((item) => item.kind === "keyframes");
    const completed = new Set(resources.filter((item) => item.kind === "scenes").map((item) => item.content?.beatId));
    return (audio?.content?.scenes || []).filter((scene) => scene?.beatId && !completed.has(scene.beatId)).map((scene) => ({ beatId: scene.beatId, narration: scene.narration, durationSec: scene.durationSec, audio: scene.audio, keyframe: (keyframes?.content?.keyframes || []).find((frame) => frame?.beatId === scene.beatId)?.image }));
  })();
  const batch = /全部|所有|一次生成|all/i.test(instruction);
  const stageWorkflow = {
    brief: "一份短而明确的创作简报：主题、受众、论点、核心张力与编辑方向。",
    beats: "一个可审阅的叙事弧：三秒钩子、逐段节拍、每段的观众理解与画面证据。",
    look: "3 个明显不同的视觉方向。每个方向都需要一张 16:9 风格参考图和原始画面描述；图里不要有可读正文、Logo 或水印。完成后停下，等待选择。",
    keyframes: "每个节拍一张关键画面：先用 recut.image.generate 逐张生成并拿到完成的图片 assetId，再保存。每个 keyframes[] 项的 image 必须是完整 MediaSnapshot，image.assetId 指向该节拍的新图；text 是该图的原始提示词；imageAssetIds 引用选定 Look 的参考图；audioAssetIds 为空数组；sourceResourceIds 记录对应 Beat 和 Look。绝不把文字画面描述当成关键画面保存。",
    audio: "每个场景都必须先生成真实可播放的旁白：从 recut.project_context.media.defaultRoutes 找到 speech.generate 的 credentialId，调用 recut.media.list_voices 取得 voiceId；逐段调用 recut.speech.generate_async 后立即取得稳定 assetId 并保存 scenes[]。每项 audio 必须是完整 MediaSnapshot：assetId 为刚提交的音频，text 为旁白原文，imageAssetIds/audioAssetIds 为空数组，sourceResourceIds 记录对应 Beat 与 Keyframe。Daemon 会原位更新状态；只有音频已完成时才可将它作为场景视频输入。音乐和音效可以是编辑指令，但不能替代旁白音频。生成失败时不得保存空 Audio 资源，应如实报告。",
    scenes: `视频生成昂贵，默认只生成第一段并停下等待用户确认。${batch ? "用户已明确要求一次生成全部剩余段；逐段生成，但每段必须独立调用 resource.create，绝不能合并为一个含多段的 Scene resource。" : "不要循环生成其余段，不要合并为一个含多段的 Scene resource。"} 执行顺序不可替换：先调用 recut.video.generate_async，传入该段 keyframe.assetId 与已完成 audio.assetId；若 Route 使用 Seedance，output.generateAudio 默认为 true，只有用户明确要求无声视频才传 false；Gemini 不传此字段。提交响应会带稳定 assetIds[0]，立刻调用 resource.create 保存独立 Scene resource，不能等待轮询完成。recut.media.get_job 只用于读取并报告该 Asset 的 queued/running/completed/failed 状态。禁止使用 HyperFrames、ffmpeg、浏览器自动化、终端脚本或本地渲染替代该 API 调用。顶层字段为 beatId、title、durationSec、visualAction、cutPoint、video；video 必须是完整 MediaSnapshot 且 assetId 指向刚提交的视频。`,
    delivery: "最终时间线、画幅、时长、格式和可执行的导出前检查表。",
  }[kind.toLowerCase()] || "一份面向审阅的清晰创作产出。";
  const contract = resourceContracts[kind.toLowerCase()];
  const outputFields = contract ? Object.entries(contract.output).map(([field, type]) => `${field}: ${type}`).join("；") : "一份可审阅的阶段资源";
  const itemFields = contract?.item ? `\n数组项：${contract.item.field}[] 每项为 { ${Object.entries(contract.item.types || {}).map(([field, type]) => `${field}: ${type}`).join("；")} }${contract.item.optional?.length ? `；可选 ${contract.item.optional.join("、")}` : ""}` : "";
 const interfaceText = contract ? `输入：${contract.inputs.join("；")}\n输出对象：${outputFields}${itemFields}` : "输出：一份可审阅的阶段资源。";
  const executionMethod = kind.toLowerCase() === "scenes" ? "这是平台视频生成任务：recut.video.generate_async 成功提交后立刻用返回的 queued assetIds[0] 调用 resource.create；常驻 Daemon 原位更新状态。除非用户明确要求 HyperFrames，否则不要把它解释为 HyperFrames 合成任务。" : kind.toLowerCase() === "keyframes" ? "这是平台图片生成任务：调用 recut.image.generate。" : kind.toLowerCase() === "audio" ? "这是平台语音生成任务：调用 recut.speech.generate_async 后立刻保存返回的稳定 assetId；Daemon 原位更新状态。" : "遵循当前阶段契约。";
 return {
    intent: "resource.create",
    prompt: `创作阶段：${kind}\n执行方式：${executionMethod}\n已有输入：${dependencies.join("、") || "由当前创作上下文决定"}\n用户要求：${instruction}\n${sceneTargets.length ? `待生成场景（默认只取第一项）：${JSON.stringify(batch ? sceneTargets : sceneTargets.slice(0, 1))}\n` : ""}本阶段交付：${stageWorkflow}\n资源接口：\n${interfaceText}\n只完成这个阶段；产出必须可供下一阶段使用。`,
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

function resourceByID(id, ctx) {
  const rows = ctx.sqlite.query("select id, kind, title, content_json, dependencies_json, created_at from resources where id = ? and retired_at is null", [id]);
  if (!rows.length) throw new Error(`resource ${id} was not found`);
  const row = rows[0];
  return { id: row.id, kind: row.kind, title: row.title, content: JSON.parse(row.content_json), dependencies: JSON.parse(row.dependencies_json), createdAt: row.created_at };
}

function readResource(input, ctx) {
  ensureSchema(ctx);
  const id = String(input.id || "").trim();
  if (!id) throw new Error("resource id is required");
  return resourceByID(id, ctx);
}

function findItemIndex(items, match) {
  if (!Array.isArray(items)) return -1;
  const id = String(match?.id || "").trim();
  const beatID = String(match?.beatId || "").trim();
  if (!id && !beatID) throw new Error("item.match requires id or beatId");
  return items.findIndex((item) => item && typeof item === "object" && (!id || item.id === id) && (!beatID || item.beatId === beatID));
}

function updateResource(input, ctx) {
  ensureSchema(ctx);
  const id = String(input.id || "").trim();
  if (!id) throw new Error("resource id is required");
  const resource = resourceByID(id, ctx);
  const contentPatch = input.contentPatch && typeof input.contentPatch === "object" && !Array.isArray(input.contentPatch) ? input.contentPatch : null;
  const itemPatch = input.itemPatch && typeof input.itemPatch === "object" && !Array.isArray(input.itemPatch) ? input.itemPatch : null;
  if (!contentPatch && !itemPatch && !String(input.title || "").trim()) throw new Error("resource.update requires title, contentPatch, or itemPatch");
  const content = JSON.parse(JSON.stringify(resource.content));
  if (contentPatch) Object.assign(content, contentPatch);
  if (itemPatch) {
    const collection = String(itemPatch.collection || "").trim();
    const patch = itemPatch.patch;
    if (!collection || !patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("itemPatch requires collection and object patch");
    const index = findItemIndex(content[collection], itemPatch.match);
    if (index < 0) throw new Error(`no matching item in ${collection}`);
    content[collection][index] = { ...content[collection][index], ...patch };
  }
  validateResourceContent(resource.kind, content);
  const title = String(input.title || "").trim() || resource.title;
  ctx.sqlite.execute("update resources set title = ?, content_json = ? where id = ?", [title, JSON.stringify(content), id]);
  const updated = { ...resource, title, content };
  return ctx.artifacts.publish({ type: `recut.vox.${resource.kind.toLowerCase()}@1`, value: updated });
}

function listResources(_, ctx) {
  ensureSchema(ctx);
  purgeInvalidMediaResources(ctx);
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
recut.operation.register("resource.read", readResource);
recut.operation.register("resource.update", updateResource);
recut.operation.register("resource.list", listResources);
recut.operation.register("resource.retire", retireResource);
recut.operation.register("resource.delete", deleteResource);
