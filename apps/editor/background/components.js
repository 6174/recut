/**
 * [INPUT]: 依赖 project-store 的 schema、assets 的项目 asset 引用索引、scope、事件与 ctx.files/shell，依赖 op-engine 的 component 元素模型。
 * [OUTPUT]: 组件版本、构建、验证、查询与归档 operation 的注册，并在 verified head 上维护 component asset 引用。创建入口为 service 侧的 component.create
 *           （同模型受限子 Agent），本文件只提供受管 define/verify/source/resolve/list。
 * [POS]: background 的组件素材库边界；组件创建不修改时间线。作者路径契约：平台生成类型完整脚手架 + 从时间线
 *        推导合成上下文（overMedia/默认透明/视觉旋钮）注入 prompt；构建走 --loose（运行安全闸保留）；
 *        业务校验失败必须 throw recut.error(payload) 结构化信封，禁止裸 Error（service 侧翻译成 {ok:false} 结果）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

var COMPONENT_SURFACES = ["html", "react", "r3f"];

function newComponentId() {
  return "ai-" + Math.random().toString(36).slice(2, 10);
}

function readComponent(ctx, scopeId, componentId) {
  ensureSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select * from editor_components where component_id = ? and project_id = ?",
    [componentId, scopeId],
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

function readVersion(ctx, scopeId, versionId) {
  ensureSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select v.* from editor_component_versions v " +
      "join editor_components c on c.component_id = v.component_id " +
      "where v.version_id = ? and c.project_id = ?",
    [versionId, scopeId],
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

function latestVersion(ctx, scopeId, componentId) {
  ensureSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select v.version_id from editor_component_versions v " +
      "join editor_components c on c.component_id = v.component_id " +
      "where v.component_id = ? and c.project_id = ? order by v.version desc limit 1",
    [componentId, scopeId],
  );
  return rows && rows.length > 0 ? rows[0].version_id : null;
}

function headVersion(ctx, scopeId, componentId) {
  ensureSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select v.version_id, v.status, v.bundle, v.bundle_hash, v.inputs_json, v.test_report_json, v.cover_path " +
      "from editor_component_versions v " +
      "where v.version_id = (select head_version_id from editor_components where component_id = ? and project_id = ?)",
    [componentId, scopeId],
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

/** 构建组件 bundle：写源文件 → 跑 component-build.js（esbuild+shape+确定性扫描+可选 tsc）→ 读产物。
 * AI 作者路径传 --loose：跳过 strict 类型检查，保留运行安全闸（shape/确定性/esbuild 可编译）。
 * 类型卫生只属于受信内置库路径（rfc/2026-08-19 P3：平台拥有框架，模型只拥有内容）。 */
