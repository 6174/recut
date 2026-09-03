/**
 * [INPUT]: 依赖 project-store、op-engine、subtitles 与 script-model。
 * [OUTPUT]: 项目、时间线、字幕、文稿与混音 operation 的注册。
 * [POS]: background 的编辑操作适配层；所有 mutation 委托 executeCommand。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// 操作
// ============================================================================
recut.operation.register("project.create", (input, ctx) => {
  const scopeId = scope(ctx);
  const now = nowIso();
  const project = makeDefaultProject({
    scopeId,
    name: input && input.name,
    settings: input && input.settings,
    materialAssetIds: input && input.materialAssetIds,
    locale: ctx.locale,
  });
  ensureSchema(ctx, scopeId);
  ctx.sqlite.execute(
    "insert into editor_projects (project_id, project_json, registered_assets_json, version, updated_at) values (?, ?, ?, ?, ?) " +
      "on conflict(project_id) do update set " +
      "project_json = excluded.project_json, registered_assets_json = excluded.registered_assets_json, " +
      "version = excluded.version, updated_at = excluded.updated_at",
    [scopeId, JSON.stringify(project), JSON.stringify((input && input.materialAssetIds) || []), 1, now],
  );
  return { projectId: scopeId, project, version: 1 };
});

recut.operation.register("project.load", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) {
    const project = makeDefaultProject({ scopeId, name: undefined, locale: ctx.locale });
    writeProject(ctx, scopeId, project, [], 1);
    return { project, registeredAssets: [], version: 1 };
  }
  return { project: existing.project, registeredAssets: existing.registeredAssets, version: existing.version };
});

recut.operation.register("project.save", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !input.project) {
    throw new Error("project.save: missing project");
  }
  const lock = readLock(ctx, scopeId);
  if (lock && !lockExpired(lock)) {
    return { ok: false, locked: true, lock: { owner: lock.owner } };
  }
  const baseVersion = input.baseVersion !== undefined && input.baseVersion !== null ? input.baseVersion : undefined;
  const write = writeProject(ctx, scopeId, input.project, undefined, undefined, baseVersion);
  if (!write.ok) {
    return { ok: false, conflict: true, currentVersion: write.currentVersion };
  }
  emitDocumentChanged(ctx, scopeId, write.version, "ui");
  return { ok: true, version: write.version, savedAt: nowIso() };
});

recut.operation.register("workflow.context", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  const project = existing && existing.project;
  const c = condensedTimeline(project);
  const lock = readLock(ctx, scopeId);
  const hasProject = !!existing && !!project;
  const hasElements = c.clips.length > 0;
  const locked = !!(lock && !lockExpired(lock));
  const fullActions = ["timeline.read", "element.get", "timeline.validate", "timeline.command", "timeline.placeComponents", "timeline.placeAudio", "timeline.delta", "history.undo", "history.redo", "project.lock", "project.unlock", "work.checkpoint", "work.cancel", "timeline.assets", "asset.list", "asset.archive", "component.create", "component.revise", "component.source", "component.update", "component.list", "component.archive", "film.package.import", "subtitle.import", "subtitle.export", "subtitle.capabilities", "subtitle.generate", "subtitle.status", "subtitle.commit", "subtitle.cancel", "subtitle.retry-save", "script.read", "script.apply", "script.clean", "script.find", "script.fix-transcript", "script.attach", "track.role", "audio.smooth", "library.browse", "preview.frame", "preview.batch", "preview.contact-sheet", "export.start", "cover.get"];
  return {
    projectId: scopeId,
    // 阶段以"项目是否已建"为准：已建但空 → ready（可加内容），未建 → brief（需先建）。
    stage: !hasProject ? "brief" : hasElements ? "editing" : "ready",
    settings: project && project.settings ? project.settings : null,
    timeline: { elements: c.clips.length, tracks: c.tracks.length },
    durationSeconds: c.durationSec,
    registeredAssets: (existing && existing.registeredAssets) || [],
    version: existing ? existing.version : 0,
    aiLock: locked ? { owner: lock.owner, since: lock.since } : null,
    // nextAction：只有项目未建才 create_project；已建空项目 → add_content，已有内容 → edit_timeline。
    nextAction: !hasProject ? "create_project" : hasElements ? "edit_timeline" : "add_content",
    allowedActions: hasProject
      ? fullActions
      : ["project.create", "film.package.import", "timeline.command", "timeline.placeComponents", "asset.list", "asset.archive", "component.create", "component.revise", "component.source", "component.update", "component.list", "component.archive", "subtitle.import", "subtitle.export", "subtitle.capabilities", "subtitle.generate", "subtitle.status", "subtitle.commit", "subtitle.cancel", "subtitle.retry-save", "script.attach", "track.role", "library.browse"],
    authoring: {
      incrementalSync: true,
      workUnits: true,
      previewBatch: true,
      contactSheet: true,
      headlessPreview: false,
      headlessExport: false,
    },
    capabilities: {
      "preview.frame": "ui-only",
      "preview.batch": "ui-only",
      "preview.contact-sheet": "ui-only",
      "export.start": "ui-async",
      "timeline.delta": true,
      "work.checkpoint": true,
      "work.cancel": true,
      headless: false,
    },
    paths: { appRoot: ctx.paths ? ctx.paths.appRoot : null, projectFilesRoot: ctx.paths ? ctx.paths.projectFilesRoot : null },
  };
});

recut.operation.register("project.get", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  const project = existing && existing.project;
  const lock = readLock(ctx, scopeId);
  return {
    name: project && project.metadata ? project.metadata.name : null,
    settings: project && project.settings ? project.settings : null,
    version: existing ? existing.version : 0,
    durationSec: projectDurationTicks(project) / TICKS_PER_SECOND,
    materialAssetIds: (project && project.materialAssetIds) || [],
    registeredAssets: (existing && existing.registeredAssets) || [],
    aiLock: lock && !lockExpired(lock) ? { owner: lock.owner, since: lock.since } : null,
  };
});

recut.operation.register("timeline.read", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  const project = existing && existing.project;
  const c = condensedTimeline(project);
  const lock = readLock(ctx, scopeId);
  return {
    version: existing ? existing.version : 0,
    currentSceneId: c.currentSceneId,
    durationSec: c.durationSec,
    settings: c.settings,
    tracks: c.tracks,
    clips: c.clips,
    aiLock: lock && !lockExpired(lock) ? { owner: lock.owner } : null,
  };
});

recut.operation.register("element.get", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  if (!input || !input.trackId || !input.elementId) {
    throw new Error("element.get: trackId + elementId required");
  }
  const detail = elementDetail(existing && existing.project, { trackId: input.trackId, elementId: input.elementId });
  if (!detail) throw new Error("element.get: element not found");
  return { version: existing.version, element: detail };
});

recut.operation.register("timeline.validate", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  const compRows = ctx.sqlite.query(
    "select component_id from editor_components where project_id = ?",
    [scopeId],
  );
  const componentIds = (compRows || []).map((r) => r.component_id);
  const violations = validateTimeline(existing && existing.project, existing && existing.registeredAssets, componentIds);
  return { version: existing ? existing.version : 0, ok: violations.length === 0, violations };
});

recut.operation.register("timeline.assets", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!Array.isArray(input && input.assetIds)) {
    throw new Error("timeline.assets: assetIds array required");
  }
  const unique = Array.from(new Set(input.assetIds));
  ensureSchema(ctx, scopeId);
  ctx.sqlite.execute(
    "update editor_projects set registered_assets_json = ?, updated_at = ? where project_id = ?",
    [JSON.stringify(unique), nowIso(), scopeId],
  );
  // 实时同步：AI 登记素材后通知前端面板刷新并切到素材视图。
  emitProjectEvent(ctx, scopeId, "project.assets.changed", {
    kind: "any",
    mediaIds: unique,
    library: { tab: "media" },
  });
  return { registered: unique.length, assetIds: unique };
});

recut.operation.register("project.updateSettings", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) throw new Error("project.updateSettings: project not found");
  const op = {
    type: "settings",
    payload: {
      fps: input && input.fps,
      canvasSize: input && input.canvasSize,
      background: input && input.background,
    },
  };
  if (input && input.baseVersion !== undefined && input.baseVersion !== null) {
    op.baseVersion = input.baseVersion;
  }
  const out = executeCommand(ctx, scopeId, op);
  if (out.ok) {
    const cur = readProject(ctx, scopeId);
    out.settings = cur && cur.project && cur.project.settings;
  }
  return out;
});

recut.operation.register("project.lock", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) throw new Error("project.lock: project not found");
  const lock = readLock(ctx, scopeId);
  if (lock && !lockExpired(lock)) {
    return { ok: false, locked: true, lock: { owner: lock.owner } };
  }
  const owner = (input && input.owner) || "agent";
  const token = lockToken();
  writeLock(ctx, scopeId, owner, token);
  emitProjectEvent(ctx, scopeId, "project:locked", { owner: owner, version: existing.version });
  return { ok: true, lock: { owner, token: token, since: nowIso() }, version: existing.version };
});

recut.operation.register("project.unlock", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  const lock = readLock(ctx, scopeId);
  if (lock && !lockExpired(lock)) {
    const owner = input && input.owner;
    const token = input && input.token;
    if (!owner || owner !== lock.owner) return { ok: false, locked: true, reason: "lock-owner-mismatch", lock: { owner: lock.owner } };
    if (!token || !lock.token || token !== lock.token) return { ok: false, locked: true, reason: "lock-token-mismatch", lock: { owner: lock.owner } };
  }
  clearLock(ctx, scopeId);
  emitProjectEvent(ctx, scopeId, "project:unlocked", { version: existing ? existing.version : 0 });
  emitDocumentChanged(ctx, scopeId, existing ? existing.version : 0, "agent");
  return { ok: true, version: existing ? existing.version : 0 };
});

recut.operation.register("timeline.command", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !input.op || !input.op.type) {
    throw new Error("timeline.command: op required");
  }
  return executeCommand(ctx, scopeId, normalizeComponentAssetOp(ctx, scopeId, input.op));
});

function resolveComponentAsset(ctx, scopeId, assetId) {
  ensureAssetSchema(ctx, scopeId);
  const rows = ctx.sqlite.query(
    "select asset_id, type, ref_id, status from editor_assets where project_id = ? and asset_id = ?",
    [scopeId, assetId],
  );
  const asset = rows && rows[0];
  if (!asset || asset.type !== "component" || asset.status !== "active") {
    throw new Error("timeline component asset is missing or archived: " + assetId);
  }
  return asset.ref_id;
}

function normalizeComponentItems(ctx, scopeId, items) {
  return items.map((item) => {
    const next = Object.assign({}, item || {});
    const fromAsset = next.assetId ? resolveComponentAsset(ctx, scopeId, next.assetId) : null;
    if (fromAsset && next.componentId && fromAsset !== next.componentId) {
      throw new Error("timeline component assetId and componentId do not match");
    }
    next.componentId = fromAsset || next.componentId;
    if (!next.componentId) {
      throw new Error("timeline component requires assetId");
    }
    next.assetId = next.assetId || projectAssetId("component", next.componentId);
    return next;
  });
}

function normalizeComponentAssetOp(ctx, scopeId, op) {
  const normalized = Object.assign({}, op, { payload: Object.assign({}, op.payload || {}) });
  if (normalized.type === "component-placement") {
    normalized.payload.items = normalizeComponentItems(ctx, scopeId, normalized.payload.items || []);
  } else if (normalized.type === "insert" && normalized.payload.element && normalized.payload.element.type === "component") {
    normalized.payload.element = normalizeComponentItems(ctx, scopeId, [normalized.payload.element])[0];
  }
  return normalized;
}

/**
 * 原子放置一组已验证组件。默认 firstAvailable：同一时间段的 graphic 组件分配不同轨，
 * 非重叠组件复用轨；一次 command log / version 变化，杜绝 Agent 逐条插入的重叠与版本竞态。
 */
