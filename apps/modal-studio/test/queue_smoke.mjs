// L1 队列并发测试：按预设包隔离（不同 modalapp 不互相排队）
// 用 node:sqlite + mock 平台 ctx 驱动 background.js 的真实 pumpQueue 路径：直接往 modal_tasks 里种
// 「queued」行，再经 modal.tasks.list（它先 pumpQueue）触发派发，断言每条任务的终态。
//   1) 跨预设包：两个不同 modalapp 的 generate 同时 running
//   2) 同预设包：generate 单槽 FIFO（第二条 queued）
//   3) 跨预设包：deploy(A) 与 generate(B) 并行
//   4) 同预设包：deploy 优先于更早排队的 generate
//   5) engine.concurrency.generate=2 的预设包：同一应用内两条 generate 都 running
//   6) prepare 全局单槽：会阻塞其它预设包的 generate（本机共用一个 venv）
//   7) 运行中 generate 取消：按 generations/<recordId>.call_id 直接取消云端 Modal 调用，并终止本地 shell job
//   8) 删除终态任务（modal.task.remove）：任务行/生成记录移除、私有文件交给 rm 清理；运行中的任务拒绝删除
// 运行：node test/queue_smoke.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, "..");
const code = readFileSync(path.join(appRoot, "background.js"), "utf8");
const registry = readFileSync(path.join(appRoot, "python", "registry.json"), "utf8");

// 带 engine.concurrency.generate=2 的用户预设包（走 normalizeManifest 的用户分支）。
const FAST_MANIFEST = JSON.stringify({
  id: "fast-app",
  name: { zh: "快应用", en: "Fast app" },
  capability: "image.generate",
  engine: { appName: "recut-fast-app", concurrency: { generate: 2 } },
  weights: { sizeGb: 1 },
  functions: [{ id: "run", name: { zh: "运行", en: "Run" }, entrypoint: "run", output: { kind: "image", mimeType: "image/png", ext: "png" }, formSchema: [] }],
});

const ops = {};
const recutMock = { operation: { register: (name, fn) => { ops[name] = fn; } } };

// 每次一个全新的内存数据库；python.run 返回一个持续 running 的 shell job，因此派发出去的任务不会自行结算。
function makeWorld({ withFastApp = false, filesText = {}, execArgs = [], cancelled = [] } = {}) {
  const db = new DatabaseSync(":memory:");
  const sqlite = {
    execute: (sql, params = []) => {
      try {
        const info = db.prepare(sql).run(...params);
        return { rowsAffected: Number(info && info.changes != null ? info.changes : 0) };
      } catch (e) {
        if (!String(e.message).includes("duplicate column")) throw e;
        return { rowsAffected: 0 };
      }
    },
    query: (sql, params = []) => db.prepare(sql).all(...params),
  };
  let seq = 0;
  const ctx = {
    locale: "zh",
    sqlite,
    paths: { appRoot, appFilesRoot: "/appstate" },
    app: { readText: (name) => (name === "python/registry.json" ? registry : "") },
    appFiles: withFastApp
      ? { list: () => ["fast-app"], readText: (name) => (name === "modalapps/fast-app/manifest.json" ? FAST_MANIFEST : "") }
      : { list: () => [], readText: () => "" },
    files: { readText: (name) => filesText[name] ?? "", writeText: () => {}, url: () => "http://preview" },
    shell: {
      exec: (spec) => { execArgs.push(spec); return { stdout: "\n", exitCode: 0 }; },
      status: (id) => ({ id, status: "running" }),
      logs: () => [],
      cancel: (id) => { cancelled.push(id); },
    },
    python: { status: () => ({ ready: true }), prepare: () => ({ id: `sj-${++seq}`, status: "running" }), run: () => ({ id: `sj-${++seq}`, status: "running" }) },
    media: { materialize: () => ({ path: "/sandbox/x", name: "x" }), importFile: () => ({ id: "asset-1" }) },
  };

  // 第一次 seed 前先让 background.js 建表（ensureSchema 只在操作调用时跑）。
  let schemaReady = false;
  const seed = (id, action, modalapp, createdAt) => {
    if (!schemaReady) { ops["modal.tasks.list"]({ limit: 1 }, ctx); schemaReady = true; }
    db.prepare("insert into modal_tasks (id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, '', ?, ?, '', '', 'manual', '', 'queued', 0, '{}', '{}', ?, '', ?, '', '')")
      .run(id, action, modalapp, `tasks/${id}.log`, createdAt);
  };
  const states = () => Object.fromEntries(sqlite.query("select id, state from modal_tasks").map((r) => [r.id, r.state]));
  const pump = () => ops["modal.tasks.list"]({ limit: 50 }, ctx);
  return { ctx, db, seed, states, pump };
}