function buildComponentBundle(ctx, versionId, source) {
  var sourcePath = "components/" + versionId + ".tsx";
  var outPath = "components/" + versionId + ".js";
  ctx.files.writeText(sourcePath, source);
  var buildScript = ctx.paths.appRoot + "/scripts/component-build.js";
  var result = ctx.shell.exec({
    command: "node",
    args: [buildScript, sourcePath, outPath, "--loose"],
    cwd: "files",
    timeoutSeconds: 60,
  });
  var parsed = null;
  try {
    parsed = JSON.parse((result && (result.stdout || result.output)) || "{}");
  } catch (_) {
    parsed = null;
  }
  if (!parsed || parsed.ok !== true) {
    return {
      ok: false,
      error: parsed && parsed.error,
      type: parsed && parsed.type,
      issues: parsed && parsed.issues,
      errors: parsed && parsed.errors,
    };
  }
  var bundle = ctx.files.readText(outPath);
  return { ok: true, bundle: bundle, bundleHash: parsed.bundleHash };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

/** 新建临时组件或已有组件的新版本（AI 二次调整 = 带 componentId 重 define）。 */
function defineComponent(input, ctx) {
  var scopeId = scope(ctx);
  if (!ctx.project) {
    throw new Error(loc(ctx, "component.define: 需要项目上下文", "component.define: project context required"));
  }
  if (!input || typeof input.source !== "string" || !input.source.trim()) {
    throw new Error(loc(ctx, "component.define: source 必填", "component.define: source is required"));
  }
  var surface = input.surface || "r3f";
  if (COMPONENT_SURFACES.indexOf(surface) === -1) {
    throw new Error("component.define: surface 非法: " + surface);
  }
  var componentId = input.componentId || newComponentId();
  var name = input.name || loc(ctx, "AI 组件", "AI Component");
  var keywords = Array.isArray(input.keywords) ? input.keywords : [];
  var inputs = Array.isArray(input.inputs) ? input.inputs : [];
  var mode = input.mode === "fullscreen" ? "fullscreen" : "local";
  var now = nowIso();
  ensureSchema(ctx, scopeId);

  var existing = readComponent(ctx, scopeId, componentId);
  var baseVersionId = input.baseVersionId || "";
  if (baseVersionId && (!existing || existing.head_version_id !== baseVersionId)) {
    throw new Error("component.define: stale baseVersionId; component changed while authoring");
  }
  if (baseVersionId) {
    var baseRow = readVersion(ctx, scopeId, baseVersionId);
    var newer = baseRow && ctx.sqlite.query(
      "select version_id from editor_component_versions where component_id = ? and version > ? and status <> 'failed' limit 1",
      [componentId, baseRow.version],
    );
    if (!baseRow || !newer || newer.length > 0) {
      throw new Error("component.define: stale baseVersionId; another version is already authoring");
    }
  }
  if (!existing) {
    ctx.sqlite.execute(
      "insert into editor_components (component_id, project_id, name, surface, keywords_json, head_version_id, mode, created_at, updated_at) values (?, ?, ?, ?, ?, null, ?, ?, ?)",
      [componentId, scopeId, name, surface, JSON.stringify(keywords), mode, now, now],
    );
  } else {
    ctx.sqlite.execute(
      "update editor_components set name = ?, surface = ?, keywords_json = ?, mode = ?, updated_at = ? where component_id = ?",
      [name, surface, JSON.stringify(keywords), mode, now, componentId],
    );
  }

  var prev = latestVersion(ctx, scopeId, componentId);
  var version = prev ? parseInt(prev.split("@").pop(), 10) + 1 : 1;
  var versionId = componentId + "@" + version;
  var built = buildComponentBundle(ctx, versionId, input.source);

  if (built.ok) {
    ctx.sqlite.execute(
      "insert into editor_component_versions (version_id, component_id, version, source, bundle_hash, bundle, inputs_json, status, test_report_json, created_at, verified_at) values (?, ?, ?, ?, ?, ?, ?, 'draft', null, ?, null)",
      [versionId, componentId, version, input.source, built.bundleHash, built.bundle, JSON.stringify(inputs), now],
    );
    emitProjectEvent(ctx, scopeId, "project.components.changed", { componentId: componentId, versionId: versionId, status: "draft" });
    return { componentId: componentId, versionId: versionId, version: version, status: "draft" };
  }

  // 构建失败：记录 failed 版本（含错误报告），供 AI 读错误迭代；head 不动。
  ctx.sqlite.execute(
    "insert into editor_component_versions (version_id, component_id, version, source, bundle_hash, bundle, inputs_json, status, test_report_json, created_at, verified_at) values (?, ?, ?, ?, '', '', ?, 'failed', ?, ?, null)",
    [versionId, componentId, version, input.source, JSON.stringify(inputs), JSON.stringify(built), now],
  );
  return { componentId: componentId, versionId: versionId, version: version, status: "failed", buildError: built };
}

recut.operation.register("component.define", (input, ctx) => defineComponent(input, ctx));

// ---- 受限子 Agent 请求：background 动态声明上下文与受限工具范围（平台通用 runner 执行）----

var COMPONENT_REQUEST_TOOLS = ["recut.editor.component.commit"];

var FEATURE_CHIP_SKELETON = `import { str } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

export default {
  surface: "html",
  name: "Feature Chip",
  keywords: ["chip", "badge", "feature"],
  inputs: [
    { key: "title", type: "text", default: "Feature", label: "主标题" },
    { key: "subtitle", type: "text", default: "Ready to use", label: "副标题" },
    { key: "accent", type: "color", default: "#38bdf8", label: "强调色" },
    { key: "icon", type: "text", default: "✦", label: "图标" },
  ],
  getBaseSize: () => ({ width: 520, height: 150 }),
  getContentBounds: () => ({ x: 12, y: 12, width: 496, height: 126 }),
  render(ctx: ComponentRenderContext) {
    const title = escapeHtml(str(ctx.params.title, "Feature"));
    const subtitle = escapeHtml(str(ctx.params.subtitle, "Ready to use"));
    const accent = escapeHtml(str(ctx.params.accent, "#38bdf8"));
    const icon = escapeHtml(str(ctx.params.icon, "✦"));
    const rise = ctx.anim.lerp(18, 0, Math.min(1, ctx.progress * 4), { ease: "outCubic" });
    const opacity = Math.min(1, ctx.progress * 5);
    return \`<div style="box-sizing:border-box;width:100%;height:100%;display:flex;align-items:center;gap:18px;padding:18px 22px;border:1px solid \${accent};border-radius:28px;background:rgba(9,16,29,.9);box-shadow:0 10px 28px rgba(0,0,0,.28);color:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;transform:translateY(\${rise}px);opacity:\${opacity}"><span style="display:grid;place-items:center;width:54px;height:54px;border-radius:18px;background:\${accent};color:#0f172a;font-size:27px;font-weight:800">\${icon}</span><span style="display:grid;gap:5px"><strong style="font-size:24px;line-height:1.05;letter-spacing:-.4px">\${title}</strong><small style="font-size:15px;line-height:1;color:#cbd5e1">\${subtitle}</small></span></div>\`;
  },
};
`;

// 全屏 feature 骨架（类型完整 + 合成默认透明 + 视觉旋钮 inputs）。
// 由平台生成、模型只改 render 主体（rfc/2026-08-19 P3：平台拥有框架，模型只拥有内容）。
function featureFullscreenSkeleton(w, h) {
  return `import { str } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

export default {
  surface: "html",
  name: "Fullscreen Feature",
  keywords: ["feature", "fullscreen"],
  inputs: [
    { key: "title", type: "text", default: "主标题", label: "主标题" },
    { key: "subtitle", type: "text", default: "一行辅助说明", label: "辅助说明" },
    { key: "background", type: "text", default: "transparent", label: "背景（transparent/light/dark）" },
    { key: "textColor", type: "text", default: "#0f172a", label: "文字颜色" },
    { key: "accent", type: "color", default: "#22c55e", label: "强调色" },
  ],
  getBaseSize: () => ({ width: ${w}, height: ${h} }),
  getContentBounds: () => ({ x: 0, y: 0, width: ${w}, height: ${h} }),
  render(ctx: ComponentRenderContext) {
    const { params, progress } = ctx;
    const p = params || {};
    const title = str(p.title, "主标题");
    const subtitle = str(p.subtitle, "一行辅助说明");
    const bg = str(p.background, "transparent");
    const color = str(p.textColor, "#0f172a");
    const ease = (k: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);
    const enter = ease(progress / 0.2);
    const ty = (1 - enter) * 60;
    return \`<div style="position:absolute;inset:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;\${bg === "transparent" ? "" : "background:" + bg + ";"}color:\${color};font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;opacity:\${enter.toFixed(3)};transform:translateY(\${ty.toFixed(1)}px);">
  <div style="font-size:176px;font-weight:800;line-height:1.12;letter-spacing:6px;text-align:center;">\${title}</div>
  <div style="width:560px;height:60px;margin-top:64px;border-radius:30px;background:linear-gradient(90deg,#22c55e 0%,#22d3ee 100%);"></div>
  <div style="margin-top:64px;font-size:46px;letter-spacing:4px;text-align:center;">\${subtitle}</div>
</div>\`;
  },
};
`;
}

// GSAP 变体骨架（rfc/2026-08-20 §8.2）：react 函数组件形态（hook 可用），useTimeline 声明 paused Timeline，
// 运行时逐帧 seek 到当前帧时间。被动画属性经 ref 由 GSAP 命令式持有，绝不写进 JSX props。
function featureFullscreenGaspSkeleton(w, h) {
  return `import { useRef, useTimeline } from "@recut/runtime";

export default function FullscreenFeature(props: any) {
  const root = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const p = props || {};
  const title = String(p.title ?? "主标题");
  const subtitle = String(p.subtitle ?? "一行辅助说明");
  const bg = String(p.background ?? "transparent");
  const color = String(p.textColor ?? "#0f172a");
  useTimeline((tl) => {
    if (!root.current || !titleRef.current || !barRef.current || !subRef.current) return;
    tl.fromTo(root.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: "power1.out" }, 0)
      .fromTo(titleRef.current, { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: "power3.out" }, 0.1)
      .fromTo(barRef.current, { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.5, ease: "power2.out" }, 0.35)
      .fromTo(subRef.current, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, ease: "power2.out" }, 0.5);
  }, []);
  return (
    <div ref={root} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: bg === "transparent" ? "transparent" : bg, color, fontFamily: "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif" }}>
      <div ref={titleRef} style={{ fontSize: 176, fontWeight: 800, lineHeight: 1.12, letterSpacing: 6, textAlign: "center" }}>{title}</div>
      <div ref={barRef} style={{ width: 560, height: 60, marginTop: 64, borderRadius: 30, background: "linear-gradient(90deg,#22c55e 0%,#22d3ee 100%)" }} />
      <div ref={subRef} style={{ marginTop: 64, fontSize: 46, letterSpacing: 4, textAlign: "center" }}>{subtitle}</div>
    </div>
  );
}
FullscreenFeature.inputs = [
  { key: "title", type: "text", default: "主标题", label: "主标题" },
  { key: "subtitle", type: "text", default: "一行辅助说明", label: "辅助说明" },
  { key: "background", type: "text", default: "transparent", label: "背景（transparent/light/dark）" },
  { key: "textColor", type: "text", default: "#0f172a", label: "文字颜色" },
  { key: "accent", type: "color", default: "#22c55e", label: "强调色" },
];
FullscreenFeature.getBaseSize = () => ({ width: ${w}, height: ${h} });
FullscreenFeature.getContentBounds = () => ({ x: 0, y: 0, width: ${w}, height: ${h} });
`;
}

var FEATURE_CHIP_GSAP_SKELETON = `import { useRef, useTimeline } from "@recut/runtime";

export default function FeatureChip(props: any) {
  const root = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const p = props || {};
  const title = String(p.title ?? "Feature");
  const subtitle = String(p.subtitle ?? "Ready to use");
  const accent = String(p.accent ?? "#38bdf8");
  const icon = String(p.icon ?? "✦");
  useTimeline((tl) => {
    if (!root.current || !iconRef.current) return;
    tl.fromTo(root.current, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.55, ease: "power3.out" })
      .fromTo(iconRef.current, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.35, ease: "back.out(2)" }, "-=0.2");
  }, []);
  return (
    <div ref={root} style={{ boxSizing: "border-box", width: "100%", height: "100%", display: "flex", alignItems: "center", gap: 18, padding: "18px 22px", border: \`1px solid \${accent}\`, borderRadius: 28, background: "rgba(9,16,29,.9)", boxShadow: "0 10px 28px rgba(0,0,0,.28)", color: "#f8fafc", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <span ref={iconRef} style={{ display: "grid", placeItems: "center", width: 54, height: 54, borderRadius: 18, background: accent, color: "#0f172a", fontSize: 27, fontWeight: 800 }}>{icon}</span>
      <span style={{ display: "grid", gap: 5 }}>
        <strong style={{ fontSize: 24, lineHeight: 1.05, letterSpacing: "-0.4px" }}>{title}</strong>
        <small style={{ fontSize: 15, lineHeight: 1, color: "#cbd5e1" }}>{subtitle}</small>
      </span>
    </div>
  );
}
FeatureChip.inputs = [
  { key: "title", type: "text", default: "Feature", label: "主标题" },
  { key: "subtitle", type: "text", default: "Ready to use", label: "副标题" },
  { key: "accent", type: "color", default: "#38bdf8", label: "强调色" },
  { key: "icon", type: "text", default: "✦", label: "图标" },
];
FeatureChip.getBaseSize = () => ({ width: 520, height: 150 });
FeatureChip.getContentBounds = () => ({ x: 12, y: 12, width: 496, height: 126 });
`;

function selectSkeletonSource(item, canvas) {
  var id = (item && item.template) || "";
  if (!id && item && typeof item.role === "string") {
    if (item.role.indexOf("feature") !== -1 || item.role.indexOf("chip") !== -1) id = "feature-chip";
  }
  var brief = (item && item.brief) || "";
  var wantsGsap = /gsap|timeline|stagger|animate|animation|动画|动效|入场/.test(brief);
  var w = canvas && canvas.width ? canvas.width : 1920;
  var h = canvas && canvas.height ? canvas.height : 1080;
  if (wantsGsap) {
    if (id === "feature-chip" || id === "gsap-chip") return FEATURE_CHIP_GSAP_SKELETON;
    if (item.mode === "fullscreen" || id === "fullscreen" || id === "feature-fullscreen") {
      return featureFullscreenGaspSkeleton(w, h);
    }
  }
  if (id === "feature-chip") return FEATURE_CHIP_SKELETON;
  if (item.mode === "fullscreen" || id === "fullscreen" || id === "feature-fullscreen") {
    return featureFullscreenSkeleton(w, h);
  }
  return null;
}

// 平台视觉铁律 + 类型强制（架构 P3：把"要写类型/默认透明/合成对比"从模型自觉变成契约叙述 + 平台兜底）。
var COMPONENT_AUTHOR_HEADER = "You are a focused Component Author running in General mode. Do not inspect tools, read skills, use shell/files, or emit commentary. Think and implement normally, then finish by calling mcp__component_author__recut_editor_component_commit. Do not return component JSON in chat and do not call any timeline operation: this tool is already bound to the correct project and commits a component-library asset only.\n\nAuthoring contract:\n- Choose html for DOM/card/text visuals, react for JSX interaction-free composition, r3f for real 3D only.\n- The only external import allowed is @recut/runtime. JSX uses that runtime automatically; do not import React or any other package.\n- TYPE MANDATE (hard rule): every parameter MUST carry an explicit type annotation. Use render(ctx: any), or better render(ctx: ComponentRenderContext) with `import type { ComponentRenderContext } from \"@recut/runtime\"`. Every inline arrow/map/for callback parameter MUST be typed, e.g. (i: number) => ..., (item: string) => .... Untyped parameters are rejected; the platform does not guess.\n- Inputs must be ParamDefinition[] objects: {key,label?,type?,default,min?,max?,step?}. Use an array, never an object map.\n- The default export must be ONE of two accepted shapes (the platform validates shape at build time):\n  A) A definition object: export default { surface, name, keywords?, inputs?, render(ctx), getBaseSize?, getContentBounds? } — render(ctx) returns the surface output (html string / JSX / R3F tree).\n  B) A pure function component (react surface): export default function MyComp(props) {...} — props = ctx fields (progress, localTime, time, params, anim) plus your inputs spread as top-level props. Attach getBaseSize/getContentBounds/inputs as static properties on the function.\n- Include sensible base size and stable content bounds when appropriate.\n- ANIMATION: For react/r3f, use GSAP via useTimeline (import { useTimeline } from \"@recut/runtime\") — build a paused timeline once and the runtime seeks it to the current frame time. For html surface use ctx.anim helpers. HARD RULES: timelines must be paused and driven only by seek/progress (never .play()/.restart()/.resume()); animated properties must NOT appear as time-varying JSX props (use refs and let GSAP write them); never use ScrollTrigger/ScrollSmoother/Draggable/Inertia/Observer/gsap.utils.random; no wall-clock APIs, timers, randomness, requestAnimationFrame, network, or browser storage. Use refs as targets (DOM nodes for react, Object3D for r3f).\n- Keep the result compact, visually legible at video scale, and self-contained.\n- If component.commit reports a build error, fix THAT exact error first (especially missing type annotations on ctx / arrow params) before committing again. Do not re-submit the same pattern that just failed.\n";

function buildCreatePrompt(items, canvas, composition) {
  var parts = [COMPONENT_AUTHOR_HEADER];
  parts.push("Create " + items.length + " component(s). Call component.commit once per item; each commit produces one distinct component. Match each commit to the item with the same index (nameHint/role below).\n");
  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    parts.push("=== Item " + (i + 1) + " ===");
    if (item.nameHint) parts.push("nameHint: " + item.nameHint);
    if (item.role) parts.push("role: " + item.role);
    if (item.mode) parts.push("mode: " + item.mode);
    parts.push("brief: " + (item.brief || ""));
    var w = canvas && canvas.width ? canvas.width : 1920;
    var h = canvas && canvas.height ? canvas.height : 1080;
    if (item.mode === "fullscreen") {
      parts.push("\nThis is a FULLSCREEN component: it must fill the entire canvas. Set getBaseSize to the canvas size (" + w + "x" + h + ") and design to fill it edge-to-edge. If a canvas size is not yet set, default to " + w + "x" + h + ".");
    }
    var skeleton = selectSkeletonSource(item, canvas);
    if (skeleton) {
      parts.push("\nUse this TYPE-ANNOTATED skeleton as the starting point (adapt its render body to the brief; keep its signature/inputs/transparency defaults unless the brief requires otherwise):\n" + skeleton);
    }
    if (composition && composition.overMedia) {
      parts.push("\nCOMPOSITION: this component will be composited on top of existing video/image footage. Rules:\n- background DEFAULTS to transparent — do NOT paint an opaque full-canvas background unless the brief explicitly requires one.\n- Choose textColor/graphics for high contrast against the underlying footage. Without a luminance sample, default to dark text (#0f172a) with subtle shadow; if the brief states the footage is dark, use light text.\n- Expose background / textColor / accent as inputs so the user can tweak colors without editing source.");
    }
    parts.push("");
  }
  return parts.join("\n");
}

