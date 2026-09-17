/**
 * [INPUT]: 依赖 model-base 的时间单位、轨道与元素模型，以及 ctx.media.transcript。
 * [OUTPUT]: 口播文稿读取、解析、版式和可 undo 的 op 生成函数。
 * [POS]: background 的 speech-track 领域模型；不直接注册 operation。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// ---- script 文稿面（speech-track）--------------------------------------------
// 文稿剪辑 = 编辑一份 markdown（script.read 物化 / script.apply 翻译回 op）。
// 说话源 = video/audio 元素上的 transcript：assetId 解析 platform 转写素材
// （ctx.media.transcript），或 script.apply 重建后内嵌的 segments 快照。
// 段落源区间 → 时间线映射为线性（trim 窗口内按比例）。

var SCRIPT_FILLERS = ["呃", "额", "um", "uh", "er", "ah"];

function hasTranscript(el) {
  return !!(el && el.transcript && (el.transcript.assetId || (el.transcript.segments && el.transcript.segments.length)));
}

function speechTracks(project, scene) {
  var t = sceneTracks(scene);
  var out = [];
  if (t.main) out.push(t.main);
  out = out.concat(t.audio || []);
  return out;
}

// 解析元素转录分段（源时间秒，{start,end,text}）。overrides（script.fix-transcript）
// 按段覆盖文本，不改音频。
function resolveTranscriptSegments(ctx, el) {
  if (!el || !el.transcript) return { segments: [], language: null };
  var t = el.transcript;
  var raw = t.segments;
  var language = t.language || null;
  if (!raw && t.assetId && ctx && ctx.media && typeof ctx.media.transcript === "function") {
    var resolved = ctx.media.transcript(t.assetId);
    if (resolved) {
      raw = resolved.segments;
      if (language == null) language = resolved.language || null;
    }
  }
  if (!raw || !raw.length) return { segments: [], language: language };
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var seg = raw[i];
    var text = seg.text;
    if (t.overrides && t.overrides[i] !== undefined && t.overrides[i] !== null) text = String(t.overrides[i]);
    var srcStart = seg.srcStart !== undefined && seg.srcStart !== null ? Number(seg.srcStart) : Number(seg.start);
    var srcEnd = seg.srcEnd !== undefined && seg.srcEnd !== null ? Number(seg.srcEnd) : Number(seg.end);
    if (isNaN(srcStart) || isNaN(srcEnd) || srcEnd <= srcStart) continue;
    out.push({ idx: i, text: text, srcStart: srcStart, srcEnd: srcEnd });
  }
  return { segments: out, language: language };
}

// 把元素转录分段映射到时间线（trim 窗口内线性裁剪）。
function scriptSegments(ctx, project, el) {
  var r = resolveTranscriptSegments(ctx, el);
  var ts = secOf(el.trimStart) || 0;
  var te = el.trimEnd !== undefined && el.trimEnd !== null ? secOf(el.trimEnd) : ts + secOf(el.duration);
  var span = te - ts;
  if (span <= 0) return { segments: [], language: r.language };
  var out = [];
  for (var i = 0; i < r.segments.length; i++) {
    var s = r.segments[i];
    if (s.srcEnd <= ts || s.srcStart >= te) continue;
    var cs = Math.max(s.srcStart, ts);
    var ce = Math.min(s.srcEnd, te);
    if (ce <= cs) continue;
    var fs = (cs - ts) / span;
    var fe = (ce - ts) / span;
    out.push({
      idx: s.idx,
      text: s.text,
      srcStart: cs,
      srcEnd: ce,
      tlStart: secOf(el.startTime) + secOf(el.duration) * fs,
      tlDur: secOf(el.duration) * (fe - fs),
    });
  }
  return { segments: out, language: r.language };
}

// 说话 run = 同一轨上连续的、带 transcript 的 speech 元素（含 script.apply 重建后的碎片）。
function findSpeechRun(project, scene, track, startRef) {
  var els = track.elements || [];
  var start = 0;
  if (startRef && startRef.elementId) {
    for (var i = 0; i < els.length; i++) {
      if (els[i].id === startRef.elementId) { start = i; break; }
    }
  }
  if (start >= els.length || !hasTranscript(els[start])) return [];
  var run = [els[start]];
  var lo = start;
  var hi = start;
  while (hi + 1 < els.length && hasTranscript(els[hi + 1]) &&
         els[hi + 1].startTime <= els[hi].startTime + els[hi].duration + 1) {
    hi += 1;
    run.push(els[hi]);
  }
  while (lo - 1 >= 0 && hasTranscript(els[lo - 1]) &&
         els[lo].startTime <= els[lo - 1].startTime + els[lo - 1].duration + 1) {
    lo -= 1;
    run.unshift(els[lo]);
  }
  return run;
}

function buildBaselineOrdered(ctx, project, track, run) {
  var out = [];
  var prevEnd = null;
  for (var e = 0; e < run.length; e++) {
    var el = run[e];
    var r = scriptSegments(ctx, project, el);
    for (var s = 0; s < r.segments.length; s++) {
      var seg = r.segments[s];
      var gap = prevEnd !== null ? Math.max(0, seg.tlStart - prevEnd) : 0;
      out.push({
        addr: track.id + ":" + el.id + ":" + seg.idx,
        trackId: track.id, elementId: el.id, idx: seg.idx,
        text: seg.text, srcStart: seg.srcStart, srcEnd: seg.srcEnd,
        tlStart: seg.tlStart, tlDur: seg.tlDur, gapAfter: gap,
      });
      prevEnd = seg.tlStart + seg.tlDur;
    }
  }
  return out;
}

function renderRunMarkdown(ctx, project, track, run, opts) {
  opts = opts || {};
  var showSilence = !!opts.showSilence;
  var lines = [loc(ctx, "# 文稿 · recut.editor script surface", "# Script · recut.editor script surface")];
  var n = 0;
  var language = null;
  var prevEnd = null;
  for (var e = 0; e < run.length; e++) {
    var el = run[e];
    var r = scriptSegments(ctx, project, el);
    if (language == null && r.language) language = r.language;
    for (var s = 0; s < r.segments.length; s++) {
      var seg = r.segments[s];
      if (prevEnd !== null && showSilence) {
        var gap = seg.tlStart - prevEnd;
        if (gap > 0.05) lines.push("[gap=" + gap.toFixed(2) + "s]");
      }
      lines.push("[seg-" + track.id + ":" + el.id + ":" + seg.idx + "] " + seg.text);
      prevEnd = seg.tlStart + seg.tlDur;
      n += 1;
    }
  }
  var meta = [
    loc(ctx, "> 轨道 " + track.id + " · " + n + " 段" + (language ? " · 语言 " + language : ""), "> Track " + track.id + " · " + n + " segment(s)" + (language ? " · language " + language : "")),
    loc(ctx, "> 一行=一段；行内 ~~x~~=只删 x 的音频；整行删除=删整段；行移动=改顺序" + (showSilence ? "；[gap=Xs→Ys]=压缩停顿" : ""), "> One line = one segment; inline ~~x~~ = delete only x's audio; delete a whole line = delete that segment; move a line = reorder" + (showSilence ? "; [gap=Xs→Ys] = compress pause" : "")),
  ];
  return { md: lines[0] + "\n" + meta.join("\n") + "\n" + lines.slice(1).join("\n") + "\n", count: n, language: language };
}

var SCRIPT_SEG_RE = /^\[seg-([^:\]]+):([^:\]]+):(\d+)\]\s*(.*)$/;
var SCRIPT_GAP_RE = /^\[gap=([\d.]+)s(?:\s*(?:→|->)\s*([\d.]+)s)?\]$/;

// 解析行内删除线 ~~x~~，返回干净文本 + struck 区间（相对干净文本）。
function parseStrikes(raw) {
  var clean = "";
  var strikes = [];
  var i = 0;
  while (i < raw.length) {
    if (raw.charAt(i) === "~" && raw.charAt(i + 1) === "~") {
      var j = raw.indexOf("~~", i + 2);
      if (j < 0) { clean += raw.charAt(i); i += 1; continue; }
      var inner = raw.slice(i + 2, j);
      if (inner.indexOf("~~") < 0) {
        strikes.push({ start: clean.length, end: clean.length + inner.length, text: inner });
        clean += inner;
        i = j + 2;
        continue;
      }
      clean += raw.charAt(i);
      i += 1;
    } else {
      clean += raw.charAt(i);
      i += 1;
    }
  }
  return { clean: clean, strikes: strikes };
}

function parseScriptMarkdown(text) {
  var units = [];
  var lines = String(text || "").split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === "#" || line.charAt(0) === ">") continue;
    var gm = line.match(SCRIPT_GAP_RE);
    if (gm) {
      var from = gm[1] !== undefined ? Number(gm[1]) : null;
      var to = gm[2] !== undefined ? Number(gm[2]) : from;
      units.push({ kind: "gap", from: from, to: to });
      continue;
    }
    var sm = line.match(SCRIPT_SEG_RE);
    if (sm) {
      var parsed = parseStrikes(sm[4] || "");
      units.push({
        kind: "seg", trackId: sm[1], elementId: sm[2], idx: Number(sm[3]),
        text: parsed.clean, strikes: parsed.strikes,
      });
      continue;
    }
  }
  return { units: units };
}

// 把 struck 区间应用到 baseline 段 → 保留的子区间（字符按比例映射到源时间）。
function applyStrikes(base, strikes) {
  if (!strikes || !strikes.length) return [{ srcStart: base.srcStart, srcEnd: base.srcEnd, text: base.text }];
  var span = base.srcEnd - base.srcStart;
  var len = base.text.length || 1;
  var cuts = strikes.slice().sort(function (a, b) { return a.start - b.start; });
  var out = [];
  var curTextStart = 0;
  for (var i = 0; i < cuts.length; i++) {
    var c = cuts[i];
    if (c.end <= c.start || c.start > base.text.length) continue;
    var ce = Math.min(c.end, base.text.length);
    if (c.start > curTextStart) {
      out.push({
        srcStart: base.srcStart + span * (curTextStart / len),
        srcEnd: base.srcStart + span * (c.start / len),
        text: base.text.slice(curTextStart, c.start),
      });
    }
    curTextStart = ce;
  }
  if (curTextStart < base.text.length) {
    out.push({
      srcStart: base.srcStart + span * (curTextStart / len),
      srcEnd: base.srcEnd,
      text: base.text.slice(curTextStart),
    });
  }
  return out.length ? out : [{ srcStart: base.srcStart, srcEnd: base.srcEnd, text: base.text }];
}

// 由 edited units 计算目标片段布局（有序源区间 + 段间停顿 gapAfter）。
// 默认保留每个 baseline 段的原始 trailing 停顿；[gap=X→Y] 显式覆盖。
function computeScriptLayout(baselineOrdered, units, locale) {
  var pieces = [];
  var seen = {};
  var baseByAddr = {};
  for (var b = 0; b < baselineOrdered.length; b++) baseByAddr[baselineOrdered[b].addr] = baselineOrdered[b];
  for (var u = 0; u < units.length; u++) {
    var unit = units[u];
    if (unit.kind === "gap") {
      if (pieces.length) pieces[pieces.length - 1].gapAfter = unit.to !== null ? unit.to : 0;
      continue;
    }
    var key = unit.trackId + ":" + unit.elementId + ":" + unit.idx;
    var base = baseByAddr[key];
    if (!base) {
      return { ok: false, error: loc(locale, "address not found in project: " + key + "（项目在 script.read 后已变更？请重新 script.read）", "address not found in project: " + key + " (project changed since script.read? Please run script.read again)") };
    }
    if (seen[key]) return { ok: false, error: "duplicate segment in script: " + key };
    seen[key] = true;
    var sub = applyStrikes(base, unit.strikes);
    for (var p = 0; p < sub.length; p++) {
      pieces.push({ srcStart: sub[p].srcStart, srcEnd: sub[p].srcEnd, text: sub[p].text });
    }
    pieces[pieces.length - 1].gapAfter = base.gapAfter !== undefined ? base.gapAfter : 0;
  }
  var deleted = [];
  for (var k in baseByAddr) {
    if (Object.prototype.hasOwnProperty.call(baseByAddr, k) && !seen[k]) deleted.push(k);
  }
  return { ok: true, pieces: pieces, deleted: deleted };
}

// 停顿规则（作用于 pieces 的段间时间线 gap，秒；只回既有停顿，不发明新静音）。
function applySilenceRule(pieces, rule) {
  if (!rule) return;
  var rs = String(rule);
  for (var i = 0; i + 1 < pieces.length; i++) {
    var a = pieces[i];
    var gap = a.gapAfter || 0;
    if (gap <= 0) continue;
    var target = gap;
    var m;
    if ((m = rs.match(/^compress:(\d+)$/))) target = Math.min(gap, Number(m[1]) / 1000);
    else if ((m = rs.match(/^normalize:(\d+)$/))) target = Math.min(gap, Number(m[1]) / 1000);
    else if ((m = rs.match(/^restore:(\d+)$/))) target = Math.min(gap, Number(m[1]) / 1000);
    else if ((m = rs.match(/^range:(\d+)-(\d+)$/))) {
      var lo = Number(m[1]) / 1000;
      var hi = Number(m[2]) / 1000;
      target = Math.max(Math.min(gap, hi), Math.min(gap, lo));
    }
    a.gapAfter = target;
  }
}

// 固定 filler（无语义 hesitation）→ struck 区间。
function strikeFillers(text) {
  var clean = "";
  var strikes = [];
  var lower = text.toLowerCase();
  var i = 0;
  while (i < text.length) {
    var matched = false;
    for (var f = 0; f < SCRIPT_FILLERS.length; f++) {
      var filler = SCRIPT_FILLERS[f];
      if (lower.slice(i, i + filler.length) === filler.toLowerCase()) {
        strikes.push({ start: clean.length, end: clean.length + filler.length, text: text.slice(i, i + filler.length) });
        clean += text.slice(i, i + filler.length);
        i += filler.length;
        matched = true;
        break;
      }
    }
    if (!matched) { clean += text.charAt(i); i += 1; }
  }
  return { clean: clean, strikes: strikes };
}

// 由目标布局生成 op 批：删整个 run → 插入碎片 → 后续元素平移。
function buildScriptOps(project, scene, track, run, pieces, opts) {
  opts = opts || {};
  var ops = [];
  var template = run[0];
  var runStart = run[0].startTime;
  var oldEnd = 0;
  for (var e = 0; e < run.length; e++) {
    var end = run[e].startTime + run[e].duration;
    if (end > oldEnd) oldEnd = end;
  }
  var cursor = runStart;
  var paramsCopy = cloneJson(template.params || {});
  for (var p = 0; p < pieces.length; p++) {
    var piece = pieces[p];
    var durTicks = Math.max(tickOf(piece.srcEnd) - tickOf(piece.srcStart), 1);
    var gapTicks = p < pieces.length - 1 ? tickOf(pieces[p].gapAfter || 0) : 0;
    ops.push({
      type: "insert",
      payload: {
        trackId: track.id,
        element: {
          type: template.type,
          name: "Speech " + (p + 1),
          mediaId: template.mediaId,
          sourceType: template.sourceType,
          sourceUrl: template.sourceUrl,
          startSec: secOf(cursor),
          durationSec: secOf(durTicks),
          trimStartSec: secOf(tickOf(piece.srcStart)),
          trimEndSec: secOf(tickOf(piece.srcEnd)),
          params: paramsCopy,
          transcript: transcriptSnapshot(template, piece),
        },
      },
    });
    cursor = cursor + durTicks + gapTicks;
  }
  var delRefs = [];
  for (var d = 0; d < run.length; d++) delRefs.push({ trackId: track.id, elementId: run[d].id });
  ops.unshift({ type: "delete", payload: { refs: delRefs } });
  var newEnd = cursor;
  var delta = newEnd - oldEnd;
  var els = track.elements || [];
  for (var l = 0; l < els.length; l++) {
    var later = els[l];
    if (run.indexOf(later) >= 0) continue;
    if (later.startTime >= oldEnd) {
      ops.push({ type: "trim", payload: { ref: { trackId: track.id, elementId: later.id }, startSec: secOf(later.startTime + delta) } });
    }
  }
  return { ops: ops, newTotalTicks: newEnd, oldTotalTicks: oldEnd };
}

// 碎片元素携带 transcript 快照，使 script.read 重建后仍可寻址。
function transcriptSnapshot(template, piece) {
  var t = template.transcript || {};
  return {
    assetId: t.assetId || null,
    source: t.source || "transcript",
    language: t.language || null,
    segments: [{ srcStart: piece.srcStart, srcEnd: piece.srcEnd, text: piece.text }],
  };
}

function resolveSpeechTrackScene(project, editedUnits) {
  for (var u = 0; u < editedUnits.length; u++) {
    var unit = editedUnits[u];
    if (unit.kind !== "seg") continue;
    var scene = findScene(project, project.currentSceneId);
    var track = findTrack(scene, unit.trackId);
    return { scene: scene, track: track, elementId: unit.elementId };
  }
  return { scene: null, track: null, elementId: null };
}
