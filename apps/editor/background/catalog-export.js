/**
 * [INPUT]: 依赖 project-store 的 scope/项目读写与 ctx 的 http、files、media、project 能力。
 * [OUTPUT]: library、export、cover 与 film.package operation 的注册。
 * [POS]: background 的素材目录与交付适配层；不持有时间线模型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// ---- 内置目录（library.browse，catalog-first）----
// 目录动态加载：优先 CDN（可持续更新），回退随包 catalog/ 文件，再回退内嵌最小集。
// 效果 = 渲染器真实支持的 effect.*（UI runtime EFFECT_COMPONENTS，附 inputs）；
// 音乐/音效 = CDN 音频库（与 UI audio-library 同源，url 直接可插为 sourceType:library 的 audio 元素）。
var LIBRARY_CATALOG_URLS = {
  effects: "https://cdn.recut.video/effects/catalog.json",
  audio: "https://cdn.recut.video/audio/catalog.json",
};

var LIBRARY_BUILTIN_EFFECTS = [
  { id: "effect.glass", name: "Glass 玻璃", keywords: ["glass", "玻璃", "折射", "refraction"], inputs: [
    { key: "centerX", label: "中心 X", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
    { key: "centerY", label: "中心 Y", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
    { key: "zoom", label: "放大", type: "number", default: 1.34, min: 1, max: 4, step: 0.01 },
    { key: "ior", label: "折射率", type: "number", default: 1.5, min: 1, max: 2.5, step: 0.01 },
  ] },
  { id: "effect.magnify", name: "Magnify 放大镜", keywords: ["magnify", "放大镜", "放大", "zoom"], inputs: [
    { key: "centerX", label: "中心 X", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
    { key: "centerY", label: "中心 Y", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
    { key: "zoom", label: "放大", type: "number", default: 1.7, min: 1, max: 5, step: 0.01 },
    { key: "radius", label: "透镜半径", type: "number", default: 140, min: 40, max: 600, step: 5 },
  ] },
  { id: "effect.glitch", name: "Glitch 故障", keywords: ["glitch", "故障", "信号", "tearing"], inputs: [
    { key: "intensity", label: "强度", type: "number", default: 1.35, min: 0, max: 5, step: 0.01 },
  ] },
  { id: "effect.crt", name: "CRT 显像管", keywords: ["crt", "显像管", "复古", "scanline"], inputs: [
    { key: "scan", label: "扫描线", type: "number", default: 0.24, min: 0, max: 1, step: 0.01 },
    { key: "vignette", label: "暗角", type: "number", default: 0.68, min: 0, max: 1, step: 0.01 },
  ] },
  { id: "effect.vintage", name: "Vintage 复古", keywords: ["vintage", "复古", "胶片", "grain"], inputs: [
    { key: "intensity", label: "强度", type: "number", default: 1, min: 0, max: 3, step: 0.01 },
  ] },
];

function libraryHttpJson(ctx, url, opts) {
  if (!ctx || !ctx.http || typeof ctx.http.get !== "function") return null;
  try {
    var res = ctx.http.get(url, opts || {});
    if (res && res.status === 200 && res.body) {
      var doc = JSON.parse(res.body);
      if (doc && typeof doc === "object") return doc;
    }
  } catch (e) { /* 网络/解析失败 → 回退 */ }
  return null;
}

function loadEffectsCatalog(ctx) {
  var doc = libraryHttpJson(ctx, LIBRARY_CATALOG_URLS.effects, { timeoutMs: 3000, maxBytes: 1048576 });
  if (doc) return { effects: doc.effects || [], transitions: doc.transitions || [], luts: doc.luts || [], source: "cdn" };
  try {
    // 随包回退：ctx.app.readText（真实运行时）或 ctx.files.readText（测试桩）
    var text = ctx && ctx.app && typeof ctx.app.readText === "function" ? ctx.app.readText("catalog/effects.json") : ctx.files.readText("catalog/effects.json");
    var local = JSON.parse(text);
    if (local && local.effects) return { effects: local.effects, transitions: local.transitions || [], luts: local.luts || [], source: "shipped" };
  } catch (e) { /* 无随包文件 */ }
  return { effects: LIBRARY_BUILTIN_EFFECTS, transitions: [], luts: [], source: "builtin" };
}