recut.operation.register("timeline.placeComponents", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("timeline.placeComponents: items required");
  }
  const items = normalizeComponentItems(ctx, scopeId, input.items);
  return executeCommand(ctx, scopeId, {
    type: "component-placement",
    baseVersion: input.baseVersion,
    payload: {
      sceneId: input.sceneId,
      trackType: input.trackType || "graphic",
      items: items,
    },
  });
});

/**
 * 原子批量放置一组已验证/已登记的音频素材。「音频是媒体素材」：AI 只给 assetId(平台媒体素材)
 * + start/duration，source 语义（sourceType:"upload"+mediaId）由后端推导，杜绝 AI 拼错
 * library/sourceUrl。放置前自动把这些媒体素材登记进 registeredAssets，并广播同步事件，
 * 让前端素材面板实时看到新增音频。
 */
function normalizeAudioPlacementItems(ctx, scopeId, items) {
  return (items || []).map((item) => {
    const next = Object.assign({}, item || {});
    const raw = next.mediaId || next.assetId;
    if (!raw) throw new Error("placeAudio: each item requires assetId (platform media asset)");
    if (String(raw).indexOf("audio:") === 0) {
      next.mediaId = String(raw).slice("audio:".length);
    } else {
      next.mediaId = String(raw);
    }
    delete next.assetId;
    next.sourceType = "upload";
    next.type = "audio";
    return next;
  });
}