vm.runInNewContext(code, {
  recut: recutMock, console, JSON, Date, Math, Set, Map, Number, String, Boolean, Error,
  Object, Array, Promise, RegExp,
});
if (!ops["modal.tasks.list"]) { console.error("FAIL op registration", Object.keys(ops)); process.exit(1); }

let failures = 0;
const check = (name, cond) => { if (cond) console.log(`  ok  ${name}`); else { failures++; console.log(` FAIL ${name}`); } };

// S1：跨预设包 generate 并行（A 不等 B）
{
  const w = makeWorld();
  w.seed("a1", "generate", "sd-turbo", "2026-01-01T00:00:00.000Z");
  w.seed("b1", "generate", "qwen-image-2.1", "2026-01-01T00:00:01.000Z");
  w.pump();
  const s = w.states();
  check("S1 跨预设包 generate 并行", s.a1 === "running" && s.b1 === "running");
}

// S2：同预设包 generate 单槽 FIFO
{
  const w = makeWorld();
  w.seed("a1", "generate", "sd-turbo", "2026-01-01T00:00:00.000Z");
  w.seed("a2", "generate", "sd-turbo", "2026-01-01T00:00:01.000Z");
  w.pump();
  const s = w.states();
  check("S2 同预设包 generate 单槽（早的 running / 晚的 queued）", s.a1 === "running" && s.a2 === "queued");
}

// S3：deploy(A) 与 generate(B) 并行（跨预设包不互斥）
{
  const w = makeWorld();
  w.seed("d1", "deploy", "sd-turbo", "2026-01-01T00:00:00.000Z");
  w.seed("g1", "generate", "qwen-image-2.1", "2026-01-01T00:00:01.000Z");
  w.pump();
  const s = w.states();
  check("S3 跨预设包 deploy + generate 并行", s.d1 === "running" && s.g1 === "running");
}

// S4：同预设包内 deploy 优先于更早排队的 generate
{
  const w = makeWorld();
  w.seed("g1", "generate", "sd-turbo", "2026-01-01T00:00:00.000Z");
  w.seed("d1", "deploy", "sd-turbo", "2026-01-01T00:00:01.000Z");
  w.pump();
  const s = w.states();
  check("S4 同预设包 deploy 优先，generate 让位保持 queued", s.d1 === "running" && s.g1 === "queued");
}

// S5：engine.concurrency.generate=2 → 同一应用两条 generate 都 running
{
  const w = makeWorld({ withFastApp: true });
  w.seed("f1", "generate", "fast-app", "2026-01-01T00:00:00.000Z");
  w.seed("f2", "generate", "fast-app", "2026-01-01T00:00:01.000Z");
  w.pump();
  const s = w.states();
  check("S5 engine.concurrency.generate=2 生效", s.f1 === "running" && s.f2 === "running");
}

// S5b：并发上限只在声明的应用生效，内置默认应用不受影响
{
  const w = makeWorld({ withFastApp: true });
  w.seed("s1", "generate", "sd-turbo", "2026-01-01T00:00:00.000Z");
  w.seed("s2", "generate", "sd-turbo", "2026-01-01T00:00:01.000Z");
  w.pump();
  const s = w.states();
  check("S5b 内置应用仍单槽", s.s1 === "running" && s.s2 === "queued");
}

// S6：prepare 全局单槽，阻塞其它预设包的 generate
{
  const w = makeWorld();
  w.seed("p1", "prepare", "sd-turbo", "2026-01-01T00:00:00.000Z");
  w.seed("g1", "generate", "qwen-image-2.1", "2026-01-01T00:00:01.000Z");
  w.pump();
  const s = w.states();
  check("S6 prepare 全局单槽并阻塞 generate", s.p1 === "running" && s.g1 === "queued");
}

// S7：同一时刻只有一个 prepare（prepare 行 modalapp 为空，守卫不能依赖 modalapp）
{
  const w = makeWorld();
  w.seed("p1", "prepare", "", "2026-01-01T00:00:00.000Z");
  w.seed("p2", "prepare", "", "2026-01-01T00:00:01.000Z");
  w.pump();
  const s = w.states();
  check("S7 prepare 全局单槽（第二条 queued）", s.p1 === "running" && s.p2 === "queued");
}

// S7b：已有 running 的 prepare 时不再派发新的 prepare
{
  const w = makeWorld();
  w.seed("p0", "prepare", "", "2026-01-01T00:00:00.000Z");
  w.pump();
  w.seed("p1", "prepare", "", "2026-01-01T00:00:01.000Z");
  w.pump();
  const s = w.states();
  check("S7b running prepare 期间不重复派发", s.p0 === "running" && s.p1 === "queued");
}

