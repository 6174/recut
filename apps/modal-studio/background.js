/*
 * [INPUT]: 依赖 ctx.sqlite 保存生成记录/任务账本/设置，ctx.files 读取 python/registry.json（由
 *          modalapps/*\/manifest.json 生成）与读写 token profile 镜像、ctx.media 复制参考素材与导入产物，
 *          ctx.python.run / ctx.shell.exec 执行可观察本地任务（modal_runner.py：status/catalog/deploy/bootstrap/
 *          invoke/teardown/secret）
 * [OUTPUT]: 注册连通性与就绪度（modal.status）、预设包目录（modal.catalog，含 deployed/volumeReady/stale 代码变更标记）、token profiles（modal.profiles.*）、
 *          设置（modal.settings.set）、云端 Secret（modal.secret.set）、部署（modal.deploy）、权重（modal.install）、
 *          调用函数（modal.generate，单槽 FIFO）、历史与入库（modal.generations / modal.generation.complete /
 *          modal.save）、停止（modal.teardown）、任务中心（modal.tasks.list/get/params/logs/cancel）与取消（modal.cancel）。
 * [POS]: modal-studio 的唯一业务后端；v1 不接平台（无 contributes.media、无默认路由）；能力只经本 App 的
 *        api/mcp operation（modal.generate/modal.save 等 capability:true）暴露。任务并发：运行（generate）单槽
 *        FIFO、部署（deploy）单槽且与运行互斥、权重（install）按预设包串行、停止（teardown）可并行；提交永不拒绝。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

const DOWNLOAD_SOURCES = new Set(["automatic", "huggingface", "modelscope"]);
const ACTIONS = new Set(["prepare", "deploy", "install", "generate", "teardown"]);
const INFER_ACTIONS = new Set(["generate"]);
const RECORD_TABLES = { generate: "modal_generations" };
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const GENERATION_KINDS = new Set(["image", "video", "audio"]);
const PROFILES_PATH = "modal/profiles.json";
const SECRET_PATH = "modal/pending-secret.json";

// registry.json 的内置兜底（静态预设包清单；正常从 ctx.app.readText("python/registry.json") 读取，
// 由 python/publish_registry.py 生成保持一致）。
const REGISTRY_FALLBACK = {
  modalapps: [{
    id: "sd-turbo",
    label: { zh: "SD-Turbo 文生图", en: "SD-Turbo text-to-image" },
    capability: "image.generate",
    appName: "recut-sd-turbo",
    gpuTiers: { default: "T4", options: [{ id: "t4", gpu: "T4", label: { zh: "T4（省额度）", en: "T4 (cheaper)" } }, { id: "a10g", gpu: "A10G", label: { zh: "A10G（更快）", en: "A10G (faster)" } }] },
    volumes: [{ name: "recut-sd-turbo-models", mount: "/models", label: { zh: "模型权重", en: "Model weights" } }],
    secrets: [],
    weights: { repoHuggingFace: "stabilityai/sd-turbo", repoModelScope: "AI-ModelScope/sd-turbo", revision: "main", sizeGb: 3 },
    functions: [{
      id: "text-to-image", label: { zh: "文生图", en: "Text to image" }, entrypoint: "generate_image",
      output: { kind: "image", mimeType: "image/png", ext: "png" },
      formSchema: [
        { key: "prompt", type: "textarea", required: true, label: { zh: "提示词", en: "Prompt" } },
        { key: "steps", type: "number", default: 2, min: 1, max: 8, label: { zh: "步数", en: "Steps" } },
        { key: "seed", type: "number", default: -1, label: { zh: "随机种子（-1 随机）", en: "Seed (-1 random)" } }
      ],
      defaultParams: { steps: 2 }
    }]
  }]
};

function value(input, name) { return String(input[name] || "").trim(); }
function outputID() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function locale(ctx) { return String(ctx?.locale || "").toLowerCase() === "en" ? "en" : "zh"; }
function tr(ctx, zh, en) { return locale(ctx) === "en" ? en : zh; }
// 双语 label（{zh,en} 或字符串）→ 当前语言字符串。
function labelText(ctx, label, fallback) {
  if (!label) return fallback;
  if (typeof label === "string") return label;
  return (locale(ctx) === "en" ? (label.en || label.zh) : (label.zh || label.en)) || fallback;
}
function taskLogPath(taskID) { return `tasks/${taskID}.log`; }
function taskParamsPath(taskID) { return `tasks/${taskID}.params.json`; }
function taskRefsPath(taskID) { return `tasks/${taskID}.refs.json`; }

// 内置预设包来自 App 包内 python/registry.json（由 publish_registry.py 从内置 modalapps/*/manifest.json 生成）。
function builtinRegistry(ctx) {
  try {
    const raw = ctx.app.readText("python/registry.json");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.modalapps) && parsed.modalapps.length) return parsed;
  } catch (_) { /* fall through */ }
  return REGISTRY_FALLBACK;
}

// 用户预设包的 manifest 归一（与 publish_registry.py 的 registry_modalapp 同形）。
function normalizeManifest(manifest, origin, sourceRel) {
  const engine = (manifest && manifest.engine) || {};
  const weights = (manifest && manifest.weights) || {};
  return {
    id: manifest.id,
    label: manifest.name || manifest.id,
    capability: manifest.capability || "image.generate",
    appName: engine.appName || manifest.id,
    sourceDir: sourceRel,
    origin,
    gpuTiers: engine.gpuTiers || { default: "T4", options: [] },
    volumes: engine.volumes || [],
    secrets: engine.secrets || [],
    profileId: engine.profileId || "",
    weights: {
      repoHuggingFace: weights.repoHuggingFace || "", repoModelScope: weights.repoModelScope || "",
      revision: weights.revision || "", sizeGb: weights.sizeGb || 0, files: weights.files || [],
    },
    functions: (manifest.functions || []).map((f) => ({
      id: f.id, label: f.name || f.id, entrypoint: f.entrypoint || f.id,
      invoke: f.invoke || { mode: "sdk" },
      output: f.output || { kind: "image", mimeType: "image/png", ext: "png" },
      formSchema: f.formSchema || [], defaultParams: f.defaultParams || {},
    })),
  };
}

// 用户预设包存放在 App 私有状态（appstate）的 modalapps/<id>/ 下（ctx.appFiles / ctx.paths.appFilesRoot）。
function readUserModalapps(ctx) {
  const out = [];
  let names = [];
  try { names = ctx.appFiles.list("modalapps") || []; } catch (_) { names = []; }
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) continue;
    try {
      const manifest = JSON.parse(ctx.appFiles.readText(`modalapps/${name}/manifest.json`));
      if (manifest && manifest.id) out.push(normalizeManifest(manifest, "user", `modalapps/${name}`));
    } catch (_) { /* not a modalapp dir */ }
  }
  return out;
}

// 运行期合并：内置（registry.json）+ 用户（appstate 扫描）；同 id 用户覆盖内置（save 已禁止撞名，此处兜底）。
function readRegistry(ctx) {
  const byId = {};
  for (const app of (builtinRegistry(ctx).modalapps || [])) byId[app.id] = { ...app, origin: app.origin || "builtin" };
  for (const app of readUserModalapps(ctx)) byId[app.id] = app;
  return { modalapps: Object.values(byId) };
}