function canvasOf(ctx, scopeId) {
  try {
    var existing = readProject(ctx, scopeId);
    var settings = existing && existing.project && existing.project.settings;
    return (settings && settings.canvasSize) || null;
  } catch (_) {
    return null;
  }
}

// compositingOf 从项目当前时间线推导合成上下文：底层是否有 video/image 等视觉素材
// （架构 P3：合成事实由平台推导并注入契约，而非由主 Agent 猜）。
function compositingOf(ctx, scopeId) {
  try {
    var existing = readProject(ctx, scopeId);
    var project = existing && existing.project;
    if (!project || !Array.isArray(project.scenes) || project.scenes.length === 0) return { overMedia: false };
    var scene = project.scenes[0];
    if (project.currentSceneId) {
      for (var s = 0; s < project.scenes.length; s++) {
        if (project.scenes[s].id === project.currentSceneId) { scene = project.scenes[s]; break; }
      }
    }
    var tracks = scene && scene.tracks;
    if (!tracks) return { overMedia: false };
    var all = [];
    if (tracks.main) all.push(tracks.main);
    all = all.concat(tracks.overlay || []).concat(tracks.audio || []);
    for (var i = 0; i < all.length; i++) {
      var els = (all[i] && all[i].elements) || [];
      for (var e = 0; e < els.length; e++) {
        var type = els[e].type;
        if (type === "video" || type === "image") return { overMedia: true };
      }
    }
    return { overMedia: false };
  } catch (_) {
    return { overMedia: false };
  }
}

