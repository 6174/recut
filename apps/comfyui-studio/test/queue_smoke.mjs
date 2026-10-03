// L1 队列回归测试：并发提交时「running 但尚无 shell_job_id」的瞬态窗口不得被 settleAllJobs 误判为启动失败。
// 用 node:sqlite + mock 平台 ctx 驱动 background.js 真实代码路径（与平台相同的 (input, ctx) 调用约定）。
//   1) queued generate 正常派发（原子认领）
//   2) 窗口内 running（无 shell_job_id）保持 running
//   3) 超期 running（无 shell_job_id）回收为 failed（崩溃残留）
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

const ops = {};
const recutMock = { operation: { register: (name, fn) => { ops[name] = fn; } } };

function makeWorld() {
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
    appFiles: { list: () => [], readText: () => "" },
    files: { readText: () => "", writeText: () => {}, url: () => "http://preview" },
    shell: {
      exec: () => ({ stdout: "{}\n", exitCode: 0 }),
      status: (id) => ({ id, status: "running" }),
      logs: () => [],
      cancel: () => {},
    },
    python: { status: () => ({ ready: true }), prepare: () => ({ id: `sj-${++seq}`, status: "running" }), run: () => ({ id: `sj-${++seq}`, status: "running" }) },
  };

  let schemaReady = false;
  const seed = (id, state, startedAt) => {
    if (!schemaReady) { ops["comfy.tasks.list"]({ limit: 1 }, ctx); schemaReady = true; }
    db.prepare("insert into comfy_tasks (id, shell_job_id, action, record_id, source, submitted_by, state, progress, meta_json, payload_json, log_path, error, created_at, started_at, resolved_at) values (?, '', 'generate', ?, 'manual', '', ?, 0, '{}', '{}', ?, '', ?, ?, '')")
      .run(id, `gen-${id}`, state, `tasks/${id}.log`, startedAt, startedAt);
  };
  const states = () => Object.fromEntries(sqlite.query("select id, state from comfy_tasks").map((r) => [r.id, r.state]));
  const pump = () => ops["comfy.tasks.list"]({ limit: 50 }, ctx);
  return { ctx, db, seed, states, pump };
}

vm.runInNewContext(code, {
  recut: recutMock, console, JSON, Date, Math, Set, Map, Number, String, Boolean, Error,
  Object, Array, Promise, RegExp,
});
if (!ops["comfy.tasks.list"]) { console.error("FAIL op registration", Object.keys(ops)); process.exit(1); }

let failures = 0;
const check = (name, cond) => { if (cond) console.log(`  ok  ${name}`); else { failures++; console.log(` FAIL ${name}`); } };

// S1：queued generate 被队列派发（原子认领 → running）
{
  const w = makeWorld();
  w.seed("g1", "queued", "2026-01-01T00:00:00.000Z");
  w.pump();
  check("S1 queued generate 派发为 running", w.states().g1 === "running");
}

// S2：running 但尚无 shell_job_id 的瞬态窗口不得被并发结算误杀
{
  const w = makeWorld();
  const fresh = new Date().toISOString();
  const stale = new Date(Date.now() - 10 * 60000).toISOString();
  w.seed("t-fresh", "running", fresh);
  w.seed("t-stale", "running", stale);
  w.pump();
  const s = w.states();
  check("S2 瞬态 running（窗口内无 shell_job_id）保持 running", s["t-fresh"] === "running");
  check("S2 超期 running（无 shell_job_id）回收为 failed", s["t-stale"] === "failed");
}

console.log(failures ? `\n${failures} failing` : "\nall checks passed");
process.exit(failures ? 1 : 0);
