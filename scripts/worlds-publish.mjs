/**
 * 平台 World 发布构建脚本（v2，RFC 2026-09-13 world-content-format-v2）。
 *
 * 源格式 worlds/<slug>/（world.json + entities/*.json + assets/*.json + canvas.json + world.md）
 * → 发布格式 cdn/buckets/worlds/<id>/<version>/world.json（单文件自包含 manifest v2，
 *   确定性序列化）+ 镜像资源 + cdn/buckets/worlds/catalog.json。
 *
 * 用法：
 *   node scripts/worlds-publish.mjs [--check] [--seed] [--upload]
 *     --check        只校验并打印 canonical/manifest hash 预览（CI 防漂移；不发 CDN）
 *     --seed         同时把最新 pgc.* 发布产物与 catalog 写入 service/worldcatalog/
 *     --upload       构建后增量上传到 R2（只传新版本目录 + catalog；--skip-existing）
 *
 * 构建期硬校验：schema、closed 集合、ID/引用完整性（parentId/relations/media asset id/
 * canvas refId）、预算（skillMd ≤16KB / detail 合计 ≤16KB / attrs ≤200/实体 / canvases
 * 元素 ≤2000 / manifest ≤2MB）、$file 与资源路径必须位于世界目录内、媒体引用展开为 CDN 绝对 URL。
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const withSeed = args.includes("--seed");
const withUpload = args.includes("--upload");

// --- budgets（与 service 物化器一致）---------------------------------------
const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
const SKILL_MD_MAX_BYTES = 16 * 1024;
const ENTITY_DETAIL_MAX_BYTES = 16 * 1024;
const ENTITY_ATTR_MAX = 200;
const CANVAS_ELEMENT_MAX = 2000;

const WORLD_TYPES = new Set(["character_ip", "creator_brand", "brand", "fiction_world", "custom"]);
const ATTR_TYPES = new Set(["text", "textarea", "number", "boolean", "select", "media"]);
const ENTITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const IS_ABSOLUTE_URL = /^https?:\/\//i;

const errors = [];
function fail(message) {
  errors.push(message);
  console.error(`  ✗ ${message}`);
}

/** 确定性 JSON 序列化：键排序、无多余空白（同一源逐字节可复现）。 */
function stableStringify(value, indent = 2) {
  return JSON.stringify(sortKeys(value), null, indent);
}
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}
function sha256hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** 世界目录内相对路径解析（禁止 .. 逃逸）。baseDir 为引用所在文件的目录。 */
function resolveInDir(worldDir, baseDir, rawPath, what) {
  const normalized = String(rawPath).trim();
  if (normalized.includes("\0") || normalized.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    fail(`${what} 必须是世界目录内的相对路径: ${normalized}`);
    return null;
  }
  const abs = join(baseDir, normalized);
  const rel = relative(worldDir, abs);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    fail(`${what} 不能逃出世界目录: ${normalized}`);
    return null;
  }
  return abs;
}

/** 递归解析 $file 引用（长文本），baseDir 为当前文件目录。 */
function resolveFileRefs(value, baseDir, worldDir, what) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.$file === "string") {
      const abs = resolveInDir(worldDir, baseDir, value.$file, `${what} 的 $file`);
      if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
        fail(`${what} 的 $file 不存在: ${value.$file}`);
        return "";
      }
      return readFileSync(abs, "utf8");
    }
    const out = {};
    for (const [key, nested] of Object.entries(value)) out[key] = resolveFileRefs(nested, baseDir, worldDir, what);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => resolveFileRefs(item, baseDir, worldDir, what));
  return value;
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** 读取 assets/ 目录下所有 sidecar：id → { id, name, kind, file, recipe?, provenance? }。 */
function readAssetProtocol(worldDir) {
  const dir = join(worldDir, "assets");
  const assets = new Map();
  if (!existsSync(dir)) return assets;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const sidecar = readJSON(join(dir, entry));
    const id = String(sidecar.id ?? entry.replace(/\.json$/, ""));
    if (assets.has(id)) fail(`素材 id 重复: ${id}`);
    assets.set(id, { ...sidecar, id });
  }
  return assets;
}

