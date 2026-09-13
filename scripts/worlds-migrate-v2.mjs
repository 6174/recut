/**
 * worlds-migrate-v2.mjs — 把 v1 世界源目录迁移到 v2（RFC 2026-09-13 world-content-format-v2）。
 *
 * v1: worlds/<slug>/world.json  { world, entities:[{id,kind,title,summary,content}], relations, evidence, provenance }
 * v2: worlds/<slug>/world.json  { sourceVersion:2, world, entityTypes, relations, provenance }
 *     worlds/<slug>/entities/<id>.json          统一实体（typeId/name/intro/detail/attrs）
 *     worlds/<slug>/assets/<id>.json            素材 sidecar（file/kind/name）+ 原二进制不动
 *     worlds/<slug>/canvas.json                 确定性自动布局（实体卡分列栅格）
 *
 * 用法：
 *   node scripts/worlds-migrate-v2.mjs [--check] [--world <slug>] [--canvas]
 *     --check   只打印计划，不写文件（CI 可用）
 *     --world   只迁移一个世界目录
 *     --canvas  只对已是 v2 的世界重排自动画布（不碰实体/素材）
 *
 * 迁移是幂等的：已带 sourceVersion:2 的世界直接跳过。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const canvasOnly = args.includes("--canvas");
const onlyWorld = args.includes("--world") ? args[args.indexOf("--world") + 1] : null;

// 与 service/worlds_canvas.go presetEntityTypeFields 保持一致的字段 schema 子集
// （label/type），用于把 v1 content 键映射成带语义的 locked attrs。
const PRESET_FIELDS = {
  character: {
    appearance: { label: "外貌与标志", type: "textarea" },
    personality: { label: "性格", type: "textarea" },
    voice: { label: "声音", type: "textarea" },
    invariants: { label: "不可变特征", type: "textarea" },
    background: { label: "背景", type: "media" },
  },
  location: {
    description: { label: "描述", type: "textarea" },
    atmosphere: { label: "氛围", type: "textarea" },
    background: { label: "背景", type: "media" },
  },
  object: {
    description: { label: "描述", type: "textarea" },
    material: { label: "材质", type: "text" },
    origin: { label: "来历", type: "textarea" },
    usage: { label: "用途", type: "textarea" },
    moment: { label: "重要时刻", type: "textarea" },
    background: { label: "背景", type: "media" },
  },
  story: {
    premise: { label: "前提", type: "textarea" },
    moment: { label: "关键时刻", type: "textarea" },
    emotion: { label: "情绪", type: "textarea" },
    background: { label: "背景", type: "media" },
  },
  style: {
    visual: { label: "视觉", type: "textarea" },
    guidance: { label: "guidance", type: "textarea" },
    avoid: { label: "避免", type: "textarea" },
    background: { label: "背景", type: "media" },
  },
  rule: {
    text: { label: "规则文本", type: "textarea" },
  },
};

const PURPOSES = {
  identity: "主体",
  appearance: "外貌参考",
  wardrobe: "服装参考",
  voice: "声音参考",
  motion: "动作参考",
  scene: "场景参考",
  mood: "氛围参考",
  visual_style: "风格示例",
  sound_style: "声音风格",
  narrative: "叙事参考",
  rule_evidence: "规则证据",
};

function slug(value, fallback = "asset") {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function pathRelToWorld(worldDir, abs) {
  return relative(worldDir, abs).split(sep).join("/");
}

function attrFor(key, value, typeId) {
  const preset = PRESET_FIELDS[typeId]?.[key];
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (preset) {
    return { key, label: preset.label, type: preset.type, locked: true, value: preset.type === "media" ? value : text };
  }
  return { key, label: key, type: text.length > 80 ? "textarea" : "text", value: text };
}

// 素材 sidecar：{ id, name, kind, file }；file 相对 assets/ 目录（允许 ../examples）。
function assetSidecar(id, name, kind, fileRelToAssets) {
  return { id, name, kind, file: fileRelToAssets };
}

function buildWorld(worldDir, slugName, source) {
  const entities = source.entities ?? [];
  const evidence = source.evidence ?? [];
  const v2World = source.world;

  // 1. 素材包：evidence → assets/<id>.json；二进制保持在原目录。
  const usedAssetIds = new Set();
  const evidenceAssets = new Map(); // evidence index → { assetId, kind, name, file }
  const assetWrites = [];
  evidence.forEach((item, index) => {
    const modality = item.modality === "video" || item.modality === "audio" ? item.modality : "image";
    if (item.modality === "text" || item.modality === "research") return; // 非媒体证据不迁
    const rawUrl = String(item.url ?? "").trim();
    const fileBase = rawUrl.replace(/[?#].*$/, "").split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    // 文件名带足够字母时用文件名（01-two-breakpoints）；否则退回 purpose（visual-style）+ 序号。
    const meaningful = fileBase.replace(/[^a-z]/gi, "").length >= 3 ? fileBase : "";
    const base = slug(meaningful || item.purpose || `${modality}-${index + 1}`, `asset-${index + 1}`);
    let assetId = base;
    let n = 2;
    while (usedAssetIds.has(assetId)) assetId = `${base}-${n++}`;
    usedAssetIds.add(assetId);
    const name = item.label || PURPOSES[item.purpose] || assetId;
    if (/^https?:\/\//i.test(rawUrl)) {
      // 已在远程：不落本地包，实体 attr 直接内联 {url}。
      evidenceAssets.set(index, { assetId, kind: modality, name, inlineUrl: rawUrl });
      return;
    }
    // 相对路径：sidecar 的 file 相对 assets/ 目录。
    const fromAssets = rawUrl.startsWith("assets/") ? rawUrl.slice("assets/".length) : `../${rawUrl}`;
    evidenceAssets.set(index, { assetId, kind: modality, name, file: rawUrl });
    assetWrites.push({ assetId, sidecar: assetSidecar(assetId, name, modality, fromAssets) });
  });

  // 2. 实体文件：content → detail + attrs；evidence → media attrs。
  const evidenceByEntity = new Map();
  evidence.forEach((item, index) => {
    const mapped = evidenceAssets.get(index);
    if (!mapped) return;
    const key = item.entityId || entities[0]?.id || "";
    if (!key) return;
    (evidenceByEntity.get(key) ?? evidenceByEntity.set(key, []).get(key)).push(mapped);
  });

  const entityFiles = entities.map((entity) => {
    const typeId = entity.kind || "object";
    const content = entity.content ?? {};
    let detail = "";
    const attrs = [];
    for (const [key, value] of Object.entries(content)) {
      if (key === "body") {
        if (value && typeof value === "object" && value.$file) {
          // detail $file：路径改写成相对 entities/ 目录
          detail = { $file: `../${value.$file}` };
        } else {
          detail = typeof value === "string" ? value : JSON.stringify(value);
        }
        continue;
      }
      attrs.push(attrFor(key, value, typeId));
    }
    for (const media of evidenceByEntity.get(entity.id) ?? []) {
      const value = media.inlineUrl
        ? { url: media.inlineUrl, kind: media.kind, name: media.name }
        : { asset: media.assetId, kind: media.kind, name: media.name };
      attrs.push({ key: `media-${media.assetId}`, label: media.name, type: "media", value });
    }
    const record = {
      id: entity.id,
      typeId,
      name: entity.title ?? entity.id,
      intro: entity.summary ?? "",
    };
    if (detail) record.detail = detail;
    if (entity.parentId) record.parentId = entity.parentId;
    if (entity.containerRole) record.containerRole = entity.containerRole;
    if (entity.isProvisional) record.isProvisional = true;
    record.attrs = attrs;
    return { id: entity.id, record };
  });

  // 3. 自动画布：按类型分带布局（见 buildAutoCanvas）。
  const topLevel = entityFiles.filter((entity) => !entity.record.parentId);
  const canvas = buildAutoCanvas(topLevel.map((entity) => entity.record));

  const v2 = {
    sourceVersion: 2,
    ...(source.version ? { version: source.version } : {}),
    world: v2World,
    entityTypes: source.entityTypes ?? [],
    relations: source.relations ?? [],
    provenance: source.provenance ?? undefined,
  };
  return { v2, entityFiles, assetWrites, canvas };
}

function writeJSON(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

// 类型带顺序：角色/物件在前（创作者最关心），规则/风格在后；未知类型排末尾。
const TYPE_BANDS = ["character", "object", "location", "story", "style", "rule"];
const CARD = { width: 264, height: 328 };
const BAND_COLS = 4;
const CARD_GAP_X = 320;
const CARD_GAP_Y = 388;
const BAND_GAP = 96;
const ORIGIN = 40;

/** 确定性自动布局：按 typeId 分带（每带最多 4 列），带间留白，角色置顶。 */
function buildAutoCanvas(records) {
  const groups = new Map();
  for (const record of records) {
    const typeId = record.typeId || "object";
    if (!groups.has(typeId)) groups.set(typeId, []);
    groups.get(typeId).push(record);
  }
  const orderedTypes = [
    ...TYPE_BANDS.filter((type) => groups.has(type)),
    ...[...groups.keys()].filter((type) => !TYPE_BANDS.includes(type)),
  ];
  const elements = [];
  let y = ORIGIN;
  for (const type of orderedTypes) {
    const group = groups.get(type);
    group.forEach((record, index) => {
      const col = index % BAND_COLS;
      const row = Math.floor(index / BAND_COLS);
      elements.push({
        id: `shape:${record.id}`,
        kind: "entity",
        refKind: "entity",
        refId: record.id,
        name: record.name,
        props: { collapsed: false },
        geometry: { x: ORIGIN + col * CARD_GAP_X, y: y + row * CARD_GAP_Y, ...CARD, zIndex: 1 },
        style: {},
        layer: "0",
      });
    });
    y += Math.ceil(group.length / BAND_COLS) * CARD_GAP_Y + BAND_GAP;
  }
  return { docVersion: 1, canvases: elements.length ? [{ contextId: "", elements }] : [] };
}

