/**
 * [INPUT]: 依赖 project-store 的 scope/nowIso 与平台 ctx.project.callUI / ctx.job / ctx.files 能力。
 * [OUTPUT]: preview.frame（AI 读取 timeline 任意时刻真实画面，UI 快路径）、frame.heartbeat（iframe
 *           存活性心跳）、frame.finalize（rpc.reply 的 completeOp 收尾：写 PNG、出 CDN 地址、可选入库）。
 * [POS]: 平台通讯契约（docs/platform-comms-contract.md）的首个消费者；只消费 ctx.project.callUI +
 *        ctx.job 原语，不自造请求表/轮询 op。P2 的 headless 模式在 preview.frame 返回业务错误占位。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

var FRAME_HEARTBEAT_FRESH_MS = 30 * 1000;
var FRAME_CALLUI_TIMEOUT_MS = 15000;

function currentTimelineVersion(ctx, scopeId) {
  if (typeof readProject !== "function" || !ctx.sqlite) return 0;
  var project = readProject(ctx, scopeId);
  return project ? Number(project.version || 0) : 0;
}

function rejectStaleFrame(ctx, expectedVersion, actualVersion) {
  if (typeof expectedVersion !== "number" || expectedVersion === actualVersion) return;
  recut.error({
    code: "timeline-version-stale",
    message: loc(ctx, "时间线在出帧期间发生变化，已丢弃这张旧证据。", "The timeline changed during rendering; the stale frame was discarded."),
    hint: loc(ctx, "重新读取 timeline.read 后，在新 version 上重试。", "Read timeline.read again and retry against the new version."),
    data: { expectedVersion: expectedVersion, actualVersion: actualVersion },
    retryable: true,
  });
}

function ensureFrameSchema(ctx, scopeId) {
  ctx.sqlite.execute(
    "create table if not exists editor_frame_sessions (" +
      "project_id text not null primary key, last_seen_at text not null, updated_at text not null)",
  );
}

function frameSessionFresh(ctx, scopeId, maxAgeMs) {
  ensureFrameSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select last_seen_at from editor_frame_sessions where project_id = ?",
    [scopeId],
  );
  if (!rows || rows.length === 0) return false;
  try {
    return Date.now() - new Date(rows[0].last_seen_at).getTime() < maxAgeMs;
  } catch (e) {
    return false;
  }
}

// iframe 挂载后每 10s 心跳一次；preview.frame 据此前 30s 判断编辑器是否在线。
recut.operation.register("frame.heartbeat", (input, ctx) => {
  const scopeId = scope(ctx);
  const now = nowIso();
  ensureFrameSchema(ctx, scopeId);
  ctx.sqlite.execute(
    "insert into editor_frame_sessions (project_id, last_seen_at, updated_at) values (?, ?, ?) " +
      "on conflict(project_id) do update set last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at",
    [scopeId, now, now],
  );
  return { ok: true, at: now };
});

// preview.frame：AI 读取 timeline 在 timeSec 时刻的真实画面。
// 返回统一异步 Handle（jobId），Agent 用 recut.job.wait 观察终态，结果含 imageUrl（app 文件 CDN 地址）。
recut.operation.register("preview.frame", (input, ctx) => {
  const scopeId = scope(ctx);
  const timeSec = input && typeof input.timeSec === "number" ? input.timeSec : null;
  if (timeSec === null || timeSec < 0) {
    throw new Error("preview.frame: timeSec (>= 0 seconds) required");
  }
  const mode = (input && input.mode) || "auto";
  if (mode === "headless") {
    recut.error({
      code: "headless-unavailable",
      message: loc(ctx, "无头渲染尚未实现（P2）。", "Headless rendering is not implemented yet (P2)."),
      hint: loc(ctx, "请先打开编辑器，或等待 P2 无头渲染器上线。", "Open the editor first, or wait for the P2 headless renderer."),
    });
  }
  const fresh = frameSessionFresh(ctx, scopeId, FRAME_HEARTBEAT_FRESH_MS);
  if (!fresh) {
    recut.error({
      code: "editor-not-open",
      message: loc(ctx, "编辑器前端未打开，无法出帧。", "The editor frontend is not open, so no frame can be rendered."),
      hint: loc(ctx, "请打开编辑器 UI 后重试；无前端场景需 P2 无头渲染（headless-unavailable）。", "Open the editor UI and retry; frontend-less scenarios need the P2 headless renderer (headless-unavailable)."),
    });
  }
  const expectedVersion = currentTimelineVersion(ctx, scopeId);
  const job = ctx.project.callUI(
    "frame.render",
    {
      timeSec: timeSec,
      width: input && typeof input.width === "number" ? input.width : null,
      height: input && typeof input.height === "number" ? input.height : null,
      pixelRatio: input && typeof input.pixelRatio === "number" ? input.pixelRatio : null,
      saveToLibrary: !!(input && input.saveToLibrary),
      expectedVersion: expectedVersion,
    },
    { completeOp: "frame.finalize", timeoutMs: FRAME_CALLUI_TIMEOUT_MS },
  );
  return { ok: true, jobId: job.id, requestId: job.id, mode: "ui", timeoutMs: FRAME_CALLUI_TIMEOUT_MS };
});

// 批量 settled-frame 请求：共享同一份时间线快照，返回多个可独立观察/取消的 Handle。
// 这里不在 background 拼 contact sheet（不同运行时的图片编码不可假设），由调用方按
// jobs 读取证据；UI 仍只保留一个 renderer，不会因每个时间点重新加载项目。
recut.operation.register("preview.batch", (input, ctx) => {
  const scopeId = scope(ctx);
  const times = input && Array.isArray(input.times) ? input.times : [];
  if (times.length === 0 || times.length > 32 || times.some((time) => typeof time !== "number" || time < 0)) {
    throw new Error("preview.batch: times must contain 1..32 non-negative seconds");
  }
  const fresh = frameSessionFresh(ctx, scopeId, FRAME_HEARTBEAT_FRESH_MS);
  if (!fresh) {
    recut.error({
      code: "editor-not-open",
      message: loc(ctx, "编辑器前端未打开，无法批量出帧。", "The editor frontend is not open, so batch frames cannot be rendered."),
      hint: loc(ctx, "请打开编辑器 UI 后重试。", "Open the editor UI and retry."),
    });
  }
  const expectedVersion = currentTimelineVersion(ctx, scopeId);
  const jobs = times.map((timeSec) => {
    const job = ctx.project.callUI(
      "frame.render",
      {
        timeSec,
        width: input && typeof input.width === "number" ? input.width : null,
        height: input && typeof input.height === "number" ? input.height : null,
        pixelRatio: input && typeof input.pixelRatio === "number" ? input.pixelRatio : null,
        saveToLibrary: !!(input && input.saveToLibrary),
        purpose: input && input.purpose ? String(input.purpose) : "settled-scenes",
        expectedVersion: expectedVersion,
      },
      { completeOp: "frame.finalize", timeoutMs: FRAME_CALLUI_TIMEOUT_MS },
    );
    return { jobId: job.id, requestId: job.id, timeSec };
  });
  return { ok: true, mode: "ui", jobs, count: jobs.length, timeoutMs: FRAME_CALLUI_TIMEOUT_MS };
});

// 一张可直接审阅的 contact sheet。每个 cell 仍来自同一个 UI renderer，避免 background
// 自己实现第二套视觉运行时；frame.finalize 负责统一文件落盘与可选素材入库。
recut.operation.register("preview.contact-sheet", (input, ctx) => {
  const scopeId = scope(ctx);
  const times = input && Array.isArray(input.times) ? input.times : [];
  if (times.length === 0 || times.length > 16 || times.some((time) => typeof time !== "number" || time < 0)) {
    throw new Error("preview.contact-sheet: times must contain 1..16 non-negative seconds");
  }
  if (!frameSessionFresh(ctx, scopeId, FRAME_HEARTBEAT_FRESH_MS)) {
    recut.error({ code: "editor-not-open", message: loc(ctx, "编辑器前端未打开，无法生成 contact sheet。", "The editor frontend is not open, so a contact sheet cannot be rendered."), hint: loc(ctx, "请打开编辑器 UI 后重试。", "Open the editor UI and retry.") });
  }
  const expectedVersion = currentTimelineVersion(ctx, scopeId);
  const job = ctx.project.callUI("frame.contactSheet", {
    times,
    width: input && typeof input.width === "number" ? input.width : null,
    height: input && typeof input.height === "number" ? input.height : null,
    pixelRatio: input && typeof input.pixelRatio === "number" ? input.pixelRatio : null,
    saveToLibrary: !!(input && input.saveToLibrary),
    expectedVersion: expectedVersion,
  }, { completeOp: "frame.finalize", timeoutMs: FRAME_CALLUI_TIMEOUT_MS * 2 });
  return { ok: true, jobId: job.id, requestId: job.id, mode: "ui", timeoutMs: FRAME_CALLUI_TIMEOUT_MS * 2, count: times.length };
});

// frame.finalize：rpc.reply 成功后由平台按 completeOp 调用的收尾 op。
// 输入 { id, result: { fileBase64, width, height, version } }；写项目文件并返回最终结果。
recut.operation.register("frame.finalize", (input, ctx) => {
  const id = input && input.id;
  if (!id) throw new Error("frame.finalize: id required");
  const result = (input && input.result) || {};
  const fileBase64 = result.fileBase64;
  if (!fileBase64) {
    throw new Error("frame.finalize: result.fileBase64 missing");
  }
  if (ctx.project && ctx.sqlite && typeof result.expectedVersion === "number") {
    rejectStaleFrame(ctx, result.expectedVersion, currentTimelineVersion(ctx, scope(ctx)));
  }
  const path = "frames/" + id + ".png";
  ctx.files.writeBase64(path, fileBase64);
  const imageUrl = ctx.files.url(path);
  let assetId = null;
  try {
    const info = ctx.job.status(id);
    const payload = (info && info.payload) || {};
    if (payload && payload.saveToLibrary) {
      const asset = ctx.media.importFile({ path: path, name: "frame-" + id + ".png", mimeType: "image/png" });
      if (asset && asset.id) assetId = asset.id;
    }
  } catch (e) {
    // 素材导入失败不阻塞帧交付；imageUrl 始终可用。
  }
  return {
    imageUrl: imageUrl,
    width: result.width,
    height: result.height,
    version: result.version,
    assetId: assetId,
    path: path,
  };
});