/** 素材 sidecar → 镜像到 stagedDir/assets/<id><ext>，返回 manifest 内的 url+meta。 */
function mirrorAsset(worldDir, stagedDir, cdnBase, worldId, version, sidecar) {
  const abs = resolveInDir(worldDir, join(worldDir, "assets"), sidecar.file ?? `${sidecar.id}.png`, `素材 ${sidecar.id} 的 file`);
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
    fail(`素材 ${sidecar.id} 文件不存在: ${sidecar.file}`);
    return null;
  }
  const ext = abs.includes(".") ? abs.slice(abs.lastIndexOf(".")) : "";
  const targetRel = `assets/${sidecar.id}${ext}`;
  const targetPath = join(stagedDir, targetRel);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, readFileSync(abs));
  const out = {
    url: `${cdnBase}/worlds/${worldId}/${version}/${targetRel}`,
    kind: sidecar.kind ?? "image",
    name: sidecar.name ?? sidecar.id,
  };
  if (sidecar.recipe) out.recipe = sidecar.recipe;
  return out;
}

/** 媒体引用 {asset:id} → 展开后的 {url,kind,name,recipe?}；已是 {url} 的原样返回。 */
function expandMediaValue(value, assetProtocol, mirrored, what) {
  if (!value || typeof value !== "object") {
    fail(`${what} 的 media 值必须是对象`);
    return value;
  }
  if (value.url) {
    if (!IS_ABSOLUTE_URL.test(String(value.url))) {
      fail(`${what} 的 media url 必须是绝对 http(s): ${value.url}`);
    }
    const { asset: _asset, ...rest } = value;
    return rest;
  }
  const assetId = value.asset;
  if (!assetId) {
    fail(`${what} 的 media 值必须含 asset 或 url`);
    return value;
  }
  if (!assetProtocol.has(assetId)) {
    fail(`${what} 引用未知素材: ${assetId}`);
    return value;
  }
  const resolved = mirrored.get(assetId);
  if (!resolved) {
    fail(`${what} 的素材未镜像成功: ${assetId}`);
    return value;
  }
  const { asset: _asset, kind: _kind, name: _name, ...rest } = value;
  return { ...resolved, ...rest };
}