// 把引用的媒体素材关联到当前项目，使 recut.assets.list(projectId) 能取到它（前端面板实时可见、回放可解析）。
function attachMediaAssetsToProject(ctx, scopeId, mediaIds) {
  if (!ctx.media || typeof ctx.media.attach !== "function") return;
  for (const mediaId of mediaIds) {
    try {
      ctx.media.attach({ assetId: mediaId });
    } catch (e) {
      // 素材缺失或宿主不支持 attach 时静默跳过；缺失仍会被 timeline.validate 的
      // audio-unresolvable / asset-exists 拦截暴露，这里不因告警失败阻塞落轨。
    }
  }
}

recut.operation.register("timeline.placeAudio", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("timeline.placeAudio: items required");
  }
  const items = normalizeAudioPlacementItems(ctx, scopeId, input.items);

  // 放置前把引用的媒体素材登记进 registeredAssets，保证 audio-placement 通过可解析校验。
  const existing = readProject(ctx, scopeId);
  const merged = Array.from(new Set((existing && existing.registeredAssets) || []));
  for (const item of items) {
    if (!merged.includes(item.mediaId)) merged.push(item.mediaId);
  }
  ctx.sqlite.execute(
    "update editor_projects set registered_assets_json = ?, updated_at = ? where project_id = ?",
    [JSON.stringify(merged), nowIso(), scopeId],
  );

  // 关联到项目，保证回放与面板实时可见（attached asset 才出现在 recut.assets.list(projectId)）。
  attachMediaAssetsToProject(ctx, scopeId, merged.filter((id) => !String(id).startsWith("component:")));

  const out = executeCommand(ctx, scopeId, {
    type: "audio-placement",
    baseVersion: input.baseVersion,
    payload: { sceneId: input.sceneId, items },
  });

  if (out.ok) {
    emitProjectEvent(ctx, scopeId, "project.assets.changed", {
      kind: "audio",
      mediaIds: items.map((i) => i.mediaId),
      library: { tab: "media" },
    });
  }
  return out;
});