/** 读取已迁移世界的实体（用于 --canvas 重排）。 */
function readV2EntityRecords(worldDir) {
  const dir = join(worldDir, "entities");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")))
    .map((record) => ({ id: record.id, typeId: record.typeId || "object", name: record.name ?? record.id, parentId: record.parentId }))
    .filter((record) => !record.parentId);
}

function main() {
  const worldsRoot = join(repoRoot, "worlds");
  const dirs = readdirSync(worldsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !onlyWorld || name === onlyWorld)
    .sort();

  let migrated = 0;
  let regenerated = 0;
  for (const name of dirs) {
    const worldDir = join(worldsRoot, name);
    const worldJson = join(worldDir, "world.json");
    if (!existsSync(worldJson)) continue;
    const source = JSON.parse(readFileSync(worldJson, "utf8"));
    if (source.sourceVersion === 2) {
      if (canvasOnly) {
        const records = readV2EntityRecords(worldDir);
        const canvas = buildAutoCanvas(records);
        console.log(`↻ ${name}: 重排画布 ${records.length} 卡（${canvas.canvases[0]?.elements.length ?? 0} 元素）`);
        if (!checkOnly) writeJSON(join(worldDir, "canvas.json"), canvas);
        regenerated += 1;
      } else {
        console.log(`· skip ${name}（已是 v2）`);
      }
      continue;
    }
    if (canvasOnly) {
      console.log(`· skip ${name}（未迁移，先跑迁移）`);
      continue;
    }
    const { v2, entityFiles, assetWrites, canvas } = buildWorld(worldDir, name, source);
    console.log(`→ ${name}: ${entityFiles.length} entities, ${assetWrites.length} assets, ${canvas.canvases[0]?.elements.length ?? 0} canvas cards`);
    if (checkOnly) continue;
    mkdirSync(join(worldDir, "entities"), { recursive: true });
    mkdirSync(join(worldDir, "assets"), { recursive: true });
    for (const entity of entityFiles) {
      writeJSON(join(worldDir, "entities", `${entity.id}.json`), entity.record);
    }
    for (const asset of assetWrites) {
      writeJSON(join(worldDir, "assets", `${asset.assetId}.json`), asset.sidecar);
    }
    writeJSON(join(worldDir, "canvas.json"), canvas);
    writeJSON(worldJson, v2);
    migrated += 1;
  }
  if (canvasOnly) {
    console.log(checkOnly ? `✓ --check 完成（未写文件，${regenerated} 个世界可重排）` : `✓ 画布重排完成：${regenerated} 个世界`);
  } else {
    console.log(checkOnly ? "✓ --check 完成（未写文件）" : `✓ 迁移完成：${migrated} 个世界`);
  }
}

main();
