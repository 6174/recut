/*
 * [INPUT]: 依赖 ctx.sqlite 保存生成记录/任务账本/下载源，ctx.app.readText 读取 python/registry.json（由
 *          comfyuiapps/*\/manifest.json 生成的静态注册表），ctx.media 复制参考素材与导入产物，ctx.files
 *          生成私有预览 URL / 写 params 文件，ctx.python 与 ctx.shell 执行可观察本地任务（prepare 全量走
 *          ctx.python.prepare；定向走 bootstrap.py --target，但主 venv 未就绪时先回退平台全量准备；
 *          generate/install 走 ctx.python.run(studio_runner.py ...)）
 * [OUTPUT]: 注册环境检查（comfy.status，含在途任务）、工作流目录（comfy.catalog：静态注册表 + 动态就绪度）、
 *          环境准备（comfy.prepare target: all|comfyui|<appId>，收尾起 ComfyUI 引擎）、下载源设置
 *          （comfy.settings.set）、权重下载（comfy.install，huggingface/modelscope/automatic）、引擎控制
 *          （comfy.engine.status/start/ensure/stop；ensure 幂等，供 AI/background 操作）、本机生成
 *          （comfy.generate {app, params}，单槽 FIFO）、历史与入库（comfy.generations / comfy.generation.complete /
 *          comfy.save）、任务中心（comfy.tasks.list/get/params/logs/cancel）与取消（comfy.cancel）。
 * [POS]: comfyui-studio 的唯一业务后端；manifest contributes.media 声明 local-gen provider，平台经
 *        comfy.generate/comfy.save 能力桥调用本 App 完成本机 ComfyUI 工作流生成。切换单位是「工作流(app)」
 *        而非模型；generate 接受任意 params。任务并发：推理（generate）单槽 FIFO，环境准备（prepare）单槽
 *        等推理排空，模型下载（install）不限并行；提交永不拒绝，占槽入队。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

const DOWNLOAD_SOURCES = new Set(["automatic", "huggingface", "modelscope"]);
const ACTIONS = new Set(["prepare", "install", "generate", "engine"]);
const PREPARE_TARGETS = new Set(["all", "comfyui"]);
const INFER_ACTIONS = new Set(["generate"]);
const RECORD_TABLES = { generate: "comfy_generations" };
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const GENERATION_KINDS = new Set(["image", "video", "audio"]);

// registry.json 的内置兜底（静态工作流清单；正常从 ctx.app.readText("python/registry.json") 读取，
// 由 python/publish_registry.py 生成保持一致）。
const REGISTRY_FALLBACK = {
  runtimes: [{ id: "comfyui", label: { zh: "ComfyUI（共享运行时）", en: "ComfyUI (shared runtime)" }, venv: "comfyui" }],
  apps: [{
    id: "qwen-image-2.1", capability: "image.generate", runtime: "comfyui", exposeModel: "qwen-image",
    label: { zh: "Qwen-Image-2.1 · 本机文生图/编辑（int8）", en: "Qwen-Image-2.1 · Local t2i/edit (int8)" },
    output: { kind: "image", mimeType: "image/png", ext: "png" },
    inputModes: ["text", "image"],
    formSchema: [
      { key: "prompt", type: "textarea", required: true, label: { zh: "提示词", en: "Prompt" } },
      { key: "negativePrompt", type: "textarea", label: { zh: "负向词", en: "Negative prompt" } },
      { key: "aspectRatio", type: "select", options: ["1:1", "16:9", "9:16", "4:3", "3:4"], default: "1:1" },
      { key: "steps", type: "number", default: 10, min: 1, max: 100 },
      { key: "cfg", type: "number", default: 1.0, min: 0, max: 20 },
      { key: "seed", type: "number", default: -1 }
    ],
    defaultParams: { aspectRatio: "1:1", steps: 10, cfg: 1.0, negativePrompt: " " },
    weights: { huggingFace: "Comfy-Org/Qwen-Image-2.1", modelScope: "Comfy-Org/Qwen-Image-2.1", revision: "main", sizeGb: 17 }
  }]
};

function value(input, name) { return String(input[name] || "").trim(); }
function outputID() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function locale(ctx) { return String(ctx?.locale || "").toLowerCase() === "en" ? "en" : "zh"; }
function tr(ctx, zh, en) { return locale(ctx) === "en" ? en : zh; }
function taskLogPath(taskID) { return `tasks/${taskID}.log`; }
function taskParamsPath(taskID) { return `tasks/${taskID}.params.json`; }

function readRegistry(ctx) {
  try {
    const raw = ctx.app.readText("python/registry.json");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.apps) && parsed.apps.length) return parsed;
  } catch (_) { /* fall through */ }
  return REGISTRY_FALLBACK;
}

function appDef(registry, id) { return (registry.apps || []).find((a) => a.id === id) || null; }
function appByExposeModel(registry, model) { return (registry.apps || []).find((a) => a.exposeModel === model) || null; }

// 解析生成目标：优先 app（工作流 id），否则按平台模型简单名（exposeModel）回退（平台执行桥兼容）。
function resolveApp(registry, input) {
  const id = value(input, "app");
  if (id) return appDef(registry, id);
  const model = value(input, "model");
  if (model) return appByExposeModel(registry, model);
  return null;
}

function outputExt(app) { return (app.output && app.output.ext) || "png"; }
function outputKind(app) { return (app.output && app.output.kind) || "image"; }
function outputMime(app) { return (app.output && app.output.mimeType) || "image/png"; }