recut.operation.register("history.undo", (input, ctx) => {
  const scopeId = scope(ctx);
  return undoLast(ctx, scopeId);
});

recut.operation.register("history.redo", (input, ctx) => {
  const scopeId = scope(ctx);
  return redoNext(ctx, scopeId);
});

// 增量同步：iframe 版本 gap 或事件未带 document 时拉取 fold 后的快照 + opsSince。
recut.operation.register("timeline.delta", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) {
    throw new Error("timeline.delta: project not found");
  }
  const fromVersion = input && typeof input.fromVersion === "number" ? input.fromVersion : 0;
  return {
    ok: true,
    fromVersion: fromVersion,
    toVersion: existing.version,
    operations: logSince(ctx, scopeId, fromVersion),
    document: existing.project,
  };
});

// 工作单元检查点：记下当前 command-log seq。cancel 按 seq undo，不能按 version
//（undoLast 会递增 version，version 回不到检查点）。
recut.operation.register("work.checkpoint", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  const lock = readLock(ctx, scopeId);
  const checkpointSeq = currentDoneSeq(ctx, scopeId);
  ensureSchema(ctx, scopeId);
  ctx.sqlite.execute(
    "insert into editor_work_checkpoints (project_id, checkpoint_seq, owner, lock_token, version, created_at) values (?, ?, ?, ?, ?, ?) " +
      "on conflict(project_id) do update set checkpoint_seq = excluded.checkpoint_seq, owner = excluded.owner, lock_token = excluded.lock_token, version = excluded.version, created_at = excluded.created_at",
    [scopeId, checkpointSeq, lock && !lockExpired(lock) ? lock.owner : null, lock && !lockExpired(lock) ? (lock.token || null) : null, existing ? existing.version : 0, nowIso()],
  );
  return {
    ok: true,
    checkpointSeq: checkpointSeq,
    version: existing ? existing.version : 0,
    owner: lock && !lockExpired(lock) ? lock.owner : null,
    token: lock && !lockExpired(lock) ? (lock.token || null) : null,
  };
});

