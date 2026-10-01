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
    execute: (sql, params = []) => { try { db.prepare(sql).run(...params); } catch (e) { if (!String(e.message).includes("duplicate column")) throw e; } },
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

console.log(failures ? `\n${failures} failing` : "\nall checks passed");
process.exit(failures ? 1 : 0);