// 预设包源码目录的绝对路径：内置在 App 包内（appRoot），用户在 appstate（appFilesRoot）。
function sourceAbs(ctx, modalapp) {
  const paths = ctx.paths || {};
  const root = modalapp.origin === "user" ? (paths.appFilesRoot || "") : (paths.appRoot || "");
  if (!root) return "";
  return `${String(root).replace(/\/+$/, "")}/${String(modalapp.sourceDir || "").replace(/^\/+/, "")}`;
}

function appDef(registry, id) { return (registry.modalapps || []).find((a) => a.id === id) || null; }
function functionDef(modalapp, id) { return (modalapp.functions || []).find((f) => f.id === id) || null; }

function outputKind(spec) { return (spec && spec.kind) || "image"; }
function outputExt(spec) { return (spec && spec.ext) || "png"; }
function outputMime(spec) { return (spec && spec.mimeType) || "image/png"; }
function functionOutput(modalapp, fn) { return (fn && fn.output) || { kind: "image", mimeType: "image/png", ext: "png" }; }
function defaultGpuTier(modalapp) { return (modalapp.gpuTiers && modalapp.gpuTiers.default) || "T4"; }

// 由 action + meta 渲染列表展示名（meta.label 可能是双语对象，需按当前语言取字符串）。
function taskName(ctx, action, meta) {
  const m = meta || {};
  const label = labelText(ctx, m.label, m.modalapp || m.function || "");
  if (action === "generate") return `运行 ${label}${m.prompt ? " · " + m.prompt : ""}`.trim();
  if (action === "deploy") return `部署环境：${label}`.trim();
  if (action === "install") return `下载权重：${label}`.trim();
  if (action === "teardown") return `停止环境：${label}`.trim();
  if (action === "prepare") return "准备运行环境";
  return action;
}

function shellJobID(job) { return String(job.id || job.ID || "").trim(); }
function shellJobStatus(job) { return String(job.status || job.Status || "").trim(); }
function shellJobError(job) { return String(job.error || job.Error || "").trim(); }
function isActiveJob(status) { return ACTIVE_JOB_STATUSES.has(status); }
function isTerminalJob(status) { return TERMINAL_JOB_STATUSES.has(status); }
function outputStatus(status) { return status === "completed" ? "completed" : "failed"; }

function ensureSchema(ctx) {
  ctx.sqlite.execute("create table if not exists modal_generations (id text primary key, modalapp text not null, function text not null default '', model text not null default '', capability text not null default 'image.generate', output_kind text not null default 'image', mime_type text not null default 'image/png', params_json text not null default '{}', prompt text not null default '', reference_asset_ids text not null default '', output_path text not null, width integer not null default 0, height integer not null default 0, duration real not null default 0, seed integer not null default 0, gpu_tier text not null default '', saved_asset_id text not null default '', created_at text not null, job_id text not null default '', status text not null default 'queued', error text not null default '')");
  ctx.sqlite.execute("create table if not exists modal_tasks (id text primary key, shell_job_id text not null default '', action text not null, modalapp text not null default '', function text not null default '', record_id text not null default '', source text not null default 'manual', submitted_by text not null default '', state text not null default 'queued', progress integer not null default 0, meta_json text not null default '{}', payload_json text not null default '', log_path text not null default '', error text not null default '', created_at text not null, started_at text not null default '', resolved_at text not null default '')");
  ctx.sqlite.execute("create index if not exists modal_tasks_created on modal_tasks(created_at desc)");
  ctx.sqlite.execute("create index if not exists modal_tasks_active on modal_tasks(state)");
  ctx.sqlite.execute("create table if not exists modal_settings (key text primary key, value text not null)");
  ctx.sqlite.execute("create table if not exists modal_env_error (id integer primary key check (id = 1), job_id text not null, action text not null, error text not null, logs text not null, updated_at text not null)");
}

// ---------------------- 设置 ----------------------

function settingGet(ctx, key, fallback) {
  ensureSchema(ctx);
  const rows = ctx.sqlite.query("select value from modal_settings where key = ?", [key]);
  return rows.length ? rows[0].value : fallback;
}
function settingSet(ctx, key, val) {
  ctx.sqlite.execute("insert into modal_settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", [key, val]);
}
function downloadSource(ctx) {
  const source = settingGet(ctx, "download_source", "huggingface");
  return DOWNLOAD_SOURCES.has(source) ? source : "huggingface";
}
function defaultProfileId(ctx) { return settingGet(ctx, "default_profile_id", ""); }
function defaultGpuTierSetting(ctx) { return settingGet(ctx, "default_gpu_tier", ""); }
function requireCostConfirm(ctx) { return settingGet(ctx, "require_cost_confirm", "true") !== "false"; }

// ---------------------- token profiles（镜像文件供 runner 读取；secret 永不回传 UI） ----------------------

function readProfiles(ctx) {
  try {
    const parsed = JSON.parse(ctx.files.readText(PROFILES_PATH));
    if (parsed && Array.isArray(parsed.profiles)) return parsed;
  } catch (_) { /* fall through */ }
  return { profiles: [], defaultProfileId: "" };
}
function writeProfiles(ctx, data) {
  try { ctx.files.writeText(PROFILES_PATH, JSON.stringify(data)); } catch (_) { /* ignore */ }
}
function maskToken(tokenId) {
  const raw = String(tokenId || "");
  if (raw.length <= 8) return raw ? "••••" : "";
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}
function profileSummary(profile) {
  return { id: profile.id, name: profile.name, tokenIdMasked: maskToken(profile.tokenId), tokenSet: Boolean(profile.tokenSecret) };
}
// 预设包可绑定 profileId；否则用全局默认；都没有则空（runner 报「先配置 token」）。
function resolveProfileId(ctx, registry, modalapp) {
  const bound = modalapp && modalapp.profileId ? String(modalapp.profileId) : "";
  if (bound) return bound;
  const data = readProfiles(ctx);
  return data.defaultProfileId || defaultProfileId(ctx) || "";
}

// ---------------------- runner 调用 ----------------------

// 同步调用主 venv 的 modal_runner.py（status/catalog/secret 等短命令）。
function run(ctx, args, timeoutSeconds) {
  const shell = '"$RECUT_PYTHON" python/modal_runner.py "$@"';
  const result = ctx.shell.exec({ command: "sh", args: ["-eu", "-c", shell, "modal-runner", ...args], environment: "modal-studio", timeoutSeconds });
  const lines = String(result.stdout || "").trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1] || "{}";
  let payload;
  try { payload = JSON.parse(last); }
  catch (_) { payload = { ready: false, connected: false, error: String(result.stdout || result.error || tr(ctx, "Python 未返回状态数据。", "Python did not return a status payload.")) }; }
  if (Number(result.exitCode) !== 0) payload.error = payload.error || String(result.stdout || result.error || tr(ctx, "Python 进程执行失败。", "Python process failed."));
  return payload;
}