function validateManifest(manifest) {
  const world = manifest.world;
  if (!world || typeof world.id !== "string" || !world.id.startsWith("pgc.")) {
    fail(`world.id 必须为 pgc. 前缀: ${world && world.id}`);
    return;
  }
  if (!world.name || !world.name.trim()) fail("world.name 必填");
  if (!WORLD_TYPES.has(world.type)) fail(`world.type 非法: ${world.type}`);
  if (typeof world.skillMd !== "string") fail("world.skillMd 必须是字符串（可空）");
  else if (Buffer.byteLength(world.skillMd) > SKILL_MD_MAX_BYTES) fail(`skillMd 超过 ${SKILL_MD_MAX_BYTES} 字节`);

  const declaration = new Set();
  for (const entityType of manifest.entityTypes ?? []) {
    if (!entityType.id || declaration.has(entityType.id)) fail(`entityType id 缺失或重复: ${entityType.id}`);
    declaration.add(entityType.id);
    if (!entityType.name) fail(`entityType ${entityType.id} name 必填`);
    for (const field of entityType.fields ?? []) {
      if (!field.key || !ATTR_TYPES.has(field.type)) fail(`entityType ${entityType.id} 字段非法: ${field.key}/${field.type}`);
    }
  }

  const seen = new Set();
  let detailTotal = 0;
  for (const entity of manifest.entities ?? []) {
    if (!ENTITY_ID_PATTERN.test(entity.id)) fail(`实体 ID 不是稳定 slug: ${entity.id}`);
    if (seen.has(entity.id)) fail(`实体 ID 重复: ${entity.id}`);
    seen.add(entity.id);
    if (!entity.typeId) fail(`实体 ${entity.id} typeId 必填`);
    if (!entity.name || !entity.name.trim()) fail(`实体 ${entity.id} name 必填`);
    detailTotal += Buffer.byteLength(typeof entity.detail === "string" ? entity.detail : "");
    if ((entity.attrs ?? []).length > ENTITY_ATTR_MAX) fail(`实体 ${entity.id} attrs 超过 ${ENTITY_ATTR_MAX}`);
    for (const attr of entity.attrs ?? []) {
      if (!attr.key || !ATTR_TYPES.has(attr.type)) fail(`实体 ${entity.id} 属性非法: ${attr.key}/${attr.type}`);
      if (attr.type === "media" && attr.value && !(attr.value.url && IS_ABSOLUTE_URL.test(String(attr.value.url)))) {
        fail(`实体 ${entity.id} 媒体属性 ${attr.key} 缺 CDN url`);
      }
    }
  }
  if (detailTotal > ENTITY_DETAIL_MAX_BYTES) fail(`实体 detail 合计超过 ${ENTITY_DETAIL_MAX_BYTES} 字节`);

  for (const [index, relation] of (manifest.relations ?? []).entries()) {
    if (!relation.id || !relation.type) fail(`relation 缺 id/type`);
    if (!seen.has(relation.from) || !seen.has(relation.to)) fail(`relation ${relation.id ?? index} 引用未知实体`);
    if (relation.scope && !seen.has(relation.scope)) fail(`relation ${relation.id} scope 引用未知实体`);
  }

  let elementCount = 0;
  for (const canvas of manifest.canvases ?? []) {
    if (canvas.contextId && !seen.has(canvas.contextId)) fail(`canvas context 引用未知实体: ${canvas.contextId}`);
    const elementIDs = new Set((canvas.elements ?? []).map((element) => element.id));
    for (const element of canvas.elements ?? []) {
      elementCount += 1;
      if (!element.id || !element.kind) fail(`canvas ${canvas.contextId} 元素缺 id/kind`);
      if ((element.kind === "entity" || element.refKind === "entity") && element.refId && !seen.has(element.refId)) {
        fail(`canvas 实体元素引用未知实体: ${element.refId}`);
      }
      for (const key of ["fromElementId", "toElementId"]) {
        const ref = element.props?.[key];
        if (ref && !elementIDs.has(ref)) fail(`canvas 元素 ${element.id} 的 ${key} 引用缺失元素`);
      }
      if (element.props?.url && !IS_ABSOLUTE_URL.test(String(element.props.url))) {
        fail(`canvas 元素 ${element.id} 的 url 必须是绝对 http(s)`);
      }
    }
  }
  if (elementCount > CANVAS_ELEMENT_MAX) fail(`canvas 元素合计超过 ${CANVAS_ELEMENT_MAX}`);

  const provenance = manifest.provenance ?? {};
  for (const key of ["author", "license", "repository"]) {
    if (!provenance[key]) fail(`provenance.${key} 必填`);
  }
}