// 由 action + meta 渲染列表展示名。
function taskName(action, meta) {
  const m = meta || {};
  if (action === "generate") return `生成：${m.label || m.app || ""}${m.prompt ? " · " + m.prompt : ""}`.trim();
  if (action === "install") return `下载模型：${m.label || m.app || ""}`.trim();
  if (action === "prepare") return "准备运行环境";
  if (action === "engine") return "启动 ComfyUI 引擎";
  return action;
}

function shellJobID(job) { return String(job.id || job.ID || "").trim(); }
function shellJobStatus(job) { return String(job.status || job.Status || "").trim(); }
function shellJobError(job) { return String(job.error || job.Error || "").trim(); }
function isActiveJob(status) { return ACTIVE_JOB_STATUSES.has(status); }
function isTerminalJob(status) { return TERMINAL_JOB_STATUSES.has(status); }
function outputStatus(status) { return status === "completed" ? "completed" : "failed"; }

function ensureSchema(ctx) {
  ctx.sqlite.execute("create table if not exists comfy_generations (id text primary key, app text not null, model text not null default '', runtime text not null default '', capability text not null default 'image.generate', output_kind text not null default 'image', mime_type text not null default 'image/png', params_json text not null default '{}', prompt text not null default '', reference_asset_ids text not null default '', output_path text not null, width integer not null default 0, height integer not null default 0, duration real not null default 0, saved_asset_id text not null default '', created_at text not null, job_id text not null default '', status text not null default 'queued', error text not null default '')");
  ctx.sqlite.execute("create table if not exists comfy_tasks (id text primary key, shell_job_id text not null default '', action text not null, record_id text not null default '', source text not null default 'manual', submitted_by text not null default '', state text not null default 'queued', progress integer not null default 0, meta_json text not null default '{}', payload_json text not null default '', log_path text not null default '', error text not null default '', created_at text not null, started_at text not null default '', resolved_at text not null default '')");
  ctx.sqlite.execute("create index if not exists comfy_tasks_created on comfy_tasks(created_at desc)");
  ctx.sqlite.execute("create index if not exists comfy_tasks_active on comfy_tasks(state)");
  ctx.sqlite.execute("create table if not exists comfy_settings (key text primary key, value text not null)");
  ctx.sqlite.execute("create table if not exists comfy_env_error (id integer primary key check (id = 1), job_id text not null, action text not null, error text not null, logs text not null, updated_at text not null)");
}

function downloadSource(ctx) {
  ensureSchema(ctx);
  const rows = ctx.sqlite.query("select value from comfy_settings where key = 'download_source'");
  return DOWNLOAD_SOURCES.has(rows[0]?.value) ? rows[0].value : "automatic";
}
function setDownloadSource(ctx, source) {
  if (!DOWNLOAD_SOURCES.has(source)) throw new Error("download source must be automatic, huggingface or modelscope");
  ctx.sqlite.execute("insert into comfy_settings (key, value) values ('download_source', ?) on conflict(key) do update set value = excluded.value", [source]);
}

// 同步调用主 venv 的 studio_runner.py（环境/目录/引擎查询）。
function run(ctx, args, timeoutSeconds) {
  const shell = '"$RECUT_PYTHON" python/studio_runner.py "$@"';
  const result = ctx.shell.exec({ command: "sh", args: ["-eu", "-c", shell, "comfy-runner", ...args], environment: "comfyui-studio", timeoutSeconds });
  const lines = String(result.stdout || "").trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1] || "{}";
  let payload;
  try { payload = JSON.parse(last); }
  catch (_) { payload = { ready: false, error: String(result.stdout || result.error || tr(ctx, "Python 未返回状态数据。", "Python did not return a status payload.")) }; }
  if (Number(result.exitCode) !== 0) payload.error = payload.error || String(result.stdout || result.error || tr(ctx, "Python 进程执行失败。", "Python process failed."));
  return payload;
}

// 环境/引擎就绪度（主 venv 未就绪时直接返回未就绪，不拉起 runner）。
function envStatus(ctx) {
  ensureSchema(ctx);
  const environment = ctx.python.status();
  if (!environment.ready) return { ready: false, error: environment.error || tr(ctx, "Python 运行环境尚未就绪。", "The Python runtime is not ready yet."), runtimes: {}, apps: {} };
  try { return run(ctx, ["status"], 60); }
  catch (error) { return { ready: false, error: error instanceof Error ? error.message : String(error), runtimes: {}, apps: {} }; }
}

function buildCatalog(ctx) {
  const registry = readRegistry(ctx);
  const status = envStatus(ctx);
  const statusRuntimes = status.runtimes || {};
  const statusApps = status.apps || {};
  const runtimes = (registry.runtimes || []).map((r) => ({
    id: r.id, label: r.label || r.id, venv: r.venv || r.id,
    ready: !!(statusRuntimes[r.id] && statusRuntimes[r.id].ready),
    error: (statusRuntimes[r.id] && statusRuntimes[r.id].error) || ""
  }));
  const apps = (registry.apps || []).map((a) => {
    const st = statusApps[a.id] || {};
    const runtimeReady = !!(statusRuntimes[a.runtime] && statusRuntimes[a.runtime].ready);
    const installed = st.installed === true;
    return {
      app: a.id, model: a.exposeModel || a.id, capability: a.capability, runtime: a.runtime,
      label: a.label || a.id, output: a.output || { kind: "image", mimeType: "image/png", ext: "png" },
      inputModes: Array.isArray(a.inputModes) && a.inputModes.length ? a.inputModes : ["text"],
      formSchema: a.formSchema || [], defaultParams: a.defaultParams || {},
      ready: runtimeReady && installed,
      weight: { installed, sizeGb: st.sizeGb || (a.weights && a.weights.sizeGb) || 0, source: st.source || "", revision: (a.weights && a.weights.revision) || "" }
    };
  });
  // models 是 apps 的平台模型兼容投影（供 app_media_bridge 的动态就绪面按 exposeModel 匹配）。
  const models = apps.map((a) => ({ ...a, model: a.model }));
  return { ready: status.ready === true, error: status.error || "", runtimes, apps, models, downloadSource: downloadSource(ctx) };
}

