/*
 * [INPUT]: 依赖平台注入的 ctx.sqlite、ctx.files、ctx.media.materialize/importFile、ctx.artifacts.publish 与受限 ctx.shell
 * [OUTPUT]: 注册 Brief、设计（composition）保存/查询/原位更新、静态目录、本地 Remotion 渲染环境准备与后台导出任务、任务状态与取消的 App API 与 MCP 工具处理器
 * [POS]: remotion-studio 的唯一业务后端；数据表与导出记录由本 App 自己定义，浏览器实时预览由 UI 内嵌 Remotion Player 完成，最终渲染委托本地 Node 渲染工作区 + 平台 Asset 归档
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

function id() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureSchema(ctx) {
  ctx.sqlite.execute("create table if not exists briefs (id text primary key, template text not null, topic text not null, details text not null, expected_duration_sec real not null, material_json text not null, created_at text not null)");
  ctx.sqlite.execute("create table if not exists designs (id text primary key, brief_id text not null, title text not null, content_json text not null, dependencies_json text not null, created_at text not null, updated_at text not null, retired_at text)");
  ctx.sqlite.execute("create table if not exists exports (render_id text primary key, design_id text not null, shell_job_id text not null, status text not null, label text not null, settings_json text not null, asset_id text, error text, created_at text not null, updated_at text not null)");
  ctx.sqlite.execute("create table if not exists app_meta (key text primary key, value text not null)");
}

const STYLE_TEMPLATES = {
  "paper-collage": {
    label: "纸拼贴编辑风",
    description: "纸质拼贴、编辑杂志感；适合解说、知识与观点内容",
    style: {
      background: "#f4efe7",
      primary: "#14120f",
      accent: "#c46a2b",
      text: "#14120f",
      fontFamily: "Georgia, 'Times New Roman', serif",
      captionTheme: "simple-one-word",
      captionPrimary: "#14120f",
      captionSecondary: "#c46a2b",
      effectId: "noise-grain",
    },
    motion: "低能量、缓慢推进、落定后呼吸；像一篇会动的杂志文章",
  },
  "cinematic-dark": {
    label: "电影感深色",
    description: "深色背景、星空与粒子光效；适合产品、故事与情绪化内容",
    style: {
      background: "#0b0b12",
      primary: "#f5f2ea",
      accent: "#e8b341",
      text: "#f5f2ea",
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      captionTheme: "kinetic-01",
      captionPrimary: "#f5f2ea",
      captionSecondary: "#e8b341",
      effectId: "starfield",
    },
    motion: "聚光→推进→悬浮；单一主角完整动作弧",
  },
  "clean-editorial": {
    label: "简洁杂志排版",
    description: "几何背景、大字排版；适合新闻、教育、报告类内容",
    style: {
      background: "#f7f7f4",
      primary: "#111314",
      accent: "#1d5bd6",
      text: "#111314",
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      captionTheme: "pop",
      captionPrimary: "#111314",
      captionSecondary: "#1d5bd6",
      effectId: "geometric",
    },
    motion: "直线滑动、克制的过冲；信息先于装饰",
  },
  "vibrant-tech": {
    label: "科技活力风",
    description: "渐变色块、高能量运动；适合产品发布、演示与社交媒体",
    style: {
      background: "#12002a",
      primary: "#ffffff",
      accent: "#22d3ee",
      text: "#ffffff",
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      captionTheme: "hustle",
      captionPrimary: "#ffffff",
      captionSecondary: "#22d3ee",
      effectId: "gradient-shift",
    },
    motion: "高能量入场、轻微过冲；批量元素靠运动本身表达",
  },
};

const CAPTION_THEMES = [
  { id: "pop", label: "Pop 弹入", description: "缩放弹入，清爽通用" },
  { id: "karaoke", label: "Karaoke 扫光", description: "逐词高亮扫过，适合歌词式字幕" },
  { id: "kinetic-01", label: "Kinetic 动能排版", description: "主词放大、侧词对齐的动能排版" },
  { id: "kinetic-02", label: "Kinetic 变体", description: "动能排版第二套" },
  { id: "hustle", label: "Hustle 快节奏", description: "快速进入，活力十足" },
  { id: "grape", label: "Grape 圆角盒", description: "圆角色块背景字幕" },
  { id: "beast", label: "Beast 粗体高对比", description: "粗体加高对比阴影" },
  { id: "poppin", label: "Poppin 大写字幕", description: "全大写 Poppins 字体" },
  { id: "aarit", label: "Aarit 逐字缩放", description: "电影感逐字缩放与渐变扫光" },
  { id: "soft-ai", label: "Soft AI 毛玻璃", description: "磨砂玻璃模糊进入" },
  { id: "gaming-stream", label: "Gaming 霓虹", description: "霓虹发光游戏风格" },
  { id: "simple-one-word", label: "单字聚焦", description: "每次只高亮一个词" },
  { id: "podcast", label: "Podcast 播客", description: "播客风格的段落字幕" },
];

const EFFECTS = [
  { id: "starfield", label: "星空粒子", kind: "background", description: "粒子从中心向外扩散" },
  { id: "geometric", label: "几何图案", kind: "background", description: "旋转缩放的几何形" },
  { id: "bokeh", label: "光斑", kind: "background", description: "漂浮柔和的圆形光斑" },
  { id: "liquid-wave", label: "液态波浪", kind: "background", description: "流动的液态波浪背景" },
  { id: "noise-grain", label: "胶片颗粒", kind: "background", description: "细微颗粒质感，配纸拼贴" },
  { id: "gradient-shift", label: "渐变流动", kind: "background", description: "流动的渐变色彩" },
  { id: "matrix-rain", label: "数字雨", kind: "background", description: "矩阵字符下落" },
  { id: "bounce-text", label: "弹跳文字", kind: "text", description: "逐字弹跳入场的标题" },
  { id: "typewriter", label: "打字机", kind: "text", description: "逐字打出的标题与光标" },
  { id: "glitch", label: "故障文字", kind: "text", description: "RGB 分离的故障标题" },
  { id: "cinematic-title", label: "电影开场字", kind: "text", description: "大写字距拉开的高级开场字" },
  { id: "slide-text", label: "滑入文字", kind: "text", description: "方向性滑入标题" },
  { id: "ken-burns", label: "慢推镜头", kind: "image", description: "画面缓慢推近，默认图片运镜" },
];

const CANVAS_SIZES = [
  { id: "1080p", label: "1080p 横屏", width: 1920, height: 1080, fps: 30 },
  { id: "vertical", label: "1080×1920 竖屏", width: 1080, height: 1920, fps: 30 },
  { id: "square", label: "1080×1080 方形", width: 1080, height: 1080, fps: 30 },
];

function catalog(_, ctx) {
  ensureSchema(ctx);
  return { styleTemplates: STYLE_TEMPLATES, captionThemes: CAPTION_THEMES, effects: EFFECTS, canvasSizes: CANVAS_SIZES };
}

function createBrief(input, ctx) {
  ensureSchema(ctx);
  const template = String(input.template || "").trim();
  const topic = String(input.topic || "").trim();
  if (!template || !STYLE_TEMPLATES[template]) throw new Error("template 必须选择一个有效的风格模板");
  if (!topic) throw new Error("topic 是必填项");
  const details = String(input.details ?? "").trim();
  const expectedDurationSec = input.expectedDurationSec === undefined ? 60 : Number(input.expectedDurationSec);
  if (!Number.isFinite(expectedDurationSec) || expectedDurationSec <= 0) throw new Error("expectedDurationSec 必须是正数");
  const materialAssetIds = Array.isArray(input.materialAssetIds) ? input.materialAssetIds.filter((value) => typeof value === "string" && Boolean(value.trim())) : [];
  const brief = {
    id: id(),
    template,
    topic,
    details,
    expectedDurationSec,
    materialAssetIds,
    createdAt: new Date().toISOString(),
  };
  ctx.sqlite.execute("insert into briefs (id, template, topic, details, expected_duration_sec, material_json, created_at) values (?, ?, ?, ?, ?, ?, ?)", [brief.id, template, topic, details, expectedDurationSec, JSON.stringify(materialAssetIds), brief.createdAt]);
  return ctx.artifacts.publish({ type: "recut.remotion-studio.brief@1", value: brief });
}

function latestBrief(_, ctx) {
  ensureSchema(ctx);
  const rows = ctx.sqlite.query("select id, template, topic, details, expected_duration_sec, material_json, created_at from briefs order by created_at desc limit 1");
  if (!rows.length) return null;
  const row = rows[0];
  return { id: row.id, template: row.template, topic: row.topic, details: row.details, expectedDurationSec: row.expected_duration_sec, materialAssetIds: JSON.parse(row.material_json), createdAt: row.created_at };
}

const designContract = {
  output: { title: "string", durationSec: "number", template: "string", style: "object", scenes: "array" },
  optional: { width: "number", height: "number", fps: "number" },
  styleFields: { background: "string", primary: "string", accent: "string", text: "string", fontFamily: "string", captionTheme: "string", captionPrimary: "string", captionSecondary: "string", effectId: "string", bgmAssetId: "string" },
  sceneRequired: ["id", "kind", "title", "durationSec"],
  sceneOptional: ["narration", "caption", "imageAssetId", "effectId"],
};

function hasValue(value) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function hasExpectedType(value, type) {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  return true;
}

function validateDesign(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("design 必须是对象");
  const missing = Object.keys(designContract.output).filter((field) => !hasValue(content[field]));
  if (missing.length) throw new Error(`design 缺少必填字段：${missing.join(", ")}`);
  const invalid = Object.entries(designContract.output).filter(([field, type]) => !hasExpectedType(content[field], type)).map(([field]) => field);
  if (invalid.length) throw new Error(`design 字段类型错误：${invalid.join(", ")}`);
  if (!Number.isFinite(content.durationSec) || content.durationSec <= 0 || content.durationSec > 3600) throw new Error("design.durationSec 必须是 1–3600 秒");
  const sceneTotal = (Array.isArray(content.scenes) ? content.scenes : []).reduce((sum, scene) => sum + Number(scene?.durationSec || 0), 0);
  if (Math.abs(sceneTotal - content.durationSec) > 2) throw new Error(`design.scenes 时长之和(${sceneTotal.toFixed(1)})与 durationSec(${content.durationSec})不一致`);
  if (!content.style || typeof content.style !== "object") throw new Error("design.style 必须是对象");
  if (content.template && !STYLE_TEMPLATES[content.template]) throw new Error(`未知风格模板：${content.template}`);
  const styleInvalid = Object.entries(content.style).filter(([field]) => designContract.styleFields[field] !== undefined && !hasExpectedType(content.style[field], designContract.styleFields[field])).map(([field]) => field);
  if (styleInvalid.length) throw new Error(`design.style 字段类型错误：${styleInvalid.join(", ")}`);
  if (content.style.captionTheme && !CAPTION_THEMES.some((theme) => theme.id === content.style.captionTheme)) throw new Error(`未知字幕主题：${content.style.captionTheme}`);
  (Array.isArray(content.scenes) ? content.scenes : []).forEach((scene, index) => {
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) throw new Error(`design.scenes[${index}] 必须是对象`);
    const sceneMissing = designContract.sceneRequired.filter((field) => !hasValue(scene[field]));
    if (sceneMissing.length) throw new Error(`design.scenes[${index}] 缺少必填字段：${sceneMissing.join(", ")}`);
    if (!["title", "content", "outro"].includes(scene.kind)) throw new Error(`design.scenes[${index}].kind 必须是 title/content/outro`);
    if (scene.caption && (typeof scene.caption !== "object" || !hasValue(scene.caption.text))) throw new Error(`design.scenes[${index}].caption 必须是 {text,...}`);
    if (!Number.isFinite(scene.durationSec) || scene.durationSec <= 0) throw new Error(`design.scenes[${index}].durationSec 必须是正数`);
  });
  return true;
}

function designByID(ctx, id) {
  const rows = ctx.sqlite.query("select id, brief_id, title, content_json, dependencies_json, created_at, updated_at from designs where id = ? and retired_at is null", [id]);
  if (!rows.length) throw new Error(`design ${id} 不存在`);
  const row = rows[0];
  return { id: row.id, briefId: row.brief_id, title: row.title, content: JSON.parse(row.content_json), dependencies: JSON.parse(row.dependencies_json), createdAt: row.created_at, updatedAt: row.updated_at };
}

function latestDesign(designId, ctx) {
  if (designId) return designByID(ctx, String(designId));
  const rows = ctx.sqlite.query("select id from designs where retired_at is null order by created_at desc limit 1");
  if (!rows.length) return null;
  return designByID(ctx, rows[0].id);
}

function saveComposition(input, ctx) {
  ensureSchema(ctx);
  if (!input.content || typeof input.content !== "object") throw new Error("content 必须是结构化设计正文");
  validateDesign(input.content);
  const brief = latestBrief({}, ctx);
  const design = {
    id: id(),
    briefId: brief ? brief.id : "",
    title: String(input.title || input.content.title || "未命名设计"),
    content: input.content,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  ctx.sqlite.execute("insert into designs (id, brief_id, title, content_json, dependencies_json, created_at, updated_at, retired_at) values (?, ?, ?, ?, ?, ?, ?, null)", [design.id, design.briefId, design.title, JSON.stringify(design.content), JSON.stringify(design.dependencies), design.createdAt, design.updatedAt]);
  return ctx.artifacts.publish({ type: "recut.remotion-studio.design@1", value: design });
}

function readComposition(input, ctx) {
  ensureSchema(ctx);
  const id = String(input.id || "").trim();
  if (!id) throw new Error("design id 是必填项");
  return designByID(ctx, id);
}

function findItemIndex(items, match) {
  if (!Array.isArray(items)) return -1;
  const id = String(match?.id || "").trim();
  if (!id) throw new Error("itemPatch.match 需要 id");
  return items.findIndex((item) => item && typeof item === "object" && item.id === id);
}

function updateComposition(input, ctx) {
  ensureSchema(ctx);
  const id = String(input.id || "").trim();
  if (!id) throw new Error("design id 是必填项");
  const resource = designByID(ctx, id);
  const contentPatch = input.contentPatch && typeof input.contentPatch === "object" && !Array.isArray(input.contentPatch) ? input.contentPatch : null;
  const itemPatch = input.itemPatch && typeof input.itemPatch === "object" && !Array.isArray(input.itemPatch) ? input.itemPatch : null;
  if (!contentPatch && !itemPatch && !String(input.title || "").trim()) throw new Error("composition.update 需要 title、contentPatch 或 itemPatch");
  const content = JSON.parse(JSON.stringify(resource.content));
  if (contentPatch) Object.assign(content, contentPatch);
  if (itemPatch) {
    const collection = String(itemPatch.collection || "").trim();
    const patch = itemPatch.patch;
    if (collection !== "scenes" || !patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("itemPatch.collection 必须为 scenes 且带对象 patch");
    const index = findItemIndex(content.scenes, itemPatch.match);
    if (index < 0) throw new Error(`scenes 中没有匹配 id 的 scene`);
    content.scenes[index] = { ...content.scenes[index], ...patch };
  }
  validateDesign(content);
  const title = String(input.title || "").trim() || resource.title;
  const now = new Date().toISOString();
  ctx.sqlite.execute("update designs set title = ?, content_json = ?, updated_at = ? where id = ?", [title, JSON.stringify(content), now, id]);
  const updated = { ...resource, title, content, updatedAt: now };
  return ctx.artifacts.publish({ type: "recut.remotion-studio.design@1", value: updated });
}

function latestComposition(_, ctx) {
  ensureSchema(ctx);
  const design = latestDesign(null, ctx);
  return design ? { design, brief: latestBrief({}, ctx) } : null;
}

function listDesigns(_, ctx) {
  ensureSchema(ctx);
  return ctx.sqlite.query("select id, brief_id, title, created_at, updated_at from designs order by created_at desc").map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at }));
}

function workflowContext(_, ctx) {
  ensureSchema(ctx);
  const brief = latestBrief({}, ctx);
  const design = latestDesign(null, ctx);
  const stage = !brief ? "brief" : !design ? "design" : "preview";
  const allowedActions = stage === "brief" ? ["create_brief"] : stage === "design" ? ["create_design"] : ["preview_design", "update_design", "export"];
  return {
    revision: `${stage}:${brief?.createdAt || "none"}:${design?.updatedAt || "none"}`,
    stage,
    nextAction: stage === "preview" ? "preview_design" : stage === "brief" ? "create_brief" : "create_design",
    brief,
    design: design ? design.content : null,
    designResource: design ? { id: design.id, title: design.title, updatedAt: design.updatedAt } : null,
    resourceContracts: {
      design: {
        inputs: ["brief", "material assets", "style template"],
        output: { title: "string", durationSec: "number", template: "string", style: "object", scenes: "Scene[]" },
        optional: { width: "number", height: "number", fps: "number" },
        style: { background: "string", primary: "string", accent: "string", text: "string", fontFamily: "string", captionTheme: "string", captionPrimary: "string", captionSecondary: "string", effectId: "string", bgmAssetId: "string" },
        scene: { required: ["id", "kind", "title", "durationSec"], optional: ["narration", "caption", "imageAssetId", "effectId"], kinds: ["title", "content", "outro"] },
      },
    },
    catalogs: { styleTemplates: STYLE_TEMPLATES, captionThemes: CAPTION_THEMES, effects: EFFECTS, canvasSizes: CANVAS_SIZES },
    allowedActions,
    mediaExecution: {
      design: { kind: "structured-composition", generate: "把 Brief、风格模板与素材资产编排为可实时预览的 Remotion 合成：场景脚本、字幕主题、背景特效与媒体引用", complete: "composition.save 保存通过校验的 design，UI 即开始实时预览" },
    },
  };
}

function collectAssetIds(design) {
  const assetIds = [];
  const push = (assetId) => { if (typeof assetId === "string" && assetId.trim() && !assetIds.includes(assetId)) assetIds.push(assetId); };
  const style = design?.style || {};
  push(style.bgmAssetId);
  (Array.isArray(design?.scenes) ? design.scenes : []).forEach((scene) => push(scene.imageAssetId));
  return assetIds;
}

function renderSetup(_, ctx) {
  ensureSchema(ctx);
  const node = ctx.shell.run({ command: "node", args: ["--version"], timeoutSeconds: 30 });
  const checks = { node: node.exitCode === 0 ? { ok: true, version: String(node.stdout || "").trim() } : { ok: false, error: node.error || "node 不可用，请先安装 Node.js 18+" } };
  if (checks.node.ok) {
    const deps = ctx.shell.run({ command: "node", args: ["render/node-check.js"], timeoutSeconds: 180 });
    if (deps.exitCode === 0) {
      checks.renderWorkspace = { ok: true };
    } else {
      let install = ctx.shell.run({ command: "npm", args: ["ci", "--prefix", "render", "--no-audit", "--no-fund"], timeoutSeconds: 1800 });
      if (install.exitCode !== 0) {
        install = ctx.shell.run({ command: "npm", args: ["install", "--prefix", "render", "--no-audit", "--no-fund"], timeoutSeconds: 1800 });
      }
      checks.renderWorkspace = install.exitCode === 0 ? { ok: true } : { ok: false, error: install.error || "npm 依赖安装失败" };
    }
  }
  const ready = Object.values(checks).every((item) => item && item.ok);
  return { ready, checks };
}

function renderExport(input, ctx) {
  ensureSchema(ctx);
  const design = latestDesign(input.designId, ctx);
  if (!design) throw new Error("没有可导出的设计，请先让 AI 完成设计");
  const renderId = id();
  const now = new Date().toISOString();
  const width = Number(input.width || design.content.width || 1920);
  const height = Number(input.height || design.content.height || 1080);
  const fps = Number(input.fps || design.content.fps || 30);
  if (![24, 30].includes(fps)) throw new Error("fps 必须是 24 或 30");
  const codec = String(input.codec || "h264");
  const label = String(input.label || "remotion 渲染导出");

  const media = {};
  collectAssetIds(design.content).forEach((assetId) => {
    const materialized = ctx.media.materialize(assetId);
    media[assetId] = { kind: materialized.kind, mimeType: materialized.mimeType, path: materialized.path };
  });

  const payload = { design: design.content, media, settings: { width, height, fps, codec } };
  ctx.files.writeText(`exports/${renderId}/props.json`, JSON.stringify(payload));
  ctx.files.writeText(`exports/${renderId}/progress.json`, JSON.stringify({ phase: "queued", progress: 0, message: "任务已排队" }));

  const job = ctx.shell.start({ command: "node", args: ["render/render.js", "--renderId", renderId], timeoutSeconds: 3600 });
  const settings = { width, height, fps, codec, label };
  ctx.sqlite.execute("insert into exports (render_id, design_id, shell_job_id, status, label, settings_json, asset_id, error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [renderId, design.id, job.id, "queued", label, JSON.stringify(settings), null, null, now, now]);
  return { renderId, shellJobId: job.id, status: "queued", designId: design.id };
}

function exportRow(ctx, renderId) {
  const rows = ctx.sqlite.query("select render_id, design_id, shell_job_id, status, label, settings_json, asset_id, error, created_at, updated_at from exports where render_id = ?", [renderId]);
  if (!rows.length) throw new Error(`渲染任务 ${renderId} 不存在`);
  const row = rows[0];
  return { renderId: row.render_id, designId: row.design_id, shellJobId: row.shell_job_id, status: row.status, label: row.label, settings: JSON.parse(row.settings_json), assetId: row.asset_id, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at };
}

function renderStatus(input, ctx) {
  ensureSchema(ctx);
  const renderId = String(input.renderId || "").trim();
  if (!renderId) throw new Error("renderId 是必填项");
  const record = exportRow(ctx, renderId);
  if (record.status === "completed" || record.status === "cancelled" || record.status === "failed") {
    return { renderId, status: record.status, assetId: record.assetId, error: record.error, label: record.label, settings: record.settings };
  }
  const job = ctx.shell.status(record.shellJobId);
  let progress = null;
  try { progress = JSON.parse(ctx.files.readText(`exports/${renderId}/progress.json`)); } catch (_) { /* 尚未写入进度文件 */ }
  if (job.status === "completed") {
    if (!record.assetId) {
      const asset = ctx.media.importFile({ path: `exports/${renderId}/out.mp4`, name: record.label + ".mp4", mimeType: "video/mp4" });
      const now = new Date().toISOString();
      ctx.sqlite.execute("update exports set status = 'completed', asset_id = ?, updated_at = ? where render_id = ?", [asset.id, now, renderId]);
      return { renderId, status: "completed", assetId: asset.id, progress, label: record.label, settings: record.settings };
    }
    return { renderId, status: "completed", assetId: record.assetId, progress, label: record.label, settings: record.settings };
  }
  if (job.status === "failed" || job.status === "interrupted" || job.status === "cancelled") {
    const now = new Date().toISOString();
    const error = job.error || (job.status === "cancelled" ? "渲染任务已取消" : "渲染失败，请查看渲染日志");
    ctx.sqlite.execute("update exports set status = ?, error = ?, updated_at = ? where render_id = ?", [job.status, error, now, renderId]);
    return { renderId, status: job.status, error, progress, label: record.label, settings: record.settings };
  }
  return { renderId, status: job.status, progress, label: record.label, settings: record.settings };
}

