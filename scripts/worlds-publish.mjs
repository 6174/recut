/**
 * 平台 World 发布构建脚本（PGC Platform Worlds RFC, P3）。
 *
 * 源格式 worlds/<slug>/（world.json + world.md + references/ + 资源目录）
 * → 发布格式 cdn/buckets/worlds/<id>/<version>/world.json（单文件自包含
 * manifest，确定性序列化）+ 镜像资源 + cdn/buckets/worlds/catalog.json。
 *
 * 用法：
 *   node scripts/worlds-publish.mjs [--check] [--seed] [--upload] [--only-updates]
 *     --check        只校验并打印 canonical/manifest hash 预览（CI 防漂移；不发 CDN）
 *     --seed         同时把最新 pgc.* 发布产物与 catalog 写入 service/worldcatalog/
 *                    （//go:embed 种子，随二进制发布）
 *     --upload       构建后增量上传到 R2（只传新版本目录 + catalog；--skip-existing）
 *     --only-updates 仅上传有变更的部分（需要 --upload）；跳过未变更世界
 *
 * 构建期硬校验（物化期会复核）：schema、closed 集合、ID 前缀、预算
 * （skillMd ≤16KB / body 合计 ≤16KB / evidence ≤200 / manifest ≤2MB）、
 * $file 与相对路径必须位于世界目录内（禁止 .. 逃逸）、绝对 URL 资源 HEAD 验证。
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const withSeed = args.includes("--seed");
const withUpload = args.includes("--upload");
const onlyUpdates = args.includes("--only-updates");

// --- budgets（与 service 物化器一致）---------------------------------------
const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
const SKILL_MD_MAX_BYTES = 16 * 1024;
const ENTITY_BODY_MAX_BYTES = 16 * 1024;
const EVIDENCE_MAX_ROWS = 200;

const WORLD_TYPES = new Set(["character_ip", "creator_brand", "brand", "fiction_world", "custom"]);
const ENTITY_KINDS = new Set(["character", "location", "story", "style", "rule", "reference"]);
const MODALITIES = new Set(["image", "video", "audio", "text", "research"]);
const PURPOSES = new Set([
  "identity", "appearance", "wardrobe", "voice", "motion", "scene", "mood",
  "visual_style", "sound_style", "narrative", "rule_evidence",
]);
const STATUSES = new Set(["primary", "supporting", "counterexample"]);
const ENTITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

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

/** 世界目录内相对路径解析（禁止 .. 逃逸）。 */
function resolveInWorldDir(worldDir, rawPath, what) {
  const normalized = String(rawPath).trim();
  if (normalized.includes("\0") || normalized.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    fail(`${what} 必须是世界目录内的相对路径: ${normalized}`);
    return null;
  }
  const abs = join(worldDir, normalized);
  const rel = relative(worldDir, abs);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    fail(`${what} 不能逃出世界目录: ${normalized}`);
    return null;
  }
  return abs;
}

/** 解析 $file 引用（实体 body 长文）。 */
function resolveFileRefs(value, worldDir, entityID) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.$file === "string") {
      const abs = resolveInWorldDir(worldDir, value.$file, `实体 ${entityID} 的 $file`);
      if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
        fail(`实体 ${entityID} 的 $file 不存在: ${value.$file}`);
        return "";
      }
      return readFileSync(abs, "utf8");
    }
    const out = {};
    for (const [key, nested] of Object.entries(value)) out[key] = resolveFileRefs(nested, worldDir, entityID);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => resolveFileRefs(item, worldDir, entityID));
  return value;
}

/** 绝对 http(s) URL HEAD 验证（已发布的 CDN 资源）。 */
async function headVerify(url) {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
    if (!response.ok) fail(`绝对 URL 资源验证失败 HTTP ${response.status}: ${url}`);
  } catch (err) {
    fail(`绝对 URL 资源不可达: ${url}（${err.message}）`);
  }
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
  else if (Buffer.byteLength(world.skillMd) > SKILL_MD_MAX_BYTES) {
    fail(`skillMd 超过 ${SKILL_MD_MAX_BYTES} 字节`);
  }

  const seen = new Set();
  let bodyTotal = 0;
  for (const entity of manifest.entities ?? []) {
    if (!ENTITY_ID_PATTERN.test(entity.id)) fail(`实体 ID 不是稳定 slug: ${entity.id}`);
    if (seen.has(entity.id)) fail(`实体 ID 重复: ${entity.id}`);
    seen.add(entity.id);
    if (!ENTITY_KINDS.has(entity.kind)) fail(`实体 kind 非法: ${entity.kind}`);
    if (!entity.title || !entity.title.trim()) fail(`实体 ${entity.id} title 必填`);
    const body = entity.content && typeof entity.content.body === "string" ? entity.content.body : "";
    bodyTotal += Buffer.byteLength(body);
  }
  if (bodyTotal > ENTITY_BODY_MAX_BYTES) fail(`实体 body 合计超过 ${ENTITY_BODY_MAX_BYTES} 字节`);

  if ((manifest.evidence ?? []).length > EVIDENCE_MAX_ROWS) fail(`evidence 条目超过 ${EVIDENCE_MAX_ROWS}`);
  const seenEvidence = new Set();
  for (const evidence of manifest.evidence ?? []) {
    if (!/^https?:\/\/[^/]+\/.+/i.test(evidence.url ?? "")) fail(`evidence url 必须是绝对 http(s) URL: ${evidence.url}`);
    if (!MODALITIES.has(evidence.modality)) fail(`evidence modality 非法: ${evidence.modality}`);
    if (!PURPOSES.has(evidence.purpose)) fail(`evidence purpose 非法: ${evidence.purpose}`);
    if (!STATUSES.has(evidence.status)) fail(`evidence status 非法: ${evidence.status}`);
    if (evidence.entityId && !seen.has(evidence.entityId)) fail(`evidence 引用未知实体: ${evidence.entityId}`);
    // 物化器按 (entityId, url, role) 派生确定性行 ID：重复三元组会在物化时
    // 主键碰撞导致整个世界拒绝物化，构建期直接拒绝。
    const triple = `${evidence.entityId ?? ""}|${evidence.url}|evidence:${evidence.purpose}`;
    if (seenEvidence.has(triple)) fail(`evidence 重复（entity/url/purpose 相同）: ${triple}`);
    seenEvidence.add(triple);
  }
  for (const relation of manifest.relations ?? []) {
    if (!relation.id || !relation.type) fail(`relation 缺 id/type`);
    if (!seen.has(relation.from) || !seen.has(relation.to)) fail(`relation ${relation.id} 引用未知实体`);
  }
  const provenance = manifest.provenance ?? {};
  for (const key of ["author", "license", "repository"]) {
    if (!provenance[key]) fail(`provenance.${key} 必填`);
  }
}