// 按 formSchema 把原始表单值转换为 typed params（number→Number、boolean→Boolean；其余字符串）。
function coerceParams(app, raw) {
  const out = {};
  const schema = app.formSchema || [];
  for (const field of schema) {
    if (!field || !field.key || field.type === "media") continue;
    const value = raw[field.key];
    if (value === undefined || value === null || value === "") continue;
    if (field.type === "number") { const n = Number(value); out[field.key] = Number.isFinite(n) ? n : value; }
    else if (field.type === "boolean") out[field.key] = value === true || value === "true" || value === 1 || value === "1";
    else out[field.key] = value;
  }
  return out;
}

// ---------------------- 任务账本 ----------------------

function settleOutput(ctx, action, recordID, job) {
  const table = RECORD_TABLES[action];
  if (!table || !recordID || !isTerminalJob(job.status)) return;
  ctx.sqlite.execute(`update ${table} set status = ?, error = ? where id = ?`, [outputStatus(job.status), String(job.error || job.status || "failed"), recordID]);
}

// 生成完成后把 worker 写出的 <output>.meta.json（真实宽高/seed/步数/耗时）回填进记录。
function applyGenerationMeta(ctx, recordID) {
  if (!recordID) return;
  const rows = ctx.sqlite.query("select output_path from comfy_generations where id = ?", [recordID]);
  if (!rows.length) return;
  let raw = "";
  try { raw = ctx.files.readText(`${rows[0].output_path}.meta.json`); } catch (_) { return; }
  let meta;
  try { meta = JSON.parse(raw); } catch (_) { return; }
  const width = Number(meta.width) || 0;
  const height = Number(meta.height) || 0;
  const duration = Number(meta.duration) || 0;
  ctx.sqlite.execute("update comfy_generations set width = ?, height = ?, duration = ? where id = ?", [width, height, duration, recordID]);
}
function markFailed(ctx, action, recordID, error) {
  const table = RECORD_TABLES[action];
  if (!table || !recordID) return;
  ctx.sqlite.execute(`update ${table} set status = 'failed', error = ? where id = ?`, [error instanceof Error ? error.message : String(error), recordID]);
}

function closeTaskById(ctx, taskID, state, error) {
  ctx.sqlite.execute("update comfy_tasks set state = ?, error = ?, resolved_at = ? where id = ?", [state, error || "", new Date().toISOString(), taskID]);
}

function settleTaskRow(ctx, row) {
  const closeWith = (state, error) => {
    settleOutput(ctx, row.action, row.record_id, { status: state === "completed" ? "completed" : "failed", error: error || "" });
    if (state === "completed" && row.action === "generate") applyGenerationMeta(ctx, row.record_id);
    if (row.action === "prepare" || row.action === "install") noteEnvOutcome(ctx, row, { status: state, error: error || "" });
    const finalState = state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : state === "interrupted" ? "interrupted" : "failed";
    closeTaskById(ctx, row.id, finalState, error || "");
  };
  let job;
  try { job = ctx.shell.status(row.shell_job_id); }
  catch (error) { closeWith("interrupted", tr(ctx, `任务记录不可恢复：${error}`, `Task record cannot be recovered: ${error}`)); return; }
  const status = shellJobStatus(job);
  if (isActiveJob(status)) return;
  if (!isTerminalJob(status)) { closeWith("interrupted", tr(ctx, `任务状态不可恢复：${status || "empty"}`, `Task status cannot be recovered: ${status || "empty"}`)); return; }
  closeWith(status, shellJobError(job));
}

function settleAllJobs(ctx) {
  ensureSchema(ctx);
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, created_at from comfy_tasks where state in ('queued','running')");
  for (const row of rows) {
    if (row.state !== "running") continue;
    if (!row.shell_job_id) {
      const message = tr(ctx, "任务未能成功启动。", "The task did not start successfully.");
      ctx.sqlite.execute("update comfy_tasks set state = 'failed', error = ?, resolved_at = ? where id = ? and state = 'running' and shell_job_id = ''", [message, new Date().toISOString(), row.id]);
      markFailed(ctx, row.action, row.record_id, message);
      continue;
    }
    settleTaskRow(ctx, row);
  }
}

function parseTaskMeta(row) {
  try { return JSON.parse(row.meta_json || "{}"); } catch (_) { return {}; }
}