function buildRevisePrompt(input) {
  return COMPONENT_AUTHOR_HEADER +
    "Produce a new version of the existing component. Current source is provided only as a reference. Preserve its public inputs and visual identity unless the instruction requires otherwise. Fix the following request:\n" +
    (input.instruction || "") + "\n\nCurrent source:\n" + (input.source || "");
}

/**
 * 受限子 Agent 创建（component.create，subAgent op）：
 * - 无 subAgentTools：authorize——返回 {subAgent:{allowedTools,prompt}}（上下文+工具范围由 background 声明）；
 * - 带 subAgentTools：finalize——平台通用 runner 跑完子 Agent 后回传 commit 结果，轻量验证进素材库。
 */
recut.operation.register("component.create", (input, ctx) => {
  var scopeId = scope(ctx);
  ensureSchema(ctx, scopeId);
  if (input && Array.isArray(input.subAgentTools)) {
    return finalizeComponentCommits(ctx, scopeId, input.subAgentTools, (input && input.items) || [], "create");
  }
  var items = Array.isArray(input && input.items) ? input.items : [];
  if (items.length === 0) throw new Error("component.create: items required");
  var canvas = canvasOf(ctx, scopeId);
  var composition = compositingOf(ctx, scopeId);
  var prompt = buildCreatePrompt(items, canvas, composition);
  // 单 job 会话的组件形态：取首项 mode（常见为统一）；混合场景由 finalize 按项修正。
  var mode = items[0] && items[0].mode === "fullscreen" ? "fullscreen" : "local";
  // 超时按 op 可配（rfc/2026-08-19 P0-1）：按 items 数预估作者预算，缺省兜底 30min。
  var timeoutSeconds = Math.min(1800, Math.max(300, items.length * 150));
  return {
    subAgent: {
      allowedTools: COMPONENT_REQUEST_TOOLS,
      prompt: prompt,
      canvas: canvas,
      timeoutSeconds: timeoutSeconds,
      focused: { mode: mode },
      items: items,
    },
  };
});

