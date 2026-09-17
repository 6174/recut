/**
 * [INPUT]: 无外部依赖；供字幕、文稿和 op 引擎共享的时间线原语。
 * [OUTPUT]: tick、轨道、元素、关键帧与自动混音的纯模型函数；component 元素保留 assetId 与 componentId。
 * [POS]: background 的基础层；不得注册 operation 或访问持久化能力。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// ============================================================================
// AI Model Core —— 纯函数，无 DOM/React 依赖，goja 可直接运行。
// ============================================================================
var TICKS_PER_SECOND = 120000;
var DEFAULT_FPS = { numerator: 30, denominator: 1 };
var DEFAULT_CANVAS = { width: 1920, height: 1080 };
var DEFAULT_BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light", "difference",
  "exclusion", "hue", "saturation", "color", "luminosity", "additive",
];

function tickOf(sec) {
  return Math.round((typeof sec === "number" ? sec : 0) * TICKS_PER_SECOND);
}
function secOf(ticks) {
  return (ticks || 0) / TICKS_PER_SECOND;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---- 用户可见字符串双语（zh fallback，en 由 ctx.locale 提供）----------------
// 用法：loc(ctx, "中文", "English")；ctx 可为 { locale } 或直接传 "zh"/"en" 字符串。
function isEnglish(ctxOrLocale) {
  var l = typeof ctxOrLocale === "string" ? ctxOrLocale : ctxOrLocale && ctxOrLocale.locale;
  return l === "en";
}
function loc(ctxOrLocale, zh, en) {
  return isEnglish(ctxOrLocale) ? en : zh;
}

var CORE_DEFAULT_PARAMS = {
  "transform.positionX": 0,
  "transform.positionY": 0,
  "transform.positionZ": 0,
  "transform.scaleX": 1,
  "transform.scaleY": 1,
  "transform.rotate": 0,
  opacity: 1,
  blendMode: "normal",
};
var CORE_DEFAULT_TEXT_PARAMS = {
  // TODO(i18n): 默认文本内容 "文本" 会出现在画布上的默认文字元素，属深度内容面，后续随内容默认值 i18n 迁移。
  content: "文本",
  fontFamily: "sans-serif",
  fontSize: 72,
  color: "#FFFFFF",
  textAlign: "center",
  fontWeight: "400",
  fontStyle: "normal",
  textDecoration: "none",
  letterSpacing: 0,
  lineHeight: 1.2,
};
var CORE_DEFAULT_AUDIO_PARAMS = { volume: 0, muted: false };

// ---- 自动混音（track role → duck；audio.smooth）-------------------------------
// 音量一律 dB（UI 同构：0=满、-60 下限）；音量关键帧驱动 gain automation，
// Preview==Export 共享同一包络计算。
var DUCK_DEFAULT_DEPTH_DB = 8;
var DUCK_FADE_SILENCE_DB = -100;
var AUDIO_SMOOTH_FADE_MS = 120;

function dBToLinearCore(db) {
  return Math.pow(10, (typeof db === "number" ? db : 0) / 20);
}

function trackRole(track) {
  return track && track.role ? track.role : "none";
}

// anchor 可听区间集合（角色=anchor 且未静音、音量>下限的音频元素时间线区间）。
function collectAnchorSpans(project, scene) {
  var spans = [];
  var t = sceneTracks(scene);
  var all = [];
  if (t.main) all.push(t.main);
  all = all.concat(t.overlay || []).concat(t.audio || []);
  for (var i = 0; i < all.length; i++) {
    var track = all[i];
    if (trackRole(track) !== "anchor" || track.muted) continue;
    var els = track.elements || [];
    for (var e = 0; e < els.length; e++) {
      var el = els[e];
      if (el.type !== "audio" && el.type !== "video") continue;
      if (el.params && el.params.muted) continue;
      var vol = el.params && typeof el.params.volume === "number" ? el.params.volume : 0;
      if (vol <= DUCK_FADE_SILENCE_DB + 40) continue; // 静音片段不算 anchor
      var start = secOf(el.startTime);
      var end = secOf(el.startTime + el.duration);
      if (end <= start) continue;
      spans.push({ startSec: start, endSec: end });
    }
  }
  // 合并重叠区间
  spans.sort(function (a, b) { return a.startSec - b.startSec; });
  var merged = [];
  for (var s = 0; s < spans.length; s++) {
    var cur = spans[s];
    if (merged.length && cur.startSec <= merged[merged.length - 1].endSec) {
      if (cur.endSec > merged[merged.length - 1].endSec) merged[merged.length - 1].endSec = cur.endSec;
    } else {
      merged.push({ startSec: cur.startSec, endSec: cur.endSec });
    }
  }
  return merged;
}

// 缺省 duckDepthDb：由 anchor 基准音量（dB）粗估；无 anchor 数据用默认 8dB。
function autoInitDuckDepth(project, scene) {
  var t = sceneTracks(scene);
  var all = [];
  if (t.main) all.push(t.main);
  all = all.concat(t.overlay || []).concat(t.audio || []);
  var sum = 0;
  var n = 0;
  for (var i = 0; i < all.length; i++) {
    if (trackRole(all[i]) !== "anchor") continue;
    var els = all[i].elements || [];
    for (var e = 0; e < els.length; e++) {
      var v = els[e].params && typeof els[e].params.volume === "number" ? els[e].params.volume : 0;
      if (v > DUCK_FADE_SILENCE_DB + 40) { sum += v; n += 1; }
    }
  }
  if (n === 0) return DUCK_DEFAULT_DEPTH_DB;
  var avgDb = sum / n;
  var depth = 10 - avgDb;
  return clamp(depth, 4, 16);
}

// 确定性 duck 包络：anchor 出声区间 duck 到 factor，间隙回升到 1。
function buildDuckEnvelope(project, scene, depthDb) {
  var spans = collectAnchorSpans(project, scene);
  var depth = typeof depthDb === "number" && isFinite(depthDb) ? depthDb : autoInitDuckDepth(project, scene);
  var duckFactor = dBToLinearCore(-depth);
  return {
    depthDb: depth,
    spans: spans,
    factorAt: function (sec) {
      for (var i = 0; i < spans.length; i++) {
        if (sec >= spans[i].startSec && sec < spans[i].endSec) return duckFactor;
      }
      return 1;
    },
  };
}

function resolveDuckGainAt(envelope, sec) {
  return envelope ? envelope.factorAt(sec) : 1;
}

// 目标音频元素（audio 或带声音的 video）。
function isAudioCapable(el) {
  return el && (el.type === "audio" || el.type === "video");
}

// 元素当前音量（dB）：params 基础值或边界处关键帧。
function elementVolumeAt(el, localSec) {
  if (el.params && typeof el.params.volume === "number" && (!el.animations || !el.animations.volume)) {
    return el.params.volume;
  }
  var keys = el.animations && el.animations.volume && el.animations.volume.keys;
  if (!keys || !keys.length) return (el.params && typeof el.params.volume === "number") ? el.params.volume : 0;
  var atTicks = Math.round(localSec * TICKS_PER_SECOND);
  var base = (el.params && typeof el.params.volume === "number") ? el.params.volume : 0;
  var value = base;
  for (var k = 0; k < keys.length; k++) {
    if (keys[k].time <= atTicks) value = keys[k].value;
  }
  return value;
}

// 字幕轨默认外观：与 UI 字幕导入一致（app 单位，1080p 下有效字高 ≈ fontSize×12）。
var SUBTITLE_DEFAULT_TEXT_PARAMS = {
  fontFamily: "Arial",
  fontSize: 5,
  color: "#FFFFFF",
  textAlign: "center",
  fontWeight: "bold",
  fontStyle: "normal",
  textDecoration: "none",
  letterSpacing: 0,
  lineHeight: 1.2,
};

function coreParamsForType(type) {
  var p = Object.assign({}, CORE_DEFAULT_PARAMS);
  if (type === "text") Object.assign(p, CORE_DEFAULT_TEXT_PARAMS);
  if (type === "audio") Object.assign(p, CORE_DEFAULT_AUDIO_PARAMS);
  return p;
}

function makeTrack(type, seq, name) {
  var suffix = "-" + (seq === undefined || seq === null ? Math.random().toString(36).slice(2, 8) : "ai" + seq);
  return {
    id: "track-" + type + suffix,
    name: name || trackDefaultName(type),
    type: type,
    elements: [],
    muted: false,
    hidden: false,
  };
}
function trackDefaultName(type) {
  var names = { video: "Main", text: "Text", audio: "Audio", graphic: "Graphic", effect: "Effect" };
  return names[type] || "Track";
}

function findScene(project, sceneId) {
  if (!project || !Array.isArray(project.scenes)) return null;
  if (sceneId) {
    var found = null;
    for (var i = 0; i < project.scenes.length; i++) {
      if (project.scenes[i].id === sceneId) { found = project.scenes[i]; break; }
    }
    if (found) return found;
  }
  for (var j = 0; j < project.scenes.length; j++) {
    if (project.scenes[j].isMain) return project.scenes[j];
  }
  return project.scenes[0] || null;
}

function sceneTracks(scene) {
  if (!scene.tracks) {
    scene.tracks = { overlay: [], main: null, audio: [] };
  }
  if (!scene.tracks.main) {
    scene.tracks.main = makeTrack("video", null, "Main");
    scene.tracks.main.type = "video";
  }
  if (!scene.tracks.overlay) scene.tracks.overlay = [];
  if (!scene.tracks.audio) scene.tracks.audio = [];
  return scene.tracks;
}

function findTrack(scene, trackId) {
  var t = sceneTracks(scene);
  if (t.main && t.main.id === trackId) return t.main;
  var list = (t.overlay || []).concat(t.audio || []);
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === trackId) return list[i];
  }
  return null;
}

function defaultTrackTypeForElement(type) {
  if (type === "video" || type === "image") return "video";
  if (type === "text") return "text";
  if (type === "audio") return "audio";
  if (type === "graphic" || type === "component") return "graphic";
  if (type === "effect") return "effect";
  return "video";
}

function findOrCreateTrack(scene, trackType, seq, trackId) {
  var t = sceneTracks(scene);
  if (trackId) {
    var existing = findTrack(scene, trackId);
    if (existing) return existing;
  }
  if (trackType === "video") {
    if (t.main && t.main.elements && t.main.type === "video") return t.main;
    var main = t.main || makeTrack("video", seq, "Main");
    t.main = main;
    return main;
  }
  var arr = trackType === "audio" ? t.audio : t.overlay;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].type === trackType) return arr[i];
  }
  var track = makeTrack(trackType, seq, undefined);
  arr.push(track);
  return track;
}

function spansOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function trackCanPlaceSpan(track, startTime, duration) {
  var endTime = startTime + duration;
  var elements = (track && track.elements) || [];
  for (var i = 0; i < elements.length; i++) {
    var existing = elements[i];
    if (spansOverlap(startTime, endTime, existing.startTime, existing.startTime + existing.duration)) {
      return false;
    }
  }
  return true;
}

/**
 * 组件批量放置的唯一避碰入口：按同类型轨的稳定顺序复用空时段，找不到才新建轨。
 * 不接受 trackId 时禁止把并发 graphic 静默叠进第一条轨；显式 trackId 保留调用方的层级意图。
 */