function buildJobSpec(ctx, action, row, payload) {
  const p = payload || {};
  const logPath = row.log_path || taskLogPath(row.id);
  if (action === "prepare") {
    const target = p.target || "all";
    if (target === "all") return { platformPrepare: true };
    // 定向准备（bootstrap.py --target）依赖主 venv 提供 python；主环境未就绪时先走平台全量准备，
    // 否则 ctx.python.run 会因主 venv 不存在直接失败。
    let environmentReady = false;
    try { environmentReady = ctx.python.status().ready === true; } catch (_) { environmentReady = false; }
    if (!environmentReady) return { platformPrepare: true };
    return { args: ["python/bootstrap.py", "--target", target, "--task-log", logPath] };
  }
  if (action === "install") {
    return { args: ["python/studio_runner.py", "install", "--app", p.app, "--source", p.source, "--task-log", logPath] };
  }
  if (action === "engine") {
    return { args: ["python/studio_runner.py", "engine", "start", "--task-log", logPath] };
  }
  if (action === "generate") {
    const args = ["python/studio_runner.py", "generate", "--app", p.app, "--output", `generations/${row.record_id}`, "--task-log", logPath];
    if (p.paramsPath) args.push("--params", p.paramsPath);
    for (const ref of (p.referencePaths || [])) args.push("--reference", ref);
    return { args };
  }
  throw new Error(`Unsupported queue task action: ${action}`);
}

function dispatchTask(ctx, row) {
  const now = new Date().toISOString();
  ctx.sqlite.execute("update comfy_tasks set state = 'running', started_at = ? where id = ? and state = 'queued'", [now, row.id]);
  let payload = {};
  try { payload = JSON.parse(row.payload_json || "{}"); } catch (_) { payload = {}; }
  try {
    const spec = buildJobSpec(ctx, row.action, row, payload);
    const job = spec.platformPrepare ? ctx.python.prepare() : ctx.python.run(spec.args);
    const shellID = shellJobID(job);
    if (!shellID) throw new Error(tr(ctx, "平台未返回任务 ID。", "The platform did not return a job id."));
    ctx.sqlite.execute("update comfy_tasks set shell_job_id = ? where id = ?", [shellID, row.id]);
    linkRecordJob(ctx, row.action, row.record_id, shellID);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task failed to start.";
    ctx.sqlite.execute("update comfy_tasks set state = 'failed', error = ?, resolved_at = ? where id = ?", [message, new Date().toISOString(), row.id]);
    markFailed(ctx, row.action, row.record_id, message);
  }
}

function linkRecordJob(ctx, action, recordID, shellID) {
  const table = RECORD_TABLES[action];
  if (!table || !recordID || !shellID) return;
  ctx.sqlite.execute(`update ${table} set job_id = ? where id = ?`, [shellID, recordID]);
}

// 队列引擎：结算 → 守卫派发（prepare 无推理在途；generate 无推理 running、无 prepare running）。
function pumpQueue(ctx) {
  ensureSchema(ctx);
  settleAllJobs(ctx);
  const actives = ctx.sqlite.query("select action, state from comfy_tasks where state in ('queued','running')");
  const inferAny = actives.some((row) => INFER_ACTIONS.has(row.action));
  const inferRunning = actives.some((row) => INFER_ACTIONS.has(row.action) && row.state === "running");
  const envRunning = actives.some((row) => row.action === "prepare" && row.state === "running");
  if (!inferAny) {
    const next = ctx.sqlite.query("select id, action, record_id, meta_json, payload_json, log_path from comfy_tasks where action = 'prepare' and state = 'queued' order by created_at asc limit 1");
    if (next.length) dispatchTask(ctx, next[0]);
  }
  if (!inferRunning && !envRunning) {
    const next = ctx.sqlite.query("select id, action, record_id, meta_json, payload_json, log_path from comfy_tasks where action = 'generate' and state = 'queued' order by created_at asc limit 1");
    if (next.length) dispatchTask(ctx, next[0]);
  }
}

function submitJob(ctx, { action, recordID = "", payload, meta, source, submittedBy, taskId, started = false }) {
  ensureSchema(ctx);
  const id = taskId || outputID();
  const now = new Date().toISOString();
  const state = started ? "running" : "queued";
  let metaJson = "{}";
  try { metaJson = JSON.stringify(meta || {}); } catch (_) { metaJson = "{}"; }
  let payloadJson = "";
  try { payloadJson = JSON.stringify(payload || {}); } catch (_) { payloadJson = ""; }
  ctx.sqlite.execute("insert into comfy_tasks (id, shell_job_id, action, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, '', ?, ?, ?, ?, ?, 0, ?, ?, ?, '', ?, ?, '')", [id, action, recordID, source === "ai" ? "ai" : "manual", submittedBy || "", state, metaJson, payloadJson, taskLogPath(id), now, started ? now : ""]);
  if (action === "prepare" || action === "install") clearEnvError(ctx);
  return id;
}

function cancelTaskRow(ctx, row) {
  if (row.state === "queued") {
    const error = tr(ctx, "已取消（尚未开始）。", "Cancelled before it started.");
    closeTaskById(ctx, row.id, "cancelled", error);
    const table = RECORD_TABLES[row.action];
    if (table && row.record_id) ctx.sqlite.execute(`update ${table} set status = 'failed', error = ? where id = ?`, [error, row.record_id]);
    return { cancelled: true, id: row.id };
  }
  if (row.state === "running" && row.shell_job_id) {
    try { ctx.shell.cancel(row.shell_job_id); } catch (_) { /* 平台已结算时忽略 */ }
    return { cancelled: true, id: row.id };
  }
  return { cancelled: false };
}

