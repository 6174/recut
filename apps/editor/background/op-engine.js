/**
 * [INPUT]: 依赖 model-base、subtitles 与 script-model 提供的纯函数。
 * [OUTPUT]: applyOp、校验与供 UI/Agent 共用的时间线读取模型；组件 clip 读回 assetId 与 componentId。
 * [POS]: background 的确定性命令内核；不访问 SQLite、不注册外部 operation。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// ---- op 引擎 -------------------------------------------------------------
function applyOp(project, op, opts) {
  opts = opts || {};
  var seq = opts.seq || 0;
  var payload = (op && op.payload) || {};
  var result = { refs: [] };
  var scene = findScene(project, payload.sceneId);

  switch (op.type) {
    case "insert": {
      var trackType = payload.trackType || defaultTrackTypeForElement(payload.element && payload.element.type);
      payload.element = payload.element || {};
      var isImplicitComponentPlacement = payload.element.type === "component" && !payload.trackId;
      var track = isImplicitComponentPlacement
        ? findOrCreateAvailableTrack(scene, trackType, seq, undefined, tickOf(payload.element.startSec || 0), tickOf(payload.element.durationSec || 0))
        : findOrCreateTrack(scene, trackType, seq, payload.trackId);
      payload.element.elementId = payload.element.elementId || "el-ai" + seq + "-" + (payload.element.slot || 0);
      var el = buildElement(payload.element, seq, opts.locale);
      // 字幕 cue 插入字幕轨时继承全轨共享样式（显式 params 优先）。
      if (track && track.type === "text" && track.captionStyle && el.type === "text" && el.subtitle) {
        el.params = Object.assign({}, track.captionStyle, el.params);
      }
      var idx = typeof payload.index === "number" ? payload.index : track.elements.length;
      track.elements.splice(idx, 0, el);
      result.refs.push({ trackId: track.id, elementId: el.id });
      result.element = { trackId: track.id, elementId: el.id, id: el.id };
      break;
    }
    case "component-placement": {
      var items = Array.isArray(payload.items) ? payload.items : [];
      if (items.length === 0) throw new Error("component-placement: items required");
      var placementTrackType = payload.trackType || "graphic";
      for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
        var item = items[itemIndex] || {};
        var raw = Object.assign({}, item, { type: "component" });
        var startTime = tickOf(raw.startSec || 0);
        var duration = tickOf(raw.durationSec || 0);
        if (duration <= 0) throw new Error("component-placement: durationSec must be positive");
        var placementTrack = findOrCreateAvailableTrack(scene, placementTrackType, seq, item.trackId, startTime, duration);
        raw.elementId = raw.elementId || "el-ai" + seq + "-" + itemIndex;
        var placed = buildElement(raw, seq, opts.locale);
        placementTrack.elements.push(placed);
        result.refs.push({ trackId: placementTrack.id, elementId: placed.id });
      }
      result.items = result.refs;
      break;
    }
    case "audio-placement": {
      // 统一音频落轨：AI 只给 assetId(=平台媒体素材)+start/duration，source 语义由
      // 后端推导（sourceType:"upload" + mediaId），杜绝 AI 拼错 library/sourceUrl。
      var audioItems = Array.isArray(payload.items) ? payload.items : [];
      if (audioItems.length === 0) throw new Error("audio-placement: items required");
      var audioTrackType = payload.trackType || "audio";
      for (var ai = 0; ai < audioItems.length; ai++) {
        var audioItem = audioItems[ai] || {};
        if (!audioItem.mediaId) throw new Error("audio-placement: each item requires mediaId");
        var audioRaw = Object.assign({}, audioItem, {
          type: "audio",
          sourceType: "upload",
          mediaId: audioItem.mediaId,
        });
        delete audioRaw.audioId;
        delete audioRaw.assetId;
        var audioStartTime = tickOf(audioRaw.startSec || 0);
        var audioDuration = tickOf(audioRaw.durationSec || 0);
        if (audioDuration <= 0) throw new Error("audio-placement: durationSec must be positive");
        var audioTrack = findOrCreateAvailableTrack(scene, audioTrackType, seq, audioItem.trackId, audioStartTime, audioDuration);
        audioRaw.elementId = audioRaw.elementId || "el-ai" + seq + "-" + ai;
        var placedAudio = buildElement(audioRaw, seq, opts.locale);
        audioTrack.elements.push(placedAudio);
        result.refs.push({ trackId: audioTrack.id, elementId: placedAudio.id });
      }
      result.items = result.refs;
      break;
    }
    case "delete": {
      var refs = payload.refs || [];
      var sceneRef = scene;
      var any = false;
      for (var d = 0; d < refs.length; d++) {
        var delTrack = findTrack(sceneRef, refs[d].trackId);
        if (delTrack && removeElementFromTrack(delTrack, refs[d].elementId)) any = true;
      }
      if (!any) throw new Error("delete: element not found");
      result.deleted = refs;
      break;
    }
    case "param": {
      var pEl = findElementInTrack(findTrack(scene, payload.ref && payload.ref.trackId), payload.ref && payload.ref.elementId);
      if (!pEl) throw new Error("param: element not found");
      var patch = payload.params || {};
      for (var pk in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, pk)) {
          setParamAt(pEl, pk, patch[pk], payload.atSec);
        }
      }
      if (payload.fields) {
        for (var fk in payload.fields) {
          if (Object.prototype.hasOwnProperty.call(payload.fields, fk)) pEl[fk] = payload.fields[fk];
        }
      }
      result.refs.push(elementRefPath(payload.ref));
      // 字幕 cue：共享样式广播到全轨（content 除外）。
      if (pEl.type === "text" && pEl.subtitle) {
        var pTrack = findTrack(scene, payload.ref && payload.ref.trackId);
        broadcastSubtitleStyle(pTrack, pEl);
      }
      break;
    }
    case "trim": {
      var trTrack = findTrack(scene, payload.ref && payload.ref.trackId);
      var trEl = trTrack && findElementInTrack(trTrack, payload.ref && payload.ref.elementId);
      if (!trEl) throw new Error("trim: element not found");
      var oldStart = trEl.startTime;
      var oldEnd = oldStart + trEl.duration;
      var newStart = payload.startSec !== undefined ? tickOf(payload.startSec) : trEl.startTime;
      if (payload.durationSec !== undefined) trEl.duration = Math.max(tickOf(payload.durationSec), 1);
      if (payload.trimStartSec !== undefined) trEl.trimStart = Math.max(tickOf(payload.trimStartSec), 0);
      if (payload.trimEndSec !== undefined) trEl.trimEnd = Math.max(tickOf(payload.trimEndSec), trEl.trimStart);
      trEl.startTime = Math.max(newStart, 0);
      if (payload.ripple) {
        var delta = trEl.startTime + trEl.duration - oldEnd;
        rippleTrack(trTrack, oldEnd, delta);
      }
      result.refs.push(elementRefPath(payload.ref));
      break;
    }
    case "split": {
      var spTrack = findTrack(scene, payload.ref && payload.ref.trackId);
      var spEl = spTrack && findElementInTrack(spTrack, payload.ref && payload.ref.elementId);
      if (!spEl) throw new Error("split: element not found");
      var localTicks = tickOf(payload.atSec) - spEl.startTime;
      if (localTicks <= 0 || localTicks >= spEl.duration) throw new Error("split: atSec outside element");
      var retainSide = payload.retainSide || "both";
      var sourceStart = spEl.trimStart;
      var sourceEnd = spEl.trimEnd === undefined || spEl.trimEnd === null ? spEl.trimStart + spEl.duration : spEl.trimEnd;
      var sourceSpan = sourceEnd - sourceStart;
      var leftDur = localTicks;
      var rightDur = spEl.duration - localTicks;
      payload.leftElementId = payload.leftElementId || "el-ai" + seq + "-r1";
      payload.rightElementId = payload.rightElementId || "el-ai" + seq + "-r2";
      var leftClone = cloneJson(spEl);
      var rightClone = cloneJson(spEl);
      leftClone.id = payload.leftElementId;
      rightClone.id = payload.rightElementId;
      leftClone.duration = leftDur;
      leftClone.trimEnd = sourceStart + Math.round((sourceSpan * leftDur) / spEl.duration);
      rightClone.startTime = spEl.startTime + localTicks;
      rightClone.duration = rightDur;
      rightClone.trimStart = sourceStart + Math.round((sourceSpan * leftDur) / spEl.duration);
      var elIdx = -1;
      for (var s = 0; s < spTrack.elements.length; s++) {
        if (spTrack.elements[s].id === spEl.id) { elIdx = s; break; }
      }
      spTrack.elements.splice(elIdx, 1);
      var insertAt = elIdx;
      var keepLeft = retainSide === "left" || retainSide === "both";
      var keepRight = retainSide === "right" || retainSide === "both";
      if (keepLeft) spTrack.elements.splice(insertAt++, 0, leftClone);
      if (keepRight) spTrack.elements.splice(insertAt, 0, rightClone);
      if (keepLeft) result.refs.push({ trackId: spTrack.id, elementId: leftClone.id });
      if (keepRight) result.refs.push({ trackId: spTrack.id, elementId: rightClone.id });
      break;
    }
    case "keyframe-upsert": {
      var kfTrack = findTrack(scene, payload.ref && payload.ref.trackId);
      var kfEl = kfTrack && findElementInTrack(kfTrack, payload.ref && payload.ref.elementId);
      if (!kfEl) throw new Error("keyframe-upsert: element not found");
      upsertScalarKeyframe(
        kfEl,
        payload.path,
        tickOf(payload.atSec) - kfEl.startTime,
        payload.value,
        payload.segmentToNext,
      );
      result.refs.push(elementRefPath(payload.ref));
      break;
    }
    case "keyframe-remove": {
      var krTrack = findTrack(scene, payload.ref && payload.ref.trackId);
      var krEl = krTrack && findElementInTrack(krTrack, payload.ref && payload.ref.elementId);
      if (!krEl) throw new Error("keyframe-remove: element not found");
      if (krEl.animations && krEl.animations[payload.path]) {
        if (payload.atSec === undefined || payload.atSec === null) {
          delete krEl.animations[payload.path];
        } else {
          var at = tickOf(payload.atSec) - krEl.startTime;
          var keys = krEl.animations[payload.path].keys || [];
          krEl.animations[payload.path].keys = keys.filter(function (k) { return k.time !== at; });
          if (krEl.animations[payload.path].keys.length === 0) delete krEl.animations[payload.path];
        }
      }
      result.refs.push(elementRefPath(payload.ref));
      break;
    }
    case "track-add": {
      var newTrack = addTrackToScene(scene, payload.type, seq, payload.name, payload.index);
      result.refs.push({ trackId: newTrack.id, elementId: null });
      result.trackId = newTrack.id;
      break;
    }
    case "track-remove": {
      var ok = removeTrackFromScene(scene, payload.trackId);
      if (ok === false) throw new Error("track-remove: track not empty or missing");
      break;
    }
    case "track-mute": {
      var mTrack = findTrack(scene, payload.trackId);
      if (!mTrack) throw new Error("track-mute: track not found");
      mTrack.muted = payload.muted !== undefined ? !!payload.muted : !mTrack.muted;
      break;
    }
    case "track-visible": {
      var vTrack = findTrack(scene, payload.trackId);
      if (!vTrack) throw new Error("track-visible: track not found");
      vTrack.hidden = payload.hidden !== undefined ? !!payload.hidden : !vTrack.hidden;
      break;
    }
    case "track-role": {
      var rTrack = findTrack(scene, payload.trackId);
      if (!rTrack) throw new Error("track-role: track not found");
      var role = payload.role || "none";
      if (["anchor", "follower", "none"].indexOf(role) < 0) throw new Error("track-role: invalid role " + role);
      if (role === "none") delete rTrack.role;
      else rTrack.role = role;
      if (payload.duckDepthDb !== undefined && payload.duckDepthDb !== null) {
        if (!rTrack.audioRouting) rTrack.audioRouting = {};
        rTrack.audioRouting.duckDepthDb = Number(payload.duckDepthDb);
      }
      result.trackId = rTrack.id;
      break;
    }
    case "scene-create": {
      var newScene = {
        id: "scene-ai" + seq,
        name: payload.name || loc(opts.locale, "场景 " + seq, "Scene " + seq),
        isMain: !!payload.isMain,
        tracks: { overlay: [], main: makeTrack("video", seq, "Main"), audio: [] },
        bookmarks: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      project.scenes.push(newScene);
      if (payload.isMain) {
        for (var mc = 0; mc < project.scenes.length; mc++) project.scenes[mc].isMain = false;
        newScene.isMain = true;
      }
      result.sceneId = newScene.id;
      break;
    }
    case "scene-rename": {
      var sc = findScene(project, payload.sceneId);
      if (!sc) throw new Error("scene-rename: scene not found");
      sc.name = payload.name;
      break;
    }
    case "scene-delete": {
      var delIdx = -1;
      var delScene = null;
      for (var ds = 0; ds < project.scenes.length; ds++) {
        if (project.scenes[ds].id === payload.sceneId) { delIdx = ds; delScene = project.scenes[ds]; break; }
      }
      if (!delScene) throw new Error("scene-delete: scene not found");
      if (delScene.isMain) throw new Error("scene-delete: cannot delete main scene");
      project.scenes.splice(delIdx, 1);
      break;
    }
    case "bookmark-add": {
      var bmScene = findScene(project, payload.sceneId);
      if (!bmScene.bookmarks) bmScene.bookmarks = [];
      var btime = tickOf(payload.timeSec);
      var exists = false;
      for (var bi = 0; bi < bmScene.bookmarks.length; bi++) {
        if (bmScene.bookmarks[bi].time === btime) { exists = true; break; }
      }
      if (!exists) bmScene.bookmarks.push({ time: btime, note: payload.note || null });
      break;
    }
    case "bookmark-remove": {
      var brScene = findScene(project, payload.sceneId);
      if (!brScene.bookmarks) break;
      var brt = tickOf(payload.timeSec);
      brScene.bookmarks = brScene.bookmarks.filter(function (b) { return b.time !== brt; });
      break;
    }
    case "settings": {
      if (!project.settings) project.settings = {};
      if (payload.fps) project.settings.fps = payload.fps;
      if (payload.canvasSize) project.settings.canvasSize = payload.canvasSize;
      if (payload.background) project.settings.background = payload.background;
      break;
    }
    case "caption-style": {
      var csTrack = findTrack(scene, payload.trackId);
      if (!csTrack) throw new Error("caption-style: track not found");
      if (csTrack.type !== "text") throw new Error("caption-style: track is not a text track");      var cs = Object.assign({}, csTrack.captionStyle || {}, payload.style || {});
      delete cs.content;
      delete cs["transform.positionX"];
      delete cs["transform.positionY"];
      csTrack.captionStyle = cs;
      var firstPosX;
      var firstPosY;
      for (var ci = 0; ci < csTrack.elements.length; ci++) {
        var cue = csTrack.elements[ci];
        if (cue.type !== "text" || !cue.subtitle) continue;
        var cueParams = cue.params || {};
        if (firstPosX === undefined) firstPosX = cueParams["transform.positionX"];
        if (firstPosY === undefined) firstPosY = cueParams["transform.positionY"];
        cue.params = Object.assign({}, cs, {
          content: cueParams.content !== undefined ? cueParams.content : "",
          "transform.positionX": cueParams["transform.positionX"],
          "transform.positionY": cueParams["transform.positionY"],
        });
      }
      if (firstPosX !== undefined) csTrack.captionStyle["transform.positionX"] = firstPosX;
      if (firstPosY !== undefined) csTrack.captionStyle["transform.positionY"] = firstPosY;
      result.trackId = csTrack.id;
      break;
    }
    case "transcript-attach": {
      var taEl = findElementInTrack(findTrack(scene, payload.ref && payload.ref.trackId), payload.ref && payload.ref.elementId);
      if (!taEl) throw new Error("transcript-attach: element not found");
      if (!payload.assetId) throw new Error("transcript-attach: assetId required");
      var prevT = taEl.transcript || null;
      taEl.transcript = {
        assetId: payload.assetId,
        source: payload.source || "transcript",
        language: payload.language || null,
        overrides: prevT && prevT.overrides ? prevT.overrides : undefined,
      };
      result.refs.push(elementRefPath(payload.ref));
      break;
    }
    case "transcript-fix": {
      var tfEl = findElementInTrack(findTrack(scene, payload.ref && payload.ref.trackId), payload.ref && payload.ref.elementId);
      if (!tfEl) throw new Error("transcript-fix: element not found");
      if (!tfEl.transcript) tfEl.transcript = { source: "transcript" };
      if (!tfEl.transcript.overrides) tfEl.transcript.overrides = {};
      if (typeof payload.segmentIndex !== "number") throw new Error("transcript-fix: segmentIndex required");
      tfEl.transcript.overrides[payload.segmentIndex] = String(payload.text);
      result.refs.push(elementRefPath(payload.ref));
      break;
    }
    case "subtitle-import": {
      var cues = payload.cues || [];
      if (cues.length === 0) throw new Error("subtitle-import: no cues");
      var capTrack = payload.trackId ? findTrack(scene, payload.trackId) : null;
      if (capTrack && capTrack.type !== "text") throw new Error("subtitle-import: track is not a text track");
      if (!capTrack) {
        capTrack = makeTrack("text", seq, loc(opts.locale, "字幕", "Captions"));
        sceneTracks(scene).overlay.unshift(capTrack);
      }
      var canvas = (project.settings && project.settings.canvasSize) || DEFAULT_CANVAS;
      var baseStyle = Object.assign(
        {},
        CORE_DEFAULT_PARAMS,
        SUBTITLE_DEFAULT_TEXT_PARAMS,
        payload.style || {},
        capTrack.captionStyle || {}
      );
      delete baseStyle.content;
      capTrack.captionStyle = Object.assign({}, baseStyle, { content: undefined });
      delete capTrack.captionStyle.content;
      var startTicks = payload.startSec !== undefined && payload.startSec !== null ? tickOf(payload.startSec) : 0;
      var source = payload.source || "srt";
      // 无浏览器测量环境：按画布高度估算底部锚点，保证 AI 导入的字幕默认落在下三分之一。
      var fontSize = typeof baseStyle.fontSize === "number" ? baseStyle.fontSize : CORE_DEFAULT_TEXT_PARAMS.fontSize;
      var lineHeight = typeof baseStyle.lineHeight === "number" ? baseStyle.lineHeight : 1.2;
      var approxBlockHeight = fontSize * (canvas.height / 90) * lineHeight;
      var approxMargin = canvas.height * 0.05;
      var approxY = canvas.height / 2 - approxMargin - approxBlockHeight / 2;
      for (var cq = 0; cq < cues.length; cq++) {
        var cueData = cues[cq];
        var durTicks = Math.max(tickOf(cueData.durationSec), 1);
        var elCue = {
          id: "el-ai" + seq + "-cap" + cq,
          name: "Caption " + (cq + 1),
          type: "text",
          startTime: startTicks + tickOf(cueData.startSec),
          duration: durTicks,
          trimStart: 0,
          trimEnd: durTicks,
          params: Object.assign({}, baseStyle, {
            content: cueData.text,
            "transform.positionX": 0,
            "transform.positionY": approxY,
          }),
          subtitle: { source: source, cueIndex: cq },
        };
        capTrack.elements.push(elCue);
      }
      capTrack.captionStyle["transform.positionX"] = 0;
      capTrack.captionStyle["transform.positionY"] = approxY;
      result.trackId = capTrack.id;
      result.element = { trackId: capTrack.id, elementId: (capTrack.elements[0] || {}).id };
      result.refs = (capTrack.elements || [])
        .filter(function (e) { return e.type === "text" && e.subtitle; })
        .map(function (e) { return { trackId: capTrack.id, elementId: e.id }; });
      break;
    }
    default:
      throw new Error("applyOp: unknown op type " + op.type);
  }
  return result;
}

// ---- 校验 ------------------------------------------------------------------
function validateTimeline(project, registeredAssets, componentIds) {
  var violations = [];
  var assetSet = new Set(registeredAssets || []);
  var componentSet = new Set(componentIds || []);
  var scenes = project && Array.isArray(project.scenes) ? project.scenes : [];
  for (var s = 0; s < scenes.length; s++) {
    var scene = scenes[s];
    var tracks = sceneTracks(scene);
    var allTracks = [];
    if (tracks.main) allTracks.push(tracks.main);
    allTracks = allTracks.concat(tracks.overlay || []).concat(tracks.audio || []);
    for (var t = 0; t < allTracks.length; t++) {
      var track = allTracks[t];
      var elements = track.elements || [];
      for (var e = 0; e < elements.length; e++) {
        var el = elements[e];
        if (el.mediaId && !assetSet.has(el.mediaId)) {
          violations.push({ code: "asset-exists", ref: { trackId: track.id, elementId: el.id }, detail: "mediaId not registered: " + el.mediaId });
        }
        // 音频可解析性：upload 必须有已登记的 mediaId；library 必须有非空 sourceUrl。
        // 让「可播放」进入结构 proof，杜绝零违规却无声。
        if (el.type === "audio") {
          if (el.sourceType === "upload" && !el.mediaId) {
            violations.push({ code: "audio-unresolvable", ref: { trackId: track.id, elementId: el.id }, detail: "audio upload requires mediaId" });
          }
          if (el.sourceType === "library" && !el.sourceUrl) {
            violations.push({ code: "audio-unresolvable", ref: { trackId: track.id, elementId: el.id }, detail: "audio library requires sourceUrl" });
          }
          if (el.sourceType !== "upload" && el.sourceType !== "library") {
            violations.push({ code: "audio-unresolvable", ref: { trackId: track.id, elementId: el.id }, detail: "audio sourceType must be upload or library" });
          }
        }
        if (!el.duration || el.duration <= 0) {
          violations.push({ code: "duration>0", ref: { trackId: track.id, elementId: el.id }, detail: "duration <= 0" });
        }
        if (el.trimEnd !== undefined && el.trimStart > el.trimEnd) {
          violations.push({ code: "out-of-range", ref: { trackId: track.id, elementId: el.id }, detail: "trimStart > trimEnd" });
        }
        if (el.type === "component" && el.componentId && !componentSet.has(el.componentId)) {
          violations.push({ code: "component-def", ref: { trackId: track.id, elementId: el.id }, detail: "unknown componentId: " + el.componentId });
        }
        var bm = el.params && el.params.blendMode;
        if (bm !== undefined && bm !== null && DEFAULT_BLEND_MODES.indexOf(bm) < 0) {
          violations.push({ code: "param-valid", ref: { trackId: track.id, elementId: el.id }, detail: "invalid blendMode: " + bm });
        }
        if (el.params && el.params.opacity !== undefined && (el.params.opacity < 0 || el.params.opacity > 1)) {
          violations.push({ code: "param-valid", ref: { trackId: track.id, elementId: el.id }, detail: "opacity out of [0,1]" });
        }
        if (el.transcript && !el.transcript.assetId && !(el.transcript.segments && el.transcript.segments.length)) {
          violations.push({ code: "transcript-src", ref: { trackId: track.id, elementId: el.id }, detail: "transcript declared without source (assetId or segments)" });
        }
        if (el.type === "effect" && !el.effectType) {
          violations.push({ code: "effect-type", ref: { trackId: track.id, elementId: el.id }, detail: "effect element without effectType (use library.browse ids)" });
        }
      }
    }
    // 主轨重叠
    if (tracks.main && tracks.main.elements) {
      var sorted = tracks.main.elements.slice().sort(function (a, b) { return a.startTime - b.startTime; });
      for (var o = 1; o < sorted.length; o++) {
        if (sorted[o].startTime < sorted[o - 1].startTime + sorted[o - 1].duration) {
          violations.push({ code: "overlap", ref: { trackId: tracks.main.id, elementId: sorted[o].id }, detail: "overlaps " + sorted[o - 1].id });
        }
      }
    }
  }
  return violations;
}

// ---- condensed 读取 ---------------------------------------------------------
function condensedClip(el, trackId) {
  var p = el.params || {};
  return {
    ref: { trackId: trackId, elementId: el.id },
    type: el.type,
    name: el.name,
    startSec: secOf(el.startTime),
    durationSec: secOf(el.duration),
    trimStartSec: secOf(el.trimStart),
    trimEndSec: secOf(el.trimEnd),
    params: {
      transform: {
        positionX: p["transform.positionX"] !== undefined ? p["transform.positionX"] : 0,
        positionY: p["transform.positionY"] !== undefined ? p["transform.positionY"] : 0,
        scaleX: p["transform.scaleX"] !== undefined ? p["transform.scaleX"] : 1,
        scaleY: p["transform.scaleY"] !== undefined ? p["transform.scaleY"] : 1,
        rotate: p["transform.rotate"] !== undefined ? p["transform.rotate"] : 0,
      },
      opacity: p.opacity !== undefined ? p.opacity : 1,
      volume: p.volume !== undefined ? p.volume : undefined,
      blendMode: p.blendMode !== undefined ? p.blendMode : "normal",
      text: el.type === "text" ? { content: p.content || "", fontSize: p.fontSize, color: p.color } : undefined,
    },
    keyframeCount: countKeyframes(el),
    effectCount: (el.effects || []).length,
    maskCount: (el.masks || []).length,
    muted: !!(el.isSourceAudioEnabled === false) || !!(p.muted),
    hidden: !!el.hidden,
    subtitle: el.subtitle ? { source: el.subtitle.source, cueIndex: el.subtitle.cueIndex } : undefined,
    hasTranscript: !!el.transcript,
    transcript: el.transcript ? { source: el.transcript.source, language: el.transcript.language || undefined } : undefined,
    mediaId: el.mediaId,
    assetId: el.assetId,
    componentId: el.componentId,
    definitionId: el.definitionId,
    effectType: el.effectType,
    sourceType: el.sourceType,
    sourceUrl: el.sourceUrl,
  };
}
function countKeyframes(el) {
  if (!el.animations) return 0;
  var n = 0;
  for (var path in el.animations) {
    if (Object.prototype.hasOwnProperty.call(el.animations, path)) {
      n += (el.animations[path].keys || []).length;
    }
  }
  return n;
}

function condensedTimeline(project) {
  var scenes = project && Array.isArray(project.scenes) ? project.scenes : [];
  var clips = [];
  var tracks = [];
  var maxEnd = 0;
  var activeScene = findScene(project, project.currentSceneId);
  var activeSceneId = activeScene ? activeScene.id : (scenes[0] ? scenes[0].id : null);
  for (var s = 0; s < scenes.length; s++) {
    var scene = scenes[s];
    var st = sceneTracks(scene);
    var all = [];
    if (st.main) all.push(st.main);
    all = all.concat(st.overlay || []).concat(st.audio || []);
    for (var t = 0; t < all.length; t++) {
      var track = all[t];
      var els = track.elements || [];
      tracks.push({ trackId: track.id, type: track.type, name: track.name, muted: !!track.muted, hidden: !!track.hidden, role: track.role || "none", audioRouting: track.audioRouting || undefined, captionStyle: track.captionStyle || undefined, clipCount: els.length });
      for (var e = 0; e < els.length; e++) {
        var end = els[e].startTime + els[e].duration;
        if (end > maxEnd) maxEnd = end;
        clips.push(condensedClip(els[e], track.id));
      }
    }
  }
  clips.sort(function (a, b) { return a.startSec - b.startSec; });
  return {
    currentSceneId: activeSceneId,
    durationSec: maxEnd / TICKS_PER_SECOND,
    tracks: tracks,
    clips: clips,
    settings: project.settings || null,
  };
}

function elementDetail(project, ref) {
  // 跨场景解析：ref 可不带 sceneId，按 trackId+elementId 在全项目内定位
  var scene = ref && ref.sceneId ? findScene(project, ref.sceneId) : null;
  var track = scene && findTrack(scene, ref.trackId);
  var el = track && findElementInTrack(track, ref.elementId);
  if (!el && project && Array.isArray(project.scenes)) {
    for (var s = 0; s < project.scenes.length && !el; s++) {
      track = findTrack(project.scenes[s], ref.trackId);
      el = track && findElementInTrack(track, ref.elementId);
    }
  }
  if (!el) return null;
  var animations = {};
  if (el.animations) {
    for (var path in el.animations) {
      if (Object.prototype.hasOwnProperty.call(el.animations, path)) {
        animations[path] = { keyCount: (el.animations[path].keys || []).length, keys: el.animations[path].keys };
      }
    }
  }
  return {
    ref: { trackId: ref.trackId, elementId: ref.elementId },
    type: el.type,
    name: el.name,
    startSec: secOf(el.startTime),
    startTicks: el.startTime,
    durationSec: secOf(el.duration),
    durationTicks: el.duration,
    trimStartSec: secOf(el.trimStart),
    trimEndSec: secOf(el.trimEnd),
    params: el.params || {},
    animations: animations,
    effects: el.effects || [],
    masks: el.masks || [],
    mediaId: el.mediaId,
    assetId: el.assetId,
    componentId: el.componentId,
    definitionId: el.definitionId,
    effectType: el.effectType,
    sourceType: el.sourceType,
    sourceUrl: el.sourceUrl,
    retime: el.retime || null,
    hidden: !!el.hidden,
    subtitle: el.subtitle || undefined,
    hasTranscript: !!el.transcript,
    transcript: el.transcript ? { source: el.transcript.source, language: el.transcript.language || undefined } : undefined,
  };
}

function cloneJson(x) {
  return JSON.parse(JSON.stringify(x));
}