function loadAudioCatalog(ctx) {
  var doc = libraryHttpJson(ctx, LIBRARY_CATALOG_URLS.audio, { timeoutMs: 5000, maxBytes: 2097152 });
  if (doc) return { music: doc.music || [], sfx: doc.sfx || [], source: "cdn" };
  try {
    var text = ctx && ctx.app && typeof ctx.app.readText === "function" ? ctx.app.readText("catalog/audio.json") : ctx.files.readText("catalog/audio.json");
    var local = JSON.parse(text);
    if (local && local.sfx) return { music: local.music || [], sfx: local.sfx || [], source: "shipped" };
  } catch (e) { /* 无随包文件 */ }
  return { music: [], sfx: [], source: "builtin" };
}

function libraryAssetUrl(url) {
  var clean = String(url || "").replace(/^\//, "");
  if (/^https?:\/\//.test(clean)) return clean;
  return "https://cdn.recut.video/" + clean;
}

recut.operation.register("library.browse", (input, ctx) => {
  const category = input && input.category;
  const query = String((input && input.query) || "").toLowerCase();
  const kindOf = { effects: "effect", transitions: "transition", luts: "lut", "sound-effects": "sound-effect", music: "music" };
  const items = [];
  const push = (kind, entry) => {
    if (category && kindOf[category] !== kind) return;
    const hay = String(entry.id + " " + (entry.name || "") + " " + (Array.isArray(entry.keywords) ? entry.keywords.join(" ") : "")).toLowerCase();
    if (query && hay.indexOf(query) < 0) return;
    items.push(Object.assign({}, entry, { kind }));
  };
  const effects = loadEffectsCatalog(ctx);
  const audio = loadAudioCatalog(ctx);
  for (const e of effects.effects) push("effect", e);
  for (const t of effects.transitions) push("transition", t);
  for (const l of effects.luts) push("lut", l);
  for (const s of audio.sfx) push("sound-effect", Object.assign({}, s, { url: libraryAssetUrl(s.url) }));
  for (const m of audio.music) push("music", Object.assign({}, m, { url: libraryAssetUrl(m.url) }));
  return { ok: true, source: effects.source === "builtin" ? audio.source : effects.source, count: items.length, items: items.slice(0, 60) };
});

var EXPORT_CALLUI_TIMEOUT_MS = 300000;

function ensureExportSchema(ctx) {
  ctx.sqlite.execute(
    "create table if not exists editor_exports (" +
      "export_id text not null primary key, project_id text not null, settings_json text not null, " +
      "asset_id text, status text not null, created_at text not null, updated_at text not null)",
  );
}

function finishExport(ctx, scopeId, exportId, fileBase64, name, mimeType) {
  const b64Path = "exports/" + exportId + ".b64";
  const mp4Path = "exports/" + exportId + ".mp4";
  ctx.files.writeText(b64Path, fileBase64);
  const scriptPath = ctx.paths.appRoot + "/scripts/decode-base64.js";
  ctx.shell.exec({ command: "node", args: [scriptPath, b64Path, mp4Path], cwd: "files", timeoutSeconds: 300 });
  const assetName = name || loc(ctx, "成片 " + exportId, "Export " + exportId);
  const asset = ctx.media.importFile({ path: mp4Path, name: assetName, mimeType: mimeType || "video/mp4" });
  const coverPrefs = readCoverPrefs(ctx, scopeId);
  if (asset && asset.id && coverPrefs.mode === "auto") {
    ctx.project.setCover({ assetId: asset.id });
  }
  ensureExportSchema(ctx);
  ctx.sqlite.execute(
    "update editor_exports set asset_id = ?, status = 'completed', updated_at = ? where export_id = ?",
    [asset && asset.id, nowIso(), exportId],
  );
  return { exportId: exportId, assetId: asset && asset.id };
}

function rejectStaleExport(ctx, expectedVersion, actualVersion) {
  if (typeof expectedVersion !== "number" || expectedVersion === actualVersion) return;
  recut.error({
    code: "timeline-version-stale",
    message: loc(ctx, "时间线在导出期间发生变化，已丢弃这份旧成片。", "The timeline changed during export; the stale movie was discarded."),
    hint: loc(ctx, "重新读取 timeline.read 后，在新 version 上重试导出。", "Read timeline.read again and retry export against the new version."),
    data: { expectedVersion: expectedVersion, actualVersion: actualVersion },
    retryable: true,
  });
}

// ---- 导出：MCP 异步 Handle（iframe 在线走 callUI；headless 尚未实现）----
recut.operation.register("export.start", (input, ctx) => {
  const scopeId = scope(ctx);
  const mode = (input && input.mode) || "auto";
  if (mode === "headless") {
    recut.error({
      code: "headless-unavailable",
      message: loc(ctx, "无头导出尚未实现（P2）。", "Headless export is not implemented yet (P2)."),
      hint: loc(ctx, "请打开编辑器后用 UI 路径导出，或等待 P2 无头渲染器。", "Open the editor and export via the UI path, or wait for the P2 headless renderer."),
    });
  }
  if (typeof frameSessionFresh !== "function" || !frameSessionFresh(ctx, scopeId, FRAME_HEARTBEAT_FRESH_MS || 30000)) {
    recut.error({
      code: "editor-not-open",
      message: loc(ctx, "编辑器前端未打开，无法导出。", "The editor frontend is not open, so export cannot run."),
      hint: loc(ctx, "请打开编辑器 UI 后重试；无前端场景需 P2 无头导出（headless-unavailable）。", "Open the editor UI and retry; frontend-less scenarios need the P2 headless exporter (headless-unavailable)."),
    });
  }
  if (!ctx.project || typeof ctx.project.callUI !== "function") {
    recut.error({
      code: "editor-not-open",
      message: loc(ctx, "编辑器前端未打开，无法导出。", "The editor frontend is not open, so export cannot run."),
      hint: loc(ctx, "请打开编辑器 UI 后重试。", "Open the editor UI and retry."),
    });
  }
  const existing = readProject(ctx, scopeId);
  const exportId = "export-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  ensureSchema(ctx, scopeId);
  ensureExportSchema(ctx);
  const w = (existing && existing.project && existing.project.settings && existing.project.settings.canvasSize) || DEFAULT_CANVAS;
  const width = (input && typeof input.width === "number") ? input.width : w.width;
  const height = (input && typeof input.height === "number") ? input.height : w.height;
  const fps = (input && typeof input.fps === "number") ? input.fps : 30;
  const expectedVersion = existing ? Number(existing.version || 0) : 0;
  ctx.sqlite.execute(
    "insert into editor_exports (export_id, project_id, settings_json, status, created_at, updated_at) values (?, ?, ?, 'encoding', ?, ?)",
    [exportId, scopeId, JSON.stringify({ width: width, height: height, fps: fps, mode: "ui", expectedVersion: expectedVersion }), nowIso(), nowIso()],
  );
  const job = ctx.project.callUI(
    "export.encode",
    { exportId: exportId, width: width, height: height, fps: fps, expectedVersion: expectedVersion },
    { completeOp: "export.finalize", timeoutMs: EXPORT_CALLUI_TIMEOUT_MS },
  );
  return { ok: true, jobId: job.id, requestId: job.id, exportId: exportId, mode: "ui", timeoutMs: EXPORT_CALLUI_TIMEOUT_MS };
});

recut.operation.register("export.progress", (input, ctx) => {
  if (!input || !input.exportId || typeof input.progress !== "number") {
    throw new Error("export.progress: exportId + progress required");
  }
  return { exportId: input.exportId, progress: Math.max(0, Math.min(1, input.progress)) };
});

recut.operation.register("export.complete", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !input.exportId || !input.fileBase64) {
    throw new Error("export.complete: exportId + fileBase64 required");
  }
  return finishExport(ctx, scopeId, input.exportId, input.fileBase64, input.name, input.mimeType);
});

