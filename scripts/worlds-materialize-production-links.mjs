/**
 * worlds-materialize-production-links.mjs — 把既有的 parentId 生产树物化出结构 link
 * （RFC 2026-10-02-world-canvas-production-layer §D8）。
 *
 * 生产树（作品→视频脚本→场次→镜头）已改由 link（has_script / has_scene / has_shot）单源表达，
 * parentId 退回通用归属（文件夹）。运行时会为「新建」的生产实体自动物化 link，但早于该改动
 * 落地的内容只有 parentId。本脚本把世界源目录里这类实体补齐 link（幂等、可重复跑）：
 *
 *   对每个实体，若同时满足：它有 parentId、其 typeId 是生产类型（work/script/scene/shot）、
 *   父实体的 typeId 也是生产类型 —— 则在 world.relations 补一条 父→子 的 has_* 关系
 *   （子=script→has_script / scene→has_scene / shot→has_shot），已存在则跳过。
 *
 * 今天生产内容基本为空（M1/M3 当日落地），预期 no-op；保留脚本用于历史世界。
 *
 * 用法：
 *   node scripts/worlds-materialize-production-links.mjs [--check] [--world <slug>]
 *     --check   只打印计划，不写文件
 *     --world   只处理一个世界目录
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const worldsRoot = join(repoRoot, "worlds");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const onlyWorld = args.includes("--world") ? args[args.indexOf("--world") + 1] : null;

// 生产树的节点类型（与 service 的 productionNodeTypes 对齐）。
const PRODUCTION_TYPES = new Set(["work", "script", "scene", "shot"]);
// 子类型 → 父→子 的结构关系词（与 service 的 productionLinkRoleFor 对齐）。
const ROLE_BY_CHILD = { script: "has_script", scene: "has_scene", shot: "has_shot" };

function materializeWorld(slug) {
  const dir = join(worldsRoot, slug);
  const worldPath = join(dir, "world.json");
  const entitiesDir = join(dir, "entities");
  if (!existsSync(worldPath) || !existsSync(entitiesDir)) return null;

  const world = JSON.parse(readFileSync(worldPath, "utf8"));
  const entities = readdirSync(entitiesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(entitiesDir, file), "utf8")));
  const typeById = new Map(entities.map((entity) => [entity.id, entity.typeId]));
  const existing = new Set((world.relations ?? []).map((relation) => `${relation.from}→${relation.to}·${relation.fromRole ?? relation.type}`));

  const added = [];
  let seq = (world.relations ?? []).length;
  for (const entity of entities) {
    const parentId = entity.parentId ?? entity.parent_id ?? "";
    if (!parentId) continue;
    const role = ROLE_BY_CHILD[entity.typeId];
    if (!role) continue;
    const parentType = typeById.get(parentId);
    if (!parentType || !PRODUCTION_TYPES.has(parentType)) continue;
    const key = `${parentId}→${entity.id}·${role}`;
    if (existing.has(key)) continue;
    existing.add(key);
    added.push({ id: `r-${String((seq += 1)).padStart(2, "0")}`, type: role, from: parentId, to: entity.id, scope: null });
  }
  if (added.length === 0) return null;
  if (checkOnly) return { slug, added: added.length };

  world.relations = [...(world.relations ?? []), ...added];
  writeFileSync(worldPath, `${JSON.stringify(world, null, 2)}\n`);
  return { slug, added: added.length };
}

const slugs = onlyWorld ? [onlyWorld] : readdirSync(worldsRoot).filter((slug) => existsSync(join(worldsRoot, slug, "world.json")));
const results = [];
for (const slug of slugs) {
  const plan = materializeWorld(slug);
  if (plan) results.push(plan);
}

if (results.length === 0) {
  console.log("没有需要物化生产链的世界（生产内容为空或已由运行时补齐）。");
  process.exit(0);
}
console.log(checkOnly ? "计划（--check，未写文件）：" : "已物化生产链：");
for (const result of results) console.log(`  ${result.slug}: +${result.added} 条 has_* link`);
if (!checkOnly) {
  console.log("\n校验：\n  node scripts/worlds-inspect.mjs --all");
}