function toTaskSummary(task) {
  let meta = {};
  const raw = task.meta_json ?? task.meta;
  if (typeof raw === "string") { try { meta = JSON.parse(raw); } catch (_) { /* keep empty */ } }
  else if (raw && typeof raw === "object") { meta = raw; }
  return { id: task.id, action: task.action, name: taskName(task.action, meta), recordId: task.recordId || task.record_id || "", source: task.source, submittedBy: task.submittedBy || task.submitted_by || "", state: task.state, progress: task.progress, createdAt: task.createdAt || task.created_at, startedAt: task.startedAt || task.started_at || "", resolvedAt: task.resolvedAt || task.resolved_at || "", jobId: task.jobId || task.shell_job_id || "", error: task.error || "", meta };
}

function listTasks(ctx, input = {}) {
  ensureSchema(ctx);
  pumpQueue(ctx);
  const source = value(input, "source");
  const status = value(input, "status");
  const action = value(input, "action");
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const jobs = ctx.sqlite.query("select id, shell_job_id, action, record_id, source, submitted_by, state, progress, meta_json, error, created_at, started_at, resolved_at from comfy_tasks").map(toTaskSummary);
  const all = jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const filtered = all.filter((task) => {
    if (source === "ai" || source === "manual") { if (task.source !== source) return false; }
    if (action && ACTIONS.has(action) && task.action !== action) return false;
    if (status === "running") { if (task.state !== "running") return false; }
    else if (status === "queued") { if (task.state !== "queued") return false; }
    else if (status === "done") { if (task.state !== "completed") return false; }
    else if (status === "failed") { if (task.state !== "failed") return false; }
    return true;
  });
  const page = filtered.slice(0, limit);
  return { tasks: page, nextCursor: filtered.length > limit ? filtered[limit - 1].createdAt : null };
}

function getTask(ctx, input) {
  ensureSchema(ctx);
  pumpQueue(ctx);
  const id = value(input, "id");
  const rows = ctx.sqlite.query("select id, action, record_id, source, submitted_by, state, progress, meta_json, log_path, error, created_at, started_at, resolved_at from comfy_tasks where id = ?", [id]);
  if (!rows.length) throw new Error("comfy task was not found.");
  const row = rows[0];
  let meta = {};
  try { meta = JSON.parse(row.meta_json || "{}"); } catch (_) { /* keep empty */ }
  return { id: row.id, action: row.action, name: taskName(row.action, meta), recordId: row.record_id, source: row.source, submittedBy: row.submitted_by, state: row.state, progress: row.progress, meta, logPath: row.log_path, error: row.error, createdAt: row.created_at, startedAt: row.started_at, resolvedAt: row.resolved_at };
}

// 读取生成任务提交时的完整参数与参考图，供右侧预览回显与「重新调整」。
function taskParams(ctx, input) {
  ensureSchema(ctx);
  const id = value(input, "id");
  const rows = ctx.sqlite.query("select action, record_id from comfy_tasks where id = ?", [id]);
  if (!rows.length) throw new Error("comfy task was not found.");
  const row = rows[0];
  if (row.action !== "generate" || !row.record_id) return { taskId: id, params: null };
  const records = ctx.sqlite.query("select id, app, model, params_json, prompt, reference_asset_ids, status, error from comfy_generations where id = ?", [row.record_id]);
  if (!records.length) return { taskId: id, params: null };
  const record = records[0];
  let params = {};
  try { params = JSON.parse(record.params_json || "{}"); } catch (_) { params = {}; }
  let referenceAssetIds = [];
  try { referenceAssetIds = JSON.parse(record.reference_asset_ids || "[]"); } catch (_) { referenceAssetIds = []; }
  referenceAssetIds = (Array.isArray(referenceAssetIds) ? referenceAssetIds : []).map((assetId) => {
    const asset = toReferenceAsset(ctx, assetId);
    return asset ? { id: assetId, name: asset.name, savedAssetId: asset.savedAssetId, available: true } : { id: assetId, name: "", savedAssetId: "", available: false };
  });
  return {
    taskId: id,
    params: {
      id: record.id,
      app: record.app,
      model: record.model,
      values: params,
      prompt: record.prompt || "",
      referenceAssetIds,
      status: record.status,
      error: record.error || "",
    },
  };
}

function toReferenceAsset(ctx, assetId) {
  if (!assetId) return null;
  let rows = [];
  try { rows = ctx.sqlite.query("select id, name from comfy_assets where id = ?", [assetId]); } catch (_) { return { id: assetId, name: "", savedAssetId: "", available: true }; }
  if (rows.length) return { id: assetId, name: rows[0].name || "", savedAssetId: assetId, available: true };
  return { id: assetId, name: "", savedAssetId: "", available: true };
}

function inferLogLevel(message) {
  if (/失败|错误|不可用|异常|error|fail/i.test(message)) return "error";
  if (/完成|就绪|已下载|成功|done|ok/i.test(message)) return "ok";
  if (/较慢|回退|等待|重试|进行|download/i.test(message)) return "warn";
  return "info";
}