recut.operation.register("export.finalize", (input, ctx) => {
  const scopeId = scope(ctx);
  const id = input && input.id;
  if (!id) throw new Error("export.finalize: id required");
  const result = (input && input.result) || {};
  const fileBase64 = result.fileBase64;
  if (!fileBase64) throw new Error("export.finalize: result.fileBase64 missing");
  if (ctx.project && ctx.sqlite && typeof result.expectedVersion === "number") {
    const current = readProject(ctx, scopeId);
    rejectStaleExport(ctx, result.expectedVersion, current ? Number(current.version || 0) : 0);
  }
  const exportId = result.exportId || id;
  return finishExport(ctx, scopeId, exportId, fileBase64, result.name, result.mimeType);
});

recut.operation.register("export.list", (input, ctx) => {
  const scopeId = scope(ctx);
  ensureSchema(ctx, scopeId);
  const rows = ctx.sqlite.query(
    "select export_id, settings_json, asset_id, status, created_at from editor_exports where project_id = ? order by created_at desc",
    [scopeId],
  );
  return { exports: rows || [] };
});

// ---- 封面（UI 驱动，非 media Asset）----
// 首帧封面：编辑器渲染首帧后经此 op 更新项目封面。图片字节写入项目文件根（app
// files CDN 语义），再登记为 file 封面；不产生 media Asset，可频繁刷新不污染素材库。
// 由 UI 侧去抖（空闲）+ 节流 + 帧 hash 变化时才调用。auto 模式 = 每次空闲把首帧
// 推成封面；一旦用户手动选了封面帧/素材，mode 变为 frame/asset，自动首帧同步停止。
function readCoverPrefs(ctx, scopeId) {
  ensureSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select mode, frame_sec, asset_id from editor_cover_prefs where project_id = ?",
    [scopeId],
  );
  if (!rows || rows.length === 0) {
    return { mode: "auto", frameSec: null, assetId: "" };
  }
  var r = rows[0];
  return { mode: r.mode || "auto", frameSec: r.frame_sec != null ? Number(r.frame_sec) : null, assetId: r.asset_id || "" };
}