function renderCancel(input, ctx) {
  ensureSchema(ctx);
  const renderId = String(input.renderId || "").trim();
  if (!renderId) throw new Error("renderId 是必填项");
  const record = exportRow(ctx, renderId);
  if (record.status === "queued" || record.status === "running") {
    ctx.shell.cancel(record.shellJobId);
  }
  const now = new Date().toISOString();
  ctx.sqlite.execute("update exports set status = 'cancelled', updated_at = ? where render_id = ?", [now, renderId]);
  return { renderId, status: "cancelled" };
}

function listExports(_, ctx) {
  ensureSchema(ctx);
  return ctx.sqlite.query("select render_id, design_id, status, label, settings_json, asset_id, error, created_at from exports order by created_at desc").map((row) => ({ renderId: row.render_id, status: row.status, label: row.label, settings: JSON.parse(row.settings_json), assetId: row.asset_id, error: row.error, createdAt: row.created_at }));
}

recut.operation.register("project.create", createBrief);
recut.operation.register("brief.latest", latestBrief);
recut.operation.register("workflow.context", workflowContext);
recut.operation.register("catalog.list", catalog);
recut.operation.register("composition.save", saveComposition);
recut.operation.register("composition.read", readComposition);
recut.operation.register("composition.update", updateComposition);
recut.operation.register("composition.latest", latestComposition);
recut.operation.register("design.list", listDesigns);
recut.operation.register("render.setup", renderSetup);
recut.operation.register("render.export", renderExport);
recut.operation.register("render.status", renderStatus);
recut.operation.register("render.cancel", renderCancel);
recut.operation.register("export.list", listExports);
