// L1 冒烟测试：首屏加载路径（modal.overview / modal.status / 就绪度快照）
// 用 node:sqlite + mock 平台 ctx 驱动 background.js 的真实代码路径（与平台相同的 (input, ctx) 调用约定），验证：
//   1) modal.overview 不拉起 Python/modal CLI（首屏零等待），且未探测时不吃掉就绪度字段（未知 ≠ 尚未部署）
//   2) modal.status 把就绪度写进快照（含 checkedAt），下次 overview 直接回放，不再多探一次
//   3) 快照只存就绪度/连通性，不缓存 tasks 等实时数据
//   4) modal.catalog 的平台模型投影 models[] 带 expose 且 ready = deployed && volumeReady
//   5) profile 只回传掩码，secret 绝不进 payload
// 运行：node test/catalog_smoke.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, "..");
const code = readFileSync(path.join(appRoot, "background.js"), "utf8");
const registry = readFileSync(path.join(appRoot, "python", "registry.json"), "utf8");
// 期望数量从「单一信息源」现算（registry.json 的预设包数 / 根 manifest 的平台模型投影数），而不是写死：
// 新增预设包或暴露模型时这两条断言自动跟随，不会假失败。
const EXPECTED_MODALAPPS = JSON.parse(registry).modalapps.length;
const rootManifest = JSON.parse(readFileSync(path.join(appRoot, "manifest.json"), "utf8"));
const EXPECTED_MODELS = rootManifest.contributes.media.providers[0].models.length;
const PROFILES = JSON.stringify({
  profiles: [{ id: "p1", name: "default", tokenId: "ak-1234567890", tokenSecret: "super-secret-value" }],
  defaultProfileId: "p1",
});

const ops = {};
const recutMock = { operation: { register: (name, fn) => { ops[name] = fn; } } };

// 每个场景一个全新的内存数据库 + mock 平台对象；calls 记录真正拉起来的子进程，用于断言首屏零开销。
function makeWorld(states) {
  const db = new DatabaseSync(":memory:");
  const sqlite = {
    execute: (sql, params = []) => { try { db.prepare(sql).run(...params); } catch (e) { if (!String(e.message).includes("duplicate column")) throw e; } },
    query: (sql, params = []) => db.prepare(sql).all(...params),
  };
  const calls = { shell: 0, python: 0 };
  const job = () => ({ id: `sj-${calls.python}`, status: "running" });
  const ctx = {
    locale: "zh",
    sqlite,
    paths: { appRoot, appFilesRoot: "/appstate" },
    // 内置预设包清单走真实 registry.json（含 expose），用户预设包目录为空。
    app: { readText: (name) => (name === "python/registry.json" ? registry : "") },
    appFiles: { list: () => [], readText: () => "" },
    files: { readText: () => PROFILES, writeText: () => {}, url: () => "http://preview" },
    // modal.status 探测 = 一次 `sh ... modal_runner.py status`，其最后一行 stdout 才是 JSON 负载。
    shell: {
      exec: () => { calls.shell++; return { stdout: `${JSON.stringify({ ready: true, connected: true, account: "default", error: "", modalapps: states })}\n`, exitCode: 0 }; },
      status: () => { throw new Error("no shell job"); },
      logs: () => [],
      cancel: () => {},
    },
    python: { status: () => ({ ready: true }), prepare: () => job(), run: () => { calls.python++; return job(); } },
    media: { materialize: () => ({ path: "/sandbox/x", name: "x" }), importFile: () => ({ id: "asset-1" }) },
  };
  return { ctx, calls };
}

vm.runInNewContext(code, {
  recut: recutMock, console, JSON, Date, Math, Set, Map, Number, String, Boolean, Error,
  Object, Array, Promise, RegExp,
});
if (!ops["modal.overview"] || !ops["modal.status"] || !ops["modal.catalog"]) {
  console.error("FAIL op registration", Object.keys(ops));
  process.exit(1);
}

let failures = 0;
const check = (name, cond) => { if (cond) console.log(`  ok  ${name}`); else { failures++; console.log(` FAIL ${name}`); } };

const READY_STATES = {
  "minimax-h3": { deployed: true, volumeReady: true, stale: true },
  "minimax-h3-one": { deployed: true, volumeReady: true, stale: false },
  "minimax-h3-turbo": { deployed: true, volumeReady: true, stale: false },
  "qwen-image-2.1": { deployed: true, volumeReady: true, stale: false },
  "sd-turbo": { deployed: true, volumeReady: false, stale: false },
};

// S1：首屏 overview 纯本机读取；没有快照时不给就绪度字段（未知，而不是误报「尚未部署」）
{
  const w = makeWorld(READY_STATES);
  const ov = ops["modal.overview"]({}, w.ctx);
  check("S1 overview 返回全部预设包与函数表单", ov.modalapps.length === EXPECTED_MODALAPPS && ov.modalapps.every((a) => a.functions.length > 0 && Array.isArray(a.functions[0].formSchema)));
  check("S1 未探测 → 就绪度字段缺省（未知 ≠ 未部署）", ov.modalapps.every((a) => a.deployed === undefined && a.volumeReady === undefined));
  check("S1 无快照时 snapshot=null", ov.snapshot === null);
  check("S1 overview 不拉起 modal CLI/Python", w.calls.shell === 0 && w.calls.python === 0);
  check("S1 profile 只回传掩码，secret 不进 payload", ov.profiles[0].tokenIdMasked === "ak-1…7890" && !JSON.stringify(ov).includes("super-secret-value"));
}

