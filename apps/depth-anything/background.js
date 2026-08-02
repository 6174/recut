/*
 * [INPUT]: 依赖 ctx.sqlite 保存运行记录，ctx.media 复制/显式导入素材，ctx.files 生成私有预览 URL，ctx.python 与 ctx.shell 执行可观察本地任务
 * [OUTPUT]: 注册环境检查、模型安装、深度生成、预览历史与用户确认入库 operation
 * [POS]: depth-anything 的唯一业务后端；输出先停留在 App 文件沙箱，绝不在生成时自动创建素材库 Asset
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

const MODELS = { small: "vits", base: "vitb", large: "vitl" };
const KINDS = new Set(["image", "video"]);
const STYLES = new Set(["color", "grayscale"]);

function value(input, name) { return String(input[name] || "").trim(); }
function model(input) { const selected = value(input, "model"); if (!MODELS[selected]) throw new Error("model must be small, base, or large"); return selected; }
function outputID() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function ensureSchema(ctx) {
  ctx.sqlite.execute("create table if not exists depth_outputs (id text primary key, asset_id text not null, kind text not null, model text not null, style text not null, file_path text not null, mime_type text not null, saved_asset_id text not null default '', created_at text not null)");
}

function parseProcess(result) {
  const lines = String(result.stdout || "").trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1] || "{}";
  let payload;
  try { payload = JSON.parse(last); } catch (_) { payload = { ready: false, error: String(result.stdout || result.error || "Python did not return a status payload.") }; }
  if (Number(result.exitCode) !== 0) payload.error = payload.error || String(result.stdout || result.error || "Python process failed.");
  return payload;
}

function run(ctx, args, timeoutSeconds) {
  return parseProcess(ctx.shell.exec({ command: "python3", args: ["python/depth_runner.py", ...args], environment: "depth-anything-v2", timeoutSeconds }));
}

function status(_, ctx) {
  const environment = ctx.python.status();
  if (!environment.ready) return { ready: false, pending: true, installedModels: [], modelsRoot: "~/.recut/models/depth-anything-v2", error: environment.error || "" };
  return run(ctx, ["status"], 20);
}

function prepare(_, ctx) {
  return { job: ctx.python.prepare() };
}

function install(input, ctx) {
  const selected = model(input);
  return { job: ctx.python.run(["python/depth_runner.py", "install", "--model", selected]) };
}

function generate(input, ctx) {
  ensureSchema(ctx);
  const assetID = value(input, "assetId");
  const kind = value(input, "kind");
  const selected = model(input);
  const style = value(input, "style");
  if (!assetID || !KINDS.has(kind) || !STYLES.has(style)) throw new Error("assetId, kind, model and style are required");
  const source = ctx.media.materialize(assetID);
  if (source.kind !== kind) throw new Error(`Selected Asset is ${source.kind}, not ${kind}.`);
  const id = outputID();
  const extension = kind === "image" ? "png" : "mp4";
  const path = `outputs/${id}.${extension}`;
  const output = { id, assetId: assetID, kind, model: selected, style, filePath: path, mimeType: kind === "image" ? "image/png" : "video/mp4", savedAssetId: "", createdAt: new Date().toISOString() };
  const job = ctx.python.run(["python/depth_runner.py", "infer", "--model", selected, "--style", style, "--kind", kind, "--input", source.path, "--output", path]);
  ctx.sqlite.execute("insert into depth_outputs (id, asset_id, kind, model, style, file_path, mime_type, saved_asset_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", [output.id, output.assetId, output.kind, output.model, output.style, output.filePath, output.mimeType, output.savedAssetId, output.createdAt]);
  return { job, output: { ...output, previewURL: "" } };
}

function present(output, ctx) { return { ...output, previewURL: ctx.files.url(output.filePath) }; }

function list(_, ctx) {
  ensureSchema(ctx);
  return ctx.sqlite.query("select id, asset_id, kind, model, style, file_path, mime_type, saved_asset_id, created_at from depth_outputs order by created_at desc").map((row) => present({ id: row.id, assetId: row.asset_id, kind: row.kind, model: row.model, style: row.style, filePath: row.file_path, mimeType: row.mime_type, savedAssetId: row.saved_asset_id, createdAt: row.created_at }, ctx));
}

function complete(input, ctx) {
  ensureSchema(ctx);
  const id = value(input, "id");
  const rows = ctx.sqlite.query("select id, asset_id, kind, model, style, file_path, mime_type, saved_asset_id, created_at from depth_outputs where id = ?", [id]);
  if (!rows.length) throw new Error("Depth output was not found.");
  const row = rows[0];
  return present({ id: row.id, assetId: row.asset_id, kind: row.kind, model: row.model, style: row.style, filePath: row.file_path, mimeType: row.mime_type, savedAssetId: row.saved_asset_id, createdAt: row.created_at }, ctx);
}

function save(input, ctx) {
  ensureSchema(ctx);
  const id = value(input, "id");
  const rows = ctx.sqlite.query("select id, kind, file_path, mime_type, saved_asset_id from depth_outputs where id = ?", [id]);
  if (!rows.length) throw new Error("Depth output was not found.");
  const output = rows[0];
  if (!output.saved_asset_id) {
    const asset = ctx.media.importFile({ path: output.file_path, name: `depth-${output.id}.${output.kind === "image" ? "png" : "mp4"}`, mimeType: output.mime_type });
    ctx.sqlite.execute("update depth_outputs set saved_asset_id = ? where id = ?", [asset.id, output.id]);
    output.saved_asset_id = asset.id;
  }
  return { id: output.id, assetId: output.saved_asset_id };
}

recut.operation.register("depth.status", status);
recut.operation.register("depth.prepare", prepare);
recut.operation.register("depth.install", install);
recut.operation.register("depth.generate", generate);
recut.operation.register("depth.list", list);
recut.operation.register("depth.complete", complete);
recut.operation.register("depth.save", save);
