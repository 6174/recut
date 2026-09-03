/**
 * L0：frame-render background 模块的纯逻辑测试（无 Go runtime / 无浏览器）。
 * 用 stubbed recut + ctx 评估 background/frame-render.js，验证：
 *  - preview.frame / preview.batch 的 presence 门（editor-not-open / headless-unavailable 业务错误）
 *  - ctx.project.callUI 信封：id、payload 透传、completeOp=frame.finalize、timeoutMs
 *  - frame.heartbeat 写 editor_frame_sessions，之后 presence 新鲜
 * 契约：docs/platform-comms-contract.md §5–§9。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log("  ok - " + msg);
  } else {
    failures++;
    console.error("  FAIL - " + msg);
  }
}

function loadModule() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "background", "frame-render.js"),
    "utf8",
  );
  const sandbox = {
    recut: {
      operation: { register: () => {} },
      error: (payload) => {
        throw Object.assign(new Error(payload.code), { __recutError: payload });
      },
    },
    scope: () => "proj-1",
    nowIso: () => new Date().toISOString(),
    loc: (_ctx, zh) => zh,
    console,
  };
  sandbox.__opRegistrations = {};
  sandbox.recut.operation.register = (name, fn) => {
    sandbox.__opRegistrations[name] = fn;
  };
  sandbox.vm = vm;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.__opRegistrations;
}

function makeCtx(callUI, sqlite) {
  return {
    sqlite: {
      execute: (q, args) => sqlite.execute(q, args),
      query: (q, args) => sqlite.query(q, args),
    },
    files: { writeBase64: () => {}, url: (p) => "/files/" + p },
    media: { importFile: () => ({ id: "asset-1" }) },
    job: { status: () => ({ payload: { saveToLibrary: true } }) },
    project: { callUI },
  };
}

function testPresenceAndCallUI() {
  console.log("L0 preview.frame presence 门 + callUI 信封");
  const ops = loadModule();
  const preview = ops["preview.frame"];
  const batch = ops["preview.batch"];
  const heartbeat = ops["frame.heartbeat"];

  const sessions = new Map();
  const sqlite = {
    execute: (q, args) => {
      if (q.includes("create table")) return;
      sessions.set(args[0], args[1]);
    },
    query: () => {
      const v = sessions.get("proj-1");
      return v ? [{ last_seen_at: v }] : [];
    },
  };
  let callUIArgs = null;
  const callUI = (...args) => {
    callUIArgs = args;
    return { id: "op-abc123" };
  };
  const ctx = makeCtx(callUI, sqlite);

  // 1) 无心跳 → editor-not-open 业务错误
  try {
    preview({ timeSec: 1.5 }, ctx);
    assert(false, "离线时应抛 editor-not-open");
  } catch (e) {
    assert(e.__recutError && e.__recutError.code === "editor-not-open", "离线抛 editor-not-open");
  }

  // 2) headless 显式 → headless-unavailable
  try {
    preview({ timeSec: 1.5, mode: "headless" }, ctx);
    assert(false, "headless 应抛 headless-unavailable");
  } catch (e) {
    assert(e.__recutError && e.__recutError.code === "headless-unavailable", "headless 抛 headless-unavailable");
  }

  // 3) 心跳后 → presence 新鲜 → callUI 信封
  heartbeat({}, ctx);
  const out = preview({ timeSec: 2.5, width: 640, height: 360, saveToLibrary: true }, ctx);
  assert(out && out.jobId === "op-abc123" && out.mode === "ui", "preview.frame 返回统一 Handle jobId");
  assert(callUIArgs, "调用了 callUI");
  if (callUIArgs) {
    const [method, payload, opts] = callUIArgs;
    assert(method === "frame.render", "callUI method = frame.render");
    assert(payload.timeSec === 2.5 && payload.width === 640 && payload.height === 360, "callUI payload 透传");
    assert(payload.saveToLibrary === true, "callUI saveToLibrary 透传");
    assert(payload.expectedVersion === 0, "callUI 绑定当前 timeline version（独立 L0 无项目时为 0）");
    assert(opts.completeOp === "frame.finalize", "callUI completeOp = frame.finalize");
    assert(opts.timeoutMs === 15000, "callUI timeoutMs = 15000");
  }

  const batchOut = batch({ times: [0.5, 1.5], purpose: "settled-scenes" }, ctx);
  assert(batchOut && batchOut.count === 2 && batchOut.jobs.length === 2, "preview.batch 返回多个异步 Handle");
  assert(batchOut.jobs[0].timeSec === 0.5 && batchOut.jobs[1].timeSec === 1.5, "preview.batch 保留时间点顺序");

  const contact = ops["preview.contact-sheet"];
  callUIArgs = null;
  const sheet = contact({ times: [0.2, 1.2, 2.2], width: 320, height: 180 }, ctx);
  assert(sheet && sheet.jobId === "op-abc123" && sheet.count === 3, "preview.contact-sheet 返回 Handle");
  assert(callUIArgs && callUIArgs[0] === "frame.contactSheet", "contact-sheet callUI method");
  assert(callUIArgs && callUIArgs[2].completeOp === "frame.finalize", "contact-sheet completeOp");

  // 4) timeSec 缺失 → 报错
  try {
    preview({}, ctx);
    assert(false, "timeSec 缺失应报错");
  } catch (e) {
    assert(!e.__recutError || e.__recutError.code !== "editor-not-open", "timeSec 缺失不是 presence 错误");
  }
}

function testFinalize() {
  console.log("L0 frame.finalize 收尾：写 PNG + CDN 地址 + 入库");
  const ops = loadModule();
  const finalize = ops["frame.finalize"];
  let written = null;
  let imported = null;
  const ctx = {
    files: {
      writeBase64: (p, b64) => { written = { p, b64 }; },
      url: (p) => "/v1/projects/proj-1/apps/recut.editor/files/" + p,
    },
    media: { importFile: (i) => { imported = i; return { id: "asset-9" }; } },
    job: { status: () => ({ payload: { saveToLibrary: true } }) },
  };
  const result = finalize(
    { id: "op-abc123", result: { fileBase64: "UE5H", width: 1920, height: 1080, version: 3 } },
    ctx,
  );
  assert(written && written.p === "frames/op-abc123.png", "frame.finalize 写 frames/<id>.png");
  assert(written && written.b64 === "UE5H", "frame.finalize 写 fileBase64");
  assert(result.imageUrl === "/v1/projects/proj-1/apps/recut.editor/files/frames/op-abc123.png", "imageUrl 为 app 文件 CDN 地址");
  assert(result.assetId === "asset-9", "saveToLibrary → assetId");
  assert(result.width === 1920 && result.height === 1080, "尺寸透传");
}

testPresenceAndCallUI();
testFinalize();

if (failures > 0) {
  console.error(`\n${failures} L0 assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nL0 frame-render: all assertions passed");