// S10：running 但尚无 shell_job_id 的瞬态窗口不得被并发结算误杀（回归：并发提交时任务仍在跑却被标失败）
{
  const w = makeWorld();
  w.pump(); // ensureSchema
  const fresh = new Date().toISOString();
  const stale = new Date(Date.now() - 10 * 60000).toISOString();
  const insertRunning = (id, startedAt) => w.db.prepare("insert into modal_tasks (id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, '', 'generate', 'sd-turbo', 'text-to-image', ?, 'manual', '', 'running', 0, '{}', '{}', ?, '', ?, ?, '')")
    .run(id, `gen-${id}`, `tasks/${id}.log`, startedAt, startedAt);
  insertRunning("t-fresh", fresh);
  insertRunning("t-stale", stale);
  w.pump();
  const s = w.states();
  check("S10 瞬态 running（窗口内无 shell_job_id）保持 running", s["t-fresh"] === "running");
  check("S10 超期 running（无 shell_job_id）回收为 failed", s["t-stale"] === "failed");
}

// S8：运行中 generate 取消 → 先按落盘的调用 ID 直接取消云端，再终止本地 shell job
{
  const execArgs = [];
  const cancelled = [];
  const w = makeWorld({ filesText: { "generations/gen-1.call_id": "fc-123" }, execArgs, cancelled });
  w.pump(); // ensureSchema
  w.db.prepare("insert into modal_tasks (id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, ?, ?, ?, ?, ?, 'manual', '', 'running', 0, '{}', '{}', ?, '', ?, '', '')")
    .run("g1", "sj-9", "generate", "sd-turbo", "text-to-image", "gen-1", "tasks/g1.log", "2026-01-01T00:00:00.000Z");
  const result = ops["modal.task.cancel"]({ id: "g1" }, w.ctx);
  const remote = execArgs.map((spec) => (spec.args || []).join(" ")).find((line) => line.includes("cancel") && line.includes("--call-id") && line.includes("fc-123"));
  check("S8 运行中取消：按调用 ID 直接取消云端调用", Boolean(remote));
  check("S8 运行中取消：返回 cancelled 且终止本地 shell job", result.cancelled === true && cancelled.includes("sj-9"));
}

// S8b：没有调用 ID 文件时跳过远程取消，但仍终止本地 shell job（远程取消是尽力而为）
{
  const execArgs = [];
  const cancelled = [];
  const w = makeWorld({ execArgs, cancelled });
  w.pump();
  w.db.prepare("insert into modal_tasks (id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, ?, ?, ?, ?, ?, 'manual', '', 'running', 0, '{}', '{}', ?, '', ?, '', '')")
    .run("g2", "sj-10", "generate", "sd-turbo", "text-to-image", "gen-2", "tasks/g2.log", "2026-01-01T00:00:00.000Z");
  ops["modal.task.cancel"]({ id: "g2" }, w.ctx);
  check("S8b 无调用 ID：不发起远程取消，仍终止本地 shell job", execArgs.length === 0 && cancelled.includes("sj-10"));
}

// S8c：拿不到调用 ID 时返回告警（云端容器可能仍在跑，甚至与下一次调用并存）
{
  const cancelled = [];
  const w = makeWorld({ cancelled });
  w.pump();
  w.db.prepare("insert into modal_tasks (id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, ?, ?, ?, ?, ?, 'manual', '', 'running', 0, '{}', '{}', ?, '', ?, '', '')")
    .run("g3", "sj-11", "generate", "sd-turbo", "text-to-image", "gen-3", "tasks/g3.log", "2026-01-01T00:00:00.000Z");
  const result = ops["modal.task.cancel"]({ id: "g3" }, w.ctx);
  check("S8c 无调用 ID：返回「云端可能仍在运行」告警", result.cancelled === true && typeof result.warning === "string" && result.warning.length > 0 && cancelled.includes("sj-11"));
}