function writeCoverPrefs(ctx, scopeId, prefs) {
  ensureSchema(ctx, scopeId);
  ctx.sqlite.execute(
    "insert into editor_cover_prefs (project_id, mode, frame_sec, asset_id, updated_at) values (?, ?, ?, ?, ?) " +
      "on conflict(project_id) do update set mode = excluded.mode, frame_sec = excluded.frame_sec, asset_id = excluded.asset_id, updated_at = excluded.updated_at",
    [scopeId, prefs.mode, prefs.frameSec != null ? prefs.frameSec : null, prefs.assetId || "", nowIso()],
  );
}

// goja 把 Go struct 导出为 Go 字段名（Source/AssetID/Kind/FilePath/MimeType），
// 封面对外契约用 camelCase json 名；这里统一归一化为小写契约。
function normalizeCover(c) {
  if (!c) return null;
  return {
    source: c.Source != null ? c.Source : c.source,
    assetId: c.AssetID != null ? c.AssetID : c.assetId,
    kind: c.Kind != null ? c.Kind : c.kind,
    filePath: c.FilePath != null ? c.FilePath : c.filePath,
    mimeType: c.MimeType != null ? c.MimeType : c.mimeType,
  };
}

recut.operation.register("cover.update", (input, ctx) => {
  if (!input || !input.fileBase64) {
    throw new Error("cover.update: fileBase64 required");
  }
  const scopeId = scope(ctx);
  const mimeType = input.mimeType || "image/png";
  const ext = mimeType === "image/png" ? ".png" : mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/webp" ? ".webp" : ".png";
  const path = "covers/cover" + ext;
  ctx.files.writeBase64(path, input.fileBase64);
  const updated = ctx.project.setCoverImage({ path: path, mimeType: mimeType });
  const cover = normalizeCover(updated && updated.Cover != null ? updated.Cover : (updated && updated.cover));
  // 仅 auto 模式允许被自动首帧同步覆盖；手动选帧后 cover.update 不再生效。
  const prefs = readCoverPrefs(ctx, scopeId);
  if (prefs.mode !== "auto") {
    return { ok: true, path: path, mode: prefs.mode, skipped: true, cover: cover };
  }
  writeCoverPrefs(ctx, scopeId, { mode: "auto", frameSec: null, assetId: "" });
  return { ok: true, path: path, mode: "auto", cover: cover };
});

// 读取当前封面选择模式与平台封面：mode=auto（首帧自动）/ frame（用户选帧）/ asset（用户选素材）。
recut.operation.register("cover.get", (input, ctx) => {
  const scopeId = scope(ctx);
  const prefs = readCoverPrefs(ctx, scopeId);
  const cover = ctx.project && ctx.project.cover ? normalizeCover(ctx.project.cover) : null;
  return { ok: true, mode: prefs.mode, frameSec: prefs.frameSec, assetId: prefs.assetId, cover: cover };
});

// 用指定时间线的某一帧作为封面：编辑器先渲染该帧为 PNG base64，落盘并登记为 file 封面。
recut.operation.register("cover.set-frame", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !input.fileBase64) {
    throw new Error("cover.set-frame: fileBase64 required");
  }
  const mimeType = input.mimeType || "image/png";
  const ext = mimeType === "image/png" ? ".png" : mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/webp" ? ".webp" : ".png";
  const path = "covers/cover" + ext;
  ctx.files.writeBase64(path, input.fileBase64);
  const updated = ctx.project.setCoverImage({ path: path, mimeType: mimeType });
  const cover = normalizeCover(updated && updated.Cover != null ? updated.Cover : (updated && updated.cover));
  const frameSec = typeof input.frameSec === "number" ? input.frameSec : null;
  writeCoverPrefs(ctx, scopeId, { mode: "frame", frameSec: frameSec, assetId: "" });
  return { ok: true, path: path, mode: "frame", frameSec: frameSec, cover: cover };
});