/**
 * 受限子 Agent 修订（component.revise，subAgent op）：
 * - 无 subAgentTools：authorize——读取当前 verified head 源码，返回 {subAgent:{allowedTools,prompt,focused}}；
 * - 带 subAgentTools：finalize——验证 commit 结果并更新 head。
 */
recut.operation.register("component.revise", (input, ctx) => {
  var scopeId = scope(ctx);
  ensureSchema(ctx, scopeId);
  if (input && Array.isArray(input.subAgentTools)) {
    return finalizeComponentCommits(ctx, scopeId, input.subAgentTools, [], "revise");
  }
  var componentId = input && input.componentId;
  var instruction = input && input.instruction;
  if (!componentId || !instruction) throw new Error("component.revise: componentId and instruction required");
  var comp = readComponent(ctx, scopeId, componentId);
  if (!comp) throw new Error("component.revise: component not found");
  if (!comp.head_version_id) throw new Error("component.revise: component has no verified head to revise");
  var headRow = readVersion(ctx, scopeId, comp.head_version_id);
  return {
    subAgent: {
      allowedTools: COMPONENT_REQUEST_TOOLS,
      prompt: buildRevisePrompt({ instruction: instruction, source: headRow ? headRow.source : "" }),
      focused: { componentId: componentId, baseVersionId: comp.head_version_id, mode: comp.mode || "local" },
    },
  };
});