recut.operation.register("work.cancel", (input, ctx) => {
  const scopeId = scope(ctx);
  const checkpointSeq = input && typeof input.checkpointSeq === "number" ? input.checkpointSeq : 0;
  const lock = readLock(ctx, scopeId);
  const checkpointRows = ctx.sqlite.query(
    "select checkpoint_seq, owner, lock_token from editor_work_checkpoints where project_id = ?",
    [scopeId],
  );
  const checkpoint = checkpointRows && checkpointRows[0];
  if (!checkpoint || Number(checkpoint.checkpoint_seq) !== checkpointSeq) {
    return { ok: false, reason: "checkpoint-not-found", checkpointSeq: checkpointSeq, undoneSeqs: [] };
  }
  if (input && input.owner && checkpoint.owner && input.owner !== checkpoint.owner) {
    return { ok: false, reason: "checkpoint-owner-mismatch", checkpointSeq: checkpointSeq, undoneSeqs: [] };
  }
  if (input && input.token && checkpoint.lock_token && input.token !== checkpoint.lock_token) {
    return { ok: false, reason: "checkpoint-token-mismatch", checkpointSeq: checkpointSeq, undoneSeqs: [] };
  }
  if (checkpoint.owner && (!input || !input.owner || !input.token)) {
    return { ok: false, reason: "checkpoint-credentials-required", checkpointSeq: checkpointSeq, undoneSeqs: [] };
  }
  if (checkpoint.owner && (!lock || lockExpired(lock) || lock.owner !== checkpoint.owner || (checkpoint.lock_token && lock.token && checkpoint.lock_token !== lock.token))) {
    return { ok: false, reason: "checkpoint-not-owned", checkpointSeq: checkpointSeq, undoneSeqs: [] };
  }
  var undone = [];
  var guard = 0;
  while (guard < 200) {
    guard += 1;
    var seq = currentDoneSeq(ctx, scopeId);
    if (seq <= checkpointSeq) break;
    var result = undoLast(ctx, scopeId);
    if (!result || !result.ok) {
      const existingOnFailure = readProject(ctx, scopeId);
      return {
        ok: false,
        reason: result && result.reason ? result.reason : "undo-failed",
        error: result && result.error,
        checkpointSeq: checkpointSeq,
        undoneSeqs: undone,
        version: existingOnFailure ? existingOnFailure.version : 0,
      };
    }
    undone.push(result.undidSeq);
  }
  const existing = readProject(ctx, scopeId);
  const remaining = currentDoneSeq(ctx, scopeId);
  if (remaining > checkpointSeq) {
    return { ok: false, reason: "undo-guard-exceeded", checkpointSeq: checkpointSeq, undoneSeqs: undone, version: existing ? existing.version : 0 };
  }
  return {
    ok: true,
    checkpointSeq: checkpointSeq,
    undoneSeqs: undone,
    version: existing ? existing.version : 0,
  };
});

// ---- 字幕导入 / 导出（MCP + api）----
// 把 SRT/ASS 文本解析成字幕 cue 铺到字幕轨（text 轨 + captionStyle 共享样式 + subtitle 标记）。
recut.operation.register("subtitle.import", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || typeof input.content !== "string") {
    throw new Error("subtitle.import: content (SRT/ASS text) required");
  }
  const existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) {
    throw new Error("subtitle.import: project not found, run project.create first");
  }
  const cues = parseSubtitleContent(input.content, input.fileName || "");
  if (cues.length === 0) {
    return { ok: false, reason: "no-cues", imported: 0 };
  }
  const op = {
    type: "subtitle-import",
    payload: {
      cues: cues,
      style: input.style,
      trackId: input.trackId,
      startSec: input.startSec,
      source: input.source,
    },
  };
  const out = executeCommand(ctx, scopeId, op);
  if (out.ok) {
    out.imported = cues.length;
    out.trackId = out.result ? out.result.trackId : null;
    out.firstCueRef = out.result ? out.result.element : null;
    delete out.result;
  }
  return out;
});

// 把字幕轨 cue 序列化为 SRT 文本（AI 可读回 / 落盘给用户）。
recut.operation.register("subtitle.export", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  const project = existing && existing.project;
  const scene = project ? findScene(project, project.currentSceneId) : null;
  const tracks = scene ? sceneTracks(scene) : null;
  const all = [];
  if (tracks) {
    if (tracks.main) all.push(tracks.main);
    all.push.apply(all, tracks.overlay || []);
    all.push.apply(all, tracks.audio || []);
  }
  let track = null;
  if (input && input.trackId) track = findTrack(scene, input.trackId);
  if (!track) {
    for (let i = 0; i < all.length; i++) {
      if (all[i].type === "text" && all[i].captionStyle) { track = all[i]; break; }
    }
  }
  if (!track) {
    return { ok: false, reason: "no-caption-track" };
  }
  return {
    ok: true,
    trackId: track.id,
    cueCount: (track.elements || []).filter((e) => e.type === "text" && e.subtitle).length,
    srt: renderSrtFromTrack(track),
  };
});