function runProfile(ctx, registry, modalapp, args, timeoutSeconds) {
  const profileId = resolveProfileId(ctx, registry, modalapp);
  const full = profileId ? [...args, "--profile", profileId] : args;
  return run(ctx, full, timeoutSeconds);
}

// 环境就绪度（主 venv 未就绪时直接返回未就绪，不拉起 runner）。
function envStatus(ctx, registry) {
  ensureSchema(ctx);
  const environment = ctx.python.status();
  if (!environment.ready) return { ready: false, connected: false, error: environment.error || tr(ctx, "Python 运行环境尚未就绪。", "The Python runtime is not ready yet."), modalapps: {} };
  const userRoot = (ctx.paths && ctx.paths.appFilesRoot) || "";
  const args = ["status", "--profile", defaultProfileId(ctx)];
  if (userRoot) args.push("--user-root", userRoot);
  try { return run(ctx, args, 60); }
  catch (error) { return { ready: false, connected: false, error: error instanceof Error ? error.message : String(error), modalapps: {} }; }
}

function buildCatalog(ctx) {
  const registry = readRegistry(ctx);
  const status = envStatus(ctx, registry);
  const statusApps = status.modalapps || {};
  const profiles = readProfiles(ctx);
  const modalapps = (registry.modalapps || []).map((a) => {
    const st = statusApps[a.id] || {};
    return {
      id: a.id, label: a.label || a.id, capability: a.capability, appName: a.appName || a.id,
      origin: a.origin || "builtin", sourceDir: a.sourceDir || "", path: sourceAbs(ctx, a),
      deployed: st.deployed === true, volumeReady: st.volumeReady !== false, stale: st.stale === true,
      gpuTiers: a.gpuTiers || { default: "T4", options: [] },
      weights: a.weights || {}, profileId: a.profileId || "",
      functions: (a.functions || []).map((f) => ({
        id: f.id, label: f.label || f.id, entrypoint: f.entrypoint, output: f.output || { kind: "image", mimeType: "image/png", ext: "png" },
        formSchema: f.formSchema || [], defaultParams: f.defaultParams || {}
      }))
    };
  });
  return {
    ready: status.ready === true, connected: status.connected === true, error: status.error || "",
    account: status.account || "", modalapps,
    profiles: profiles.profiles.map(profileSummary),
    defaultProfileId: profiles.defaultProfileId || defaultProfileId(ctx),
    downloadSource: downloadSource(ctx), defaultGpuTier: defaultGpuTierSetting(ctx)
  };
}