function contentAddressedName(relPath, bytes) {
  const ext = relPath.includes(".") ? relPath.slice(relPath.lastIndexOf(".")) : "";
  return sha256hex(bytes).slice(0, 16) + ext;
}

async function buildWorld(worldDir, cdnBase) {
  const worldJsonPath = join(worldDir, "world.json");
  if (!existsSync(worldJsonPath)) {
    fail(`缺少 world.json: ${worldDir}`);
    return null;
  }
  const source = JSON.parse(readFileSync(worldJsonPath, "utf8"));
  const world = source.world;
  if (!world?.id) return null;
  console.log(`\n→ ${world.id} (${source.version ?? "0.1.0"})`);

  // 1. world.md → skillMd（目录约定；不存在则为空）
  const skillMdPath = join(worldDir, "world.md");
  const skillMd = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf8") : "";

  // 2. 实体 $file 解析
  const entities = (source.entities ?? []).map((entity) => ({
    ...entity,
    content: entity.content ? resolveFileRefs(entity.content, worldDir, entity.id) : entity.content,
  }));

  // 3. 证据：相对路径 → 镜像到 cdn/buckets/worlds/<id>/<version>/examples/；绝对 URL → HEAD 验证
  const version = source.version ?? world.version ?? "0.1.0";
  const stagedDir = join(repoRoot, "cdn", "buckets", "worlds", world.id, version);
  rmSync(stagedDir, { recursive: true, force: true });
  mkdirSync(stagedDir, { recursive: true });

  const evidence = [];
  for (const item of source.evidence ?? []) {
    const url = String(item.url ?? "").trim();
    if (/^https?:\/\//i.test(url)) {
      evidence.push(item);
      void headVerify(url);
      continue;
    }
    const abs = resolveInWorldDir(worldDir, url, "evidence 相对路径");
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
      fail(`evidence 相对资源不存在: ${url}`);
      continue;
    }
    const bytes = readFileSync(abs);
    const relativeToStaged = url.split("/").map((segment) => segment).join("/");
    const targetRel = relativeToStaged.includes("/")
      ? relativeToStaged
      : `examples/${relativeToStaged}`;
    const targetPath = join(stagedDir, targetRel);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, bytes);
    evidence.push({ ...item, url: `${cdnBase}/worlds/${world.id}/${version}/${targetRel}` });
  }

  // 4. 发布 manifest（canonical-complete，确定性序列化）
  const manifest = {
    manifestVersion: 1,
    world: {
      id: world.id,
      name: (world.name ?? "").trim(),
      type: world.type,
      description: (world.description ?? "").trim(),
      coverUrl: world.coverUrl ?? "",
      skillMd,
      identity: world.identity ?? {},
    },
    entities,
    relations: source.relations ?? [],
    evidence,
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
  console.log(`worlds publish — cdn=${cdnBase} check=${checkOnly} seed=${withSeed} upload=${withUpload}`);

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

  // 5. catalog（platform 按 order 排序；published 条目 P4 追加）。
  //    stagedRel/manifestRel 是构建内部字段，不进入对外目录契约。
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

  // 6. 嵌入种子 service/worldcatalog/（示例图不随二进制发布：发布 manifest 仅携带
  //    URL 清单，占位文件保留目录形态；真实 PNG 由官方仓库与 CDN 承担）
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
      const examplesDir = join(stagedDir, "examples");
      if (existsSync(examplesDir)) {
        mkdirSync(join(targetDir, "examples"), { recursive: true });
        writeFileSync(join(targetDir, "examples", ".placeholder"), "PNG 不随二进制发布，见仓库 worlds/ 与 CDN\n");
      }
      console.log(`  ✓ seed ${relative(repoRoot, targetDir)}/`);
    }
    console.log(`✓ 种子 service/worldcatalog/（首启/离线兜底）`);
  }

  // 7. CDN 增量上传（与 releases 同链路：cli.mjs upload --skip-existing）
  //    只传本次构建的版本目录 + catalog.json；旧版本对象不可变，不重复上传。
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