// ---- script 文稿面（speech-track 文稿剪辑）----
// script.read/apply/clean/find/fix-transcript/attach 提供"文稿优先"的口播/访谈剪辑：
// 说话音频在 video/audio 元素（speech-track），文稿 = 每段的源区间映射到时间线。
// script.apply 把编辑后的 markdown 翻译成 op 批（删除线=删子区间、删行=删整段、
// 行移动=改顺序、[gap=X→Y]=压停顿），逐条落统一 op 日志，全部可 undo。

recut.operation.register("script.attach", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !input.trackId || !input.elementId || !input.assetId) {
    throw new Error("script.attach: trackId + elementId + assetId (transcript) required");
  }
  const op = {
    type: "transcript-attach",
    payload: {
      ref: { trackId: input.trackId, elementId: input.elementId },
      assetId: input.assetId,
      source: input.source || "transcript",
      language: input.language,
    },
  };
  return executeCommand(ctx, scopeId, op);
});

recut.operation.register("script.read", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) throw new Error("script.read: project not found");
  const project = existing.project;
  const scene = findScene(project, project.currentSceneId);
  const tracks = speechTracks(project, scene);
  let track = null;
  if (input && input.trackId) {
    track = findTrack(scene, input.trackId);
  } else {
    for (const t of tracks) {
      if ((t.elements || []).some(hasTranscript)) { track = t; break; }
    }
  }
  if (!track) {
    return { ok: false, reason: "no-speech-track", hint: loc(ctx, "先用 script.attach 给说话元素绑定 transcript（audio-studio 转写产物 assetId）", "First bind a transcript to a speech element with script.attach (audio-studio transcript assetId)") };
  }
  const startRef = input && input.trackId && input.elementId ? { trackId: input.trackId, elementId: input.elementId } : null;
  const run = findSpeechRun(project, scene, track, startRef);
  if (!run.length) {
    return { ok: false, reason: "no-transcript-source", hint: loc(ctx, "目标元素未绑定 transcript：script.attach 绑定转写 assetId", "Target element has no transcript attached: bind a transcript assetId with script.attach") };
  }
  const rendered = renderRunMarkdown(ctx, project, track, run, { showSilence: !!(input && input.showSilence) });
  if (rendered.count === 0) {
    return { ok: false, reason: "no-transcript-source", hint: loc(ctx, "转写素材不可用：重新 script.attach 或先 audio-studio 转写", "Transcript asset unavailable: re-run script.attach or transcribe first in Audio Studio") };
  }
  ctx.files.writeText("scripts/timeline.md", rendered.md);
  ctx.files.writeText("scripts/timeline.baseline.md", rendered.md);
  const root = (ctx.paths && ctx.paths.projectFilesRoot) || "";
  return {
    ok: true,
    path: root ? root + "/scripts/timeline.md" : "scripts/timeline.md",
    content: rendered.md,
    version: existing.version,
    trackId: track.id,
    elements: run.map((e) => e.id),
    segments: rendered.count,
    language: rendered.language,
  };
});

recut.operation.register("script.apply", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) throw new Error("script.apply: project not found");
  const edited = input && typeof input.content === "string" ? input.content : ctx.files.readText("scripts/timeline.md");
  if (!edited) throw new Error(loc(ctx, "script.apply: 编辑后的文稿为空（传 content 或先 script.read 落盘）", "script.apply: edited script is empty (pass content or run script.read first)"));
  const baselineText = ctx.files.readText("scripts/timeline.baseline.md");
  if (baselineText && baselineText.trim() === edited.trim()) {
    return { ok: true, version: existing.version, applied: [], noop: true };
  }
  const project = existing.project;
  const parsed = parseScriptMarkdown(edited);
  if (!parsed.units.length) return { ok: false, reason: "no-segments", hint: loc(ctx, "文稿里没有可识别的 seg 行", "No recognizable seg lines in the script") };
  const target = resolveSpeechTrackScene(project, parsed.units);
  if (!target.track) {
    return { ok: false, reason: "address-not-found", hint: loc(ctx, "文稿里的轨道/元素不在当前项目：请重新 script.read", "Tracks/elements in the script are not in the current project: please run script.read again") };
  }
  const run = findSpeechRun(project, target.scene, target.track, { trackId: target.track.id, elementId: target.elementId });
  if (!run.length) {
    return { ok: false, reason: "no-transcript-source", hint: loc(ctx, "目标元素未绑定 transcript：请重新 script.read", "Target element has no transcript attached: please run script.read again") };
  }
  const baseline = buildBaselineOrdered(ctx, project, target.track, run);
  const layout = computeScriptLayout(baseline, parsed.units, ctx.locale);
  if (!layout.ok) return { ok: false, reason: layout.error };
  if (!layout.pieces.length) return { ok: false, reason: "empty-layout", hint: loc(ctx, "目标布局为空：全部段被删？请检查文稿", "Target layout is empty: were all segments deleted? Please review the script") };
  const built = buildScriptOps(project, target.scene, target.track, run, layout.pieces, {});
  let version = existing.version;
  const applied = [];
  for (const op of built.ops) {
    const out = executeCommand(ctx, scopeId, Object.assign({}, op, { baseVersion: version }));
    if (!out.ok) {
      return { ok: false, conflict: out.conflict === true, reason: out.error || out.reason, currentVersion: out.currentVersion, opsSince: out.opsSince };
    }
    version = out.version;
    applied.push(op.type);
  }
  ctx.files.writeText("scripts/timeline.baseline.md", edited);
  return { ok: true, version, applied, pieces: layout.pieces.length, deleted: layout.deleted.length };
});