function findOrCreateAvailableTrack(scene, trackType, seq, trackId, startTime, duration) {
  if (trackId) return findOrCreateTrack(scene, trackType, seq, trackId);
  var t = sceneTracks(scene);
  var arr = trackType === "audio" ? t.audio : (trackType === "video" ? [t.main] : t.overlay);
  for (var i = 0; i < arr.length; i++) {
    var track = arr[i];
    if (track && track.type === trackType && trackCanPlaceSpan(track, startTime, duration)) {
      return track;
    }
  }
  if (trackType === "video" && t.main && t.main.type === "video" && trackCanPlaceSpan(t.main, startTime, duration)) {
    return t.main;
  }
  var attempt = 0;
  var created;
  do {
    var trackSequence = attempt === 0 ? seq : String(seq) + "-" + attempt;
    created = makeTrack(trackType, trackSequence, undefined);
    attempt += 1;
  } while (findTrack(scene, created.id));
  if (trackType === "audio") t.audio.push(created);
  else if (trackType === "video") t.overlay.push(created);
  else t.overlay.push(created);
  return created;
}

function addTrackToScene(scene, type, seq, name, index) {
  var t = sceneTracks(scene);
  if (type === "video") {
    var existingMain = t.main;
    if (existingMain && existingMain.elements && existingMain.elements.length === 0 && (!name || existingMain.name === "Main")) {
      if (name) existingMain.name = name;
      return existingMain;
    }
    var track = makeTrack("video", seq, name || "Video " + (t.overlay.length + 1));
    track.type = "video";
    if (typeof index === "number") t.overlay.splice(index, 0, track);
    else t.overlay.push(track);
    return track;
  }
  var arr = type === "audio" ? t.audio : t.overlay;
  var track = makeTrack(type, seq, name);
  if (typeof index === "number") arr.splice(index, 0, track);
  else arr.push(track);
  return track;
}