// 用全局素材库中的一个图片/视频 Asset 作为封面（asset 封面，不写项目文件根）。
recut.operation.register("cover.set-asset", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !input.assetId) {
    throw new Error("cover.set-asset: assetId required");
  }
  const updated = ctx.project.setCover({ assetId: input.assetId });
  const cover = normalizeCover(updated && updated.Cover != null ? updated.Cover : (updated && updated.cover));
  writeCoverPrefs(ctx, scopeId, { mode: "asset", frameSec: null, assetId: input.assetId });
  return { ok: true, mode: "asset", assetId: input.assetId, cover: cover };
});

// 恢复自动首帧封面模式（清空手动选择）。
recut.operation.register("cover.set-auto", (input, ctx) => {
  const scopeId = scope(ctx);
  writeCoverPrefs(ctx, scopeId, { mode: "auto", frameSec: null, assetId: "" });
  return { ok: true, mode: "auto" };
});

recut.operation.register("film.package.import", (input, ctx) => {
  const scopeId = scope(ctx);
  const pkg = (input && input.pkg) || input;
  if (!pkg) {
    throw new Error("film.package.import: pkg required");
  }
  const existing = readProject(ctx, scopeId);
  const baseProject = (existing && existing.project) || makeDefaultProject({ scopeId, name: loc(ctx, "AI 短片草稿", "AI Short Film Draft"), locale: ctx.locale });
  const project = cloneJson(baseProject);
  const now = nowIso();
  const scene = findScene(project, project.currentSceneId);
  const tracks = sceneTracks(scene);

  const addElement = (track, element) => {
    if (!track || !track.elements) {
      throw new Error("addElement: track has no elements array: " + JSON.stringify({ trackName: track && track.name, hasElements: !!(track && track.elements) }));
    }
    track.elements.push(element);
  };

  const ensureTextTrack = () => findOrCreateTrack(scene, "text", 0, undefined);
  const ensureAudioTrack = () => findOrCreateTrack(scene, "audio", 0, undefined);

  const scenes = pkg.scenes || [];
  const script = pkg.script || { beats: [] };

  let cursor = 0;
  const beats = script.beats || (typeof script === "string" ? [] : []);
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const assetIds = sc.assetIds || sc.imageAssetIds || [];
    const durationSec = sc.durationSeconds || sc.durationSec || 5;
    const startTicks = tickOf(cursor);

    for (const assetId of assetIds) {
      addElement(tracks.main, {
        id: "el-" + i + "-" + String(assetId).slice(-8),
        name: sc.title || loc(ctx, "镜头 " + (i + 1), "Shot " + (i + 1)),
        type: "video",
        mediaId: assetId,
        startTime: startTicks,
        duration: tickOf(durationSec),
        trimStart: 0,
        trimEnd: tickOf(durationSec),
        params: Object.assign({}, CORE_DEFAULT_PARAMS),
        hidden: false,
      });
    }

    if (sc.title && sc.title !== loc(ctx, "镜头 " + (i + 1), "Shot " + (i + 1))) {
      addElement(ensureTextTrack(), {
        id: "el-text-" + i,
        name: sc.title,
        type: "text",
        startTime: startTicks,
        duration: tickOf(durationSec),
        trimStart: 0,
        trimEnd: tickOf(durationSec),
        params: Object.assign({}, coreParamsForType("text"), { content: sc.title }),
        hidden: false,
      });
    }
    cursor += durationSec;
  }

  if (pkg.audio && pkg.audio.voiceoverAssetId) {
    addElement(ensureAudioTrack(), {
      id: "el-vo-" + Date.now().toString(36),
      name: loc(ctx, "配音", "Voiceover"),
      type: "audio",
      sourceType: "upload",
      mediaId: pkg.audio.voiceoverAssetId,
      startTime: 0,
      duration: tickOf(pkg.audio.durationSeconds || cursor || 10),
      trimStart: 0,
      trimEnd: tickOf(pkg.audio.durationSeconds || cursor || 10),
      params: Object.assign({}, CORE_DEFAULT_AUDIO_PARAMS),
    });
  }

  project.metadata.updatedAt = now;
  scene.updatedAt = now;
  const write = writeProject(ctx, scopeId, project, undefined, undefined);
  if (write.ok) emitDocumentChanged(ctx, scopeId, write.version, "agent");
  return { ok: true, elements: summarizeTimeline(project) };
});

/* ------------------------------------------------------------------ *
 * AI 临时组件（Temp Components）
 * 项目作用域，逻辑组件 + 不可变版本（source+bundle 同版本持有）。
 * 时间线钉 componentId，head 跟随 = 最新 verified 版本；失败永不渲染。
 * ------------------------------------------------------------------ */