// 按函数 formSchema 把原始表单值转换为 typed params（number→Number、boolean→Boolean；其余字符串）。
function coerceParams(fn, raw) {
  const out = {};
  const schema = (fn && fn.formSchema) || [];
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

// 生成完成后把 worker 写出的 <output>.meta.json（真实宽高/时长/seed）回填进记录。
function applyGenerationMeta(ctx, recordID) {
  if (!recordID) return;
  const rows = ctx.sqlite.query("select output_path from modal_generations where id = ?", [recordID]);
  if (!rows.length) return;
  let raw = "";
  try { raw = ctx.files.readText(`${rows[0].output_path}.meta.json`); } catch (_) { return; }
  let meta;
  try { meta = JSON.parse(raw); } catch (_) { return; }
  const width = Number(meta.width) || 0;
  const height = Number(meta.height) || 0;
  const duration = Number(meta.duration) || 0;
  const seed = Number(meta.seed) || 0;
  ctx.sqlite.execute("update modal_generations set width = ?, height = ?, duration = ?, seed = ? where id = ?", [width, height, duration, seed, recordID]);
}
function markFailed(ctx, action, recordID, error) {
  const table = RECORD_TABLES[action];
  if (!table || !recordID) return;
  ctx.sqlite.execute(`update ${table} set status = 'failed', error = ? where id = ?`, [error instanceof Error ? error.message : String(error), recordID]);
}

function closeTaskById(ctx, taskID, state, error) {
  ctx.sqlite.execute("update modal_tasks set state = ?, error = ?, resolved_at = ? where id = ?", [state, error || "", new Date().toISOString(), taskID]);
}

function settleTaskRow(ctx, row) {
  const closeWith = (state, error) => {
    settleOutput(ctx, row.action, row.record_id, { status: state === "completed" ? "completed" : "failed", error: error || "" });
    if (state === "completed" && row.action === "generate") applyGenerationMeta(ctx, row.record_id);
    if (row.action === "deploy" || row.action === "install") noteEnvOutcome(ctx, row, { status: state, error: error || "" });
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
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, created_at from modal_tasks where state in ('queued','running')");
  for (const row of rows) {
    if (row.state !== "running") continue;
    if (!row.shell_job_id) {
      const message = tr(ctx, "任务未能成功启动。", "The task did not start successfully.");
      ctx.sqlite.execute("update modal_tasks set state = 'failed', error = ?, resolved_at = ? where id = ? and state = 'running' and shell_job_id = ''", [message, new Date().toISOString(), row.id]);
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
  const profileArgs = p.profileId ? ["--profile", p.profileId] : [];
  if (action === "prepare") return { platformPrepare: true };
  if (action === "deploy") return { args: ["python/modal_runner.py", "deploy", "--modalapp", p.modalapp, "--dir", p.dir, "--weight-source", p.source || "huggingface", "--task-log", logPath, ...profileArgs] };
  if (action === "install") return { args: ["python/modal_runner.py", "bootstrap", "--modalapp", p.modalapp, "--dir", p.dir, "--weight-source", p.source, "--task-log", logPath, ...profileArgs] };
  if (action === "teardown") return { args: ["python/modal_runner.py", "teardown", "--modalapp", p.modalapp, "--dir", p.dir, "--task-log", logPath, ...profileArgs] };
  if (action === "generate") {
    const args = ["python/modal_runner.py", "invoke", "--modalapp", p.modalapp, "--dir", p.dir, "--function", p.function, "--output", `generations/${row.record_id}`, "--task-log", logPath, ...profileArgs];
    if (p.paramsPath) args.push("--params", p.paramsPath);
    if (p.refsPath) args.push("--refs", p.refsPath);
    if (p.gpu) args.push("--gpu", p.gpu);
    return { args };
  }
  throw new Error(`Unsupported queue task action: ${action}`);
}

function dispatchTask(ctx, row) {
  const now = new Date().toISOString();
  ctx.sqlite.execute("update modal_tasks set state = 'running', started_at = ? where id = ? and state = 'queued'", [now, row.id]);
  let payload = {};
  try { payload = JSON.parse(row.payload_json || "{}"); } catch (_) { payload = {}; }
  try {
    const spec = buildJobSpec(ctx, row.action, row, payload);
    const job = spec.platformPrepare ? ctx.python.prepare() : ctx.python.run(spec.args);
    const shellID = shellJobID(job);
    if (!shellID) throw new Error(tr(ctx, "平台未返回任务 ID。", "The platform did not return a job id."));
    ctx.sqlite.execute("update modal_tasks set shell_job_id = ? where id = ?", [shellID, row.id]);
    linkRecordJob(ctx, row.action, row.record_id, shellID);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task failed to start.";
    ctx.sqlite.execute("update modal_tasks set state = 'failed', error = ?, resolved_at = ? where id = ?", [message, new Date().toISOString(), row.id]);
    markFailed(ctx, row.action, row.record_id, message);
  }
}

function linkRecordJob(ctx, action, recordID, shellID) {
  const table = RECORD_TABLES[action];
  if (!table || !recordID || !shellID) return;
  ctx.sqlite.execute(`update ${table} set job_id = ? where id = ?`, [shellID, recordID]);
}

// 队列引擎：结算 → 守卫派发（prepare 单槽；deploy 与 generate 互斥单槽、deploy 优先；install 按预设包串行；teardown 并行）。
function pumpQueue(ctx) {
  ensureSchema(ctx);
  settleAllJobs(ctx);
  const actives = ctx.sqlite.query("select action, state, modalapp from modal_tasks where state in ('queued','running')");
  const inferRunning = actives.some((row) => INFER_ACTIONS.has(row.action) && row.state === "running");
  const deployRunning = actives.some((row) => row.action === "deploy" && row.state === "running");
  const prepareRunning = actives.some((row) => row.action === "prepare" && row.state === "running");
  const inferAny = actives.some((row) => INFER_ACTIONS.has(row.action));
  if (!inferAny && !deployRunning && !prepareRunning) {
    const nextPrepare = ctx.sqlite.query("select id, action, record_id, modalapp, meta_json, payload_json, log_path from modal_tasks where action = 'prepare' and state = 'queued' order by created_at asc limit 1");
    if (nextPrepare.length) dispatchTask(ctx, nextPrepare[0]);
  }
  if (!inferRunning && !deployRunning && !prepareRunning) {
    const nextDeploy = ctx.sqlite.query("select id, action, record_id, modalapp, meta_json, payload_json, log_path from modal_tasks where action = 'deploy' and state = 'queued' order by created_at asc limit 1");
    if (nextDeploy.length) {
      dispatchTask(ctx, nextDeploy[0]);
    } else {
      const nextGen = ctx.sqlite.query("select id, action, record_id, modalapp, meta_json, payload_json, log_path from modal_tasks where action = 'generate' and state = 'queued' order by created_at asc limit 1");
      if (nextGen.length) dispatchTask(ctx, nextGen[0]);
    }
  }
  // install：同一预设包不并发写同一 Volume；不同预设包可并行。
  const installs = ctx.sqlite.query("select id, action, record_id, modalapp, meta_json, payload_json, log_path from modal_tasks where action = 'install' and state = 'queued' order by created_at asc");
  for (const row of installs) {
    const running = ctx.sqlite.query("select id from modal_tasks where action = 'install' and state = 'running' and modalapp = ?", [row.modalapp]);
    if (!running.length) dispatchTask(ctx, row);
  }
  // teardown：可并行。
  const teardowns = ctx.sqlite.query("select id, action, record_id, modalapp, meta_json, payload_json, log_path from modal_tasks where action = 'teardown' and state = 'queued' order by created_at asc");
  for (const row of teardowns) dispatchTask(ctx, row);
}

function submitJob(ctx, { action, modalapp = "", fn = "", recordID = "", payload, meta, source, submittedBy, taskId }) {
  ensureSchema(ctx);
  const id = taskId || outputID();
  const now = new Date().toISOString();
  let metaJson = "{}";
  try { metaJson = JSON.stringify(meta || {}); } catch (_) { metaJson = "{}"; }
  let payloadJson = "";
  try { payloadJson = JSON.stringify(payload || {}); } catch (_) { payloadJson = ""; }
  ctx.sqlite.execute("insert into modal_tasks (id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, '', ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, '', ?, '', '')", [id, action, modalapp, fn, recordID, source === "ai" ? "ai" : "manual", submittedBy || "", metaJson, payloadJson, taskLogPath(id), now]);
  if (action === "deploy" || action === "install") clearEnvError(ctx);
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

function toTaskSummary(ctx, task) {
  let meta = {};
  const raw = task.meta_json ?? task.meta;
  if (typeof raw === "string") { try { meta = JSON.parse(raw); } catch (_) { /* keep empty */ } }
  else if (raw && typeof raw === "object") { meta = raw; }
  return { id: task.id, action: task.action, name: taskName(ctx, task.action, meta), modalapp: task.modalapp || "", function: task.function || "", recordId: task.recordId || task.record_id || "", source: task.source, submittedBy: task.submittedBy || task.submitted_by || "", state: task.state, progress: task.progress, createdAt: task.createdAt || task.created_at, startedAt: task.startedAt || task.started_at || "", resolvedAt: task.resolvedAt || task.resolved_at || "", jobId: task.jobId || task.shell_job_id || "", error: task.error || "", meta };
}

function listTasks(ctx, input = {}) {
  ensureSchema(ctx);
  pumpQueue(ctx);
  const source = value(input, "source");
  const status = value(input, "status");
  const action = value(input, "action");
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const jobs = ctx.sqlite.query("select id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, error, created_at, started_at, resolved_at from modal_tasks").map((task) => toTaskSummary(ctx, task));
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
  const rows = ctx.sqlite.query("select id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, log_path, error, created_at, started_at, resolved_at from modal_tasks where id = ?", [id]);
  if (!rows.length) throw new Error("modal task was not found.");
  const row = rows[0];
  let meta = {};
  try { meta = JSON.parse(row.meta_json || "{}"); } catch (_) { /* keep empty */ }
  return { id: row.id, action: row.action, name: taskName(ctx, row.action, meta), modalapp: row.modalapp, function: row.function, recordId: row.record_id, source: row.source, submittedBy: row.submitted_by, state: row.state, progress: row.progress, meta, logPath: row.log_path, error: row.error, createdAt: row.created_at, startedAt: row.started_at, resolvedAt: row.resolved_at };
}

// 读取生成任务提交时的完整参数与参考图，供右侧预览回显与「重新调整」。
function taskParams(ctx, input) {
  ensureSchema(ctx);
  const id = value(input, "id");
  const rows = ctx.sqlite.query("select action, record_id from modal_tasks where id = ?", [id]);
  if (!rows.length) throw new Error("modal task was not found.");
  const row = rows[0];
  if (row.action !== "generate" || !row.record_id) return { taskId: id, params: null };
  const records = ctx.sqlite.query("select id, modalapp, function, params_json, prompt, reference_asset_ids, gpu_tier, status, error from modal_generations where id = ?", [row.record_id]);
  if (!records.length) return { taskId: id, params: null };
  const record = records[0];
  let params = {};
  try { params = JSON.parse(record.params_json || "{}"); } catch (_) { params = {}; }
  let referenceAssetIds = [];
  try { referenceAssetIds = JSON.parse(record.reference_asset_ids || "[]"); } catch (_) { referenceAssetIds = []; }
  referenceAssetIds = (Array.isArray(referenceAssetIds) ? referenceAssetIds : []).map((assetId) => ({ id: assetId, name: "", savedAssetId: assetId, available: true }));
  return {
    taskId: id,
    params: {
      id: record.id,
      modalapp: record.modalapp,
      function: record.function,
      model: record.modalapp,
      gpuTier: record.gpu_tier || "",
      values: params,
      prompt: record.prompt || "",
      referenceAssetIds,
      status: record.status,
      error: record.error || "",
    },
  };
}

function inferLogLevel(message) {
  if (/失败|错误|不可用|异常|error|fail/i.test(message)) return "error";
  if (/完成|就绪|已下载|成功|done|ok/i.test(message)) return "ok";
  if (/较慢|回退|等待|重试|进行|download|deploy/i.test(message)) return "warn";
  return "info";
}

function readTaskLogs(ctx, input) {
  ensureSchema(ctx);
  pumpQueue(ctx);
  const id = value(input, "id");
  const rows = ctx.sqlite.query("select log_path, shell_job_id, state from modal_tasks where id = ?", [id]);
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
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, error, created_at, started_at from modal_tasks where state in ('queued','running') order by created_at desc limit 1");
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
  const rows = ctx.sqlite.query("select job_id, action, error, logs, updated_at from modal_env_error where id = 1");
  return rows.length ? rows[0] : null;
}
function clearEnvError(ctx) { ctx.sqlite.execute("delete from modal_env_error where id = 1"); }
function storeEnvError(ctx, action, jobID, error, logs) {
  ctx.sqlite.execute("insert into modal_env_error (id, job_id, action, error, logs, updated_at) values (1, ?, ?, ?, ?, ?) on conflict(id) do update set job_id = excluded.job_id, action = excluded.action, error = excluded.error, logs = excluded.logs, updated_at = excluded.updated_at", [jobID || "", action, error, JSON.stringify(logs), new Date().toISOString()]);
}
function meaningfulError(logs, fallback) {
  const lines = (logs || []).map((entry) => String(entry.text || "")).map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || fallback || "unknown error";
}
function noteEnvOutcome(ctx, record, job) {
  if (record.action !== "prepare" && record.action !== "deploy" && record.action !== "install") return;
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
  const registry = readRegistry(ctx);
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, progress, meta_json, error, created_at, started_at from modal_tasks where state in ('queued','running') order by created_at asc");
  const tasks = rows.map((task) => toTaskSummary(ctx, task));
  const latest = rows.length ? toTaskSummary(ctx, rows[rows.length - 1]) : null;
  const activeJob = latest ? { id: latest.jobId, action: latest.action, recordID: latest.recordId, startedAt: latest.startedAt || latest.createdAt, status: latest.state, error: latest.error, logs: [] } : null;
  const env = envStatus(ctx, registry);
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
    ready: env.ready === true, connected: env.connected === true, account: env.account || "",
    pending: !pythonReady, error: env.error || "", modalapps: env.modalapps || {},
    profiles: readProfiles(ctx).profiles.map(profileSummary),
    defaultProfileId: defaultProfileId(ctx), downloadSource: downloadSource(ctx), defaultGpuTier: defaultGpuTierSetting(ctx),
    activeJob, activeTask: latest, tasks, ...(envFailure || {})
  };
}

function catalog(_, ctx) { return buildCatalog(ctx); }

function profilesList(_, ctx) {
  const data = readProfiles(ctx);
  return { profiles: data.profiles.map(profileSummary), defaultProfileId: data.defaultProfileId || defaultProfileId(ctx) };
}

function profilesAdd(input, ctx) {
  ensureSchema(ctx);
  const name = value(input, "name");
  const tokenId = value(input, "tokenId");
  const tokenSecret = value(input, "tokenSecret");
  if (!name || !tokenId || !tokenSecret) throw new Error("name, tokenId and tokenSecret are required");
  const data = readProfiles(ctx);
  const id = outputID();
  data.profiles.push({ id, name, tokenId, tokenSecret, createdAt: new Date().toISOString() });
  if (input.makeDefault === true || !data.defaultProfileId) data.defaultProfileId = id;
  writeProfiles(ctx, data);
  if (data.defaultProfileId) settingSet(ctx, "default_profile_id", data.defaultProfileId);
  return { profile: profileSummary({ id, name, tokenId, tokenSecret }), defaultProfileId: data.defaultProfileId };
}

function profilesRemove(input, ctx) {
  ensureSchema(ctx);
  const id = value(input, "id");
  const data = readProfiles(ctx);
  data.profiles = data.profiles.filter((profile) => profile.id !== id);
  if (data.defaultProfileId === id) data.defaultProfileId = data.profiles.length ? data.profiles[0].id : "";
  writeProfiles(ctx, data);
  settingSet(ctx, "default_profile_id", data.defaultProfileId);
  return { removed: true, defaultProfileId: data.defaultProfileId };
}

function settingsSet(input, ctx) {
  ensureSchema(ctx);
  const data = readProfiles(ctx);
  if (input.defaultProfileId !== undefined) {
    const id = value(input, "defaultProfileId");
    if (id && !data.profiles.some((profile) => profile.id === id)) throw new Error("unknown profile: " + id);
    data.defaultProfileId = id;
    writeProfiles(ctx, data);
    settingSet(ctx, "default_profile_id", id);
  }
  const source = value(input, "downloadSource");
  if (source) {
    if (!DOWNLOAD_SOURCES.has(source)) throw new Error("download source must be automatic, huggingface or modelscope");
    settingSet(ctx, "download_source", source);
  }
  const gpu = value(input, "defaultGpuTier");
  if (input.defaultGpuTier !== undefined) settingSet(ctx, "default_gpu_tier", gpu);
  if (input.requireCostConfirm !== undefined) settingSet(ctx, "require_cost_confirm", input.requireCostConfirm === false ? "false" : "true");
  return { defaultProfileId: data.defaultProfileId, downloadSource: downloadSource(ctx), defaultGpuTier: defaultGpuTierSetting(ctx), requireCostConfirm: requireCostConfirm(ctx) };
}

// 把 Secret 值写到临时文件供 runner 读取（runner 读完即删），不经日志/命令行。
function secretSet(input, ctx) {
  ensureSchema(ctx);
  const name = value(input, "name");
  const values = (input.values && typeof input.values === "object") ? input.values : {};
  if (!name) throw new Error("secret name is required");
  const entries = Object.entries(values).map(([key, val]) => [String(key), String(val)]);
  if (!entries.length) throw new Error("secret values must be a non-empty object");
  ctx.files.writeText(SECRET_PATH, JSON.stringify({ name, values: Object.fromEntries(entries) }));
  const payload = runProfile(ctx, readRegistry(ctx), null, ["secret", "--name", name, "--secret-file", SECRET_PATH], 120);
  try { ctx.files.writeText(SECRET_PATH, ""); } catch (_) { /* ignore */ }
  if (payload.error) throw new Error(payload.error);
  return { name, created: payload.created === true };
}

// 聚合所有预设包声明的 Secret（去重）+ 该账号下是否已创建（供「账号」面板渲染 token/密钥设置项）。
function secretsList(_, ctx) {
  const registry = readRegistry(ctx);
  const declared = [];
  const seen = new Set();
  for (const modalapp of (registry.modalapps || [])) {
    for (const secret of (modalapp.secrets || [])) {
      if (!secret || !secret.name || seen.has(secret.name)) continue;
      seen.add(secret.name);
      declared.push({ name: secret.name, required: secret.required === true, keys: secret.keys || [], label: secret.label || secret.name });
    }
  }
  let existing = [];
  try {
    if (ctx.python.status().ready === true) {
      const result = run(ctx, ["secrets", "--profile", defaultProfileId(ctx)], 60);
      existing = Array.isArray(result.secrets) ? result.secrets : [];
    }
  } catch (_) { existing = []; }
  const existingSet = new Set(existing);
  return { secrets: declared.map((secret) => ({ ...secret, set: existingSet.has(secret.name) })) };
}

// ---------------------- 预设包管理（内置只读 + 用户 appstate 可写） ----------------------

const MODALAPP_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

function builtinIds(ctx) { return new Set((builtinRegistry(ctx).modalapps || []).map((a) => a.id)); }

function modalappPath(_, ctx) {
  const paths = ctx.paths || {};
  const userRoot = paths.appFilesRoot || "";
  return {
    userRoot,
    userModalappsRoot: userRoot ? `${String(userRoot).replace(/\/+$/, "")}/modalapps` : "",
    builtinRoot: paths.appRoot ? `${String(paths.appRoot).replace(/\/+$/, "")}/modalapps` : "",
  };
}

function modalappList(_, ctx) {
  const registry = readRegistry(ctx);
  const status = envStatus(ctx, registry);
  const states = status.modalapps || {};
  return {
    modalapps: (registry.modalapps || []).map((a) => {
      const st = states[a.id] || {};
      return {
        id: a.id, label: a.label || a.id, capability: a.capability, origin: a.origin || "builtin",
        appName: a.appName || a.id, sourceDir: a.sourceDir || "", path: sourceAbs(ctx, a),
        deployed: st.deployed === true, volumeReady: st.volumeReady === true, stale: st.stale === true,
        functions: (a.functions || []).map((f) => ({ id: f.id, label: f.label || f.id, output: f.output || {} })),
      };
    }),
  };
}

function modalappGet(input, ctx) {
  const registry = readRegistry(ctx);
  const modalapp = appDef(registry, value(input, "id"));
  if (!modalapp) throw new Error("unknown modalapp: " + value(input, "id"));
  let files = [];
  if (modalapp.origin === "user") { try { files = ctx.appFiles.list(modalapp.sourceDir) || []; } catch (_) { files = []; } }
  else { files = ["manifest.json", "modal_app.py", "bootstrap.py"]; }
  return { modalapp, origin: modalapp.origin || "builtin", path: sourceAbs(ctx, modalapp), files };
}

// 写入用户预设包（appstate/modalapps/<id>/）：manifest 必填校验 + 可选代码文件。
function modalappSave(input, ctx) {
  const id = value(input, "id");
  if (!MODALAPP_ID_RE.test(id)) throw new Error("id must match [a-z0-9][a-z0-9._-]*");
  if (builtinIds(ctx).has(id)) throw new Error("id is reserved by a built-in modalapp: " + id);
  const manifest = input.manifest;
  if (!manifest || typeof manifest !== "object") throw new Error("manifest is required");
  if (manifest.id !== id) throw new Error("manifest.id must equal id");
  const engine = manifest.engine || {};
  if (!manifest.name || !engine.appName) throw new Error("manifest requires name and engine.appName");
  if (!Array.isArray(manifest.functions) || !manifest.functions.length) throw new Error("manifest requires at least one function");
  for (const fn of manifest.functions) {
    if (!fn || !fn.id || !fn.entrypoint) throw new Error("each function requires id and entrypoint");
  }
  const dir = `modalapps/${id}`;
  ctx.appFiles.writeText(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  if (typeof input.modalAppPy === "string" && input.modalAppPy.trim()) ctx.appFiles.writeText(`${dir}/modal_app.py`, input.modalAppPy);
  if (typeof input.bootstrapPy === "string" && input.bootstrapPy.trim()) ctx.appFiles.writeText(`${dir}/bootstrap.py`, input.bootstrapPy);
  return { id, origin: "user", path: sourceAbs(ctx, { origin: "user", sourceDir: dir }) };
}

function modalappRemove(input, ctx) {
  const id = value(input, "id");
  if (!MODALAPP_ID_RE.test(id)) throw new Error("invalid id");
  if (builtinIds(ctx).has(id)) throw new Error("cannot remove a built-in modalapp: " + id);
  const userRoot = (ctx.paths && ctx.paths.appFilesRoot) || "";
  if (!userRoot) throw new Error("app state root is unavailable");
  const dir = `${String(userRoot).replace(/\/+$/, "")}/modalapps/${id}`;
  const result = ctx.shell.exec({ command: "rm", args: ["-rf", dir], timeoutSeconds: 60 });
  if (Number(result.exitCode) !== 0) throw new Error(String(result.error || "failed to remove modalapp"));
  return { removed: true, id };
}

// 生成一个可端到端跑通的最小预设包骨架（占位 1x1 PNG，无需权重），供用户/Agent 作为起点。
function scaffoldManifest(id, name, capability) {
  return {
    id,
    name: { zh: name, en: name },
    capability: capability || "image.generate",
    engine: {
      appName: `recut-${id}`,
      sourceDir: `modalapps/${id}`,
      image: { base: "debian_slim", pythonVersion: "3.11", apt: [], pip: [] },
      gpuTiers: { default: "T4", options: [{ id: "t4", gpu: "T4", label: { zh: "T4（省额度）", en: "T4 (cheaper)" } }] },
      timeoutSec: 300,
      idleTimeoutSec: 60,
      volumes: [],
      secrets: [],
    },
    weights: { bootstrapFunction: "bootstrap_weights", repoHuggingFace: "", repoModelScope: "", revision: "main", sizeGb: 0, files: [] },
    functions: [{
      id: "generate",
      name: { zh: "生成", en: "Generate" },
      entrypoint: "generate",
      invoke: { mode: "sdk" },
      output: { kind: "image", mimeType: "image/png", ext: "png" },
      formSchema: [
        { key: "prompt", type: "textarea", required: true, label: { zh: "提示词", en: "Prompt" } },
        { key: "seed", type: "number", default: -1, label: { zh: "随机种子（-1 随机）", en: "Seed (-1 random)" } },
      ],
      defaultParams: {},
    }],
  };
}

const SCAFFOLD_MODAL_APP = `"""最小预设包：返回一张 1x1 占位图；替换本文件为你的模型代码。"""

import base64

import modal

APP_NAME = "__APP_NAME__"

app = modal.App(APP_NAME)
image = modal.Image.debian_slim(python_version="3.11")

# 1x1 透明 PNG（占位产物，替换为真实生成结果）
_PLACEHOLDER_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


@app.function(image=image, timeout=300)
def generate(prompt: str, seed: int = -1, refs=None):
    # TODO: 加载你的依赖/模型并生成真实产物；返回 {kind:"bytes"|"file", ...}。
    return {"kind": "bytes", "data": _PLACEHOLDER_PNG, "mimeType": "image/png",
            "meta": {"width": 1, "height": 1, "seed": int(seed)}}
`;

const SCAFFOLD_BOOTSTRAP = `"""最小预设包：无权重；如需下载权重，在此实现并写入 /models 卷。"""

import modal

app = modal.App("__APP_NAME__")


@app.function(image=modal.Image.debian_slim(python_version="3.11"), timeout=600)
def bootstrap_weights(source: str = "automatic"):
    print("[modal] scaffold 无需权重。", flush=True)
    return {"ready": True}


@app.local_entrypoint()
def main(source: str = "automatic"):
    bootstrap_weights.remote(source=source)
`;

function appFileExists(ctx, path) { try { ctx.appFiles.readText(path); return true; } catch (_) { return false; } }

function modalappScaffold(input, ctx) {
  const id = value(input, "id");
  if (!MODALAPP_ID_RE.test(id)) throw new Error("id must match [a-z0-9][a-z0-9._-]*");
  if (builtinIds(ctx).has(id)) throw new Error("id is reserved by a built-in modalapp: " + id);
  if (input.overwrite !== true && appFileExists(ctx, `modalapps/${id}/manifest.json`)) {
    throw new Error("modalapp already exists: " + id + " (pass overwrite:true to replace)");
  }
  const name = value(input, "name") || id;
  const manifest = scaffoldManifest(id, name, value(input, "capability"));
  const appName = manifest.engine.appName;
  return modalappSave({
    id, manifest,
    modalAppPy: SCAFFOLD_MODAL_APP.split("__APP_NAME__").join(appName),
    bootstrapPy: SCAFFOLD_BOOTSTRAP.split("__APP_NAME__").join(appName),
  }, ctx);
}

function prepare(input, ctx) {
  pumpQueue(ctx);
  const tid = outputID();
  submitJob(ctx, { action: "prepare", payload: {}, meta: { type: tr(ctx, "运行环境", "Runtime environment") }, source: value(input, "origin"), submittedBy: value(input, "submittedBy"), taskId: tid });
  pumpQueue(ctx);
  const row = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, started_at, error from modal_tasks where id = ?", [tid])[0];
  return { job: jobForTask(ctx, row), taskId: tid };
}

function deploy(input, ctx) {
  const registry = readRegistry(ctx);
  const modalapp = appDef(registry, value(input, "modalapp"));
  if (!modalapp) throw new Error("unknown modalapp: " + value(input, "modalapp"));
  const source = value(input, "source") || downloadSource(ctx);
  if (!DOWNLOAD_SOURCES.has(source)) throw new Error("download source must be automatic, huggingface or modelscope");
  settingSet(ctx, "download_source", source);
  const profileId = value(input, "profileId") || resolveProfileId(ctx, registry, modalapp);
  pumpQueue(ctx);
  const tid = outputID();
  submitJob(ctx, { action: "deploy", modalapp: modalapp.id, payload: { modalapp: modalapp.id, dir: sourceAbs(ctx, modalapp), source, profileId }, meta: { type: tr(ctx, "部署环境", "Deploy environment"), modalapp: modalapp.id, label: labelText(ctx, modalapp.label, modalapp.id) }, source: value(input, "origin"), submittedBy: value(input, "submittedBy"), taskId: tid });
  pumpQueue(ctx);
  const row = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, started_at, error from modal_tasks where id = ?", [tid])[0];
  return { job: jobForTask(ctx, row), taskId: tid };
}

function install(input, ctx) {
  const registry = readRegistry(ctx);
  const modalapp = appDef(registry, value(input, "modalapp"));
  if (!modalapp) throw new Error("unknown modalapp: " + value(input, "modalapp"));
  const source = value(input, "source") || downloadSource(ctx);
  if (!DOWNLOAD_SOURCES.has(source)) throw new Error("download source must be automatic, huggingface or modelscope");
  settingSet(ctx, "download_source", source);
  const profileId = value(input, "profileId") || resolveProfileId(ctx, registry, modalapp);
  pumpQueue(ctx);
  const tid = outputID();
  submitJob(ctx, { action: "install", modalapp: modalapp.id, payload: { modalapp: modalapp.id, dir: sourceAbs(ctx, modalapp), source, profileId }, meta: { type: tr(ctx, "模型权重", "Model weights"), modalapp: modalapp.id, label: labelText(ctx, modalapp.label, modalapp.id) }, source: value(input, "origin"), submittedBy: value(input, "submittedBy"), taskId: tid });
  pumpQueue(ctx);
  const row = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, started_at, error from modal_tasks where id = ?", [tid])[0];
  return { job: jobForTask(ctx, row), taskId: tid };
}

function teardown(input, ctx) {
  const registry = readRegistry(ctx);
  const modalapp = appDef(registry, value(input, "modalapp"));
  if (!modalapp) throw new Error("unknown modalapp: " + value(input, "modalapp"));
  const profileId = value(input, "profileId") || resolveProfileId(ctx, registry, modalapp);
  pumpQueue(ctx);
  const tid = outputID();
  submitJob(ctx, { action: "teardown", modalapp: modalapp.id, payload: { modalapp: modalapp.id, dir: sourceAbs(ctx, modalapp), profileId }, meta: { type: tr(ctx, "停止环境", "Stop environment"), modalapp: modalapp.id, label: labelText(ctx, modalapp.label, modalapp.id) }, source: value(input, "origin"), submittedBy: value(input, "submittedBy"), taskId: tid });
  pumpQueue(ctx);
  const row = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, started_at, error from modal_tasks where id = ?", [tid])[0];
  return { job: jobForTask(ctx, row), taskId: tid };
}

function generate(input, ctx) {
  ensureSchema(ctx);
  const registry = readRegistry(ctx);
  const modalapp = appDef(registry, value(input, "modalapp"));
  if (!modalapp) throw new Error("unknown modalapp: " + value(input, "modalapp"));
  const fn = functionDef(modalapp, value(input, "function"));
  if (!fn) throw new Error("unknown function: " + value(input, "function") + " in " + modalapp.id);
  if (requireCostConfirm(ctx) && input.confirmCost !== true) {
    throw new Error(tr(ctx, "云端 GPU 调用会消耗 Modal 额度，请显式传入 confirmCost: true 确认后重试。", "Cloud GPU calls consume Modal credits; pass confirmCost: true to confirm."));
  }
  const rawParams = (input.params && typeof input.params === "object") ? input.params : input;
  const params = coerceParams(fn, rawParams);
  const referenceIds = Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds : [];
  // media 字段不进 params，经 referenceAssetIds 传入，故单独按参考素材校验 required。
  for (const field of (fn.formSchema || [])) {
    if (!field.required) continue;
    if (field.type === "media") {
      if (!referenceIds.length) throw new Error(`${field.key} is required`);
      continue;
    }
    if (params[field.key] === undefined || params[field.key] === "") throw new Error(`${field.key} is required`);
  }
  const gpu = value(input, "gpuTier") || defaultGpuTierSetting(ctx) || defaultGpuTier(modalapp);
  const profileId = value(input, "profileId") || resolveProfileId(ctx, registry, modalapp);
  const refs = [];
  for (const assetId of referenceIds) {
    try { const materialized = ctx.media.materialize(assetId); refs.push({ path: materialized.path, name: materialized.name || assetId, mimeType: materialized.mimeType || "" }); }
    catch (_) { /* skip missing reference */ }
  }
  const id = outputID();
  const output = functionOutput(modalapp, fn);
  const kind = outputKind(output);
  const ext = outputExt(output);
  const mimeType = outputMime(output);
  const outputPath = `generations/${id}.${ext}`;
  const createdAt = new Date().toISOString();
  ctx.sqlite.execute(
    "insert into modal_generations (id, modalapp, function, model, capability, output_kind, mime_type, params_json, prompt, reference_asset_ids, output_path, width, height, duration, seed, gpu_tier, saved_asset_id, created_at, job_id, status, error) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, '', ?, '', 'queued', '')",
    [id, modalapp.id, fn.id, modalapp.id, modalapp.capability || "image.generate", kind, mimeType, JSON.stringify(params), String(params.prompt || ""), JSON.stringify(referenceIds), outputPath, gpu, createdAt]
  );
  const tid = outputID();
  const paramsPath = taskParamsPath(tid);
  const refsPath = taskRefsPath(tid);
  try { ctx.files.writeText(paramsPath, JSON.stringify(params)); } catch (_) { /* optional */ }
  try { ctx.files.writeText(refsPath, JSON.stringify(refs)); } catch (_) { /* optional */ }
  submitJob(ctx, { action: "generate", modalapp: modalapp.id, fn: fn.id, recordID: id, payload: { modalapp: modalapp.id, function: fn.id, dir: sourceAbs(ctx, modalapp), paramsPath, refsPath, gpu, profileId }, meta: { type: tr(ctx, "运行函数", "Run function"), modalapp: modalapp.id, function: fn.id, label: labelText(ctx, fn.label, fn.id), capability: modalapp.capability, gpuTier: gpu, prompt: String(params.prompt || "").slice(0, 60) }, source: value(input, "origin"), submittedBy: value(input, "submittedBy"), taskId: tid });
  pumpQueue(ctx);
  const row = ctx.sqlite.query("select id, shell_job_id, action, record_id, state, started_at, error from modal_tasks where id = ?", [tid])[0];
  return { job: jobForTask(ctx, row), taskId: tid, generation: { id } };
}

function generationRecord(ctx, row) {
  const record = { id: row.id, modalapp: row.modalapp, function: row.function, app: row.modalapp, outputKind: row.output_kind, width: row.width, height: row.height, duration: row.duration, seed: row.seed, gpuTier: row.gpu_tier, savedAssetId: row.saved_asset_id, createdAt: row.created_at, outputURL: "" };
  try { record.outputURL = ctx.files.url(row.output_path); }
  catch (error) {
    ctx.sqlite.execute("update modal_generations set status = 'failed', error = ? where id = ?", [error instanceof Error ? error.message : tr(ctx, "生成文件已丢失。", "The generated file is missing."), row.id]);
    return null;
  }
  return record;
}

function generationComplete(input, ctx) {
  ensureSchema(ctx);
  trackedJob(ctx);
  const id = value(input, "id");
  applyGenerationMeta(ctx, id);
  const rows = ctx.sqlite.query("select id, modalapp, function, output_kind, mime_type, params_json, width, height, duration, seed, gpu_tier, saved_asset_id, output_path, created_at, status, error from modal_generations where id = ?", [id]);
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
  return ctx.sqlite.query("select id, modalapp, function, output_kind, width, height, duration, seed, gpu_tier, saved_asset_id, output_path, created_at, status from modal_generations where status = 'completed' order by created_at desc").map((row) => generationRecord(ctx, row)).filter(Boolean);
}

function save(input, ctx) {
  // 平台能力桥在 shell 任务终态后立刻调用 save；此时本 App 的队列引擎可能还没结算，
  // 生成记录仍是 queued/running。先结算在途任务（与 generation.complete 同源）。
  trackedJob(ctx);
  const id = value(input, "id");
  const kind = value(input, "kind");
  if (!GENERATION_KINDS.has(kind)) throw new Error("kind must be image, video or audio");
  const rows = ctx.sqlite.query("select id, output_path, mime_type, saved_asset_id from modal_generations where id = ? and status = 'completed'", [id]);
  if (!rows.length) throw new Error("generation was not found.");
  const record = rows[0];
  if (!record.saved_asset_id) {
    const mimeType = record.mime_type || (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/png");
    const ext = kind === "video" ? "mp4" : kind === "audio" ? "wav" : "png";
    const asset = ctx.media.importFile({ path: record.output_path, name: `modal-${record.id}.${ext}`, mimeType });
    ctx.sqlite.execute("update modal_generations set saved_asset_id = ? where id = ?", [asset.id, id]);
    record.saved_asset_id = asset.id;
  }
  return { id, kind, assetId: record.saved_asset_id };
}

function job(_, ctx) { return trackedJob(ctx); }

function resolveJob(input, ctx) {
  ensureSchema(ctx);
  const id = value(input, "id");
  if (!id) return { id, resolved: false };
  const rows = ctx.sqlite.query("select id from modal_tasks where shell_job_id = ?", [id]);
  if (!rows.length) return { id, resolved: false };
  return { id, resolved: true };
}

function cancel(_, ctx) {
  pumpQueue(ctx);
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state from modal_tasks where state in ('queued','running') order by created_at desc limit 1");
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
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, state from modal_tasks where id = ?", [id]);
  if (!rows.length) return { cancelled: false };
  if (!isActiveJob(rows[0].state)) return { cancelled: false };
  return cancelTaskRow(ctx, rows[0]);
}

recut.operation.register("modal.status", status);
recut.operation.register("modal.catalog", catalog);
recut.operation.register("modal.profiles.add", profilesAdd);
recut.operation.register("modal.profiles.list", profilesList);
recut.operation.register("modal.profiles.remove", profilesRemove);
recut.operation.register("modal.settings.set", settingsSet);
recut.operation.register("modal.secret.set", secretSet);
recut.operation.register("modal.secrets.list", secretsList);
recut.operation.register("modal.modalapp.list", modalappList);
recut.operation.register("modal.modalapp.get", modalappGet);
recut.operation.register("modal.modalapp.path", modalappPath);
recut.operation.register("modal.modalapp.save", modalappSave);
recut.operation.register("modal.modalapp.scaffold", modalappScaffold);
recut.operation.register("modal.modalapp.remove", modalappRemove);
recut.operation.register("modal.prepare", prepare);
recut.operation.register("modal.deploy", deploy);
recut.operation.register("modal.install", install);
recut.operation.register("modal.generate", generate);
recut.operation.register("modal.generations", generations);
recut.operation.register("modal.generation.complete", generationComplete);
recut.operation.register("modal.save", save);
recut.operation.register("modal.teardown", teardown);
recut.operation.register("modal.job", job);
recut.operation.register("modal.resolve", resolveJob);
recut.operation.register("modal.cancel", cancel);
recut.operation.register("modal.tasks.list", tasksList);
recut.operation.register("modal.task.get", taskGet);
recut.operation.register("modal.task.params", taskParams);
recut.operation.register("modal.task.logs", taskLogs);
recut.operation.register("modal.task.cancel", taskCancel);
