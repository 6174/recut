/**
 * [INPUT]: 依赖 ctx.capabilities（平台通用能力桥）调 audio-studio 的 audio.transcribe（saveToLibrary）/audio.status/
 *          audio.transcript，依赖 project-store 的 scope/readProject/注册登记与 op-engine 的 executeCommand。
 * [OUTPUT]: 字幕「生成」的真实落地面：subtitle.capabilities（能力/就绪/安装引导）、subtitle.generate（一次跨 App
 *          能力调用转写+入库，返回 jobId，幂等去重）、subtitle.status（经提供方轮询，懒终态自动入库后回
 *          transcriptAssetId）、subtitle.commit（把 transcript 资产登记进 registeredAssets，可同时绑定说话元素）。
 * [POS]: background 的跨 App 字幕能力消费者；只表达「场景」，转写模型/语言/入库规则全部归属 audio-studio。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

const SUBTITLE_AUDIO_STUDIO_APP_ID = "recut.audio-studio";
// 候选 ASR 模型与语言：与 audio-studio manifest 的 audio.transcribe enum 一一对应（真值归属提供方）。
const SUBTITLE_ASR_MODELS = ["qwen3-asr-0.6b", "qwen3-asr-1.7b", "whisper-small", "whisper-medium", "whisper-large-v3"];
const SUBTITLE_LANGUAGES = ["auto", "zh", "en"];
const SUBTITLE_DEFAULT_MODEL = "whisper-small";
const SUBTITLE_TERMINAL = { completed: true, failed: true, cancelled: true, timed_out: true };
const SUBTITLE_ACTIVE = { queued: true, running: true };

function subtitleValue(input, name) {
  return String((input && input[name]) || "").trim();
}

function subtitleReuseKey(targetAssetId, model, language) {
  return [targetAssetId, model, language].join("|");
}

function ensureSubtitleJobSchema(ctx, scopeId) {
  ctx.sqlite.execute(
    "create table if not exists subtitle_jobs (" +
      "project_id text not null, " +
      "job_id text not null, " +
      "transcript_id text not null default '', " +
      "target_asset_id text not null default '', " +
      "target_kind text not null default '', " +
      "model text not null default '', " +
      "language text not null default '', " +
      "reuse_key text not null default '', " +
      "status text not null default 'queued', " +
      "transcript_asset_id text not null default '', " +
      "error text not null default '', " +
      "created_at text not null, " +
      "updated_at text not null, " +
      "primary key (project_id, job_id))",
    [],
  );
}

function writeSubtitleJob(ctx, scopeId, jobId, fields) {
  const now = new Date().toISOString();
  ctx.sqlite.execute(
    "insert or replace into subtitle_jobs (project_id, job_id, transcript_id, target_asset_id, target_kind, model, language, reuse_key, status, transcript_asset_id, error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      scopeId, jobId,
      fields.transcriptId || "", fields.targetAssetId || "", fields.targetKind || "",
      fields.model || "", fields.language || "", fields.reuseKey || "",
      fields.status || "queued", fields.transcriptAssetId || "", fields.error || "",
      fields.createdAt || now, now,
    ],
  );
}

function updateSubtitleJobStatus(ctx, scopeId, jobId, status, transcriptAssetId, error) {
  ctx.sqlite.execute(
    "update subtitle_jobs set status = ?, transcript_asset_id = ?, error = ?, updated_at = ? where project_id = ? and job_id = ?",
    [status, transcriptAssetId || "", error || "", new Date().toISOString(), scopeId, jobId],
  );
}

// 就绪/能力/安装引导：经平台「能力桥」读 audio-studio 的 inspect + audio.status。
recut.operation.register("subtitle.capabilities", (input, ctx) => {
  const inspect = ctx.capabilities.inspect({ appId: SUBTITLE_AUDIO_STUDIO_APP_ID });
  let reason = "unknown";
  if (!inspect || inspect.status === "not-installed") reason = "not-installed";
  else if (inspect.ready !== true) reason = "stale";
  const base = {
    appId: SUBTITLE_AUDIO_STUDIO_APP_ID,
    ready: false,
    envReady: false,
    asrModels: SUBTITLE_ASR_MODELS,
    installedModels: [],
    languages: SUBTITLE_LANGUAGES,
    status: inspect && inspect.status ? inspect.status : "not-installed",
    reason,
    code: inspect && inspect.code ? inspect.code : "",
    message: inspect && inspect.message ? inspect.message : "",
    action: inspect && inspect.action ? inspect.action : "",
    install: inspect && inspect.install ? inspect.install : null,
  };
  if (reason === "not-installed" || reason === "stale") return base;
  // 已安装且暴露能力面：再读运行时就绪与已装模型（每次实时判定，安装/更新后立即生效）。
  const statusCall = ctx.capabilities.invoke({ appId: SUBTITLE_AUDIO_STUDIO_APP_ID, name: "audio.status", input: {} });
  const status = statusCall && statusCall.ok === true ? statusCall.result : null;
  const envReady = !!(status && status.ready === true);
  // audio.status 返回 asr: { installed: [...] }（对象，不是数组）。
  const installedModels = status && status.asr && Array.isArray(status.asr.installed) ? status.asr.installed : [];
  if (!envReady) reason = "env";
  else if (installedModels.length === 0) reason = "no-model";
  else reason = "ready";
  return {
    ...base,
    reason,
    ready: envReady,
    envReady,
    installedModels,
    action: envReady
      ? ""
      : (status && status.error) || (status && status.action) || "Open Audio Studio, prepare its runtime, then install an ASR model.",
    envError: !envReady && status && status.error ? status.error : "",
  };
});

// ─── 生成：一次跨 App 能力调用完成「转写 + 入库」，返回 jobId；幂等去重。 ───
recut.operation.register("subtitle.generate", (input, ctx) => {
  const scopeId = scope(ctx);
  const targetAssetId = subtitleValue(input, "targetAssetId") || subtitleValue(input, "assetId");
  const kind = input && input.kind === "audio" ? "audio" : "video";
  const model = subtitleValue(input, "model") || SUBTITLE_DEFAULT_MODEL;
  const language = subtitleValue(input, "language") || "auto";
  if (!targetAssetId) throw new Error("subtitle.generate: targetAssetId required");
  if (SUBTITLE_ASR_MODELS.indexOf(model) < 0) throw new Error("subtitle.generate: unsupported model " + model);
  if (SUBTITLE_LANGUAGES.indexOf(language) < 0) throw new Error("subtitle.generate: unsupported language " + language);
  ensureSubtitleJobSchema(ctx, scopeId);

  // 幂等去重：同目标+模型+语言 未终态 → 复用既有 job；已是成功终态 → 直接复用产物。
  const active = ctx.sqlite.query(
    "select job_id from subtitle_jobs where project_id = ? and reuse_key = ? and status in ('queued','running') order by created_at desc limit 1",
    [scopeId, subtitleReuseKey(targetAssetId, model, language)],
  );
  if (active.length) return { jobId: active[0].job_id, reused: true };
  const done = ctx.sqlite.query(
    "select job_id, transcript_id, transcript_asset_id from subtitle_jobs where project_id = ? and reuse_key = ? and status = 'completed' and transcript_asset_id != '' order by created_at desc limit 1",
    [scopeId, subtitleReuseKey(targetAssetId, model, language)],
  );
  if (done.length) {
    return { jobId: done[0].job_id, reused: true, completed: true, transcriptId: done[0].transcript_id, transcriptAssetId: done[0].transcript_asset_id };
  }

  const invoke = ctx.capabilities.invoke({
    appId: SUBTITLE_AUDIO_STUDIO_APP_ID,
    name: "audio.transcribe",
    input: { assetId: targetAssetId, kind, model, language, saveToLibrary: true },
  });
  if (!invoke || invoke.ok !== true) {
    const e = (invoke && invoke.error) || {};
    return { ok: false, code: e.code || "provider.error", message: e.message || "audio.transcribe failed", hint: e.hint, retryable: e.retryable, phase: e.phase };
  }
  const result = invoke.result || {};
  const now = new Date().toISOString();
  const transcriptId = result.transcript && result.transcript.id ? result.transcript.id : "";
  const reuseKey = subtitleReuseKey(targetAssetId, model, language);

  // 提供方已幂等去重复用（没起新 job）：立即进入终态。
  if (result.reused === true && transcriptId) {
    writeSubtitleJob(ctx, scopeId, "reuse-" + transcriptId, {
      transcriptId, targetAssetId, targetKind: kind, model, language, reuseKey,
      status: "completed", transcriptAssetId: result.transcriptAssetId || "", createdAt: now,
    });
    return { jobId: "reuse-" + transcriptId, reused: true, completed: true, transcriptId, transcriptAssetId: result.transcriptAssetId || "" };
  }

  const jobId = result.job && result.job.id ? result.job.id : "";
  if (!jobId) return { ok: false, code: "provider.error", message: "audio.transcribe did not return a job id" };
  writeSubtitleJob(ctx, scopeId, jobId, {
    transcriptId, targetAssetId, targetKind: kind, model, language, reuseKey,
    status: "queued", createdAt: now,
  });
  return { jobId, reused: false, transcriptId };
});

// ─── 状态：经提供方轮询；转写完成且 saveToLibrary 时懒终态自动入库，回 transcriptAssetId + srt/segments。
//      轮询取不到提供方结果时按错误返回（不再无条件静默成 running，避免永久转圈）。 ───
recut.operation.register("subtitle.status", (input, ctx) => {
  const scopeId = scope(ctx);
  const jobId = subtitleValue(input, "jobId");
  if (!jobId) throw new Error("subtitle.status: jobId required");
  ensureSubtitleJobSchema(ctx, scopeId);
  const rows = ctx.sqlite.query(
    "select transcript_id, target_asset_id, target_kind, status, transcript_asset_id, error from subtitle_jobs where project_id = ? and job_id = ?",
    [scopeId, jobId],
  );
  if (!rows.length) return { ok: false, reason: "job-not-found" };
  const row = rows[0];

  if (row.transcript_id) {
    const poll = ctx.capabilities.invoke({ appId: SUBTITLE_AUDIO_STUDIO_APP_ID, name: "audio.transcript", input: { id: row.transcript_id } });
    if (poll && poll.ok === true && poll.result) {
      const rec = poll.result;
      const providerStatus = String(rec.status || "queued");
      const transcriptAssetId = rec.transcriptAssetId || rec.savedAssetId || "";
      updateSubtitleJobStatus(ctx, scopeId, jobId, providerStatus, transcriptAssetId, rec.error || "");
      // 完成判定：提供方显式 completed，或已带 srt/segments（兼容未回 status 的旧提供方副本）。
      const completed = providerStatus === "completed" || typeof rec.srt === "string" || Array.isArray(rec.segments);
      if (completed) {
        return {
          jobId, status: "completed", transcriptId: row.transcript_id, transcriptAssetId,
          segments: Array.isArray(rec.segments) ? rec.segments : [],
          srt: rec.srt || "", model: rec.model || "", language: rec.language || "",
        };
      }
      return { jobId, status: SUBTITLE_TERMINAL[providerStatus] ? providerStatus : "running", transcriptId: row.transcript_id, error: rec.error || "" };
    }
    // 提供方查询失败/忙碌：返回 error 而不是静默 running，让 UI 决定重试或取消。
    const pollError = poll && poll.error ? { ...poll.error } : null;
    return {
      jobId,
      status: "error",
      retryable: !!(pollError && pollError.retryable),
      error: (pollError && (pollError.message || pollError.code)) || "audio.transcript unavailable",
      transcriptId: row.transcript_id,
    };
  }
  return { jobId, status: SUBTITLE_TERMINAL[row.status] ? row.status : "running", transcriptAssetId: row.transcript_asset_id, error: row.error || "" };
});

// ─── 取消：停止当前活动的转写 job（确认它是本 jobId 后经能力桥调 audio.cancel），并结束本轨任务状态。 ───
recut.operation.register("subtitle.cancel", (input, ctx) => {
  const scopeId = scope(ctx);
  const jobId = subtitleValue(input, "jobId");
  if (!jobId) throw new Error("subtitle.cancel: jobId required");
  ensureSubtitleJobSchema(ctx, scopeId);
  const rows = ctx.sqlite.query("select status from subtitle_jobs where project_id = ? and job_id = ?", [scopeId, jobId]);
  if (!rows.length) return { ok: false, reason: "job-not-found" };
  const status = rows[0].status;
  if (SUBTITLE_TERMINAL[status]) return { ok: true, status, alreadyTerminal: true };

  let cancelled = false;
  const active = ctx.capabilities.invoke({ appId: SUBTITLE_AUDIO_STUDIO_APP_ID, name: "audio.status", input: {} });
  const activeJob = active && active.ok === true && active.result && active.result.activeJob ? active.result.activeJob : null;
  if (activeJob && String(activeJob.id || "") === jobId && SUBTITLE_ACTIVE[activeJob.status || ""]) {
    const cancelCall = ctx.capabilities.invoke({ appId: SUBTITLE_AUDIO_STUDIO_APP_ID, name: "audio.cancel", input: {} });
    cancelled = !!(cancelCall && cancelCall.ok === true);
  }
  // job 已不在活动列表（可能已结束未结算）时也按用户意图收口，本地直接终态化。
  updateSubtitleJobStatus(ctx, scopeId, jobId, "cancelled", "", "用户取消");
  return { ok: true, status: "cancelled", cancelled };
});

// ─── 部分成功 repair：转写完成但懒终态入库失败（savedAssetId 为空）时，重读一次提供方记录补 save。 ───
recut.operation.register("subtitle.retry-save", (input, ctx) => {
  const scopeId = scope(ctx);
  const jobId = subtitleValue(input, "jobId");
  if (!jobId) throw new Error("subtitle.retry-save: jobId required");
  ensureSubtitleJobSchema(ctx, scopeId);
  const rows = ctx.sqlite.query("select transcript_id, status, transcript_asset_id from subtitle_jobs where project_id = ? and job_id = ?", [scopeId, jobId]);
  if (!rows.length) return { ok: false, reason: "job-not-found" };
  const row = rows[0];
  if (!row.transcript_id) return { ok: false, reason: "no-transcript-id" };
  const inv = ctx.capabilities.invoke({ appId: SUBTITLE_AUDIO_STUDIO_APP_ID, name: "audio.transcript", input: { id: row.transcript_id } });
  if (inv && inv.ok === true && inv.result) {
    const rec = inv.result;
    const transcriptAssetId = rec.transcriptAssetId || rec.savedAssetId || "";
    if (transcriptAssetId) {
      updateSubtitleJobStatus(ctx, scopeId, jobId, "completed", transcriptAssetId, "");
      return { ok: true, transcriptAssetId };
    }
    return { ok: false, message: rec.error || "transcription finished but the transcript is not in the library yet" };
  }
  const e = (inv && inv.error) || {};
  return { ok: false, message: e.message || "audio.transcript unavailable" };
});

// ─── 提交：把 transcript 资产登记进 registeredAssets（覆盖式，与 timeline.assets 语义一致），
//      可选把同一资产 script.attach 到说话元素，让字幕与可编辑文稿同源。 ───
recut.operation.register("subtitle.commit", (input, ctx) => {
  const scopeId = scope(ctx);
  const transcriptAssetId = subtitleValue(input, "transcriptAssetId") || subtitleValue(input, "assetId");
  if (!transcriptAssetId) throw new Error("subtitle.commit: transcriptAssetId required");
  const existing = readProject(ctx, scopeId) || {};
  const previous = Array.isArray(existing.registeredAssets) ? existing.registeredAssets : [];
  const merged = Array.from(new Set([transcriptAssetId].concat(previous)));
  ensureSchema(ctx, scopeId);
  ctx.sqlite.execute(
    "update editor_projects set registered_assets_json = ?, updated_at = ? where project_id = ?",
    [JSON.stringify(merged), nowIso(), scopeId],
  );
  emitProjectEvent(ctx, scopeId, "project.assets.changed", { kind: "any", mediaIds: merged, library: { tab: "media" } });

  let attached = false;
  if (input && input.trackId && input.elementId) {
    const attach = executeCommand(ctx, scopeId, {
      type: "transcript-attach",
      payload: {
        ref: { trackId: input.trackId, elementId: input.elementId },
        assetId: transcriptAssetId,
        source: input.source || "transcript",
        language: input.language,
      },
    });
    attached = !!(attach && attach.ok);
  }
  return { ok: true, transcriptAssetId, registered: merged.length, attached };
});