// S9：日志按「末尾」分页 —— 长日志先给最新的，nextCursor 回退取更早的（不再只显示最旧的一段）
{
  const lines = Array.from({ length: 1200 }, (_, i) => JSON.stringify({ ts: "", level: "info", message: `line-${i}` }));
  const w = makeWorld({ filesText: { "tasks/g4.log": `${lines.join("\n")}\n` } });
  w.pump();
  w.db.prepare("insert into modal_tasks (id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, ?, ?, ?, ?, ?, 'manual', '', 'completed', 0, '{}', '{}', ?, '', ?, '', '')")
    .run("g4", "sj-12", "generate", "sd-turbo", "text-to-image", "gen-4", "tasks/g4.log", "2026-01-01T00:00:00.000Z");

  const first = ops["modal.task.logs"]({ id: "g4", limit: 500 }, w.ctx);
  check("S9 首页是日志末尾（最新 500 行）", first.logs.length === 500 && first.logs[499].message === "line-1199");
  check("S9 nextCursor 指向更早的一页", first.nextCursor === 700);

  const second = ops["modal.task.logs"]({ id: "g4", limit: 500, cursor: first.nextCursor }, w.ctx);
  check("S9 回退一页取到更早的 500 行", second.logs.length === 500 && second.logs[0].message === "line-200" && second.logs[499].message === "line-699");

  const third = ops["modal.task.logs"]({ id: "g4", limit: 500, cursor: second.nextCursor }, w.ctx);
  check("S9 末页到达头部且 nextCursor=null", third.logs.length === 200 && third.logs[0].message === "line-0" && third.logs[199].message === "line-199" && third.nextCursor === null);
}

// S11：删除终态任务 —— 任务行与生成记录一并移除，私有文件（日志 + generations 产物/meta/call_id）交给 rm 清理
{
  const execArgs = [];
  const w = makeWorld({ execArgs });
  w.pump(); // ensureSchema
  w.db.prepare("insert into modal_tasks (id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, ?, ?, ?, ?, ?, 'manual', '', 'completed', 0, '{}', '{}', ?, '', ?, '', ?)")
    .run("g5", "sj-13", "generate", "sd-turbo", "text-to-image", "gen-5", "tasks/g5.log", "2026-01-01T00:00:00.000Z", "2026-01-01T00:01:00.000Z");
  w.db.prepare("insert into modal_generations (id, modalapp, function, model, capability, output_kind, mime_type, params_json, prompt, reference_asset_ids, output_path, width, height, duration, seed, gpu_tier, saved_asset_id, created_at, job_id, status, error) values (?, 'sd-turbo', 'text-to-image', 'sd-turbo', 'image.generate', 'image', 'image/png', '{}', 'p', '[]', 'generations/gen-5.png', 0, 0, 0, 0, '', '', '2026-01-01T00:00:00.000Z', '', 'completed', '')")
    .run("gen-5");
  const result = ops["modal.task.remove"]({ id: "g5" }, w.ctx);
  const remainingTasks = w.db.prepare("select count(*) as n from modal_tasks where id = 'g5'").get().n;
  const remainingGens = w.db.prepare("select count(*) as n from modal_generations where id = 'gen-5'").get().n;
  const rm = execArgs.find((spec) => spec.command === "rm");
  const cleaned = rm ? rm.args : [];
  check("S11 删除终态任务：任务行移除", result.removed === true && remainingTasks === 0);
  check("S11 删除生成任务：生成记录移除", remainingGens === 0);
  check("S11 清理私有文件（日志 + generations 产物/meta/call_id）", ["tasks/g5.log", "tasks/g5.params.json", "tasks/g5.refs.json", "generations/gen-5.png", "generations/gen-5.png.meta.json", "generations/gen-5.call_id"].every((p) => cleaned.includes(p)));
}

// S11b：运行中的任务不可删除（须先取消）
{
  const w = makeWorld();
  w.seed("g6", "generate", "sd-turbo", "2026-01-01T00:00:00.000Z");
  w.pump(); // queued → running（mock python.run 返回 running）
  let threw = false;
  try { ops["modal.task.remove"]({ id: "g6" }, w.ctx); } catch (_) { threw = true; }
  check("S11b 运行中的任务拒绝删除", threw && w.states().g6 === "running");
}

// S11c：删除非 generate 任务只清任务文件，不碰 modal_generations
{
  const execArgs = [];
  const w = makeWorld({ execArgs });
  w.pump();
  w.db.prepare("insert into modal_tasks (id, shell_job_id, action, modalapp, function, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, ?, 'deploy', ?, '', '', 'manual', '', 'completed', 0, '{}', '{}', ?, '', ?, '', ?)")
    .run("d5", "sj-15", "sd-turbo", "tasks/d5.log", "2026-01-01T00:00:00.000Z", "2026-01-01T00:01:00.000Z");
  const result = ops["modal.task.remove"]({ id: "d5" }, w.ctx);
  const rm = execArgs.find((spec) => spec.command === "rm");
  check("S11c 删除部署任务：行移除且只清任务文件", result.removed === true && w.db.prepare("select count(*) as n from modal_tasks where id = 'd5'").get().n === 0 && Boolean(rm) && !(rm.args || []).some((a) => String(a).startsWith("generations/")));
}

console.log(failures ? `\n${failures} failing` : "\nall checks passed");
process.exit(failures ? 1 : 0);