/** finalize：把子 Agent 的 component.commit 结果逐个轻量验证，并按 items 顺序回写 mode，返回最终组件列表。 */
function finalizeComponentCommits(ctx, scopeId, subAgentTools, items, mode) {
  var components = [];
  var hasItems = Array.isArray(items) && items.length > 0;
  var itemIndex = 0;
  for (var i = 0; i < subAgentTools.length; i++) {
    var tool = subAgentTools[i] || {};
    if (tool.name !== "recut.editor.component.commit") continue;
    var committed = tool.result || {};
    var versionId = committed.versionId;
    if (!versionId) throw new Error("component commit returned no versionId");
    var row = readVersion(ctx, scopeId, versionId);
    if (!row) throw new Error("component commit version not found: " + versionId);
    // 仅当提供了 items 才按顺序回写 mode（修正混合批次）；否则保留 commit 时经 focused 写入的 mode。
    var itemMode = null;
    if (hasItems) {
      itemMode = (items[itemIndex] && items[itemIndex].mode === "fullscreen") ? "fullscreen" : "local";
      itemIndex += 1;
      ctx.sqlite.execute(
        "update editor_components set mode = ? where component_id = ? and project_id = ?",
        [itemMode, row.component_id, scopeId],
      );
    }
    var report = { ok: true, checks: [{ name: "component-build", pass: true }], frames: [], mode: "headless-code" };
    applyComponentVerify(ctx, scopeId, row, report, true);
    var stored = readComponent(ctx, scopeId, row.component_id);
    components.push({
      assetId: projectAssetId("component", row.component_id),
      componentId: row.component_id,
      versionId: versionId,
      status: "verified",
      mode: (stored && stored.mode) || itemMode || "local",
    });
  }
  if (components.length === 0) throw new Error("component author finished without a component.commit");
  var result = {
    components: components,
    assetIds: components.map(function (component) { return component.assetId; }),
    library: { tab: "media", verification: "code-verified" },
  };
  if (mode === "revise") result.component = components[0];
  return result;
}