// S2：status 探测 → 写入快照 → overview 回放，不再多探一次
{
  const w = makeWorld(READY_STATES);
  const st = ops["modal.status"]({}, w.ctx);
  check("S2 status 探到部署与权重状态", st.modalapps["minimax-h3"].deployed === true && st.modalapps["sd-turbo"].volumeReady === false);
  check("S2 status 带 checkedAt", typeof st.checkedAt === "string" && !Number.isNaN(Date.parse(st.checkedAt)));
  check("S2 status 只探一次 modal CLI", w.calls.shell === 1);

  const ov = ops["modal.overview"]({}, w.ctx);
  check("S2 overview 回放快照（同一 checkedAt）", ov.snapshot.checkedAt === st.checkedAt);
  check("S2 回放不吃掉未就绪状态", ov.modalapps.find((a) => a.id === "sd-turbo").volumeReady === false);
  check("S2 overview 复用快照、零额外探测", w.calls.shell === 1 && w.calls.python === 0);
  check("S2 快照只存就绪度，不缓存 tasks/activeJob", ov.snapshot.tasks === undefined && ov.snapshot.activeJob === undefined);
}

// S3：平台模型投影 models[] 必须带 expose，且 ready = deployed && volumeReady
{
  const w = makeWorld(READY_STATES);
  const cat = ops["modal.catalog"]({}, w.ctx);
  const byModel = new Map(cat.models.map((m) => [m.model, m]));
  check("S3 models[] 非空且按 expose.model 命名", cat.models.length === EXPECTED_MODELS && byModel.has("qwen-image") && byModel.has("minimax-h3"));
  check("S3 ready = deployed && volumeReady", byModel.get("minimax-h3").ready === true && byModel.get("sd-turbo").ready === false);
  check("S3 weight.installed 跟随 volumeReady", byModel.get("sd-turbo").weight.installed === false && byModel.get("minimax-h3").weight.installed === true);
  check("S3 catalog 也写快照（供下次首屏直接回放）", ops["modal.overview"]({}, w.ctx).snapshot?.modalapps?.["qwen-image-2.1"]?.deployed === true);
}

// S4：未部署的预设包 → 权重字段明确为 false（不是缺省），且不浪费一次 volume 探测
{
  const w = makeWorld({ "minimax-h3": { deployed: false, volumeReady: false, stale: false } });
  const st = ops["modal.status"]({}, w.ctx);
  check("S4 未部署 → volumeReady=false（快照携带明确状态）", st.modalapps["minimax-h3"].deployed === false && st.modalapps["minimax-h3"].volumeReady === false);
}

// S5：逐产物就绪 —— 缺离线合并产物时模型 ready=false（只看 volumeReady 会把它误报为可用）
{
  const w = makeWorld({
    "minimax-h3-turbo": {
      deployed: true, volumeReady: true, stale: false,
      assets: { weights: true, adapters: true, mergedFl2va: true, mergedRef2va: false },
    },
  });
  const cat = ops["modal.catalog"]({}, w.ctx);
  const turbo = cat.models.find((m) => m.model === "minimax-h3-turbo");
  check("S5 缺离线合并产物 → 模型 ready=false", turbo.ready === false);
  check("S5 基础权重仍上报 installed=true", turbo.weight.installed === true);
  check("S5 就绪产物随快照回放（regions 保留 assets）", ops["modal.overview"]({}, w.ctx).snapshot?.modalapps?.["minimax-h3-turbo"]?.assets?.mergedRef2va === false);
}

// S6：提交前预检 —— 目标函数所需产物缺失时直接拒绝，不派发任务（不创建云端容器）
{
  const w = makeWorld({
    "minimax-h3-turbo": {
      deployed: true, volumeReady: true, stale: false,
      assets: { weights: true, adapters: true, mergedFl2va: true, mergedRef2va: false },
    },
  });
  let error = "";
  try {
    ops["modal.generate"]({ modalapp: "minimax-h3-turbo", function: "reference-to-video", params: { prompt: "x" }, confirmCost: true, origin: "manual" }, w.ctx);
  } catch (e) { error = String((e && e.message) || e); }
  check("S6 缺产物 → modal.generate 直接拒绝（提示缺 mergedRef2va）", error.includes("mergedRef2va"));
  check("S6 拒绝发生在派发前（不拉起 Python 任务）", w.calls.python === 0);
}

// S7：产物齐备时预检放行（继续走原有提交路径）
{
  const w = makeWorld({
    "minimax-h3-turbo": {
      deployed: true, volumeReady: true, stale: false,
      assets: { weights: true, adapters: true, mergedFl2va: true, mergedRef2va: true },
    },
  });
  let error = "";
  try {
    ops["modal.generate"]({ modalapp: "minimax-h3-turbo", function: "reference-to-video", params: { prompt: "x" }, confirmCost: true, origin: "manual" }, w.ctx);
  } catch (e) { error = String((e && e.message) || e); }
  check("S7 产物齐备 → 预检放行（不再报缺产物）", !error.includes("mergedRef2va"));
}

console.log(failures ? `\n${failures} failing` : "\nall checks passed");
process.exit(failures ? 1 : 0);
