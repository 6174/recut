/**
 * [INPUT]: 依赖 model-base 的轨道与元素模型。
 * [OUTPUT]: SRT/ASS 解析、字幕样式广播与导出函数。
 * [POS]: background 的字幕领域模型；由 op-engine 与 project-operations 消费。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// ---- 字幕（caption track）--------------------------------------------------
// 字幕 = text 轨上的 text 元素（带 subtitle 标记），轨道携带共享样式 captionStyle。
// param 编辑字幕 cue 时广播到全轨；caption-style 设置全轨样式；subtitle-import/export
// 供 MCP 导入/导出字幕文本。

function broadcastSubtitleStyle(track, targetEl) {
  if (!track || track.type !== "text" || !track.captionStyle || !targetEl) return;
  if (targetEl.type !== "text" || !targetEl.subtitle) return;
  var p = targetEl.params || {};
  var style = {};
  for (var k in p) {
    if (Object.prototype.hasOwnProperty.call(p, k) && k !== "content") style[k] = p[k];
  }
  track.captionStyle = style;
  for (var i = 0; i < track.elements.length; i++) {
    var sib = track.elements[i];
    if (sib.type === "text" && sib.subtitle) {
      sib.params = Object.assign({}, style, {
        content: sib.params && sib.params.content !== undefined ? sib.params.content : "",
      });
    }
  }
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function formatSrtTime(seconds) {
  var s = Math.max(0, seconds);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = Math.floor(s % 60);
  var ms = Math.floor((s - Math.floor(s)) * 1000);
  return pad2(h) + ":" + pad2(m) + ":" + pad2(sec) + "," + (ms < 100 ? (ms < 10 ? "00" + ms : "0" + ms) : String(ms));
}

function parseSrtTime(text) {
  var t = text.trim().replace(",", ".");
  var m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!m) return null;
  var h = Number(m[1]);
  var min = Number(m[2]);
  var sec = Number(m[3]);
  var frac = Number(m[4].padEnd(3, "0"));
  return h * 3600 + min * 60 + sec + frac / 1000;
}

function parseSrtText(input) {
  var normalized = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  var blocks = normalized.split(/\n{2,}/);
  var cues = [];
  for (var b = 0; b < blocks.length; b++) {
    var lines = blocks[b].split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
    if (lines.length < 2) continue;
    var tsIndex = /-->\s/.test(lines[0]) ? 0 : 1;
    if (!lines[tsIndex] || !/-->\s/.test(lines[tsIndex])) continue;
    var parts = lines[tsIndex].split(/\s*-->\s*/);
    if (parts.length < 2) continue;
    var start = parseSrtTime(parts[0]);
    var end = parseSrtTime(parts[1]);
    if (start === null || end === null || end <= start) continue;
    var text = lines.slice(tsIndex + 1).join("\n").trim();
    if (!text) continue;
    cues.push({ text: text, startSec: start, durationSec: end - start });
  }
  return cues;
}

function parseAssTime(text) {
  var m = String(text).trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) return null;
  var h = Number(m[1]);
  var min = Number(m[2]);
  var sec = Number(m[3]);
  var cs = Number(m[4]);
  return h * 3600 + min * 60 + sec + cs / 100;
}

function stripAssInline(text) {
  return String(text)
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\([NnH])/g, "\n")
    .trim();
}

function parseAssText(input) {
  var lines = String(input || "").replace(/\r\n?/g, "\n").split("\n");
  var cues = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf("Dialogue:") !== 0) continue;
    var fields = line.slice("Dialogue:".length).split(",");
    if (fields.length < 10) continue;
    var start = parseAssTime(fields[1]);
    var end = parseAssTime(fields[2]);
    if (start === null || end === null || end <= start) continue;
    var text = stripAssInline(fields.slice(9).join(","));
    if (!text) continue;
    cues.push({ text: text, startSec: start, durationSec: end - start });
  }
  return cues;
}

function parseSubtitleContent(content, fileName) {
  var ext = String(fileName || "").split(".").pop().toLowerCase();
  if (ext === "ass" || /^Dialogue:/.test(String(content).trim())) {
    return parseAssText(content);
  }
  return parseSrtText(content);
}

function renderSrtFromTrack(track) {
  var cues = (track.elements || [])
    .filter(function (e) { return e.type === "text" && e.subtitle; })
    .slice()
    .sort(function (a, b) { return a.startTime - b.startTime; });
  var out = [];
  for (var i = 0; i < cues.length; i++) {
    var c = cues[i];
    var content = c.params && c.params.content !== undefined ? c.params.content : "";
    out.push(String(i + 1));
    out.push(formatSrtTime(secOf(c.startTime)) + " --> " + formatSrtTime(secOf(c.startTime + c.duration)));
    out.push(String(content));
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}