recut.operation.register("script.clean", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) throw new Error("script.clean: project not found");
  const project = existing.project;
  const scene = findScene(project, project.currentSceneId);
  const tracks = speechTracks(project, scene);
  let track = null;
  if (input && input.trackId) {
    track = findTrack(scene, input.trackId);
  } else {
    for (const t of tracks) {
      if ((t.elements || []).some(hasTranscript)) { track = t; break; }
    }
  }
  if (!track) return { ok: false, reason: "no-speech-track", hint: loc(ctx, "先用 script.attach 绑定 transcript", "First bind a transcript with script.attach") };
  const startRef = input && input.trackId && input.elementId ? { trackId: input.trackId, elementId: input.elementId } : null;
  const run = findSpeechRun(project, scene, track, startRef);
  if (!run.length) return { ok: false, reason: "no-transcript-source", hint: loc(ctx, "目标元素未绑定 transcript", "Target element has no transcript attached") };
  const baseline = buildBaselineOrdered(ctx, project, track, run);
  const units = [];
  let fillerRemoved = 0;
  for (let o = 0; o < baseline.length; o++) {
    const base = baseline[o];
    let strikes = [];
    let text = base.text;
    if (input && input.fillers) {
      const parsed = strikeFillers(base.text);
      strikes = parsed.strikes;
      text = parsed.clean;
      for (let s = 0; s < parsed.strikes.length; s++) fillerRemoved += parsed.strikes[s].end - parsed.strikes[s].start;
    }
    units.push({ kind: "seg", trackId: base.trackId, elementId: base.elementId, idx: base.idx, text: text, strikes: strikes });
  }
  const layout = computeScriptLayout(baseline, units, ctx.locale);
  if (!layout.ok) return { ok: false, reason: layout.error };
  if (input && input.silence) applySilenceRule(layout.pieces, input.silence);
  if (!layout.pieces.length) return { ok: false, reason: "empty-layout" };
  const built = buildScriptOps(project, scene, track, run, layout.pieces, {});
  let version = existing.version;
  const applied = [];
  for (const op of built.ops) {
    const out = executeCommand(ctx, scopeId, Object.assign({}, op, { baseVersion: version }));
    if (!out.ok) {
      return { ok: false, conflict: out.conflict === true, reason: out.error || out.reason, currentVersion: out.currentVersion };
    }
    version = out.version;
    applied.push(op.type);
  }
  return { ok: true, version, applied, pieces: layout.pieces.length, fillerRemoved };
});

recut.operation.register("script.find", (input, ctx) => {
  const scopeId = scope(ctx);
  const q = (input && input.text) || "";
  if (!q) throw new Error("script.find: text required");
  const existing = readProject(ctx, scopeId);
  const project = existing && existing.project;
  const scene = project ? findScene(project, project.currentSceneId) : null;
  const tracks = speechTracks(project, scene);
  const matches = [];
  const needle = q.toLowerCase();
  for (let t = 0; t < tracks.length; t++) {
    const els = tracks[t].elements || [];
    for (let e = 0; e < els.length; e++) {
      const el = els[e];
      if (!hasTranscript(el)) continue;
      const r = scriptSegments(ctx, project, el);
      for (let s = 0; s < r.segments.length; s++) {
        const seg = r.segments[s];
        if (seg.text.toLowerCase().indexOf(needle) >= 0) {
          matches.push({
            trackId: tracks[t].id,
            elementId: el.id,
            segment: seg.idx,
            text: seg.text,
            startSec: seg.tlStart,
            endSec: seg.tlStart + seg.tlDur,
          });
        }
      }
    }
  }
  return { ok: true, matches: matches };
});