/** 应用一份验证报告：ok→verified + head + cover + 聚焦事件；供 component.verify 与子 Agent finalize 共用。 */
function applyComponentVerify(ctx, scopeId, row, report, revealLibrary) {
  var versionId = row.version_id;
  var status = report && report.ok === true ? "verified" : "failed";
  var now = nowIso();
  var coverPath = "";
  var cover = report && report.cover;
  if (status === "verified" && cover && typeof cover.fileBase64 === "string" && cover.fileBase64.length > 0) {
    coverPath = "components/covers/" + versionId + ".png";
    ctx.files.writeBase64(coverPath, cover.fileBase64);
    report.cover = { path: coverPath, mimeType: cover.mimeType || "image/png", width: cover.width || 640, height: cover.height || 360 };
  }
  ctx.sqlite.execute(
    "update editor_component_versions set status = ?, test_report_json = ?, cover_path = ?, verified_at = ? where version_id = ?",
    [status, JSON.stringify(report), coverPath, status === "verified" ? now : null, versionId],
  );
  if (status === "verified") {
    ctx.sqlite.execute(
      "update editor_components set head_version_id = ?, updated_at = ? where component_id = ? and project_id = ?",
      [versionId, now, row.component_id, scopeId],
    );
    upsertProjectAsset(ctx, {
      type: "component",
      refId: row.component_id,
      refVersionId: versionId,
    });
  }
  var event = { componentId: row.component_id, versionId: versionId, status: status };
  if (status === "verified" && revealLibrary === true) {
    event.library = { tab: "media" };
  }
  emitProjectEvent(ctx, scopeId, "project.components.changed", event);
  return {
    assetId: projectAssetId("component", row.component_id),
    versionId: versionId,
    componentId: row.component_id,
    status: status,
    report: report,
  };
}

/** 验证：浏览器 harness 渲染后回传 report（ok→verified 并更新 head）；无 report 时返回当前状态。 */
recut.operation.register("component.verify", (input, ctx) => {
  var scopeId = scope(ctx);
  var versionId = input && input.versionId;
  if (!versionId) {
    throw new Error(loc(ctx, "component.verify: versionId 必填", "component.verify: versionId is required"));
  }
  var row = readVersion(ctx, scopeId, versionId);
  if (!row) {
    throw new Error(loc(ctx, "component.verify: 版本不存在 " + versionId, "component.verify: version not found " + versionId));
  }
  if (input && input.report) {
    return applyComponentVerify(ctx, scopeId, row, input.report, input.revealLibrary === true);
  }
  return {
    assetId: projectAssetId("component", row.component_id),
    versionId: versionId,
    componentId: row.component_id,
    status: row.status,
    report: parseJson(row.test_report_json, null),
  };
});

/** 项目内组件列表（含 head 状态与 inputs，AI 建 clip 时据此构造 params 默认值）。 */
recut.operation.register("component.list", (input, ctx) => {
  var scopeId = scope(ctx);
  ensureSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select c.component_id, c.name, c.surface, c.keywords_json, c.head_version_id, c.mode, " +
      "(select v2.version_id from editor_component_versions v2 " +
        "where v2.component_id = c.component_id order by v2.version desc limit 1) as latest_version_id, " +
      "v.version, v.status, v.inputs_json, v.test_report_json, v.cover_path " +
      "from editor_components c " +
      "left join editor_component_versions v on v.version_id = c.head_version_id " +
      "where c.project_id = ? and (c.archived_at is null or c.archived_at = '') order by c.updated_at desc",
    [scopeId],
  );
  return {
    components: (rows || []).map(function (r) {
      return {
		assetId: projectAssetId("component", r.component_id),
        componentId: r.component_id,
		latestVersionId: r.latest_version_id || null,
		versionId: r.head_version_id || null,
        name: r.name,
        surface: r.surface,
        mode: r.mode || "local",
        keywords: parseJson(r.keywords_json, []),
        version: r.version || null,
        status: r.status || "draft",
        inputs: parseJson(r.inputs_json, []),
        testReport: parseJson(r.test_report_json, null),
        coverUrl: r.cover_path ? ctx.files.url(r.cover_path) : null,
      };
    }),
  };
});

/** 归档组件素材：从素材库隐藏但保留版本与时间线可解析性。 */
recut.operation.register("component.archive", (input, ctx) => {
  var scopeId = scope(ctx);
  var componentId = input && input.componentId;
  if (!componentId) throw new Error("component.archive: componentId is required");
  var component = readComponent(ctx, scopeId, componentId);
  if (!component) throw new Error("component.archive: component not found");
  var now = nowIso();
  ctx.sqlite.execute(
    "update editor_components set archived_at = ?, updated_at = ? where component_id = ? and project_id = ?",
    [now, now, componentId, scopeId],
  );
  archiveProjectAsset(ctx, "component", componentId);
  emitProjectEvent(ctx, scopeId, "project.components.changed", { componentId: componentId, status: "archived" });
  return { ok: true, componentId: componentId, status: "archived" };
});

/** 读某版本源码（AI 二次调整的权威输入）。 */
recut.operation.register("component.source", (input, ctx) => {
  var scopeId = scope(ctx);
  var componentId = input && input.componentId;
  if (!componentId) {
    throw new Error(loc(ctx, "component.source: componentId 必填", "component.source: componentId is required"));
  }
  var component = readComponent(ctx, scopeId, componentId);
  var versionId = input.versionId || (input.head && component ? component.head_version_id : latestVersion(ctx, scopeId, componentId));
  if (!versionId) {
    throw new Error(loc(ctx, "component.source: 无版本 " + componentId, "component.source: no version for " + componentId));
  }
  var row = readVersion(ctx, scopeId, versionId);
  if (!row || row.component_id !== componentId) {
    throw new Error(loc(ctx, "component.source: 无版本 " + componentId, "component.source: no version for " + componentId));
  }
  return { componentId: componentId, versionId: versionId, version: row.version, source: row.source };
});