async function buildWorld(worldDir, cdnBase) {
  const worldJsonPath = join(worldDir, "world.json");
  if (!existsSync(worldJsonPath)) {
    fail(`缺少 world.json: ${worldDir}`);
    return null;
  }
  const source = readJSON(worldJsonPath);
  if (source.sourceVersion !== 2) {
    fail(`${source.world?.id ?? worldDir}: 源格式不是 v2，请先运行 node scripts/worlds-migrate-v2.mjs`);
    return null;
  }
  const world = source.world;
  if (!world?.id) return null;
  const version = source.version ?? world.version ?? "0.1.0";
  console.log(`\n→ ${world.id} (${version})`);

  const stagedDir = join(repoRoot, "cdn", "buckets", "worlds", world.id, version);
  rmSync(stagedDir, { recursive: true, force: true });
  mkdirSync(stagedDir, { recursive: true });

  // 1. world.md → skillMd
  const skillMdPath = join(worldDir, "world.md");
  const skillMd = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf8") : "";

  // 2. 素材协议 + 镜像
  const assetProtocol = readAssetProtocol(worldDir);
  const mirrored = new Map();
  const mirrorAll = (asset) =>
    mirrorAsset(worldDir, stagedDir, cdnBase, world.id, version, asset);
  for (const asset of assetProtocol.values()) {
    const resolved = mirrorAll(asset);
    if (resolved) mirrored.set(asset.id, resolved);
  }

  // 3. entities/*.json → 展开 detail $file 与 media 引用
  const entitiesDir = join(worldDir, "entities");
  const entities = [];
  if (existsSync(entitiesDir)) {
    for (const entry of readdirSync(entitiesDir).filter((name) => name.endsWith(".json")).sort()) {
      const record = readJSON(join(entitiesDir, entry));
      const expectedId = entry.replace(/\.json$/, "");
      if (!record.id) record.id = expectedId;
      if (record.id !== expectedId) fail(`实体文件名 ${entry} 与 id ${record.id} 不一致`);
      const resolvedDetail = record.detail ? resolveFileRefs(record.detail, entitiesDir, worldDir, `实体 ${record.id}`) : "";
      const attrs = (record.attrs ?? []).map((attr) => {
        if (attr.type !== "media" || !attr.value) return attr;
        return { ...attr, value: expandMediaValue(attr.value, assetProtocol, mirrored, `实体 ${record.id} 属性 ${attr.key}`) };
      });
      entities.push({
        id: record.id,
        typeId: record.typeId,
        name: record.name,
        intro: record.intro ?? "",
        detail: typeof resolvedDetail === "string" ? resolvedDetail : String(resolvedDetail ?? ""),
        ...(record.parentId ? { parentId: record.parentId } : {}),
        ...(record.containerRole ? { containerRole: record.containerRole } : {}),
        ...(record.isProvisional ? { isProvisional: true } : {}),
        attrs,
      });
    }
  }

  // 4. canvas.json → 展开媒体元素 props
  const canvasPath = join(worldDir, "canvas.json");
  const canvases = [];
  if (existsSync(canvasPath)) {
    const canvasSource = readJSON(canvasPath);
    for (const canvas of canvasSource.canvases ?? []) {
      const elements = (canvas.elements ?? []).map((element) => {
        if (!element.props) return element;
        const props = { ...element.props };
        if (props.asset) {
          const expanded = expandMediaValue({ asset: props.asset }, assetProtocol, mirrored, `canvas 元素 ${element.id}`);
          delete props.asset;
          if (expanded?.url) props.url = expanded.url;
          if (!props.kind && expanded?.kind) props.kind = expanded.kind;
        }
        return { ...element, props };
      });
      canvases.push({ contextId: canvas.contextId ?? "", elements });
    }
  }

  // 5. coverUrl 相对路径镜像（可选）
  let coverUrl = world.coverUrl ?? "";
  if (coverUrl && !IS_ABSOLUTE_URL.test(coverUrl)) {
    const abs = resolveInDir(worldDir, worldDir, coverUrl, "world.coverUrl");
    if (abs && existsSync(abs)) {
      const ext = abs.slice(abs.lastIndexOf("."));
      const targetRel = `cover${ext}`;
      writeFileSync(join(stagedDir, targetRel), readFileSync(abs));
      coverUrl = `${cdnBase}/worlds/${world.id}/${version}/${targetRel}`;
    } else {
      coverUrl = "";
    }
  }

  // 6. manifest v2（确定性序列化）
  const manifest = {
    manifestVersion: 2,
    world: {
      id: world.id,
      name: (world.name ?? "").trim(),
      type: world.type,
      description: (world.description ?? "").trim(),
      coverUrl,
      skillMd,
      identity: world.identity ?? {},
    },
    entityTypes: source.entityTypes ?? [],
    entities,
    relations: source.relations ?? [],
    canvases,
    provenance: source.provenance,
  };
  validateManifest(manifest);

  const manifestBytes = Buffer.from(stableStringify(manifest) + "\n", "utf8");
  if (manifestBytes.length > MANIFEST_MAX_BYTES) fail(`manifest 超过 ${MANIFEST_MAX_BYTES} 字节`);
  writeFileSync(join(stagedDir, "world.json"), manifestBytes);
  console.log(`  ✓ manifest ${manifestBytes.length}B sha256=${sha256hex(manifestBytes).slice(0, 24)}…`);
  console.log(`  ✓ staged ${relative(repoRoot, stagedDir)}/`);

  return {
    id: world.id,
    kind: "platform",
    publisher: "recut",
    version,
    manifestUrl: `${cdnBase}/worlds/${world.id}/${version}/world.json`,
    sha256: sha256hex(manifestBytes),
    bytes: manifestBytes.length,
    status: source.status ?? "active",
    order: source.order ?? 1,
    stagedRel: `worlds/${world.id}/${version}/`,
    manifestRel: `worlds/${world.id}/${version}/world.json`,
  };
}