recut.operation.register("script.fix-transcript", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !input.trackId || !input.elementId || typeof input.segmentIndex !== "number" || !input.text) {
    throw new Error("script.fix-transcript: trackId + elementId + segmentIndex + text required");
  }
  const op = {
    type: "transcript-fix",
    payload: {
      ref: { trackId: input.trackId, elementId: input.elementId },
      segmentIndex: input.segmentIndex,
      text: input.text,
    },
  };
  return executeCommand(ctx, scopeId, op);
});

// ---- 自动混音（track role → auto-duck；audio.smooth）----
// track.role 设置音频轨角色：anchor（口播/旁白，其它轨 duck 到它）/
// follower（音乐/氛围底，自动 duck）/ none（SFX 不参与）。duckDepthDb 缺省由
// anchor 响度自动初始化（buildDuckEnvelope 纯函数，Preview==Export 同源）。
recut.operation.register("track.role", (input, ctx) => {
  const scopeId = scope(ctx);
  if (!input || !input.trackId || !input.role) {
    throw new Error("track.role: trackId + role required");
  }
  const op = { type: "track-role", payload: { trackId: input.trackId, role: input.role, duckDepthDb: input.duckDepthDb } };
  return executeCommand(ctx, scopeId, op);
});

// audio.smooth：对每个硬切边界做 ~120ms 微淡入/淡出（volume 关键帧），并淡掉暴露边缘。
// 幂等（已有边界 fade 则不重复）；作为结构定稿后的最后一个音频步骤（结构再动需重跑）。
// 所有 fade 都是 volume 关键帧 → 渲染器 gain automation，确定性、可 undo。
recut.operation.register("audio.smooth", (input, ctx) => {
  const scopeId = scope(ctx);
  const existing = readProject(ctx, scopeId);
  if (!existing || !existing.project) throw new Error("audio.smooth: project not found");
  const project = existing.project;
  const scene = findScene(project, project.currentSceneId);
  const t = sceneTracks(scene);
  const all = [];
  if (t.main) all.push(t.main);
  all.push.apply(all, t.overlay || []);
  all.push.apply(all, t.audio || []);
  const fadeMs = input && typeof input.fadeMs === "number" ? input.fadeMs : AUDIO_SMOOTH_FADE_MS;
  const fadeSec = Math.min(Math.max(fadeMs / 1000, 0.02), 0.5);
  const ops = [];
  for (let i = 0; i < all.length; i++) {
    const track = all[i];
    if (track.muted) continue;
    const els = track.elements || [];
    for (let e = 0; e < els.length; e++) {
      const el = els[e];
      if (!isAudioCapable(el)) continue;
      if (el.params && el.params.muted) continue;
      const durSec = secOf(el.duration);
      if (durSec <= fadeSec * 2.2) continue;
      // 是否已有边界 fade（volume 关键帧在起止 ~fade 内）
      const keys = el.animations && el.animations.volume && el.animations.volume.keys;
      const hasEdgeFade = keys && keys.length >= 2 &&
        keys.some((k) => k.time < tickOf(fadeSec)) && keys.some((k) => k.time > el.duration - tickOf(fadeSec));
      if (hasEdgeFade) continue;
      const base = elementVolumeAt(el, durSec / 2);
      const ref = { trackId: track.id, elementId: el.id };
      ops.push({ type: "keyframe-upsert", payload: { ref, path: "volume", atSec: secOf(el.startTime), value: DUCK_FADE_SILENCE_DB, segmentToNext: "linear" } });
      ops.push({ type: "keyframe-upsert", payload: { ref, path: "volume", atSec: secOf(el.startTime + tickOf(fadeSec)), value: base, segmentToNext: "linear" } });
      ops.push({ type: "keyframe-upsert", payload: { ref, path: "volume", atSec: secOf(el.startTime + el.duration - tickOf(fadeSec)), value: base, segmentToNext: "linear" } });
      ops.push({ type: "keyframe-upsert", payload: { ref, path: "volume", atSec: secOf(el.startTime + el.duration), value: DUCK_FADE_SILENCE_DB, segmentToNext: "linear" } });
    }
  }
  if (ops.length === 0) {
    return { ok: true, version: existing.version, applied: 0, reason: "nothing-to-smooth" };
  }
  let version = existing.version;
  const applied = [];
  for (const op of ops) {
    const out = executeCommand(ctx, scopeId, Object.assign({}, op, { baseVersion: version }));
    if (!out.ok) {
      return { ok: false, conflict: out.conflict === true, reason: out.error || out.reason, currentVersion: out.currentVersion };
    }
    version = out.version;
    applied.push(op.type);
  }
  return { ok: true, version, applied: applied.length, elementsSmoothed: ops.length / 4 };
});
