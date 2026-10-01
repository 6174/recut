/*
 * [INPUT]: 依赖 ctx.sqlite 保存生成记录/任务账本/设置，ctx.files 读取 python/registry.json（由
 *          modalapps/*\/manifest.json 生成）与读写 token profile 镜像、ctx.media 复制参考素材（提交前按模型的
 *          referenceImage 预算缩到单边上限，见平台 reference_image 层）与导入产物，
 *          ctx.python.run / ctx.shell.exec 执行可观察本地任务（modal_runner.py：status/catalog/deploy/bootstrap/
 *          invoke/cancel/teardown/secret）
 * [OUTPUT]: 注册首屏轻量负载（modal.overview：只读本机 registry/profiles/设置 + 上次就绪度快照，不拉起 Python）、
 *          连通性与就绪度（modal.status，结果同时写入快照供下次首屏回放）、预设包目录（modal.catalog，含 deployed/volumeReady/stale 代码变更标记与平台模型就绪投影 models[]——
 *          models[].ready 要求 deployed 且该包 expose.function 所需产物齐备，逐产物就绪由引擎 engine.artifacts/requires 声明并探测，assets 上报）、token profiles（modal.profiles.*）、
 *          设置（modal.settings.set：默认 profile / 权重源 / GPU 档位 / 每「预设包+函数」的 AI 默认参数（含默认 GPU 档位）agent_defaults:<id>:<fn>）、云端 Secret（modal.secret.set）、部署（modal.deploy）、权重（modal.install）、
 *          调用函数（modal.generate，按预设包单槽、跨预设包并行；兼容平台执行桥的 model 入参；非 origin="manual" 的调用用 agentDefaults 补全缺省字段；
 *          **派发前先预检目标函数所需产物**，缺失直接拒绝、不创建云端容器——否则容器会在 @modal.enter 里反复起不来 = crash-loop）、历史与入库（modal.generations / modal.generation.complete /
 *          modal.save）、停止（modal.teardown）、任务中心（modal.tasks.list/get/params/logs/cancel）与取消（modal.cancel：运行中的 generate
 *          先按 runner 落盘的调用 ID 直接取消云端 Modal 调用，再终止本地 shell job，避免云端 GPU 继续烧；拿不到调用 ID 时返回告警而非静默放过）。
 * [POS]: modal-studio 的唯一业务后端；经 manifest contributes.media 向平台注册 modal-cloud provider（每个声明
 *        expose 的 modalapp → 一个平台模型，平台默认生图/生视频路由可指向它，经通用执行桥调用 modal.generate），
 *        其余能力经本 App 的 api/mcp operation（modal.generate/modal.save 等 capability:true）暴露。任务并发：运行（generate）与部署（deploy）
 *        按预设包独立排队（同一预设包单槽 FIFO、上限可经 engine.concurrency 调大；跨预设包并行）、同预设包内 deploy 与 generate 互斥且 deploy 优先、
 *        准备（prepare）全局单槽、权重（install）按预设包串行、停止（teardown）可并行；提交永不拒绝。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

const DOWNLOAD_SOURCES = new Set(["automatic", "huggingface", "modelscope"]);
const ACTIONS = new Set(["prepare", "deploy", "install", "generate", "teardown"]);
const RECORD_TABLES = { generate: "modal_generations" };
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const GENERATION_KINDS = new Set(["image", "video", "audio"]);
const PROFILES_PATH = "modal/profiles.json";
const SECRET_PATH = "modal/pending-secret.json";
// 上次成功探测（modal.status/modal.catalog）的就绪度快照：进入工作台时 modal.overview 直接回放它，
// 使首屏无需等待 modal CLI 就能显示正确的部署/权重状态，随后再由后台探测覆盖。
const STATUS_SNAPSHOT_KEY = "status_snapshot";

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
        { key: "seed", type: "number", default: -1, randomizable: true, label: { zh: "随机种子（-1 随机）", en: "Seed (-1 random)" } }
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
    expose: (manifest.expose && typeof manifest.expose === "object") ? manifest.expose : {},
    appName: engine.appName || manifest.id,
    sourceDir: sourceRel,
    origin,
    gpuTiers: engine.gpuTiers || { default: "T4", options: [] },
    concurrency: engine.concurrency || {},
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
      minReferences: f.minReferences || 0,
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

// GPU 档位解析：请求显式指定 > 全局默认 > 预设包自带的默认；三个候选都必须落在该预设包的
// options 内（跨预设包的残留档位、或没跟着预设包走的全局默认都会被忽略），否则回落到首个选项——
// 保证落到 runner 的档位一定是这个预设包声明过的。
function resolveGpuTier(modalapp, requested, ctx) {
  const options = ((modalapp.gpuTiers && modalapp.gpuTiers.options) || []).map((option) => option && option.gpu).filter(Boolean);
  const available = new Set(options);
  for (const candidate of [requested, defaultGpuTierSetting(ctx), defaultGpuTier(modalapp)]) {
    if (candidate && (!available.size || available.has(candidate))) return candidate;
  }
  return options[0] || defaultGpuTier(modalapp);
}

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

// 每个「预设包 + 函数」的「AI 调用默认参数」：Agent/平台默认路由未显式传入的字段用它补全（手动 UI 提交带 origin="manual"）。
function agentDefaults(ctx, modalappID, fnID) {
  ensureSchema(ctx);
  const rows = ctx.sqlite.query("select value from modal_settings where key = ?", [`agent_defaults:${modalappID}:${fnID}`]);
  if (!rows.length) return {};
  try {
    const parsed = JSON.parse(rows[0].value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) { return {}; }
}
function setAgentDefaults(ctx, modalappID, fnID, params) {
  ensureSchema(ctx);
  ctx.sqlite.execute("insert into modal_settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", [`agent_defaults:${modalappID}:${fnID}`, JSON.stringify(params || {})]);
  return params || {};
}

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

// registry（静态清单）+ 就绪度 states → 界面/平台消费的预设包形态。
// states 为 null 表示「本机还没有任何探测结果」：此时不输出 deployed/volumeReady/stale，
// 界面据此显示为「待检查」，而不是把「未知」误报成「尚未部署」。
function projectModalapps(ctx, registry, states) {
  // 只认「id → 就绪度」的映射：数组/其它形状（例如被 catalog 的投影数组写坏的历史快照）一律当作
  // 「没有探测结果」，否则 states[a.id] 取不到，会把所有预设包误报成「尚未部署」。
  const known = states && typeof states === "object" && !Array.isArray(states) ? states : null;
  return (registry.modalapps || []).map((a) => {
    const st = (known && known[a.id]) || {};
    const projected = {
      id: a.id, label: a.label || a.id, capability: a.capability, appName: a.appName || a.id,
      origin: a.origin || "builtin", sourceDir: a.sourceDir || "", path: sourceAbs(ctx, a),
      expose: a.expose || {},
      gpuTiers: a.gpuTiers || { default: "T4", options: [] },
      concurrency: a.concurrency || {},
      weights: a.weights || {}, profileId: a.profileId || "",
      // 逐产物就绪声明（key/volume/marker）与每个函数所需产物：就绪度据此逐项判定。
      artifacts: a.artifacts || [], requires: a.requires || {},
      functions: (a.functions || []).map((f) => ({
        id: f.id, label: f.label || f.id, entrypoint: f.entrypoint, output: f.output || { kind: "image", mimeType: "image/png", ext: "png" },
        formSchema: f.formSchema || [], defaultParams: f.defaultParams || {}, minReferences: f.minReferences || 0,
        agentDefaults: agentDefaults(ctx, a.id, f.id)
      }))
    };
    if (!known) return projected;
    return { ...projected, deployed: st.deployed === true, volumeReady: st.volumeReady === true, stale: st.stale === true, assets: st.assets || null };
  });
}

// 某函数所需产物键：预设包在 engine.requires 里逐函数声明；缺省按基础权重。
function requiredAssets(modalapp, fnId) {
  const requires = modalapp.requires || {};
  const keys = requires[fnId];
  return Array.isArray(keys) && keys.length ? keys : ["weights"];
}

// 缺失的产物键：assets 未探测（null）时不拦——与界面「未知不误报」一致；已探明为 false 才算缺失。
function missingAssets(modalapp, fnId) {
  const assets = modalapp.assets;
  if (!assets || typeof assets !== "object") return [];
  return requiredAssets(modalapp, fnId).filter((key) => assets[key] === false);
}

// models 是 modalapps 的平台模型就绪投影（供 app_media_bridge 的动态就绪面按 expose.model 匹配）：
// 只有 deployed && 就绪产物齐备时才 ready，平台据此把该模型标记为可用（"一旦 available 就注册"）。
// 就绪产物按 expose.function 判定——离线合并产物缺失时基础权重卷仍是就绪的，只看 volumeReady 会把
// 「缺合并产物」的模型误报为可用，提交后云端容器起不来（crash-loop）。
function projectModels(modalapps) {
  return modalapps.filter((a) => a.expose && a.expose.model).map((a) => {
    const fnId = (a.expose && a.expose.function) || (a.functions && a.functions[0] && a.functions[0].id) || "";
    const ready = a.deployed === true && a.volumeReady === true && missingAssets(a, fnId).length === 0;
    return {
      model: a.expose.model, app: a.expose.model, capability: a.capability, runtime: "modal",
      label: a.label || a.id, ready,
      weight: { installed: a.volumeReady === true, sizeGb: (a.weights && a.weights.sizeGb) || 0, source: "", revision: (a.weights && a.weights.revision) || "" }
    };
  });
}

// 提交前就绪度预检：目标函数所需产物（基础权重 / LoRA / 离线合并）缺失时直接拒绝，**不创建云端容器**。
// 云端函数在 @modal.enter(snap=True) 里检查这些前置，缺产物时容器会反复起不来（Modal 判定
// crash-looping 并重建容器，烧 GPU 且错误不落地）。只在预设包声明了逐产物就绪（artifacts）时才探测，
// 未声明的预设包不额外增加提交延迟。探测失败（拿不到状态）不拦——与界面「未知不误报」一致。
function assertAssetsReady(ctx, modalapp, fn) {
  const declares = Array.isArray(modalapp.artifacts) && modalapp.artifacts.length > 0;
  if (!declares || !fn) return;
  const userRoot = (ctx.paths && ctx.paths.appFilesRoot) || "";
  const args = ["status", "--profile", defaultProfileId(ctx), "--modalapp", modalapp.id];
  if (userRoot) args.push("--user-root", userRoot);
  let state = null;
  try { state = (run(ctx, args, 60).modalapps || {})[modalapp.id] || null; } catch (_) { state = null; }
  if (!state) return;
  if (state.deployed === false) {
    throw new Error(tr(ctx, `预设包 ${modalapp.id} 尚未部署：请先「准备（部署 + 权重）」后再运行。`, `${modalapp.id} is not deployed yet; run "Prepare (deploy + weights)" first.`));
  }
  const missing = missingAssets({ ...modalapp, assets: state.assets || null }, fn.id);
  if (missing.length) {
    throw new Error(tr(
      ctx,
      `预设包 ${modalapp.id} 的就绪产物缺失（${missing.join("、")}）：请先「准备（部署 + 权重）」完成合并后再运行。`,
      `${modalapp.id} is missing prepared artifacts (${missing.join(", ")}); run "Prepare (deploy + weights)" first.`
    ));
  }
}

function buildCatalog(ctx) {
  const registry = readRegistry(ctx);
  const status = envStatus(ctx, registry);
  const profiles = readProfiles(ctx);
  const modalapps = projectModalapps(ctx, registry, status.modalapps || {});
  return {
    ready: status.ready === true, connected: status.connected === true, error: status.error || "",
    account: status.account || "", modalapps, models: projectModels(modalapps),
    profiles: profiles.profiles.map(profileSummary),
    defaultProfileId: profiles.defaultProfileId || defaultProfileId(ctx),
    downloadSource: downloadSource(ctx), defaultGpuTier: defaultGpuTierSetting(ctx)
  };
}

// ---------------------- 就绪度快照（首屏零等待） ----------------------

function statusSnapshot(ctx) {
  const raw = settingGet(ctx, STATUS_SNAPSHOT_KEY, "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) { return null; }
}

// 快照里的 modalapps 一律存「id → 就绪度」的状态映射：status 给的就是映射，catalog 给的是投影数组。
// 统一成同一形状，否则 overview 回放时 states[a.id] 取不到，会把所有预设包误报成「尚未部署」。
function snapshotStates(modalapps) {
  if (Array.isArray(modalapps)) {
    return Object.fromEntries(modalapps.filter((a) => a && a.id).map((a) => [a.id, {
      deployed: a.deployed === true, volumeReady: a.volumeReady === true, stale: a.stale === true, assets: a.assets || null,
    }]));
  }
  return modalapps && typeof modalapps === "object" ? modalapps : {};
}

// 只快照「就绪度 + 连通性」：tasks/activeJob 是实时数据，缓存它们会在重连后显示过期状态。
// 且只在探测可信时写：本机 python 未就绪或未配置 token 时 runner 返回的是空表，
// 写进去会把「未知」误报成「尚未部署」，所以宁可不覆盖上次的好快照。
function writeStatusSnapshot(ctx, payload) {
  if (payload.ready !== true || payload.connected !== true) return;
  try {
    settingSet(ctx, STATUS_SNAPSHOT_KEY, JSON.stringify({
      ready: payload.ready, connected: payload.connected, account: payload.account, error: payload.error,
      modalapps: snapshotStates(payload.modalapps), checkedAt: payload.checkedAt,
    }));
  } catch (_) { /* 快照只是首屏加速，失败不影响探测本身 */ }
}