function removeTrackFromScene(scene, trackId) {
  var t = sceneTracks(scene);
  if (t.main && t.main.id === trackId) {
    if (t.main.elements.length > 0) return false;
    return true; // main track 不可删除；返回 true 表示忽略
  }
  var arr = t.overlay.concat(t.audio);
  var removed = false;
  for (var i = 0; i < t.overlay.length; i++) {
    if (t.overlay[i].id === trackId) {
      if (t.overlay[i].elements.length > 0) return false;
      t.overlay.splice(i, 1);
      removed = true;
      break;
    }
  }
  if (!removed) {
    for (var j = 0; j < t.audio.length; j++) {
      if (t.audio[j].id === trackId) {
        if (t.audio[j].elements.length > 0) return false;
        t.audio.splice(j, 1);
        removed = true;
        break;
      }
    }
  }
  return removed;
}

function buildElement(payload, seq, locale) {
  var type = payload.type;
  var el = {
    id: payload.elementId || "el-ai" + seq + "-" + (payload.slot || 0),
    name: payload.name || defaultElementName(type, locale),
    type: type,
    startTime: tickOf(payload.startSec),
    duration: Math.max(tickOf(payload.durationSec), 1),
    trimStart: tickOf(payload.trimStartSec),
    trimEnd: tickOf(payload.trimEndSec),
    params: Object.assign({}, coreParamsForType(type), payload.params || {}),
  };
  if (type === "video" || type === "image") {
    el.mediaId = payload.mediaId;
  } else if (type === "text") {
    if (typeof payload.content === "string") el.params.content = payload.content;
    if (payload.subtitle) {
      el.subtitle = { source: payload.subtitleSource || "srt" };
      if (typeof payload.subtitleCueIndex === "number") el.subtitle.cueIndex = payload.subtitleCueIndex;
    }
  } else if (type === "graphic") {
    el.definitionId = payload.definitionId || "rectangle";
  } else if (type === "component") {
    el.assetId = payload.assetId;
    el.componentId = payload.componentId;
  } else if (type === "effect") {
    el.effectType = payload.effectType;
  } else if (type === "audio") {
    if (payload.sourceType === "library") {
      el.sourceType = "library";
      el.sourceUrl = payload.sourceUrl;
    } else {
      el.sourceType = "upload";
      el.mediaId = payload.mediaId;
    }
  }
  if (payload.trimEndSec === undefined || payload.trimEndSec === null) {
    el.trimEnd = el.duration;
  }
  if (payload.transcript) el.transcript = payload.transcript;
  el.hidden = !!payload.hidden;
  return el;
}
function defaultElementName(type, locale) {
  // TODO(i18n): 默认元素名（视频/图片/文本/图形/组件/音频/特效）随属性面板与时间线深度内容面一并迁移。
  var names = loc(locale, {
    video: "视频", image: "图片", text: "文本", graphic: "图形", component: "组件", audio: "音频", effect: "特效"
  }, {
    video: "Video", image: "Image", text: "Text", graphic: "Graphic", component: "Component", audio: "Audio", effect: "Effect"
  });
  return names[type] || type;
}