/**
 * 主 Agent 直接提交源码的新版本（绕过受限子 Agent 的受管入口）。
 * 基于当前 verified head 开新版本；构建通过即轻量 verified 成为新 head，进入素材库，不落轨。
 */
recut.operation.register("component.update", (input, ctx) => {
  var scopeId = scope(ctx);
  var componentId = input && input.componentId;
  var source = input && input.source;
  if (!componentId) throw new Error("component.update: componentId required");
  if (typeof source !== "string" || !source.trim()) throw new Error("component.update: source required");
  var component = readComponent(ctx, scopeId, componentId);
  if (!component) {
    throw new Error("component.update: component not found");
  }
  var baseVersionId = component.head_version_id;
  if (!baseVersionId) {
    // 业务校验失败走结构化错误信封（架构 P2）：Agent 看到 ok:false + code + hint，而非 JSON-RPC 崩溃。
    recut.error({
      kind: "business",
      code: "no-verified-head",
      message: "component.update: component has no verified head to update",
      hint: "该组件当前没有 verified head（可能是 draft/archive）。component.update/component.revise 只能基于 verified head 修改；请对引用的 asset 重新执行 component.create 生成新的 verified 组件，或先经 component.list 确认最新 versionId 后再发起。",
    });
    return; // recut.error 在运行期必抛；此 return 防 stub/降级环境下的静默继续
  }
  var defined = defineComponent({ componentId: componentId, baseVersionId: baseVersionId, source: source, surface: component.surface, name: component.name, keywords: parseJson(component.keywords_json, []), inputs: parseJson((readVersion(ctx, scopeId, baseVersionId) || {}).inputs_json, []) }, ctx);
  if (defined.status !== "draft") {
    return { ok: false, versionId: defined.versionId, status: "failed", buildError: defined.buildError };
  }
  var now = nowIso();
  // 证据戳（架构 P4）：main-agent 直提只做 build-passed 证据；render/composite 级证据由浏览器 harness/
  // preview.frame 另行补齐。无证据不交付：返回 requiresVisualCheck 提醒调用方。
  var report = { ok: true, checks: [{ name: "component-build", pass: true }], mode: "main-agent-update", evidence: { level: "build-passed", by: "component.update" } };
  ctx.sqlite.execute(
    "update editor_component_versions set status = 'verified', test_report_json = ?, verified_at = ? where version_id = ?",
    [JSON.stringify(report), now, defined.versionId],
  );
  ctx.sqlite.execute(
    "update editor_components set head_version_id = ?, updated_at = ? where component_id = ? and project_id = ?",
    [defined.versionId, now, componentId, scopeId],
  );
  upsertProjectAsset(ctx, {
    type: "component",
    refId: componentId,
    refVersionId: defined.versionId,
  });
  emitProjectEvent(ctx, scopeId, "project.components.changed", {
    componentId: componentId, versionId: defined.versionId, status: "verified", origin: "agent-update", library: { tab: "media" },
  });
  return {
    ok: true,
    assetId: projectAssetId("component", componentId),
    componentId: componentId,
    versionId: defined.versionId,
    version: defined.version,
    status: "verified",
    evidence: { level: "build-passed", by: "component.update" },
    requiresVisualCheck: true,
  };
});

/** 解析组件 bundle：iframe loader 用。按 versionId 解析精确版本（harness 验证）；按 ids 解析 head（时间线渲染）。 */
recut.operation.register("component.resolve", (input, ctx) => {
  var scopeId = scope(ctx);
  ensureSchema(ctx, scopeId);
  var out = [];
  if (input && input.versionId) {
    var row = readVersion(ctx, scopeId, input.versionId);
    if (row) {
      var comp = readComponent(ctx, scopeId, row.component_id);
      out.push({
        componentId: row.component_id,
        versionId: row.version_id,
        name: comp ? comp.name : row.component_id,
        surface: comp ? comp.surface : "r3f",
        mode: comp ? comp.mode || "local" : "local",
        status: row.status,
        inputs: parseJson(row.inputs_json, []),
        bundle: row.bundle,
        bundleHash: row.bundle_hash,
        coverUrl: row.cover_path ? ctx.files.url(row.cover_path) : null,
      });
    }
  } else {
    var ids = Array.isArray(input && input.ids) ? input.ids : [];
    for (var i = 0; i < ids.length; i++) {
      var comp2 = readComponent(ctx, scopeId, ids[i]);
      if (!comp2) continue;
      var head = headVersion(ctx, scopeId, ids[i]);
      if (!head) continue; // 无 head → 消费方显示占位
      out.push({
        componentId: ids[i],
        versionId: comp2.head_version_id,
        name: comp2.name,
        surface: comp2.surface,
        mode: comp2.mode || "local",
        status: head.status,
        inputs: parseJson(head.inputs_json, []),
        bundle: head.bundle,
        bundleHash: head.bundle_hash,
        coverUrl: head.cover_path ? ctx.files.url(head.cover_path) : null,
      });
    }
  }
  return { components: out };
});
