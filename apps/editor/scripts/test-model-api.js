#!/usr/bin/env node
/**
 * [INPUT]: manifest 声明的后台模块、内存 sqlite mock 与 recut operation stub。
 * [OUTPUT]: 验证 op 引擎、关键帧、统一日志、undo/redo、delta/work-unit 与 validate 的退出码。
 * [POS]: Editor 后台模型 L0；不访问真实 Go runtime 或浏览器。
 * L0 Model API 测试：把 manifest 声明的后台模块载入 node vm，直接调用顶层纯函数与后台操作。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 *
 * usage: node scripts/test-model-api.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "manifest.json"), "utf8"));
const source = [manifest.background, ...(manifest.backgroundModules || [])]
  .map((file) => fs.readFileSync(path.join(APP_ROOT, file), "utf8"))
  .join("\n");
const { makeDb } = require("./test-mock");

let failures = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ": " + detail : ""}`);
  }
}

// ---- vm 加载 ----
const registered = {};
const recutStub = {
  operation: { register: (name, fn) => { registered[name] = fn; } },
  error: (payload) => {
    throw Object.assign(new Error(payload.code), { __recutError: payload });
  },
};
const db = makeDb();
let lastCallUI = null;
const mockCtx = {
  sqlite: db,
  files: { readText: () => null, writeText: () => {}, list: () => [] },
  shell: { exec: () => ({}) },
  media: { importFile: () => ({ id: "asset-export-1" }) },
  paths: { appRoot: path.join(__dirname, "..") },
  project: {
    id: "p1",
    setCover: () => {},
    callUI: (...args) => {
      lastCallUI = args;
      return { id: "job-export-1" };
    },
  },
};
const sandbox = {
  recut: recutStub,
  Date,
  Math,
  JSON,
  Set,
  Map,
  Number,
  String,
  Object,
  Array,
  RegExp,
  console,
};
sandbox.ctx = mockCtx;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

// ---- 工具 ----
function defaultProject() {
  return JSON.parse(JSON.stringify(sandbox.makeDefaultProject({ scopeId: "p1", name: "t" })));
}
function cmd(op) {
  return sandbox.executeCommand(mockCtx, "p1", op);
}
function findElRef(p, elementId) {
  for (const scene of p.scenes) {
    const t = scene.tracks;
    const all = [];
    if (t.main) all.push(t.main);
    all.push(...(t.overlay || []), ...(t.audio || []));
    for (const track of all) {
      for (const el of track.elements || []) {
        if (el.id === elementId) return { trackId: track.id, elementId: el.id };
      }
    }
  }
  return null;
}
function findEl(p, elementId) {
  for (const scene of p.scenes) {
    const t = scene.tracks;
    const all = [];
    if (t.main) all.push(t.main);
    all.push(...(t.overlay || []), ...(t.audio || []));
    for (const track of all) {
      for (const el of track.elements || []) {
        if (el.id === elementId) return el;
      }
    }
  }
  return null;
}

console.log("\n== applyOp 基础 ==");
{
  const p = defaultProject();
  const res = sandbox.applyOp(p, { type: "insert", payload: { element: { type: "video", name: "A", mediaId: "a1", startSec: 0, durationSec: 2 } } }, { seq: 1 });
  assert("insert 返回 ref", res.refs.length === 1 && res.refs[0].elementId === "el-ai1-0", JSON.stringify(res.refs));
  const c = sandbox.condensedTimeline(p);
  assert("condensed clips=1", c.clips.length === 1);
  assert("condensed 秒换算", c.clips[0].durationSec === 2);
  const v = sandbox.validateTimeline(p, ["a1"]);
  assert("validate 无违规(asset 已登记)", v.length === 0, JSON.stringify(v));
  const v2 = sandbox.validateTimeline(p, []);
  assert("validate asset-exists 命中", v2.length === 1 && v2[0].code === "asset-exists", JSON.stringify(v2));
}

console.log("\n== D1 关键帧策略 ==");
{
  const p = defaultProject();
  sandbox.applyOp(p, { type: "insert", payload: { element: { type: "text", name: "T", startSec: 0, durationSec: 3, content: "Hi" } } }, { seq: 1 });
  const ref = findElRef(p, "el-ai1-0");
  assert("text 落到 text 轨道", ref && p.scenes[0].tracks.overlay.some((t) => t.id === ref.trackId && t.type === "text"));
  sandbox.applyOp(p, { type: "param", payload: { ref, params: { opacity: 1 } } }, { seq: 2 });
  const tEl = findEl(p, "el-ai1-0");
  assert("无关键帧 → 写基础值", tEl.params.opacity === 1 && !tEl.animations, JSON.stringify(tEl.params));
  sandbox.applyOp(p, { type: "keyframe-upsert", payload: { ref, path: "opacity", atSec: 0, value: 0 } }, { seq: 3 });
  const tEl2 = findEl(p, "el-ai1-0");
  assert("upsert 建关键帧", tEl2.animations && tEl2.animations.opacity && tEl2.animations.opacity.keys.length === 1);
  sandbox.applyOp(p, { type: "param", payload: { ref, params: { opacity: 1 }, atSec: 3 } }, { seq: 4 });
  const tEl3 = findEl(p, "el-ai1-0");
  assert("有关键帧 → 落关键帧", tEl3.animations.opacity.keys.length === 2 && tEl3.params.opacity === 1, JSON.stringify(tEl3.animations.opacity));
  const det = sandbox.elementDetail(p, ref);
  assert("element.get 动画摘要", det.animations.opacity && det.animations.opacity.keyCount === 2);
}

console.log("\n== 普通工作稿不是 timeline op ==");
{
  const p = defaultProject();
  let rejected = false;
  try {
    sandbox.applyOp(p, { type: "plan-apply", payload: { operations: [] } }, { seq: 1 });
  } catch (error) {
    rejected = /unknown op type/.test(error.message);
  }
  assert("plan-apply 被拒绝，timeline 只接受真实编辑 op", rejected);
}

console.log("\n== split / trim / delete ==");
{
  const p = defaultProject();
  sandbox.applyOp(p, { type: "insert", payload: { element: { type: "video", name: "V", mediaId: "a1", startSec: 0, durationSec: 4 } } }, { seq: 1 });
  const ref = { trackId: p.scenes[0].tracks.main.id, elementId: "el-ai1-0" };
  const sp = sandbox.applyOp(p, { type: "split", payload: { ref, atSec: 1.5 } }, { seq: 2 });
  const els = p.scenes[0].tracks.main.elements;
  assert("split 成两段", els.length === 2, JSON.stringify(els.map((e) => e.duration)));
  assert("左段 1.5s 右段 2.5s", sandbox.secOf(els[0].duration) === 1.5 && sandbox.secOf(els[1].duration) === 2.5);
  assert("split 确定性 id", sp.refs[0].elementId === "el-ai2-r1" && sp.refs[1].elementId === "el-ai2-r2");
  sandbox.applyOp(p, { type: "trim", payload: { ref: sp.refs[0], startSec: 1, durationSec: 1, ripple: true } }, { seq: 3 });
  assert("trim 位移", sandbox.secOf(els[0].startTime) === 1);
  assert("ripple 后段平移", sandbox.secOf(els[1].startTime) === 2);
  sandbox.applyOp(p, { type: "delete", payload: { refs: [sp.refs[0]] } }, { seq: 4 });
  assert("delete 移除", p.scenes[0].tracks.main.elements.length === 1);
}

console.log("\n== 统一 op 日志：command → undo → redo → conflict ==");
{
  const p = defaultProject();
  sandbox.ensureSchema(mockCtx, "p1");
  // 直接落库初始项目
  mockCtx.sqlite.execute(
    "insert into editor_projects (project_id, project_json, registered_assets_json, version, updated_at) values (?, ?, ?, ?, ?)",
    ["p1", JSON.stringify(p), "[]", 1, new Date().toISOString()],
  );
  const c1 = cmd({ type: "insert", payload: { element: { type: "video", name: "A", mediaId: "a1", startSec: 0, durationSec: 2 } } });
  assert("command insert ok + version 2", c1.ok && c1.version === 2, JSON.stringify(c1));
  assert("insert 确定性 id", c1.result.element.elementId === "el-ai1-0");
  const c2 = cmd({ type: "param", payload: { ref: c1.result.element, params: { opacity: 0.5 } } });
  assert("command param ok + version 3", c2.ok && c2.version === 3);
  // baseVersion 冲突
  const bad = cmd({ type: "delete", payload: { refs: [c1.result.element] }, baseVersion: 2 });
  assert("过期 baseVersion → conflict", bad.ok === false && bad.conflict === true && bad.currentVersion === 3, JSON.stringify(bad));
  // 无 conflict 写
  const okDelete = cmd({ type: "delete", payload: { refs: [c1.result.element] } });
  assert("正确 baseVersion → 成功", okDelete.ok && okDelete.version === 4, JSON.stringify(okDelete));
  // undo
  const u1 = sandbox.undoLast(mockCtx, "p1");
  assert("undo 恢复元素 + version 5", u1.ok && u1.version === 5 && u1.undidSeq === 3, JSON.stringify(u1));
  // 读取当前 project_json
  const proj = readStoredProject();
  assert("undo 后元素仍在（撤销的是 delete）", sandbox.condensedTimeline(proj).clips.length === 1);
  // redo
  const r1 = sandbox.redoNext(mockCtx, "p1");
  assert("redo 重放 delete + version 6", r1.ok && r1.version === 6, JSON.stringify(r1));
  const proj2 = readStoredProject();
  assert("redo 后元素删除", sandbox.condensedTimeline(proj2).clips.length === 0);
}
function readStoredProject() {
  const rows = mockCtx.sqlite.query("select project_json from editor_projects where project_id = ?", ["p1"]);
  return JSON.parse(rows[0].project_json);
}

console.log("\n== settings undo（整份快照）与 split retainSide ==");
{
  // 清空上一块的 mock 状态，重新落库
  for (const key of Object.keys(db.tables)) db.tables[key].rows = [];
  const p = defaultProject();
  sandbox.ensureSchema(mockCtx, "p1");
  mockCtx.sqlite.execute(
    "insert into editor_projects (project_id, project_json, registered_assets_json, version, updated_at) values (?, ?, ?, ?, ?)",
    ["p1", JSON.stringify(p), "[]", 1, new Date().toISOString()],
  );
  const s1 = cmd({ type: "settings", payload: { fps: { numerator: 60, denominator: 1 } } });
  assert("settings op ok", s1.ok && s1.version === 2);
  const u = sandbox.undoLast(mockCtx, "p1");
  assert("settings undo 恢复 fps", u.ok && readStoredProject().settings.fps.numerator === 30, JSON.stringify(readStoredProject().settings));
  sandbox.redoNext(mockCtx, "p1");
  assert("settings redo 恢复 60fps", readStoredProject().settings.fps.numerator === 60);

  const ins = cmd({ type: "insert", payload: { element: { type: "video", name: "V", mediaId: "a1", startSec: 0, durationSec: 4 } } });
  const ref = ins.result.element;
  const sp = cmd({ type: "split", payload: { ref, atSec: 2, retainSide: "left" } });
  assert("split retainSide left 仅返回 left ref", sp.ok && sp.result.refs.length === 1, JSON.stringify(sp.result));
  const proj = readStoredProject();
  const main = proj.scenes.find((sc) => sc.isMain).tracks.main;
  assert("split retainSide left 只剩左段", main.elements.length === 1 && main.elements[0].id === sp.result.refs[0].elementId);
}

console.log("\n== aiLock ==");
{
  const lock = sandbox.readLock(mockCtx, "p1");
  assert("初始无锁", lock === null);
  sandbox.writeLock(mockCtx, "p1", "agent");
  const l2 = sandbox.readLock(mockCtx, "p1");
  assert("写锁成功", l2 && l2.owner === "agent");
  sandbox.clearLock(mockCtx, "p1");
  assert("清锁成功", sandbox.readLock(mockCtx, "p1") === null);
}

console.log("\n== AI 组件素材库门禁 ==");
{
  for (const key of Object.keys(db.tables)) db.tables[key].rows = [];
  const p = defaultProject();
  sandbox.ensureSchema(mockCtx, "p1");
  mockCtx.sqlite.execute(
    "insert into editor_projects (project_id, project_json, registered_assets_json, version, updated_at) values (?, ?, ?, ?, ?)",
    ["p1", JSON.stringify(p), "[]", 1, new Date().toISOString()],
  );
  const originalHeadVersion = sandbox.headVersion;
  sandbox.headVersion = () => null;
  const draft = cmd({ type: "insert", payload: { element: { type: "component", componentId: "ai-card", startSec: 0, durationSec: 2 } } });
  assert("draft 组件不能直接进入时间线", draft.ok === false && /verified/.test(draft.error || ""), JSON.stringify(draft));
  sandbox.headVersion = () => ({ status: "verified" });
  const verified = cmd({ type: "insert", payload: { element: { type: "component", componentId: "ai-card", startSec: 0, durationSec: 2 } } });
  assert("verified 组件可独立插入时间线", verified.ok === true, JSON.stringify(verified));
  sandbox.headVersion = originalHeadVersion;
}

console.log("\n== 组件批量放置避碰 ==");
{
  const p = defaultProject();
  const placed = sandbox.applyOp(p, {
    type: "component-placement",
    payload: {
      trackType: "graphic",
      items: [
        { componentId: "chip-a", name: "A", startSec: 0, durationSec: 12 },
        { componentId: "chip-b", name: "B", startSec: 0, durationSec: 12 },
        { componentId: "chip-c", name: "C", startSec: 0, durationSec: 12 },
      ],
    },
  }, { seq: 1 });
  const graphicTracks = p.scenes[0].tracks.overlay.filter((track) => track.type === "graphic");
  assert("并发组件一次 placement 返回全部 refs", placed.refs.length === 3, JSON.stringify(placed));
  assert("并发组件分配不同 graphic 轨", graphicTracks.length === 3 && new Set(placed.refs.map((ref) => ref.trackId)).size === 3, JSON.stringify(graphicTracks));
  const later = sandbox.applyOp(p, {
    type: "component-placement",
    payload: { items: [{ componentId: "chip-later", name: "Later", startSec: 12, durationSec: 3 }] },
  }, { seq: 2 });
  assert("非重叠组件复用第一条 graphic 轨", p.scenes[0].tracks.overlay.filter((track) => track.type === "graphic").length === 3 && later.refs[0].trackId === placed.refs[0].trackId, JSON.stringify(later));

  const single = defaultProject();
  const first = sandbox.applyOp(single, { type: "insert", payload: { element: { type: "component", componentId: "chip-first", startSec: 0, durationSec: 5 } } }, { seq: 1 });
  const second = sandbox.applyOp(single, { type: "insert", payload: { element: { type: "component", componentId: "chip-second", startSec: 0, durationSec: 5 } } }, { seq: 2 });
  assert("逐条 component insert 也不会静默同轨重叠", first.refs[0].trackId !== second.refs[0].trackId, JSON.stringify(single.scenes[0].tracks.overlay));
}

console.log("\n== 字幕（caption track）：subtitle-import / param 广播 / caption-style / export ==");
{
  const p = defaultProject();
  const srt = "1\n00:00:00,500 --> 00:00:02,000\n你好，世界\n\n2\n00:00:02,500 --> 00:00:04,000\n第二句字幕\n";
  const cues = sandbox.parseSubtitleContent(srt, "a.srt");
  assert("parseSubtitleContent 解析 2 条", cues.length === 2, JSON.stringify(cues));
  assert("解析时间", cues[0].startSec === 0.5 && Math.abs(cues[1].durationSec - 1.5) < 0.001, JSON.stringify(cues[1]));

  const res = sandbox.applyOp(p, { type: "subtitle-import", payload: { cues: cues, style: { fontSize: 64, color: "#FFFF00" } } }, { seq: 1 });
  assert("subtitle-import 返回 trackId + 2 refs", res.trackId && res.refs.length === 2, JSON.stringify(res));
  const capTrack = p.scenes[0].tracks.overlay.find((t) => t.id === res.trackId);
  assert("字幕轨在最上层 + captionStyle", capTrack && capTrack.type === "text" && capTrack.captionStyle && capTrack.captionStyle.fontSize === 64);
  const capEls = capTrack.elements.filter((e) => e.type === "text" && e.subtitle);
  assert("cue 带 subtitle 标记", capEls.length === 2 && capEls[0].subtitle.source === "srt" && capEls[0].subtitle.cueIndex === 0);
  assert("cue 带底部位置（画布中心系）", typeof capEls[0].params["transform.positionY"] === "number");

  // param 广播：改第一条 cue 颜色 → 全轨 + captionStyle 同步
  const ref0 = { trackId: res.trackId, elementId: capEls[0].id };
  sandbox.applyOp(p, { type: "param", payload: { ref: ref0, params: { color: "#FF0000" } } }, { seq: 2 });
  const after = p.scenes[0].tracks.overlay.find((t) => t.id === res.trackId);
  const allCues = after.elements.filter((e) => e.type === "text" && e.subtitle);
  assert("param 广播到全轨", allCues.every((e) => e.params.color === "#FF0000"), JSON.stringify(after.captionStyle));
  assert("广播同步 captionStyle", after.captionStyle.color === "#FF0000");
  assert("content 不广播", allCues[0].params.content !== allCues[1].params.content);

  // caption-style op：统一字号
  sandbox.applyOp(p, { type: "caption-style", payload: { trackId: res.trackId, style: { fontSize: 48 } } }, { seq: 3 });
  const after2 = p.scenes[0].tracks.overlay.find((t) => t.id === res.trackId);
  assert("caption-style 统一字号", after2.elements.filter((e) => e.subtitle).every((e) => e.params.fontSize === 48) && after2.captionStyle.fontSize === 48);

  // subtitle.export
  const out = sandbox.renderSrtFromTrack(after2);
  assert("renderSrtFromTrack 输出 SRT", /-->/.test(out) && out.indexOf("你好，世界") >= 0, out);
}
{
  // 通过 executeCommand + 真实 SRT 文本走 MCP 语义
  for (const key of Object.keys(db.tables)) db.tables[key].rows = [];
  const p = defaultProject();
  sandbox.ensureSchema(mockCtx, "p1");
  mockCtx.sqlite.execute(
    "insert into editor_projects (project_id, project_json, registered_assets_json, version, updated_at) values (?, ?, ?, ?, ?)",
    ["p1", JSON.stringify(p), "[]", 1, new Date().toISOString()],
  );
  const srt = "1\n00:00:01,000 --> 00:00:03,000\n第一句\n";
  const sub = sandbox.executeCommand(mockCtx, "p1", { type: "subtitle-import", payload: { cues: sandbox.parseSubtitleContent(srt, "x.srt") } });
  assert("subtitle-import command ok + trackId", sub.ok && sub.result.trackId, JSON.stringify(sub));
  const u = sandbox.undoLast(mockCtx, "p1");
  assert("subtitle-import undo", u.ok && readStoredProject().scenes[0].tracks.overlay.length === 0);
  sandbox.redoNext(mockCtx, "p1");
  assert("subtitle-import redo", readStoredProject().scenes[0].tracks.overlay.length === 1);
}

console.log("\n== script 文稿面（speech-track）==");
{
  for (const key of Object.keys(db.tables)) db.tables[key].rows = [];
  const fsStore = {};
  const sctx = {
    project: { id: "p2", setCover: () => {} },
    sqlite: db,
    files: {
      readText: (p) => (fsStore[p] !== undefined ? fsStore[p] : null),
      writeText: (p, c) => { fsStore[p] = c; },
      list: () => Object.keys(fsStore),
    },
    media: {
      transcript: (assetId) => {
        const segs = {
          tr1: [
            { start: 0, end: 1.5, text: "大家好，嗯今天我们来聊聊" },
            { start: 1.5, end: 3.0, text: "Recut 是一个本地优先的平台" },
            { start: 3.0, end: 4.6, text: "首先，怎么把素材倒进来" },
          ],
        }[assetId];
        return segs ? { language: "zh", segments: segs } : { language: null, segments: [] };
      },
    },
    paths: { projectFilesRoot: "/fake/root" },
  };
  const projOf = () => {
    const rows = sctx.sqlite.query("select project_json from editor_projects where project_id = ?", ["p2"]);
    return JSON.parse(rows[0].project_json);
  };
  registered["project.create"]({}, sctx);
  const ins = registered["timeline.command"]({ op: { type: "insert", payload: { element: { type: "video", name: "说话", mediaId: "a1", startSec: 0, durationSec: 4.6 } } } }, sctx);
  const main = projOf().scenes[0].tracks.main;
  const elId = main.elements[0].id;
  const at = registered["script.attach"]({ trackId: main.id, elementId: elId, assetId: "tr1", language: "zh" }, sctx);
  assert("script.attach ok + version 递增", at.ok === true && at.version === 3, JSON.stringify(at));
  const attached = findEl(projOf(), elId);
  assert("attach 写入 el.transcript", attached.transcript && attached.transcript.assetId === "tr1", JSON.stringify(attached.transcript));

  const rd = registered["script.read"]({}, sctx);
  assert("script.read ok + 3 段", rd.ok === true && rd.segments === 3 && rd.path === "/fake/root/scripts/timeline.md", JSON.stringify(rd));
  assert("read 输出 seg 行", /\[seg-[^:]+:[^:]+:0\] 大家好/.test(rd.content), rd.content);
  assert("read 落盘 baseline", fsStore["scripts/timeline.baseline.md"] === rd.content);

  const edited = rd.content.replace("嗯", "~~嗯~~").replace(/\n\[seg-([^:]+):([^:]+):2\][^\n]*\n/, "\n");
  const ap = registered["script.apply"]({ content: edited }, sctx);
  assert("script.apply ok + op 批", ap.ok === true && ap.applied.indexOf("delete") >= 0 && ap.applied.indexOf("insert") >= 0, JSON.stringify(ap));
  const afterClips = sandbox.condensedTimeline(projOf()).clips;
  assert("apply 后说话元素变碎片（seg0 拆 2 + seg1 = 3）", afterClips.length === 3, JSON.stringify(afterClips.map((c) => ({ id: c.ref.elementId, d: c.durationSec }))));
  const piece = afterClips[0];
  assert("碎片保留 transcript 快照", piece.hasTranscript === true, JSON.stringify(piece));

  const cl = registered["script.clean"]({ fillers: true }, sctx);
  assert("script.clean ok（fillers）", cl.ok === true, JSON.stringify(cl));

  const fd = registered["script.find"]({ text: "Recut" }, sctx);
  assert("script.find 命中", fd.matches.length === 1 && /Recut/.test(fd.matches[0].text), JSON.stringify(fd));

  const rd3 = registered["script.read"]({}, sctx);
  const fx = registered["script.fix-transcript"]({ trackId: rd3.trackId, elementId: rd3.elements[0], segmentIndex: 0, text: "修正文本" }, sctx);
  assert("script.fix-transcript ok（不改音频）", fx.ok === true && fx.version > rd3.version, JSON.stringify(fx));
  const rd4 = registered["script.read"]({}, sctx);
  assert("fix 反映到文稿", rd4.content.indexOf("修正文本") >= 0, rd4.content);

  const u = registered["history.undo"]({}, sctx);
  assert("script op 可 undo", u.ok === true, JSON.stringify(u));

  // 纯函数：停顿规则
  const ps = [{ srcStart: 0, srcEnd: 2, text: "a" }, { srcStart: 2.9, srcEnd: 4, text: "b" }];
  sandbox.computeScriptLayout(
    [{ addr: "t:a:0", text: "a", srcStart: 0, srcEnd: 2, gapAfter: 0.9 }, { addr: "t:b:1", text: "b", srcStart: 2.9, srcEnd: 4, gapAfter: 0 }],
    [{ kind: "seg", trackId: "t", elementId: "a", idx: 0, text: "a", strikes: [] }, { kind: "seg", trackId: "t", elementId: "b", idx: 1, text: "b", strikes: [] }]
  );
  const layoutSil = sandbox.computeScriptLayout(
    [{ addr: "t:a:0", text: "a", srcStart: 0, srcEnd: 2, gapAfter: 0.9 }, { addr: "t:b:1", text: "b", srcStart: 2.9, srcEnd: 4, gapAfter: 0 }],
    [{ kind: "seg", trackId: "t", elementId: "a", idx: 0, text: "a", strikes: [] }, { kind: "seg", trackId: "t", elementId: "b", idx: 1, text: "b", strikes: [] }]
  );
  assert("布局保留原始段间停顿", layoutSil.pieces[0].gapAfter === 0.9, JSON.stringify(layoutSil.pieces));
  sandbox.applySilenceRule(layoutSil.pieces, "compress:300");
  assert("compress:300 把 0.9s 停顿压到 0.3s", Math.abs(layoutSil.pieces[0].gapAfter - 0.3) < 0.0001, JSON.stringify(layoutSil.pieces));
  const layoutGap = sandbox.computeScriptLayout(
    [{ addr: "t:a:0", text: "a", srcStart: 0, srcEnd: 2, gapAfter: 0.9 }, { addr: "t:b:1", text: "b", srcStart: 2.9, srcEnd: 4, gapAfter: 0 }],
    [{ kind: "seg", trackId: "t", elementId: "a", idx: 0, text: "a", strikes: [] }, { kind: "gap", from: 0.9, to: 0.2 }, { kind: "seg", trackId: "t", elementId: "b", idx: 1, text: "b", strikes: [] }]
  );
  assert("[gap=0.9→0.2] 显式覆盖停顿", layoutGap.pieces[0].gapAfter === 0.2, JSON.stringify(layoutGap.pieces));
  const layoutDel = sandbox.computeScriptLayout(
    [{ addr: "t:a:0", text: "a", srcStart: 0, srcEnd: 2, gapAfter: 0 }, { addr: "t:b:1", text: "b", srcStart: 2, srcEnd: 4, gapAfter: 0 }],
    [{ kind: "seg", trackId: "t", elementId: "b", idx: 1, text: "b", strikes: [] }]
  );
  assert("删行 → 只留保留段", layoutDel.pieces.length === 1 && layoutDel.deleted.length === 1 && layoutDel.pieces[0].srcStart === 2, JSON.stringify(layoutDel));
  const layoutBad = sandbox.computeScriptLayout(
    [{ addr: "t:a:0", text: "a", srcStart: 0, srcEnd: 2, gapAfter: 0 }],
    [{ kind: "seg", trackId: "t", elementId: "zzz", idx: 9, text: "?", strikes: [] }]
  );
  assert("未知地址 → 报 stale", layoutBad.ok === false && /not found/.test(layoutBad.error), JSON.stringify(layoutBad));
}

console.log("\n== 自动混音（track-role / duck 包络 / audio.smooth）==");
{
  const mkScene = (tracks) => ({ scenes: [{ id: "s1", isMain: true, tracks: tracks }], settings: {} });
  const sctx2 = {
    project: { id: "p3", setCover: () => {} },
    sqlite: db,
    files: { readText: () => null, writeText: () => {}, list: () => [] },
    media: {},
    paths: { projectFilesRoot: "/fake" },
  };
  // 纯函数：duck 包络
  const scene = mkScene({
    overlay: [],
    main: { id: "main", type: "video", elements: [], muted: false },
    audio: [
      { id: "a-track", type: "audio", elements: [{ id: "vo", type: "audio", startTime: 0, duration: 200000, params: { volume: 0, muted: false } }], muted: false, role: "anchor" },
      { id: "m-track", type: "audio", elements: [{ id: "mus", type: "audio", startTime: 0, duration: 300000, params: { volume: -6, muted: false } }], muted: false, role: "follower" },
    ],
  });
  const env = sandbox.buildDuckEnvelope({ scenes: scene.scenes }, scene.scenes[0]);
  assert("duck 包络：anchor 出声区间 duck 到 factor", env.factorAt(0.1) < 1 && env.factorAt(1.5) < 1, JSON.stringify(env.spans));
  assert("duck 包络：超出 anchor 区间回升", env.factorAt(3.0) === 1, JSON.stringify(env.spans));
  assert("duck 包络：depthDb 自动初始化", env.depthDb >= 4 && env.depthDb <= 16, String(env.depthDb));
  assert("duck 包络：span 合并正确", env.spans.length === 1 && Math.abs(env.spans[0].endSec - 200000 / 120000) < 0.001, JSON.stringify(env.spans));

  // track-role op（undoable）
  for (const key of Object.keys(db.tables)) db.tables[key].rows = [];
  const p = defaultProject();
  sandbox.ensureSchema(sctx2, "p3");
  sctx2.sqlite.execute(
    "insert into editor_projects (project_id, project_json, registered_assets_json, version, updated_at) values (?, ?, ?, ?, ?)",
    ["p3", JSON.stringify(p), "[]", 1, new Date().toISOString()],
  );
  const addTrack = sandbox.executeCommand(sctx2, "p3", { type: "track-add", payload: { type: "audio", name: "音乐" } });
  const tr = readStoredProject2();
  const audioTrack = tr.scenes[0].tracks.audio.find((t) => t.name === "音乐");
  assert("track-add 建音频轨", !!audioTrack, JSON.stringify(tr.scenes[0].tracks.audio));
  const r1 = sandbox.executeCommand(sctx2, "p3", { type: "track-role", payload: { trackId: audioTrack.id, role: "follower", duckDepthDb: 10 } });
  assert("track-role ok", r1.ok === true, JSON.stringify(r1));
  const tr2 = readStoredProject2();
  const t2 = tr2.scenes[0].tracks.audio.find((t) => t.id === audioTrack.id);
  assert("track-role 写入 role + duckDepthDb", t2.role === "follower" && t2.audioRouting.duckDepthDb === 10, JSON.stringify(t2));
  const u2 = sandbox.undoLast(sctx2, "p3");
  assert("track-role undo 清除 role", u2.ok && readStoredProject2().scenes[0].tracks.audio.find((t) => t.id === audioTrack.id).role === undefined);

  // audio.smooth：音量关键帧边界淡入淡出 + 幂等
  const ins2 = sandbox.executeCommand(sctx2, "p3", { type: "insert", payload: { element: { type: "audio", name: "VO", mediaId: "a1", sourceType: "upload", startSec: 0, durationSec: 4 } } });
  const audioElRef = ins2.result.element;
  const sm1 = registered["audio.smooth"]({}, sctx2);
  assert("audio.smooth 落关键帧", sm1.ok === true && sm1.applied === 4, JSON.stringify(sm1));
  const proj3 = readStoredProject2();
  const smoothed = proj3.scenes[0].tracks.audio.find((t) => t.id === audioElRef.trackId).elements.find((e) => e.id === audioElRef.elementId);
  assert("audio.smooth 在首尾落 4 个 volume 关键帧", smoothed.animations && smoothed.animations.volume && smoothed.animations.volume.keys.length === 4, JSON.stringify(smoothed && smoothed.animations && smoothed.animations.volume));
  const sm2 = registered["audio.smooth"]({}, sctx2);
  assert("audio.smooth 幂等（二次无新 op）", sm2.ok === true && sm2.applied === 0, JSON.stringify(sm2));
}
function readStoredProject2() {
  const rows = db.query("select project_json from editor_projects where project_id = ?", ["p3"]);
  return JSON.parse(rows[0].project_json);
}

console.log("\n== 内置目录（library.browse 动态目录）==");
{
  const libCtx = {
    project: { id: "p4", setCover: () => {} },
    sqlite: db,
    files: {
      readText: (p) =>
        p === "catalog/effects.json"
          ? JSON.stringify({ effects: [{ id: "effect.local", name: "Local", keywords: ["local"], inputs: [] }] })
          : p === "catalog/audio.json"
            ? JSON.stringify({ sfx: [{ id: "whoosh", name: "Whoosh", url: "audio/sfx/whoosh.mp3" }], music: [] })
            : null,
      writeText: () => {}, list: () => [],
    },
    http: {
      get: (url) => {
        if (url.indexOf("effects/catalog.json") >= 0) {
          return { status: 200, body: JSON.stringify({ effects: [{ id: "effect.glass", name: "Glass 玻璃", keywords: ["glass", "玻璃"], inputs: [{ key: "zoom", type: "number", default: 1.34 }] }], transitions: [], luts: [] }) };
        }
        if (url.indexOf("audio/catalog.json") >= 0) {
          return { status: 200, body: JSON.stringify({ sfx: [{ id: "whoosh-cdn", name: "Whoosh", url: "audio/sfx/whoosh.mp3" }], music: [{ id: "bgm", name: "BGM", url: "audio/music/bgm.mp3" }] }) };
        }
        return { status: 404, body: "" };
      },
    },
  };
  const b1 = registered["library.browse"]({ category: "effects", query: "glass" }, libCtx);
  assert("library.browse effects 命中 CDN", b1.ok && b1.count === 1 && b1.items[0].id === "effect.glass" && b1.source === "cdn", JSON.stringify(b1));
  const b2 = registered["library.browse"]({ category: "sound-effects" }, libCtx);
  assert("library.browse sfx url 前缀 CDN", b2.ok && b2.items[0].url === "https://cdn.recut.video/audio/sfx/whoosh.mp3" && b2.items[0].kind === "sound-effect", JSON.stringify(b2));
  const b3 = registered["library.browse"]({ category: "music" }, libCtx);
  assert("library.browse music", b3.count === 1 && b3.items[0].kind === "music", JSON.stringify(b3));
  const b1b = registered["library.browse"]({ query: "glass" }, libCtx);
  assert("library.browse 无 category = 全类目", b1b.count >= 1 && b1b.items[0].id === "effect.glass", JSON.stringify(b1b));

  const libCtx2 = { project: { id: "p4" }, sqlite: db, files: libCtx.files, http: null };
  const b4 = registered["library.browse"]({ category: "effects", query: "local" }, libCtx2);
  assert("无 http 回退 shipped", b4.count === 1 && b4.items[0].id === "effect.local" && b4.source === "shipped", JSON.stringify(b4));
  const libCtx3 = { project: { id: "p4" }, sqlite: db, files: { readText: () => null, writeText: () => {}, list: () => [] }, http: null };
  const b5 = registered["library.browse"]({ category: "effects" }, libCtx3);
  assert("无 http 无 shipped 回退 builtin", b5.count >= 4 && b5.source === "builtin", JSON.stringify(b5.count));
}

console.log("\n== timeline.delta / work.checkpoint / work.cancel ==");
{
  for (const key of Object.keys(db.tables)) db.tables[key].rows = [];
  const p = defaultProject();
  sandbox.ensureSchema(mockCtx, "p1");
  mockCtx.sqlite.execute(
    "insert into editor_projects (project_id, project_json, registered_assets_json, version, updated_at) values (?, ?, ?, ?, ?)",
    ["p1", JSON.stringify(p), "[]", 1, new Date().toISOString()],
  );
  const cp0 = registered["work.checkpoint"]({}, mockCtx);
  assert("空日志 checkpointSeq=0", cp0.ok && cp0.checkpointSeq === 0, JSON.stringify(cp0));
  const ins = cmd({ type: "insert", payload: { element: { type: "video", name: "A", mediaId: "a1", startSec: 0, durationSec: 2 } } });
  assert("insert seq=1", ins.ok && ins.seq === 1, JSON.stringify(ins));
  const cp1 = registered["work.checkpoint"]({}, mockCtx);
  assert("checkpoint 记下 seq=1", cp1.checkpointSeq === 1 && cp1.version === 2, JSON.stringify(cp1));
  cmd({ type: "insert", payload: { element: { type: "text", name: "T", startSec: 0, durationSec: 1, content: "Hi" } } });
  cmd({ type: "insert", payload: { element: { type: "text", name: "T2", startSec: 1, durationSec: 1, content: "Yo" } } });
  const delta = registered["timeline.delta"]({ fromVersion: 2 }, mockCtx);
  assert("delta 带 document + ops", delta.ok && delta.document && delta.operations.length === 2 && delta.toVersion === 4, JSON.stringify({ to: delta.toVersion, n: delta.operations.length }));
  const cancel = registered["work.cancel"]({ checkpointSeq: cp1.checkpointSeq }, mockCtx);
  assert("cancel 撤销两条", cancel.ok && cancel.undoneSeqs.length === 2, JSON.stringify(cancel));
  const after = sandbox.condensedTimeline(readStoredProject());
  assert("cancel 后只留 checkpoint 时的一条 clip", after.clips.length === 1, JSON.stringify(after.clips.map((c) => c.name)));
  const ctxAfter = registered["workflow.context"]({}, mockCtx);
  assert("workflow.context 暴露 authoring + preview.batch", ctxAfter.authoring && ctxAfter.authoring.headlessPreview === false && ctxAfter.allowedActions.indexOf("preview.batch") >= 0 && ctxAfter.allowedActions.indexOf("work.cancel") >= 0, JSON.stringify(ctxAfter.authoring));

  const ownerA = registered["project.lock"]({ owner: "agent-a" }, mockCtx);
  const ownedCheckpoint = registered["work.checkpoint"]({}, mockCtx);
  const wrongUnlock = registered["project.unlock"]({ owner: "agent-b", token: ownerA.lock.token }, mockCtx);
  assert("错误 owner 不能解锁", wrongUnlock.ok === false && wrongUnlock.reason === "lock-owner-mismatch", JSON.stringify(wrongUnlock));
  registered["project.unlock"]({ owner: "agent-a", token: ownerA.lock.token }, mockCtx);
  const ownerB = registered["project.lock"]({ owner: "agent-b" }, mockCtx);
  const foreignCancel = registered["work.cancel"]({ checkpointSeq: ownedCheckpoint.checkpointSeq, owner: "agent-b", token: ownerB.lock.token }, mockCtx);
  assert("其他 owner 不能取消工作单元", foreignCancel.ok === false && foreignCancel.reason === "checkpoint-owner-mismatch", JSON.stringify(foreignCancel));
  registered["project.unlock"]({ owner: "agent-b", token: ownerB.lock.token }, mockCtx);
}

console.log("\n== export.start MCP async 信封 ==");
{
  lastCallUI = null;
  try {
    registered["export.start"]({ mode: "headless" }, mockCtx);
    assert("headless 应抛错", false);
  } catch (e) {
    assert("headless-unavailable", e.__recutError && e.__recutError.code === "headless-unavailable", e && e.message);
  }
  try {
    registered["export.start"]({ width: 640 }, mockCtx);
    assert("无心跳应抛 editor-not-open", false);
  } catch (e) {
    assert("editor-not-open", e.__recutError && e.__recutError.code === "editor-not-open", e && e.message);
  }
  registered["frame.heartbeat"]({}, mockCtx);
  const started = registered["export.start"]({ width: 640, height: 360, fps: 24 }, mockCtx);
  assert("export.start 返回 jobId", started && started.jobId === "job-export-1" && started.mode === "ui", JSON.stringify(started));
  assert("callUI export.encode", lastCallUI && lastCallUI[0] === "export.encode" && lastCallUI[2].completeOp === "export.finalize", JSON.stringify(lastCallUI));
  assert("export.encode 绑定 timeline version + 参数", lastCallUI && typeof lastCallUI[1].expectedVersion === "number" && lastCallUI[1].width === 640 && lastCallUI[1].height === 360 && lastCallUI[1].fps === 24, JSON.stringify(lastCallUI && lastCallUI[1]));
  const finalized = registered["export.finalize"]({
    id: "job-export-1",
    result: { fileBase64: "AAAA", exportId: started.exportId, mimeType: "video/mp4" },
  }, mockCtx);
  assert("export.finalize 入库", finalized && finalized.assetId === "asset-export-1" && finalized.exportId === started.exportId, JSON.stringify(finalized));
}

console.log("\n" + (failures === 0 ? "ALL PASS" : failures + " FAILURES"));
process.exit(failures === 0 ? 0 : 1);
