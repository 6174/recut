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
    const invalid = String(row.kind).toLowerCase() === "look" && (!content || !content.assetId || !content.prompt);
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

function prepareResource(input, ctx) {
  const kind = String(input.kind || "").trim();
  if (!kind) throw new Error("resource kind is required");
  const dependencies = Array.isArray(input.dependencies) ? input.dependencies : [];
  const instruction = String(input.instruction || "无额外要求");
  const brief = latestBrief({}, ctx);
  const stageWorkflow = {
    brief: "content 使用 { topic, premise, direction }，这是供人审阅的短文本简报。",
    beats: "content 使用 { hook, narrative, beats: [{ title, description, duration }] }，每个 beat 是一张可读的叙事卡。",
    look: `
「视觉风格」不是 JSON 文案。先基于 Brief 起草 3 个可区分的风格候选；对每个候选依次执行：
1. 调用 recut.media.configuration，确认当前已配置的图片模型与输入契约。
2. 调用 recut.media.generate（capability: image.generate）生成一张 16:9 风格参考图；生成图只用于定义后续画面语言，不要在图中放可读正文、Logo 或水印。
3. 用 recut.media.get_job 轮询至 completed，取得 assetIds；失败则如实报告，不要创建没有图片的 Look。
4. 对每张成功的图片调用 recut.vox-broll.create_resource，kind 固定为 Look。content 必须是：
   { assetId, prompt, definition, palette, paperTechnique, typeTreatment, texture, mood }
   其中 assetId 是生成图的 assetId；prompt 是逐字保存的生成提示词；其余字段只作简短辅助说明。标题要能区分候选。
完成后停下，等待用户在视觉风格中选择；不要继续创建关键画面或动效。
`,
    keyframes: "content 使用 { keyframes: [{ title, composition, headline, layers, imageAssetId? }] }。镜头有参考图时保存 imageAssetId；没有图时只保存可读的构图、标题和层次，不要把 JSON 作为用户输出。",
    motion: "content 使用 { camera, motion, shots: [{ title, motion, duration, videoAssetId? }] }。有预览视频时保存 videoAssetId，否则以镜头动效卡表达。",
    audio: "content 使用 { narration, music, captions, mix, audioAssetId? }。有已生成的声音时保存 audioAssetId，文本只描述听觉方案。",
    delivery: "content 使用 { aspectRatio, duration, format, export, checklist: [{ title, description }] }，以交付字段与核对清单表达。",
  }[kind.toLowerCase()] || "content 必须是面向审阅的短字段或条目，不要把内部 JSON 作为用户输出。";
  return {
    intent: "resource.create",
    prompt: `你正在 Recut 的 Vox B-roll 项目中创建「${kind}」资源。\n当前 Brief：${brief ? JSON.stringify(brief) : "尚未创建"}。\n用户选择的依赖资源：${dependencies.join("、") || "无"}。\n额外要求：${instruction}。\n资源表达契约：${stageWorkflow}\n完成创作后必须调用 recut.vox-broll.create_resource，传入 kind、title、content、dependencies。不要直接写文件。`,
  };
}

function createResource(input, ctx) {
  ensureSchema(ctx);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const resource = { id, kind: String(input.kind), title: String(input.title), content: input.content, dependencies: Array.isArray(input.dependencies) ? input.dependencies : [], createdAt: new Date().toISOString() };
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

recut.api.register("brief.create", createBrief);
recut.api.register("brief.latest", latestBrief);
recut.api.register("resource.prepare", prepareResource);
recut.api.register("resource.list", listResources);
recut.api.register("resource.retire", retireResource);
recut.api.register("resource.delete", deleteResource);
recut.mcp.register("generate_brief", createBrief);
recut.mcp.register("create_resource", createResource);
recut.mcp.register("retire_resource", retireResource);
recut.mcp.register("delete_resource", deleteResource);
