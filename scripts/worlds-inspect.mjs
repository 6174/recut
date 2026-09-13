/**
 * worlds-inspect.mjs — 本地校验一个 World 的画布 layout 与 link（不依赖 service/浏览器）。
 *
 * 读取 worlds/<slug>/ 的 v2 源：world.json + entities/*.json + canvas.json，
 * 打印：实体分带、根画布栅格、关系连线、以及结构问题（重叠 / 缺口 / 悬空引用）。
 *
 * 用法：
 *   node scripts/worlds-inspect.mjs <slug|worldId> [--context <entityId>]
 *   node scripts/worlds-inspect.mjs --all
 *
 * 退出码非零表示存在结构问题（可用于 CI）。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const args = process.argv.slice(2);
const inspectAll = args.includes("--all");
const contextFilter = args.includes("--context") ? args[args.indexOf("--context") + 1] : null;
const target = args.find((arg) => !arg.startsWith("--") && arg !== contextFilter) ?? null;

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadWorld(slug) {
  const worldDir = join(repoRoot, "worlds", slug);
  const worldJson = join(worldDir, "world.json");
  if (!existsSync(worldJson)) return null;
  const source = readJSON(worldJson);
  const entitiesDir = join(worldDir, "entities");
  const entities = existsSync(entitiesDir)
    ? readdirSync(entitiesDir).filter((name) => name.endsWith(".json")).sort().map((name) => readJSON(join(entitiesDir, name)))
    : [];
  const canvasPath = join(worldDir, "canvas.json");
  const canvas = existsSync(canvasPath) ? readJSON(canvasPath) : { canvases: [] };
  return { slug, worldDir, source, entities, canvas };
}

function inspect(world) {
  const worldId = world.source.world?.id ?? world.slug;
  console.log(`\n════ ${worldId}（${world.slug}）════`);

  const byType = new Map();
  for (const entity of world.entities) {
    const type = entity.typeId ?? "object";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(entity);
  }
  console.log("实体：");
  for (const [type, list] of byType) {
    console.log(`  ${type.padEnd(12)} ${list.length}  ${list.map((e) => e.name).join("、")}`);
  }

  const relations = world.source.relations ?? [];
  console.log(`关系（link）：${relations.length}`);
  if (relations.length) {
    const nameOf = new Map(world.entities.map((e) => [e.id, e.name]));
    for (const relation of relations) {
      console.log(`  ${nameOf.get(relation.from) ?? relation.from} --${relation.type}--> ${nameOf.get(relation.to) ?? relation.to}${relation.scope ? `（scope ${relation.scope}）` : ""}`);
    }
  } else {
    console.log("  （无；画布不会有连线。关系写在 world.json 的 relations[]，物化后自动渲染为箭头）");
  }

  const canvases = world.canvas.canvases ?? [];
  const targetCanvas = contextFilter ? canvases.find((c) => c.contextId === contextFilter) : canvases.find((c) => !c.contextId) ?? canvases[0];
  if (!targetCanvas) {
    console.log("画布：无");
    return 0;
  }
  const elements = targetCanvas.elements ?? [];
  console.log(`画布（contextId="${targetCanvas.contextId}"）：${elements.length} 元素`);

  const entityIds = new Set(world.entities.map((e) => e.id));
  const placedRefs = elements.filter((e) => e.kind === "entity" || e.refKind === "entity").map((e) => e.refId);
  const placedSet = new Set(placedRefs);

  const problems = [];
  // 悬空引用
  for (const ref of placedRefs) if (!entityIds.has(ref)) problems.push(`悬空实体引用：${ref}`);
  // relation 两端是否在根画布
  for (const relation of relations) {
    if (contextFilter) break;
    if (!placedSet.has(relation.from)) problems.push(`关系起点未上画布：${relation.from}`);
    if (!placedSet.has(relation.to)) problems.push(`关系终点未上画布：${relation.to}`);
  }
  // 重叠（实体卡按其几何矩形）
  const rects = elements
    .filter((e) => e.kind === "entity" || e.refKind === "entity")
    .map((e) => {
      const g = e.geometry ?? {};
      return { name: e.name ?? e.refId, x: Number(g.x) || 0, y: Number(g.y) || 0, w: Number(g.width) || 264, h: Number(g.height) || 328 };
    });
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlap) problems.push(`卡片重叠：${a.name} × ${b.name}`);
    }
  }
  // 实体未上画布（根画布）
  if (!contextFilter) {
    for (const entity of world.entities) {
      if (entity.parentId) continue;
      if (!placedSet.has(entity.id)) problems.push(`实体未上根画布：${entity.name}（${entity.id}）`);
    }
  }

  // 栅格视图
  const cols = [...new Set(rects.map((r) => r.x))].sort((a, b) => a - b);
  const rows = [...new Set(rects.map((r) => r.y))].sort((a, b) => a - b);
  console.log("\n布局（行 × 列）：");
  for (const y of rows) {
    const cells = [];
    for (const x of cols) {
      const hit = rects.find((r) => r.x === x && r.y === y);
      cells.push((hit ? hit.name : "").slice(0, 10).padEnd(11));
    }
    console.log(`  y=${String(y).padStart(5)} | ${cells.join("| ")}`);
  }

  if (problems.length) {
    console.log(`\n  ✗ ${problems.length} 个结构问题：`);
    for (const problem of problems) console.log(`    - ${problem}`);
    return 1;
  }
  console.log("\n  ✓ 画布结构无问题");
  return 0;
}

function main() {
  const slugs = inspectAll
    ? readdirSync(join(repoRoot, "worlds"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [target].filter(Boolean);
  if (!slugs.length) {
    console.error("用法：node scripts/worlds-inspect.mjs <slug|worldId> [--context <id>] | --all");
    process.exit(2);
  }
  let failures = 0;
  for (const slug of slugs) {
    // 允许传 worldId（pgc.xiaohei）或目录名（xiaohei）
    const world = loadWorld(slug) ?? loadWorld(slug.replace(/^pgc\./, ""));
    if (!world) {
      console.error(`找不到世界：${slug}`);
      failures += 1;
      continue;
    }
    failures += inspect(world);
  }
  process.exit(failures > 0 ? 1 : 0);
}

main();
