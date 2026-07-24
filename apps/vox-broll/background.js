/*
 * [INPUT]: 依赖平台注入的 ctx.sqlite、ctx.files 与 ctx.artifacts capability
 * [OUTPUT]: 注册 B-roll brief 的 App API 与 MCP 工具处理器
 * [POS]: vox-broll 的唯一业务后端；数据表、文件和产物模型由本 App 自己定义
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

function ensureSchema(ctx) {
  ctx.sqlite.execute(
    "create table if not exists briefs (id text primary key, topic text not null, title text not null, body text not null, created_at text not null)",
  );
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
  ctx.files.writeText(`briefs/${id}.json`, JSON.stringify(brief, null, 2));
  return ctx.artifacts.publish({ type: "recut.vox.brief@1", value: brief });
}

function latestBrief(_, ctx) {
  ensureSchema(ctx);
  const rows = ctx.sqlite.query("select body from briefs order by created_at desc limit 1");
  return rows.length ? JSON.parse(rows[0].body) : null;
}

recut.api.register("brief.create", createBrief);
recut.api.register("brief.latest", latestBrief);
recut.mcp.register("generate_brief", createBrief);
