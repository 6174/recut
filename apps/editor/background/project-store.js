/**
 * [INPUT]: 依赖 op-engine 的 applyOp 与读取函数，以及 components 模块在运行时提供的 headVersion。
 * [OUTPUT]: SQLite schema、项目读写、乐观锁、命令日志、undo/redo 与默认项目函数。
 * [POS]: background 的持久化与事务边界；不注册 UI/MCP operation。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// ============================================================================
// 存储层
// ============================================================================
function scope(ctx) {
  return ctx.project ? ctx.project.id : "";
}

function ensureSchema(ctx, scopeId) {
  ctx.sqlite.execute(
    "create table if not exists editor_projects (" +
      "project_id text not null primary key, " +
      "project_json text not null, " +
      "registered_assets_json text not null default '[]', " +
      "version integer not null default 1, " +
      "updated_at text not null)",
    [scopeId],
  );
  ctx.sqlite.execute(
    "create table if not exists editor_command_log (" +
      "seq integer not null, " +
      "project_id text not null, " +
      "op_json text not null, " +
      "before_scenes_json text not null, " +
      "base_version integer not null, " +
      "result_version integer not null, " +
      "state text not null default 'done', " +
      "created_at text not null, " +
      "primary key (project_id, seq))",
    [scopeId],
  );
  ctx.sqlite.execute(
    "create table if not exists editor_ai_locks (" +
      "project_id text not null primary key, " +
      "owner text not null, " +
      "token text not null default '', " +
      "since text not null, " +
      "last_op_at text not null)",
    [scopeId],
  );
  try { ctx.sqlite.execute("alter table editor_ai_locks add column token text not null default ''"); } catch (_) {}
  ctx.sqlite.execute(
    "create table if not exists editor_work_checkpoints (" +
      "project_id text not null primary key, checkpoint_seq integer not null, " +
      "owner text, lock_token text, version integer not null, created_at text not null)",
    [scopeId],
  );
  ctx.sqlite.execute(
    "create table if not exists editor_cover_prefs (" +
      "project_id text not null primary key, " +
      "mode text not null default 'auto', " +
      "frame_sec real, " +
      "asset_id text not null default '', " +
      "updated_at text not null)",
    [scopeId],
  );
  ctx.sqlite.execute(
    "create table if not exists editor_components (" +
      "component_id text not null primary key, " +
      "project_id text not null, " +
      "name text not null, " +
      "surface text not null, " +
      "keywords_json text not null default '[]', " +
      "head_version_id text, " +
      "archived_at text, " +
      "mode text not null default 'local', " +
      "created_at text not null, " +
      "updated_at text not null)",
    [scopeId],
  );
  try { ctx.sqlite.execute("alter table editor_components add column archived_at text"); } catch (_) {}
  try { ctx.sqlite.execute("alter table editor_components add column mode text not null default 'local'"); } catch (_) {}
  ctx.sqlite.execute(
    "create table if not exists editor_component_versions (" +
      "version_id text not null primary key, " +
      "component_id text not null, " +
      "version integer not null, " +
      "source text not null, " +
      "bundle_hash text not null, " +
      "bundle text not null, " +
      "inputs_json text not null, " +
      "status text not null default 'draft', " +
      "test_report_json text, " +
      "cover_path text not null default '', " +
      "created_at text not null, " +
      "verified_at text)",
    [scopeId],
  );
  try { ctx.sqlite.execute("alter table editor_component_versions add column cover_path text not null default ''"); } catch (_) {}
}

function nowIso() {
  return new Date().toISOString();
}

function readProject(ctx, scopeId) {
  ensureSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select project_json, registered_assets_json, version, updated_at from editor_projects where project_id = ?",
    [scopeId],
  );
  if (!rows || rows.length === 0) {
    return null;
  }
  var row = rows[0];
  var project = null;
  try {
    project = JSON.parse(row.project_json);
  } catch (e) {
    project = null;
  }
  return {
    project: project,
    registeredAssets: JSON.parse(row.registered_assets_json || "[]"),
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function writeProject(ctx, scopeId, project, registeredAssets, version, baseVersion) {
  ensureSchema(ctx, scopeId);
  var existing = readProject(ctx, scopeId);
  var current = existing ? existing.version : 0;
  if (baseVersion !== undefined && baseVersion !== null && current !== baseVersion) {
    return { ok: false, conflict: true, currentVersion: current };
  }
  var nextVersion = (existing && existing.version) ? existing.version + 1 : 1;
  var nextRegistered = registeredAssets !== undefined && registeredAssets !== null
    ? registeredAssets
    : (existing ? existing.registeredAssets : []);
  var projectWithVersion = project ? Object.assign({}, project, { version: nextVersion }) : project;
  var changed = ctx.sqlite.execute(
    "insert into editor_projects (project_id, project_json, registered_assets_json, version, updated_at) values (?, ?, ?, ?, ?) " +
      "on conflict(project_id) do update set " +
      "project_json = excluded.project_json, registered_assets_json = excluded.registered_assets_json, " +
      "version = excluded.version, updated_at = excluded.updated_at " +
      "where editor_projects.version = ?",
    [scopeId, JSON.stringify(projectWithVersion), JSON.stringify(nextRegistered), nextVersion, nowIso(), current],
  );
  if (!changed || !changed.rowsAffected) {
    return { ok: false, conflict: true, currentVersion: current };
  }
  return { ok: true, version: nextVersion, registeredAssets: nextRegistered };
}

function readLock(ctx, scopeId) {
  var rows = ctx.sqlite.query(
    "select owner, token, since, last_op_at from editor_ai_locks where project_id = ?",
    [scopeId],
  );
  if (!rows || rows.length === 0) return null;
  var r = rows[0];
  return { owner: r.owner, token: r.token || "", since: r.since, lastOpAt: r.last_op_at };
}

function lockToken() {
  return "lock-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

function writeLock(ctx, scopeId, owner, token) {
  ctx.sqlite.execute(
    "insert into editor_ai_locks (project_id, owner, token, since, last_op_at) values (?, ?, ?, ?, ?) " +
      "on conflict(project_id) do update set owner = excluded.owner, token = excluded.token, since = excluded.since, last_op_at = excluded.last_op_at",
    [scopeId, owner, token || "", nowIso(), nowIso()],
  );
}
function clearLock(ctx, scopeId) {
  ctx.sqlite.execute("delete from editor_ai_locks where project_id = ?", [scopeId]);
}
function touchLock(ctx, scopeId) {
  ctx.sqlite.execute("update editor_ai_locks set last_op_at = ? where project_id = ?", [nowIso(), scopeId]);
}

function emitProjectEvent(ctx, scopeId, eventType, payload) {
  if (ctx.project && typeof ctx.project.emit === "function") {
    try {
      ctx.project.emit(eventType, payload || {});
    } catch (e) {
      // 事件广播尽力而为，失败不影响写操作
    }
  }
}

function emitDocumentChanged(ctx, scopeId, version, source, details) {
  emitProjectEvent(ctx, scopeId, "project.document.changed", Object.assign({
    version: version,
    source: source || "agent",
  }, details || {}));
}
var AI_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
function lockExpired(lock) {
  if (!lock) return false;
  return Date.now() - new Date(lock.lastOpAt).getTime() > AI_LOCK_TIMEOUT_MS;
}

function nextLogSeq(ctx, scopeId) {
  var rows = ctx.sqlite.query(
    "select coalesce(max(seq), 0) as m from editor_command_log where project_id = ?",
    [scopeId],
  );
  return (rows && rows.length ? Number(rows[0].m) : 0) + 1;
}

function currentDoneSeq(ctx, scopeId) {
  ensureSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select coalesce(max(seq), 0) as m from editor_command_log where project_id = ? and state = 'done'",
    [scopeId],
  );
  return rows && rows.length ? Number(rows[0].m) : 0;
}

// 事务式：apply op → 快照 → 落库 → append 日志 → version 递增
function executeCommand(ctx, scopeId, op) {
  ensureSchema(ctx, scopeId);
  var existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) {
    throw new Error("timeline.command: project not found, run project.create first");
  }
  var baseVersion = op && op.baseVersion !== undefined && op.baseVersion !== null ? op.baseVersion : existing.version;
  if (baseVersion !== existing.version) {
    return { ok: false, conflict: true, currentVersion: existing.version, opsSince: logSince(ctx, scopeId, baseVersion) };
  }
  var componentIds = [];
  if (op.type === "insert" && op.payload && op.payload.element && op.payload.element.type === "component") {
    componentIds.push(op.payload.element.componentId);
  }
  if (op.type === "component-placement" && op.payload && Array.isArray(op.payload.items)) {
    for (var componentIndex = 0; componentIndex < op.payload.items.length; componentIndex++) {
      componentIds.push(op.payload.items[componentIndex] && op.payload.items[componentIndex].componentId);
    }
  }
  for (var verifiedIndex = 0; verifiedIndex < componentIds.length; verifiedIndex++) {
    var componentId = componentIds[verifiedIndex];
    var component = componentId && headVersion(ctx, scopeId, componentId);
    if (!component || component.status !== "verified") {
      return { ok: false, error: "component must be verified in the component library before it can be inserted into the timeline" };
    }
  }
  var seq = nextLogSeq(ctx, scopeId);
  var project = cloneJson(existing.project);
  // 快照整份 project（scenes + settings + currentSceneId），保证 undo 对所有 op 语义正确
  var beforeProject = cloneJson(project);
  var result;
  try {
    result = applyOp(project, { type: op.type, payload: op.payload || {} }, { seq: seq, locale: ctx.locale });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  project.metadata = project.metadata || { id: scopeId, name: loc(ctx, "未命名剪辑", "Untitled project") };
  project.metadata.updatedAt = nowIso();
  var write = writeProject(ctx, scopeId, project, undefined, undefined, existing.version);
  if (!write.ok) {
    return { ok: false, conflict: true, currentVersion: write.currentVersion };
  }
  project.version = write.version;
  // 新命令清除 redo 栈（undo 后的条目置为 dropped）
  ctx.sqlite.execute(
    "update editor_command_log set state = 'dropped' where project_id = ? and state = 'undone'",
    [scopeId],
  );
  var storedOp = { type: op.type, payload: op.payload || {} };
  if (op.transactionId) storedOp.transactionId = op.transactionId;
  ctx.sqlite.execute(
    "insert into editor_command_log (seq, project_id, op_json, before_scenes_json, base_version, result_version, state, created_at) values (?, ?, ?, ?, ?, ?, 'done', ?)",
    [seq, scopeId, JSON.stringify(storedOp), JSON.stringify(beforeProject), existing.version, write.version, nowIso()],
  );
  var lock = readLock(ctx, scopeId);
  if (lock) touchLock(ctx, scopeId);
  emitDocumentChanged(ctx, scopeId, write.version, "agent", {
    fromVersion: existing.version,
    toVersion: write.version,
    operations: [storedOp],
    transactionId: op.transactionId || null,
    document: project,
  });
  return {
    ok: true,
    version: write.version,
    seq: seq,
    result: result,
    changed: true,
    lock: lock ? { owner: lock.owner } : null,
  };
}

function logSince(ctx, scopeId, afterVersion) {
  var rows = ctx.sqlite.query(
    "select op_json from editor_command_log where project_id = ? and result_version > ? order by seq asc",
    [scopeId, afterVersion],
  );
  return (rows || []).map(function (r) { return JSON.parse(r.op_json); });
}

function undoLast(ctx, scopeId) {
  ensureSchema(ctx, scopeId);
  var existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) throw new Error("history: project not found");
  var rows = ctx.sqlite.query(
    "select seq, before_scenes_json from editor_command_log where project_id = ? and state = 'done' order by seq desc limit 1",
    [scopeId],
  );
  if (!rows || rows.length === 0) return { ok: false, reason: "nothing-to-undo" };
  var row = rows[0];
  var project;
  try {
    project = row.before_scenes_json ? JSON.parse(row.before_scenes_json) : cloneJson(existing.project);
  } catch (e) {
    return { ok: false, error: "corrupt undo snapshot" };
  }
  project.metadata = project.metadata || { id: scopeId, name: loc(ctx, "未命名剪辑", "Untitled project") };
  project.metadata.updatedAt = nowIso();
  var write = writeProject(ctx, scopeId, project, undefined, undefined, existing.version);
  if (!write.ok) return { ok: false, conflict: true, currentVersion: write.currentVersion };
  project.version = write.version;
  ctx.sqlite.execute(
    "update editor_command_log set state = 'undone' where project_id = ? and seq = ?",
    [scopeId, row.seq],
  );
  emitDocumentChanged(ctx, scopeId, write.version, "agent", {
    fromVersion: existing.version,
    toVersion: write.version,
    operations: [],
    document: project,
  });
  return { ok: true, version: write.version, undidSeq: row.seq };
}

function redoNext(ctx, scopeId) {
  ensureSchema(ctx, scopeId);
  var existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) throw new Error("history: project not found");
  var rows = ctx.sqlite.query(
    "select seq, op_json from editor_command_log where project_id = ? and state = 'undone' order by seq desc limit 1",
    [scopeId],
  );
  if (!rows || rows.length === 0) return { ok: false, reason: "nothing-to-redo" };
  var row = rows[0];
  var op;
  try {
    op = JSON.parse(row.op_json);
  } catch (e) {
    return { ok: false, error: "corrupt op" };
  }
  var project = cloneJson(existing.project);
  var result;
  try {
    result = applyOp(project, op, { seq: row.seq, locale: ctx.locale });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  project.metadata.updatedAt = nowIso();
  var write = writeProject(ctx, scopeId, project, undefined, undefined, existing.version);
  if (!write.ok) return { ok: false, conflict: true, currentVersion: write.currentVersion };
  project.version = write.version;
  ctx.sqlite.execute(
    "update editor_command_log set state = 'done', result_version = ? where project_id = ? and seq = ?",
    [write.version, scopeId, row.seq],
  );
  emitDocumentChanged(ctx, scopeId, write.version, "agent", {
    fromVersion: existing.version,
    toVersion: write.version,
    operations: [op],
    document: project,
  });
  return { ok: true, version: write.version, redidSeq: row.seq, result: result };
}

function summarizeTimeline(project) {
  var c = condensedTimeline(project);
  return { elements: c.clips.length, tracks: c.tracks.length };
}

function projectDurationTicks(project) {
  var maxEnd = 0;
  var scenes = project && Array.isArray(project.scenes) ? project.scenes : [];
  for (var s = 0; s < scenes.length; s++) {
    var st = sceneTracks(scenes[s]);
    var all = [];
    if (st.main) all.push(st.main);
    all = all.concat(st.overlay || []).concat(st.audio || []);
    for (var t = 0; t < all.length; t++) {
      var els = all[t].elements || [];
      for (var e = 0; e < els.length; e++) {
        var end = els[e].startTime + els[e].duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
  }
  return maxEnd;
}

function makeDefaultProject({ scopeId, name, settings, materialAssetIds, locale }) {
  var now = nowIso();
  var mainTrackId = "track-main-" + Math.random().toString(36).slice(2, 10);
  var sceneId = "scene-" + Math.random().toString(36).slice(2, 10);
  var fps = (settings && settings.fps) || DEFAULT_FPS;
  var canvasSize = (settings && settings.canvasSize) || DEFAULT_CANVAS;
  var background = (settings && settings.background) || { type: "color", color: "#000000" };
  return {
    metadata: { id: scopeId, name: name || loc(locale, "未命名剪辑", "Untitled project"), thumbnail: null, duration: 0, createdAt: now, updatedAt: now },
    scenes: [
      {
        id: sceneId,
        name: "Main scene",
        isMain: true,
        tracks: { overlay: [], main: { id: mainTrackId, name: "Main", type: "video", elements: [], muted: false, hidden: false }, audio: [] },
        bookmarks: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    currentSceneId: sceneId,
    settings: { fps: fps, canvasSize: canvasSize, background: background },
    version: 1,
    materialAssetIds: materialAssetIds || [],
  };
}

function collectTimelineAssetIds(project) {
  var ids = new Set((project && project.materialAssetIds) || []);
  var scenes = project && Array.isArray(project.scenes) ? project.scenes : [];
  for (var s = 0; s < scenes.length; s++) {
    var st = sceneTracks(scenes[s]);
    var all = [];
    if (st.main) all.push(st.main);
    all = all.concat(st.overlay || []).concat(st.audio || []);
    for (var t = 0; t < all.length; t++) {
      var els = all[t].elements || [];
      for (var e = 0; e < els.length; e++) {
        if (els[e].mediaId) ids.add(els[e].mediaId);
        if (els[e].sourceUrl) ids.add(els[e].sourceUrl);
      }
    }
  }
  return Array.from(ids);
}