// modal.overview：首屏轻量负载——只读本机（registry.json + profiles + 设置）与上次快照，
// 不拉起 Python/modal CLI。预设包与函数表单立即可渲染，就绪度先按上次探测结果展示。
function overview(_, ctx) {
  ensureSchema(ctx);
  const registry = readRegistry(ctx);
  const profiles = readProfiles(ctx);
  const snapshot = statusSnapshot(ctx);
  return {
    modalapps: projectModalapps(ctx, registry, snapshot ? snapshot.modalapps : null),
    profiles: profiles.profiles.map(profileSummary),
    defaultProfileId: profiles.defaultProfileId || defaultProfileId(ctx),
    downloadSource: downloadSource(ctx), defaultGpuTier: defaultGpuTierSetting(ctx),
    snapshot,
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

// media 字段 → 带角色标记的参考素材列表。入参优先用按字段分组的 `references`（{field:[assetId]}，App UI 走这条）；
// 平台执行桥只给扁平有序的 `referenceAssetIds`，此时单字段函数直接落到该字段，多字段函数留空由契约层按 mimeType 推断。
function mediaFieldsOf(fn) { return ((fn && fn.formSchema) || []).filter((field) => field && field.type === "media"); }

function collectReferences(fn, input) {
  const fields = mediaFieldsOf(fn);
  const grouped = (input.references && typeof input.references === "object") ? input.references : null;
  const collected = [];
  if (grouped) {
    for (const field of fields) {
      const ids = Array.isArray(grouped[field.key]) ? grouped[field.key] : (grouped[field.key] ? [grouped[field.key]] : []);
      for (const assetId of ids) { if (assetId) collected.push({ assetId, field: field.key }); }
    }
    return collected;
  }
  const flat = Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds : [];
  const onlyField = fields.length === 1 ? fields[0].key : "";
  for (const assetId of flat) { if (assetId) collected.push({ assetId, field: onlyField }); }
  return collected;
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

// 从任务日志尾部提炼一条可读的失败原因：优先最近的错误行（crash-loop / RuntimeError / Traceback…），
// 否则退回最后一行。终态 failed 的任务用它替代「exit status 1」这种无信息量的 shell 报错。
function errorFromLogs(ctx, shellJobID, fallback) {
  let logs = [];
  try { logs = ctx.shell.logs(shellJobID) || []; } catch (_) { logs = []; }
  const lines = logs.map((entry) => String(entry.text || "")).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/crash-looping|RuntimeError|Traceback|Error|错误|失败|异常/.test(lines[index])) return lines[index];
  }
  return lines[lines.length - 1] || fallback || "unknown error";
}

function settleTaskRow(ctx, row) {
  const closeWith = (state, error) => {
    // 失败/中断时用日志里最后一条有信息量的错误替代空泛 shell 报错；完成/取消不做
    //（那时的末行只是心跳或收尾，替换反而误导）。这样云端 crash-loop 的错误能落到任务与记录上。
    let detail = error || "";
    if ((state === "failed" || state === "interrupted") && row.shell_job_id) {
      detail = errorFromLogs(ctx, row.shell_job_id, detail);
    }
    settleOutput(ctx, row.action, row.record_id, { status: state === "completed" ? "completed" : "failed", error: detail });
    if (state === "completed" && row.action === "generate") applyGenerationMeta(ctx, row.record_id);
    if (row.action === "deploy" || row.action === "install") noteEnvOutcome(ctx, row, { status: state, error: detail });
    const finalState = state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : state === "interrupted" ? "interrupted" : "failed";
    closeTaskById(ctx, row.id, finalState, detail);
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

// 预设包声明的并发上限（engine.concurrency）：缺省/非法 => 1（同一预设包内单槽 FIFO）。
function concurrencyLimit(registry, modalappID, action) {
  const def = appDef(registry, modalappID);
  const n = Number(def && def.concurrency && def.concurrency[action]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

const TASK_COLUMNS = "id, action, record_id, modalapp, meta_json, payload_json, log_path";

// 队列引擎：结算 → 守卫派发。运行（generate）/部署（deploy）按预设包独立排队（同一应用单槽、上限可配
// engine.concurrency；跨应用并行）；同应用内 deploy 与 generate 互斥、deploy 优先；prepare 全局单槽（共用一个
// 本机 venv）并阻塞运行/部署；install 按预设包串行；teardown 并行。
function pumpQueue(ctx) {
  ensureSchema(ctx);
  settleAllJobs(ctx);
  // registry 只在真的要为某个排队任务解析并发上限时读一次（常见路径没有排队任务，省掉一次 registry 读取/解析）。
  let registry = null;
  const getRegistry = () => (registry || (registry = readRegistry(ctx)));
  const actives = ctx.sqlite.query("select action, state, modalapp from modal_tasks where state in ('queued','running')");
  // 计数按 (action, modalapp) 维度；派发后本地自增（actives 是派发前快照，不能再用它判上限）。
  const running = {};
  for (const row of actives) {
    if (row.state !== "running") continue;
    const key = `${row.action}:${row.modalapp}`;
    running[key] = (running[key] || 0) + 1;
  }
  const runningCount = (action, modalapp) => running[`${action}:${modalapp}`] || 0;
  const bump = (action, modalapp) => { const key = `${action}:${modalapp}`; running[key] = (running[key] || 0) + 1; };
  const queued = (action) => ctx.sqlite.query(`select ${TASK_COLUMNS} from modal_tasks where action = '${action}' and state = 'queued' order by created_at asc`);

  // prepare：本 App 一个 venv（与预设包无关，行上 modalapp 为空），全局单槽；运行中或已排队时不再派发。
  const prepareRunning = actives.some((row) => row.action === "prepare" && row.state === "running");
  const prepareBusy = prepareRunning || actives.some((row) => row.action === "prepare" && row.state === "queued");
  if (!prepareRunning) {
    const nextPrepare = ctx.sqlite.query(`select ${TASK_COLUMNS} from modal_tasks where action = 'prepare' and state = 'queued' order by created_at asc limit 1`);
    if (nextPrepare.length) dispatchTask(ctx, nextPrepare[0]);
  }

  // deploy：按预设包独立排队；同应用内与 generate 互斥且优先。
  for (const row of queued("deploy")) {
    if (prepareBusy) continue;
    if (runningCount("deploy", row.modalapp) >= concurrencyLimit(getRegistry(), row.modalapp, "deploy")) continue;
    if (runningCount("generate", row.modalapp) > 0) continue;
    dispatchTask(ctx, row); bump("deploy", row.modalapp);
  }

  // generate：按预设包独立排队（上限可配）；同应用内与 deploy 互斥。
  for (const row of queued("generate")) {
    if (prepareBusy) continue;
    if (runningCount("generate", row.modalapp) >= concurrencyLimit(getRegistry(), row.modalapp, "generate")) continue;
    if (runningCount("deploy", row.modalapp) > 0) continue;
    dispatchTask(ctx, row); bump("generate", row.modalapp);
  }

  // install：同一预设包不并发写同一 Volume；不同预设包可并行。
  for (const row of queued("install")) {
    if (runningCount("install", row.modalapp) > 0) continue;
    dispatchTask(ctx, row); bump("install", row.modalapp);
  }

  // teardown：可并行。
  for (const row of queued("teardown")) dispatchTask(ctx, row);
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

// 运行中的生成任务：仅靠 ctx.shell.cancel 到不了云端——平台取消会把本机进程树 SIGKILL（不可捕获），
// runner 的 SIGTERM handler 与其中的 FunctionCall.cancel() 根本不会执行，云端 GPU 会继续烧。
// runner 在 spawn 后把 Modal 调用 ID 落在 generations/<recordId>.call_id，这里按 ID 直接发起取消；
// 失败也只是尽力而为——随后仍会终止本机 shell job，二者互补。
// 返回一句告警（拿不到调用 ID / 取消请求失败）：此时云端容器可能仍在跑，甚至与下一次调用并存
// （同一 App 两个容器同时冷启动），必须让用户看得到，而不是静默放过。
function cancelRemoteCall(ctx, row) {
  if (row.action !== "generate" || !row.record_id) return "";
  let callId = "";
  try { callId = String(ctx.files.readText(`generations/${row.record_id}.call_id`) || "").trim(); } catch (_) { callId = ""; }
  if (!callId) {
    return tr(ctx, "未找到云端调用 ID，云端容器可能仍在运行（可用「停止环境」手动收敛）。", "Cloud call id not found; the cloud container may still be running (use \"Stop environment\" to converge).");
  }
  try {
    const registry = readRegistry(ctx);
    runProfile(ctx, registry, appDef(registry, row.modalapp), ["cancel", "--call-id", callId], 60);
  } catch (_) {
    return tr(ctx, "云端取消请求未成功，容器可能仍在运行。", "Remote cancel request failed; the container may still be running.");
  }
  return "";
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
    const warning = cancelRemoteCall(ctx, row);
    try { ctx.shell.cancel(row.shell_job_id); } catch (_) { /* 平台已结算时忽略 */ }
    return warning ? { cancelled: true, id: row.id, warning } : { cancelled: true, id: row.id };
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
function getTaskParams(ctx, input) {
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
  const summary = {
    ready: env.ready === true, connected: env.connected === true, account: env.account || "",
    error: env.error || "", modalapps: env.modalapps || {},
  };
  // 记下这次探测的时间与结果：界面用 checkedAt 判断快照是否新鲜（过期才在点击运行时重探），
  // 且下次进入工作台可直接回放，不必再等 modal CLI。
  const checkedAt = new Date().toISOString();
  writeStatusSnapshot(ctx, { ...summary, checkedAt });
  return {
    ...summary, checkedAt, pending: !pythonReady,
    profiles: readProfiles(ctx).profiles.map(profileSummary),
    defaultProfileId: defaultProfileId(ctx), downloadSource: downloadSource(ctx), defaultGpuTier: defaultGpuTierSetting(ctx),
    activeJob, activeTask: latest, tasks, ...(envFailure || {})
  };
}

function catalog(_, ctx) {
  const payload = buildCatalog(ctx);
  writeStatusSnapshot(ctx, { ...payload, checkedAt: new Date().toISOString() });
  return payload;
}

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

// 更新 profile：name 缺省表示不改；tokenId/tokenSecret 必须成对提供（整体替换），都不传则只改名/改默认。
function profilesUpdate(input, ctx) {
  ensureSchema(ctx);
  const id = value(input, "id");
  if (!id) throw new Error("id is required");
  const data = readProfiles(ctx);
  const profile = data.profiles.find((item) => item.id === id);
  if (!profile) throw new Error("unknown profile: " + id);
  const name = value(input, "name");
  if (name) profile.name = name;
  const tokenId = value(input, "tokenId");
  const tokenSecret = value(input, "tokenSecret");
  if (tokenId || tokenSecret) {
    if (!tokenId || !tokenSecret) throw new Error("tokenId and tokenSecret are required together");
    profile.tokenId = tokenId;
    profile.tokenSecret = tokenSecret;
  }
  if (input.makeDefault === true) data.defaultProfileId = id;
  writeProfiles(ctx, data);
  if (data.defaultProfileId) settingSet(ctx, "default_profile_id", data.defaultProfileId);
  return { profile: profileSummary(profile), defaultProfileId: data.defaultProfileId };
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
  const defaults = input.agentDefaults;
  if (defaults && typeof defaults === "object") {
    const modalapp = appDef(readRegistry(ctx), value(defaults, "modalapp"));
    if (!modalapp) throw new Error("unknown modalapp: " + value(defaults, "modalapp"));
    const fn = functionDef(modalapp, value(defaults, "function")) || (modalapp.functions || [])[0];
    if (!fn) throw new Error("unknown function: " + value(defaults, "function") + " in " + modalapp.id);
    const params = (defaults.params && typeof defaults.params === "object") ? defaults.params : {};
    const stored = coerceParams(fn, params);
    // gpuTier 不是 formSchema 字段，会被 coerceParams 丢弃；单独保留，作为该函数 AI/Agent 调用未显式指定时的默认 GPU 档位。
    const tier = typeof params.gpuTier === "string" ? params.gpuTier.trim() : "";
    if (tier) stored.gpuTier = tier;
    setAgentDefaults(ctx, modalapp.id, fn.id, stored);
  }
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
        { key: "seed", type: "number", default: -1, randomizable: true, label: { zh: "随机种子（-1 随机）", en: "Seed (-1 random)" } },
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

// 解析生成目标：App 内调用走 modalapp + function；平台执行桥只传一个平台模型简单名（model），
// 按 modalapps 的 expose.model 命中预设包并用其 expose.function（缺省取首个函数）。平台路由表示用户已在
// 平台侧选择该模型（视频另经平台提案确认门），因此不再重复 App 的 confirmCost 门。
function resolveTarget(registry, input) {
  const explicit = appDef(registry, value(input, "modalapp"));
  if (explicit) return { modalapp: explicit, fn: functionDef(explicit, value(input, "function")), platform: false };
  const model = value(input, "model");
  if (!model) return { modalapp: null, fn: null, platform: false };
  const app = (registry.modalapps || []).find((a) => a.expose && a.expose.model === model) || appDef(registry, model);
  if (!app) return { modalapp: null, fn: null, platform: true };
  let fn = functionDef(app, (app.expose && app.expose.function) || "") || (app.functions || [])[0] || null;
  // 平台执行桥只按 model 路由、不分函数：若请求未带任何参考素材，而 expose.function 需要参考，
  // 自动回退到同输出类型的纯文生函数（text-to-*），使「有参考走参考、无参考走文生」自动成立。
  const hasReferences = Array.isArray(input.referenceAssetIds) && input.referenceAssetIds.length > 0;
  if (fn && !hasReferences && Number(fn.minReferences || 0) > 0) {
    const wanted = (fn.output && fn.output.kind) || "";
    const fallback = (app.functions || []).find((candidate) => Number(candidate.minReferences || 0) === 0 && ((candidate.output && candidate.output.kind) || "") === wanted);
    if (fallback) fn = fallback;
  }
  return { modalapp: app, fn, platform: true };
}

function generate(input, ctx) {
  ensureSchema(ctx);
  const registry = readRegistry(ctx);
  const target = resolveTarget(registry, input);
  const modalapp = target.modalapp;
  if (!modalapp) throw new Error("unknown modalapp: " + (value(input, "modalapp") || value(input, "model")));
  const fn = target.fn;
  if (!fn) throw new Error("unknown function: " + value(input, "function") + " in " + modalapp.id);
  if (!target.platform && requireCostConfirm(ctx) && input.confirmCost !== true) {
    throw new Error(tr(ctx, "云端 GPU 调用会消耗 Modal 额度，请显式传入 confirmCost: true 确认后重试。", "Cloud GPU calls consume Modal credits; pass confirmCost: true to confirm."));
  }
  // 提交前预检就绪产物（缺离线合并产物时云端容器会 crash-loop，且错误不落地）——不满足就直接拒绝，不派发。
  assertAssetsReady(ctx, modalapp, fn);
  const baseParams = (input.params && typeof input.params === "object") ? input.params : input;
  // 平台执行桥把提示词与表单参数分开传（prompt + params）；App 内调用则直接用 params/表单字段。
  const rawParams = (value(input, "prompt") && baseParams.prompt === undefined) ? { ...baseParams, prompt: value(input, "prompt") } : baseParams;
  // 仅 AI/Agent 与平台默认路由调用补配置的默认参数；App 内手动提交（origin="manual"）完全按表单值。
  const fromUI = value(input, "origin") === "manual";
  const defaults = fromUI ? {} : agentDefaults(ctx, modalapp.id, fn.id);
  const merged = fromUI ? rawParams : { ...defaults, ...rawParams };
  const params = coerceParams(fn, merged);
  const collected = collectReferences(fn, input);
  const refsByField = {};
  for (const item of collected) refsByField[item.field] = (refsByField[item.field] || 0) + 1;
  // media 字段不进 params，经按字段分组的参考素材传入，故单独按字段校验 required 与函数级 minReferences。
  for (const field of (fn.formSchema || [])) {
    if (!field || !field.required) continue;
    if (field.type === "media") {
      if (!(refsByField[field.key] > 0)) throw new Error(`${field.key} is required`);
      continue;
    }
    if (params[field.key] === undefined || params[field.key] === "") throw new Error(`${field.key} is required`);
  }
  const minReferences = Number(fn.minReferences || 0);
  if (minReferences > 0 && collected.length < minReferences) {
    throw new Error(tr(ctx, `该函数至少需要 ${minReferences} 个参考素材（图像/视频/音频）。`,
      `This function needs at least ${minReferences} reference asset(s) (image/video/audio).`));
  }
  // 档位优先取请求显式值；Agent/平台调用再回落到该函数配置的 AI 默认 GPU，然后才是全局默认与预设包默认。
  const gpu = resolveGpuTier(modalapp, value(input, "gpuTier") || defaults.gpuTier, ctx);
  const profileId = value(input, "profileId") || resolveProfileId(ctx, registry, modalapp);
  const refs = [];
  const referenceIds = [];
  for (const item of collected) {
    try {
      const materialized = ctx.media.materialize(item.assetId, { reference: true, model: (modalapp.expose && modalapp.expose.model) || modalapp.id });
      const ref = { path: materialized.path, name: materialized.name || item.assetId, mimeType: materialized.mimeType || "" };
      if (item.field) ref.field = item.field;
      refs.push(ref);
      referenceIds.push(item.assetId);
    } catch (_) { /* skip missing reference */ }
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
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, modalapp, state from modal_tasks where state in ('queued','running') order by created_at desc limit 1");
  if (!rows.length) return { cancelled: false };
  return cancelTaskRow(ctx, rows[0]);
}

function tasksList(input, ctx) { return listTasks(ctx, input || {}); }
function taskGet(input, ctx) { return getTask(ctx, input); }
function taskParams(input, ctx) { return getTaskParams(ctx, input); }
function taskLogs(input, ctx) { return readTaskLogs(ctx, input); }
function taskCancel(input, ctx) {
  ensureSchema(ctx);
  pumpQueue(ctx);
  const id = value(input, "id");
  const rows = ctx.sqlite.query("select id, shell_job_id, action, record_id, modalapp, state from modal_tasks where id = ?", [id]);
  if (!rows.length) return { cancelled: false };
  if (!isActiveJob(rows[0].state)) return { cancelled: false };
  return cancelTaskRow(ctx, rows[0]);
}

recut.operation.register("modal.status", status);
recut.operation.register("modal.overview", overview);
recut.operation.register("modal.catalog", catalog);
recut.operation.register("modal.profiles.add", profilesAdd);
recut.operation.register("modal.profiles.list", profilesList);
recut.operation.register("modal.profiles.remove", profilesRemove);
recut.operation.register("modal.profiles.update", profilesUpdate);
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