function readTaskLogs(ctx, input) {
  ensureSchema(ctx);
  pumpQueue(ctx);
  const id = value(input, "id");
  const rows = ctx.sqlite.query("select log_path, shell_job_id, state from comfy_tasks where id = ?", [id]);
  if (!rows.length) return { logs: [], nextCursor: null };
  const limit = Math.min(Math.max(Number(input.limit) || 200, 1), 500);
  const from = Number(input.cursor) || 0;
  if (isActiveJob(rows[0].state) && rows[0].shell_job_id) {
    let live = [];
    try { live = ctx.shell.logs(rows[0].shell_job_id) || []; } catch (_) { live = []; }
    const all = live.map((entry) => { const text = String(entry.text || "").trim(); return { index: entry.sequence || 0, ts: "", level: inferLogLevel(text), message: text }; });
    return { logs: all.slice(-limit), nextCursor: null };
  }
  const logPath = rows[0].log_path || taskLogPath(id);
  let raw = "";
  try { raw = ctx.files.readText(logPath); } catch (_) { raw = ""; }
  let all = raw.split("\n").map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { const entry = JSON.parse(line); return { index, ts: entry.ts || "", level: entry.level || "info", message: entry.message || "" }; }
    catch (_) { return { index, ts: "", level: "info", message: line }; }
  });
  if (!all.length && rows[0].shell_job_id) {
    let live = [];
    try { live = ctx.shell.logs(rows[0].shell_job_id) || []; } catch (_) { live = []; }
    all = live.map((entry) => { const text = String(entry.text || "").trim(); return { index: entry.sequence || 0, ts: "", level: inferLogLevel(text), message: text }; });
  }
  const page = all.slice(from, from + limit);
  return { logs: page, nextCursor: from + limit < all.length ? from + limit : null };
}

function trackedJob(ctx) {
  settleAllJobs(ctx);
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, error, created_at, started_at from comfy_tasks where state in ('queued','running') order by created_at desc limit 1");
  if (!rows.length) return null;
  const row = rows[0];
  return { id: row.shell_job_id, action: row.action, recordID: row.record_id, startedAt: row.started_at || row.created_at, status: row.state, error: row.error || "", logs: [] };
}

function jobForTask(ctx, row) {
  if (!row || row.state === "queued" || !row.shell_job_id) return null;
  const base = { id: row.shell_job_id, action: row.action, recordID: row.record_id, startedAt: row.started_at || row.created_at, logs: [] };
  try { const job = ctx.shell.status(row.shell_job_id); return { ...base, status: shellJobStatus(job), error: shellJobError(job) }; }
  catch (_) { return { ...base, status: row.state, error: "" }; }
}

function envErrorRow(ctx) {
  ensureSchema(ctx);
  const rows = ctx.sqlite.query("select job_id, action, error, logs, updated_at from comfy_env_error where id = 1");
  return rows.length ? rows[0] : null;
}
function clearEnvError(ctx) { ctx.sqlite.execute("delete from comfy_env_error where id = 1"); }
function storeEnvError(ctx, action, jobID, error, logs) {
  ctx.sqlite.execute("insert into comfy_env_error (id, job_id, action, error, logs, updated_at) values (1, ?, ?, ?, ?, ?) on conflict(id) do update set job_id = excluded.job_id, action = excluded.action, error = excluded.error, logs = excluded.logs, updated_at = excluded.updated_at", [jobID || "", action, error, JSON.stringify(logs), new Date().toISOString()]);
}
function meaningfulError(logs, fallback) {
  const lines = (logs || []).map((entry) => String(entry.text || "")).map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || fallback || "unknown error";
}
function noteEnvOutcome(ctx, record, job) {
  if (record.action !== "prepare" && record.action !== "install") return;
  if (!isTerminalJob(job.status)) return;
  if (job.status === "completed") { clearEnvError(ctx); return; }
  let logs = [];
  try { logs = ctx.shell.logs(record.shell_job_id).slice(-40); } catch (_) { logs = []; }
  storeEnvError(ctx, record.action, record.shell_job_id, meaningfulError(logs, job.error), logs);
}

// ---------------------- operations ----------------------

function status(_, ctx) {
  ensureSchema(ctx);
  pumpQueue(ctx);
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, progress, meta_json, error, created_at, started_at from comfy_tasks where state in ('queued','running') order by created_at asc");
  const tasks = rows.map(toTaskSummary);
  const latest = rows.length ? toTaskSummary(rows[rows.length - 1]) : null;
  const activeJob = latest ? { id: latest.jobId, action: latest.action, recordID: latest.recordId, startedAt: latest.startedAt || latest.createdAt, status: latest.state, error: latest.error, logs: [] } : null;
  const env = envStatus(ctx);
  let pythonReady = true;
  try { pythonReady = ctx.python.status().ready === true; } catch (_) { pythonReady = false; }
  const envError = envErrorRow(ctx);
  let envFailure = null;
  if (envError && envError.error) {
    let storedLogs = [];
    try { storedLogs = JSON.parse(envError.logs || "[]"); } catch (_) { storedLogs = []; }
    envFailure = { setupError: envError.error, setupLogs: storedLogs };
  }
  return {
    ready: env.ready === true, pending: !pythonReady, error: env.error || "", runtimes: env.runtimes || {}, apps: env.apps || {},
    downloadSource: downloadSource(ctx), activeJob, activeTask: latest, tasks, ...(envFailure || {})
  };
}

function catalog(_, ctx) { return buildCatalog(ctx); }

