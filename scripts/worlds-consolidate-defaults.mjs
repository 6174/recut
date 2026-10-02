/**
 * worlds-consolidate-defaults.mjs — 把世界源目录收口到「精简默认集」
 * （RFC 2026-10-02-world-canvas-production-layer §5）。
 *
 * 平台默认集已收窄为 character / location / script；rule 与 style 降级为世界级属性，
 * story 并入 script。本脚本把现有世界源目录做同样的收口（幂等、可重复跑）：
 *
 *   rule-*.json    → world.json 的 world.identity.constraints.{always|never|prefer}
 *                    （文本取 attr `text`，缺省退回 detail/intro/name；未知 type 归 always，
 *                      与运行时 ruleType() 的兜底一致）
 *   style-*.json   → world.json 的 world.identity.style { visual, guidance, avoid }（多份按序合并）
 *   story-*.json   → 原地改成 script 实体（保留 id，关系不断；premise→logline、moment→beats）
 *
 * 被移除的 rule / style 实体对应的 relations 与 canvas 元素一并清理（避免悬空引用）。
 * 画布布局建议随后跑 `node scripts/worlds-migrate-v2.mjs --canvas` 重排。
 *
 * 用法：
 *   node scripts/worlds-consolidate-defaults.mjs [--check] [--world <slug>]
 *     --check   只打印计划，不写文件
 *     --world   只处理一个世界目录
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const worldsRoot = join(repoRoot, "worlds");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const onlyWorld = args.includes("--world") ? args[args.indexOf("--world") + 1] : null;

const CONSTRAINT_TYPES = new Set(["always", "never", "prefer"]);

/** attr 值取值（value 可能是字符串或 media 对象）。 */
const textOf = (value) => (typeof value === "string" ? value.trim() : "");

/** 从一组 attrs 里按 key 取文本。 */
function attrText(entity, key) {
  for (const attr of entity.attrs ?? []) {
    if (attr.key === key) return textOf(attr.value);
  }
  return "";
}

/** 一条 rule 实体的约束正文：attr text → detail → intro → name。 */
function ruleText(entity) {
  return attrText(entity, "text") || textOf(entity.detail) || textOf(entity.intro) || textOf(entity.name);
}

/** 把若干 style 实体合并成 identity.style（同键多值用空行连接）。 */
function mergeStyles(entities) {
  const style = {};
  const push = (key, value) => {
    if (!value) return;
    style[key] = style[key] ? `${style[key]}\n\n${value}` : value;
  };
  for (const entity of entities) {
    push("visual", attrText(entity, "visual"));
    push("guidance", attrText(entity, "guidance"));
    push("avoid", attrText(entity, "avoid"));
    if (!style.visual && !style.guidance && !style.avoid && textOf(entity.detail)) push("visual", textOf(entity.detail));
  }
  return style;
}

/** story → script：改 typeId，把两个叙事字段映射到 script 的 locked 字段。 */
function storyToScript(entity) {
  const attrs = (entity.attrs ?? []).map((attr) => {
    if (attr.key === "premise") return { ...attr, key: "logline", label: "一句话概括", type: "text" };
    if (attr.key === "moment") return { ...attr, key: "beats", label: "节拍 / 叙事结构", type: "textarea" };
    return attr;
  });
  return { ...entity, typeId: "script", attrs };
}

function consolidateWorld(slug) {
  const dir = join(worldsRoot, slug);
  const worldPath = join(dir, "world.json");
  const entitiesDir = join(dir, "entities");
  if (!existsSync(worldPath) || !existsSync(entitiesDir)) return null;

  const world = JSON.parse(readFileSync(worldPath, "utf8"));
  const files = readdirSync(entitiesDir).filter((f) => f.endsWith(".json"));
  const entities = files.map((f) => ({ file: f, path: join(entitiesDir, f), data: JSON.parse(readFileSync(join(entitiesDir, f), "utf8")) }));

  const rules = entities.filter((e) => e.data.typeId === "rule");
  const styles = entities.filter((e) => e.data.typeId === "style");
  const stories = entities.filter((e) => e.data.typeId === "story");
  if (rules.length + styles.length + stories.length === 0) return null;

  // 1. constraints
  const constraints = world.world?.identity?.constraints ?? {};
  for (const type of ["always", "never", "prefer"]) constraints[type] ??= [];
  for (const e of rules) {
    const raw = attrText(e.data, "type");
    const type = CONSTRAINT_TYPES.has(raw) ? raw : "always";
    const text = ruleText(e.data);
    if (text && !constraints[type].includes(text)) constraints[type].push(text);
  }
  // 2. style
  const style = { ...(world.world?.identity?.style ?? {}), ...mergeStyles(styles.map((e) => e.data)) };
  // 3. story → script
  const rewritten = stories.map((e) => ({ ...e, next: storyToScript(e.data) }));

  // 4. 清理由被删实体引出的 relations / canvas 元素
  const removedIDs = new Set([...rules, ...styles].map((e) => e.data.id));
  const relations = (world.relations ?? []).filter((r) => !removedIDs.has(r.from) && !removedIDs.has(r.to));

  const plan = {
    slug,
    rules: rules.length,
    styles: styles.length,
    stories: stories.length,
    constraints: Object.fromEntries(Object.entries(constraints).map(([k, v]) => [k, v.length])),
    removedRelations: (world.relations ?? []).length - relations.length,
  };

  if (checkOnly) return plan;

  // world.json：写回 identity + 过滤后的 relations
  world.world.identity = { ...(world.world.identity ?? {}), constraints, ...(Object.keys(style).length ? { style } : {}) };
  world.relations = relations;
  writeFileSync(worldPath, `${JSON.stringify(world, null, 2)}\n`);

  // 实体：story 改写为 script；rule/style 文件删除
  for (const e of rewritten) writeFileSync(e.path, `${JSON.stringify(e.next, null, 2)}\n`);
  for (const e of [...rules, ...styles]) rmSync(e.path);

  // canvas.json：清掉引用被删实体的元素
  const canvasPath = join(dir, "canvas.json");
  if (existsSync(canvasPath)) {
    const canvas = JSON.parse(readFileSync(canvasPath, "utf8"));
    for (const layer of canvas.canvases ?? []) {
      layer.elements = (layer.elements ?? []).filter((el) => !(el.refKind === "entity" && removedIDs.has(el.refId)));
    }
    writeFileSync(canvasPath, `${JSON.stringify(canvas, null, 2)}\n`);
  }

  return plan;
}

const slugs = onlyWorld ? [onlyWorld] : readdirSync(worldsRoot).filter((s) => existsSync(join(worldsRoot, s, "world.json")));
const results = [];
for (const slug of slugs) {
  const plan = consolidateWorld(slug);
  if (plan) results.push(plan);
}

if (results.length === 0) {
  console.log("没有需要收口的世界（都已经是精简默认集）。");
  process.exit(0);
}
console.log(checkOnly ? "计划（--check，未写文件）：" : "已收口：");
for (const r of results) {
  console.log(`  ${r.slug}: rule ${r.rules} → constraints${JSON.stringify(r.constraints)} · style ${r.styles} → identity.style · story ${r.stories} → script · 清理悬空关系 ${r.removedRelations}`);
}
if (!checkOnly) {
  console.log("\n下一步（重排画布布局）：\n  node scripts/worlds-migrate-v2.mjs --canvas\n校验：\n  node scripts/worlds-inspect.mjs --all");
}