function upsertScalarKeyframe(element, path, atTicks, value, segmentToNext) {
  if (!element.animations) element.animations = {};
  var channel = element.animations[path];
  if (!channel || !channel.keys || !channel.keys.length) {
    element.animations[path] = {
      keys: [{ value: value, time: atTicks, segmentToNext: segmentToNext || "linear", leftHandle: null, rightHandle: null, tangentMode: "auto" }],
    };
    return;
  }
  var keys = channel.keys;
  var found = null;
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].time === atTicks) { found = keys[i]; break; }
  }
  if (found) {
    found.value = value;
  } else {
    keys.push({ value: value, time: atTicks, segmentToNext: segmentToNext || "linear", leftHandle: null, rightHandle: null, tangentMode: "auto" });
    keys.sort(function (a, b) { return a.time - b.time; });
  }
}

function setParamAt(element, path, value, atSec) {
  // MCP 的 atSec 永远是时间线坐标；元素动画通道则永远存相对元素起点的 tick。
  // 这层转换必须唯一，不能让调用者猜测两套时间系。
  var atTicks = atSec === undefined || atSec === null
    ? null
    : tickOf(atSec) - element.startTime;
  var channel = element.animations && element.animations[path];
  var hasKeyframes = channel && channel.keys && channel.keys.length > 0;
  if (hasKeyframes && atTicks !== null) {
    upsertScalarKeyframe(element, path, atTicks, value, "linear");
  } else {
    element.params[path] = value;
  }
}

function elementRefPath(ref) {
  return { trackId: ref && ref.trackId, elementId: ref && ref.elementId };
}

function findElementInTrack(track, elementId) {
  if (!track || !track.elements) return null;
  for (var i = 0; i < track.elements.length; i++) {
    if (track.elements[i].id === elementId) return track.elements[i];
  }
  return null;
}

function removeElementFromTrack(track, elementId) {
  if (!track || !track.elements) return false;
  var idx = -1;
  for (var i = 0; i < track.elements.length; i++) {
    if (track.elements[i].id === elementId) { idx = i; break; }
  }
  if (idx < 0) return false;
  track.elements.splice(idx, 1);
  return true;
}

function rippleTrack(track, afterTimeTicks, deltaTicks) {
  if (!track || !track.elements || !deltaTicks) return;
  for (var i = 0; i < track.elements.length; i++) {
    var el = track.elements[i];
    if (el.startTime >= afterTimeTicks) {
      el.startTime = Math.max(0, el.startTime + deltaTicks);
    }
  }
}