function prepare(input, ctx) {
  const target = value(input, "target") || "all";
  if (target !== "all" && target !== "comfyui") {
    const registry = readRegistry(ctx);
    if (!appDef(registry, target)) throw new Error(tr(ctx, "target 必须是 all、comfyui 或已注册的工作流 id。", "target must be all, comfyui, or a registered workflow id"));
  }
  pumpQueue(ctx);
  const tid = outputID();
  submitJob(ctx, { action: "prepare", payload: { target }, meta: { type: tr(ctx, "运行环境", "Runtime environment"), target }, source: value(input, "origin"), submittedBy: value(input, "submittedBy"), taskId: tid });
  pumpQueue(ctx);
  const row = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, started_at, error from comfy_tasks where id = ?", [tid])[0];
  return { job: jobForTask(ctx, row), taskId: tid };
}

function settingsSet(input, ctx) {
  ensureSchema(ctx);
  const source = value(input, "downloadSource");
  if (source) setDownloadSource(ctx, source);
  return { downloadSource: downloadSource(ctx) };
}

function install(input, ctx) {
  const registry = readRegistry(ctx);
  const app = resolveApp(registry, input);
  if (!app) throw new Error("unknown local workflow: " + (value(input, "app") || value(input, "model")));
  const dlSource = value(input, "source") || downloadSource(ctx);
  setDownloadSource(ctx, dlSource);
  const tid = outputID();
  const logPath = taskLogPath(tid);
  const job = ctx.python.run(["python/studio_runner.py", "install", "--app", app.id, "--source", dlSource, "--task-log", logPath]);
  submitJob(ctx, { action: "install", payload: { app: app.id, source: dlSource }, meta: { type: tr(ctx, "模型权重", "Model weights"), app: app.id, label: app.label || app.id }, source: value(input, "origin"), submittedBy: value(input, "submittedBy"), taskId: tid, started: true });
  ctx.sqlite.execute("update comfy_tasks set shell_job_id = ? where id = ?", [shellJobID(job), tid]);
  return { job, taskId: tid };
}

function engineStatus(_, ctx) {
  return run(ctx, ["engine", "status"], 30);
}

function engineStart(input, ctx) {
  ensureSchema(ctx);
  const tid = outputID();
  const logPath = taskLogPath(tid);
  const job = ctx.python.run(["python/studio_runner.py", "engine", "start", "--task-log", logPath]);
  submitJob(ctx, { action: "engine", payload: {}, meta: { type: tr(ctx, "ComfyUI 引擎", "ComfyUI engine") }, source: value(input, "origin"), submittedBy: value(input, "submittedBy"), taskId: tid, started: true });
  ctx.sqlite.execute("update comfy_tasks set shell_job_id = ? where id = ?", [shellJobID(job), tid]);
  return { job, taskId: tid };
}

// 幂等 ensure：已在监听 → 立即返回；否则提交引擎启动任务（AI/background 用 recut.job.* 观察就绪）。
function engineEnsure(input, ctx) {
  ensureSchema(ctx);
  let current = {};
  try { current = run(ctx, ["engine", "status"], 30); } catch (_) { current = {}; }
  if (current.running === true) return { running: true, reused: true, port: current.port || 0, pid: current.pid || "", job: null, taskId: "" };
  const result = engineStart(input, ctx);
  return { running: false, reused: false, ...result };
}

function engineStop(_, ctx) {
  return run(ctx, ["engine", "stop"], 60);
}

function generate(input, ctx) {
  ensureSchema(ctx);
  const registry = readRegistry(ctx);
  const app = resolveApp(registry, input);
  if (!app) throw new Error("unknown local workflow: " + (value(input, "app") || value(input, "model")));
  const rawParams = (input.params && typeof input.params === "object") ? input.params : input;
  const params = coerceParams(app, rawParams);
  if (!params.prompt && (app.formSchema || []).some((f) => f.key === "prompt" && f.required)) throw new Error("prompt is required");
  const referenceIds = Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds : [];
  const referencePaths = [];
  for (const id of referenceIds) {
    try { referencePaths.push(ctx.media.materialize(id).path); } catch (_) { /* skip missing reference */ }
  }
  const id = outputID();
  const ext = outputExt(app);
  const kind = outputKind(app);
  const mimeType = outputMime(app);
  const outputPath = `generations/${id}.${ext}`;
  const createdAt = new Date().toISOString();
  ctx.sqlite.execute(
    "insert into comfy_generations (id, app, model, runtime, capability, output_kind, mime_type, params_json, prompt, reference_asset_ids, output_path, width, height, duration, saved_asset_id, created_at, job_id, status, error) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, '', ?, '', 'queued', '')",
    [id, app.id, app.exposeModel || "", app.runtime || "comfyui", app.capability || "image.generate", kind, mimeType, JSON.stringify(params), String(params.prompt || ""), JSON.stringify(referenceIds), outputPath, createdAt]
  );
  const tid = outputID();
  const paramsPath = taskParamsPath(tid);
  try { ctx.files.writeText(paramsPath, JSON.stringify(params)); } catch (_) { /* params path optional */ }
  submitJob(ctx, { action: "generate", recordID: id, payload: { app: app.id, paramsPath, referencePaths }, meta: { type: tr(ctx, "生成", "Generation"), app: app.id, label: app.label || app.id, capability: app.capability, prompt: String(params.prompt || "").slice(0, 60) }, source: value(input, "origin"), submittedBy: value(input, "submittedBy"), taskId: tid });
  pumpQueue(ctx);
  const row = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, started_at, error from comfy_tasks where id = ?", [tid])[0];
  return { job: jobForTask(ctx, row), taskId: tid, generation: { id } };
}

