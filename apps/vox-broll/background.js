/*
 * [INPUT]: 依赖平台注入的 ctx.sqlite 与 ctx.artifacts capability
 * [OUTPUT]: 注册 B-roll brief 的 App API 与 MCP 工具处理器
 * [POS]: vox-broll 的唯一业务后端；数据表、文件和产物模型由本 App 自己定义
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

function ensureSchema(ctx) {
  ctx.sqlite.execute(
    "create table if not exists briefs (id text primary key, topic text not null, title text not null, body text not null, created_at text not null)",
  );
  ctx.sqlite.execute("create table if not exists resources (id text primary key, kind text not null, title text not null, content_json text not null, dependencies_json text not null, created_at text not null)");
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
  return {
    intent: "resource.create",
    prompt: `你正在 Recut 的 Vox B-roll 项目中创建「${kind}」资源。\n当前 Brief：${brief ? JSON.stringify(brief) : "尚未创建"}。\n用户选择的依赖资源：${dependencies.join("、") || "无"}。\n额外要求：${instruction}。\n完成创作后必须调用 recut.vox-broll.create_resource，传入 kind、title、content、dependencies。不要直接写文件。`,
  };
}

function createResource(input, ctx) {
  ensureSchema(ctx);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const resource = { id, kind: String(input.kind), title: String(input.title), content: input.content, dependencies: Array.isArray(input.dependencies) ? input.dependencies : [], createdAt: new Date().toISOString() };
  ctx.sqlite.execute("insert into resources (id, kind, title, content_json, dependencies_json, created_at) values (?, ?, ?, ?, ?, ?)", [resource.id, resource.kind, resource.title, JSON.stringify(resource.content), JSON.stringify(resource.dependencies), resource.createdAt]);
  return ctx.artifacts.publish({ type: `recut.vox.${resource.kind.toLowerCase()}@1`, value: resource });
}

function listResources(_, ctx) {
  ensureSchema(ctx);
  return ctx.sqlite.query("select id, kind, title, content_json, dependencies_json, created_at from resources order by created_at desc").map((row) => ({ id: row.id, kind: row.kind, title: row.title, content: JSON.parse(row.content_json), dependencies: JSON.parse(row.dependencies_json), createdAt: row.created_at }));
}

recut.api.register("brief.create", createBrief);
recut.api.register("brief.latest", latestBrief);
recut.api.register("resource.prepare", prepareResource);
recut.api.register("resource.list", listResources);
recut.mcp.register("generate_brief", createBrief);
recut.mcp.register("create_resource", createResource);