async function main() {
  const { CDN } = await import(join(repoRoot, "cdn", "config.mjs"));
  const cdnBase = CDN.baseUrl.replace(/\/$/, "");
  console.log(`worlds publish v2 — cdn=${cdnBase} check=${checkOnly} seed=${withSeed} upload=${withUpload}`);

  const worldsRoot = join(repoRoot, "worlds");
  if (!existsSync(worldsRoot)) {
    console.error("worlds/ 目录不存在");
    process.exit(1);
  }
  const entries = readdirSync(worldsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(worldsRoot, entry.name))
    .sort();

  const built = [];
  for (const worldDir of entries) {
    const result = await buildWorld(worldDir, cdnBase);
    if (result) built.push(result);
  }

  const publicEntries = built
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(({ stagedRel: _s, manifestRel: _m, ...entry }) => entry);
  const catalog = {
    catalogVersion: 1,
    updated: checkOnly ? "1970-01-01T00:00:00Z" : new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    worlds: publicEntries,
  };
  const catalogBytes = Buffer.from(stableStringify(catalog) + "\n", "utf8");
  if (!checkOnly) {
    writeFileSync(join(repoRoot, "cdn", "buckets", "worlds", "catalog.json"), catalogBytes);
    console.log(`\n✓ catalog cdn/buckets/worlds/catalog.json（${catalog.worlds.length} 条）`);
  } else {
    console.log(`\n✓ catalog 预览（--check 不落盘）`);
  }

  if (withSeed) {
    const seedRoot = join(repoRoot, "service", "worldcatalog");
    rmSync(seedRoot, { recursive: true, force: true });
    mkdirSync(seedRoot, { recursive: true });
    writeFileSync(join(seedRoot, "catalog.json"), catalogBytes);
    for (const entry of built) {
      const targetDir = join(seedRoot, entry.id, entry.version);
      mkdirSync(targetDir, { recursive: true });
      const stagedDir = join(repoRoot, "cdn", "buckets", entry.stagedRel);
      writeFileSync(join(targetDir, "world.json"), readFileSync(join(stagedDir, "world.json")));
      const assetsDir = join(stagedDir, "assets");
      if (existsSync(assetsDir)) {
        mkdirSync(join(targetDir, "assets"), { recursive: true });
        writeFileSync(join(targetDir, "assets", ".placeholder"), "素材不随二进制发布，见仓库 worlds/ 与 CDN\n");
      }
      console.log(`  ✓ seed ${relative(repoRoot, targetDir)}/`);
    }
    console.log(`✓ 种子 service/worldcatalog/（首启/离线兜底）`);
  }

  if (withUpload) {
    const cli = join(repoRoot, "cdn", "scripts", "cli.mjs");
    const onlyArgs = [];
    for (const entry of built) {
      onlyArgs.push("--only", entry.stagedRel.replace(/^worlds\//, "").replace(/\/+$/, ""));
    }
    onlyArgs.push("--only", "catalog.json");
    const result = spawnSync("node", [cli, "upload", "worlds", ...onlyArgs, "--skip-existing"], {
      cwd: repoRoot, stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  if (errors.length > 0) {
    console.error(`\n✗ ${errors.length} 个校验错误：`);
    process.exit(1);
  }
  console.log(checkOnly ? "\n✓ --check 通过" : "\n✓ 构建完成");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