function generationRecord(ctx, row) {
  const record = { id: row.id, app: row.app, model: row.app, outputKind: row.output_kind, width: row.width, height: row.height, duration: row.duration, savedAssetId: row.saved_asset_id, createdAt: row.created_at, outputURL: "" };
  try { record.outputURL = ctx.files.url(row.output_path); }
  catch (error) {
    ctx.sqlite.execute("update comfy_generations set status = 'failed', error = ? where id = ?", [error instanceof Error ? error.message : tr(ctx, "生成文件已丢失。", "The generated file is missing."), row.id]);
    return null;
  }
  return record;
}

function generationComplete(input, ctx) {
  ensureSchema(ctx);
  trackedJob(ctx);
  const id = value(input, "id");
  applyGenerationMeta(ctx, id);
  const rows = ctx.sqlite.query("select id, app, model, output_kind, mime_type, params_json, width, height, duration, saved_asset_id, output_path, created_at, status, error from comfy_generations where id = ?", [id]);
  if (!rows.length) throw new Error("generation was not found.");
  const row = rows[0];
  if (row.status === "queued" || row.status === "") return { id: row.id, status: "queued" };
  const record = generationRecord(ctx, row);
  if (!record) throw new Error("generation output is missing.");
  let params = {};
  try { params = JSON.parse(row.params_json || "{}"); } catch (_) { params = {}; }
  return { ...record, params, status: row.status, error: row.error || "" };
}

function generations(_, ctx) {
  ensureSchema(ctx);
  trackedJob(ctx);
  return ctx.sqlite.query("select id, app, model, output_kind, width, height, duration, saved_asset_id, output_path, created_at, status from comfy_generations where status = 'completed' order by created_at desc").map((row) => generationRecord(ctx, row)).filter(Boolean);
}

function save(input, ctx) {
  // 平台能力桥在 shell 任务终态后立刻调用 save；此时本 App 的队列引擎可能还没结算，
  // 生成记录仍是 queued/running。先结算在途任务（与 generation.complete 同源）。
  trackedJob(ctx);
  const id = value(input, "id");
  const kind = value(input, "kind");
  const targetAssetId = value(input, "assetId");
  if (!GENERATION_KINDS.has(kind)) throw new Error("kind must be image, video or audio");
  const rows = ctx.sqlite.query("select id, output_path, mime_type, saved_asset_id from comfy_generations where id = ? and status = 'completed'", [id]);
  if (!rows.length) throw new Error("generation was not found.");
  const record = rows[0];
  if (!record.saved_asset_id) {
    const mimeType = record.mime_type || (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/png");
    const ext = kind === "video" ? "mp4" : kind === "audio" ? "wav" : "png";
    const asset = targetAssetId
      ? ctx.media.completeAsset({ assetId: targetAssetId, path: record.output_path, mimeType })
      : ctx.media.importFile({ path: record.output_path, name: `comfy-${record.id}.${ext}`, mimeType });
    ctx.sqlite.execute("update comfy_generations set saved_asset_id = ? where id = ?", [asset.id, id]);
    record.saved_asset_id = asset.id;
  }
  return { id, kind, assetId: record.saved_asset_id };
}

function job(_, ctx) { return trackedJob(ctx); }

function resolveJob(input, ctx) {
  ensureSchema(ctx);
  const id = value(input, "id");
  if (!id) return { id, resolved: false };
  const rows = ctx.sqlite.query("select id from comfy_tasks where shell_job_id = ?", [id]);
  if (!rows.length) return { id, resolved: false };
  return { id, resolved: true };
}

function cancel(_, ctx) {
  pumpQueue(ctx);
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state from comfy_tasks where state in ('queued','running') order by created_at desc limit 1");
  if (!rows.length) return { cancelled: false };
  return cancelTaskRow(ctx, rows[0]);
}

function tasksList(input, ctx) { return listTasks(ctx, input || {}); }
function taskGet(input, ctx) { return getTask(ctx, input); }
function taskLogs(input, ctx) { return readTaskLogs(ctx, input); }
function taskCancel(input, ctx) {
  ensureSchema(ctx);
  pumpQueue(ctx);
  const id = value(input, "id");
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state from comfy_tasks where id = ?", [id]);
  if (!rows.length) return { cancelled: false };
  if (!isActiveJob(rows[0].state)) return { cancelled: false };
  return cancelTaskRow(ctx, rows[0]);
}

recut.operation.register("comfy.status", status);
recut.operation.register("comfy.catalog", catalog);
recut.operation.register("comfy.prepare", prepare);
recut.operation.register("comfy.engine.status", engineStatus);
recut.operation.register("comfy.engine.start", engineStart);
recut.operation.register("comfy.engine.ensure", engineEnsure);
recut.operation.register("comfy.engine.stop", engineStop);
recut.operation.register("comfy.settings.set", settingsSet);
recut.operation.register("comfy.install", install);
recut.operation.register("comfy.generate", generate);
recut.operation.register("comfy.generations", generations);
recut.operation.register("comfy.generation.complete", generationComplete);
recut.operation.register("comfy.save", save);
recut.operation.register("comfy.job", job);
recut.operation.register("comfy.resolve", resolveJob);
recut.operation.register("comfy.cancel", cancel);
recut.operation.register("comfy.tasks.list", tasksList);
recut.operation.register("comfy.task.get", taskGet);
recut.operation.register("comfy.task.params", taskParams);
recut.operation.register("comfy.task.logs", taskLogs);
recut.operation.register("comfy.task.cancel", taskCancel);
