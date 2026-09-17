#!/usr/bin/env node
/**
 * 从编辑器 runtime 的 EFFECT_COMPONENTS（ui/src/runtime/components/effects/index.ts）
 * 生成内置效果目录，输出两份：
 *   - apps/editor/catalog/effects.json   （随包回退，library.browse 兜底源）
 *   - cdn/buckets/effects/catalog.json   （CDN 上游，持续更新的源）
 * 同时把 CDN 音频目录 cdn/buckets/audio/catalog.json 同步为随包 catalog/audio.json。
 *
 * 更新循环：改完 effect 组件 → 重跑本脚本 → `make -C cdn sync PREFIX=effects` 推 CDN。
 * usage: node apps/editor/scripts/build-effects-catalog.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const EFFECTS_SRC = path.join(REPO, "apps/editor/ui/src/runtime/components/effects/index.ts");
const APP_CATALOG_DIR = path.join(REPO, "apps/editor/catalog");
const CDN_EFFECTS_DIR = path.join(REPO, "cdn/buckets/effects");
const CDN_AUDIO = path.join(REPO, "cdn/buckets/audio/catalog.json");

/** 深度感知的顶层逗号切分（忽略括号/引号内的逗号）。 */
function splitTopLevel(text, sep = ",") {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth += 1; cur += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth -= 1; cur += ch; continue; }
    if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function extractStringArray(block) {
  const m = block.match(/keywords:\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

function parseInputItem(item) {
  if (item.startsWith("p(")) {
    const args = splitTopLevel(item.slice(2, item.lastIndexOf(")")), ",");
    const key = args[0]?.replace(/["']/g, "").trim();
    const label = args[1]?.replace(/["']/g, "").trim();
    const def = Number(args[2] ?? 0);
    const min = args[3] !== undefined ? Number(args[3]) : 0;
    const max = args[4] !== undefined ? Number(args[4]) : 1e6;
    const step = args[5] !== undefined ? Number(args[5]) : 0.01;
    return { key, label, type: "number", default: def, min, max, step };
  }
  if (item.startsWith("{")) {
    const key = item.match(/key:\s*["']([^"']+)["']/)?.[1];
    const label = item.match(/label:\s*["']([^"']*)["']/)?.[1];
    const type = item.match(/type:\s*["']([^"']+)["']/)?.[1] || "number";
    const defRaw = item.match(/default:\s*([^,}]+)/)?.[1]?.trim();
    let def = defRaw;
    if (type === "number") def = Number(defRaw);
    else def = defRaw?.replace(/^["']|["']$/g, "");
    const min = item.match(/min:\s*([^,}]+)/)?.[1]?.trim();
    const max = item.match(/max:\s*([^,}]+)/)?.[1]?.trim();
    const step = item.match(/step:\s*([^,}]+)/)?.[1]?.trim();
    const out = { key, label, type, default: def };
    if (min !== undefined) out.min = Number(min);
    if (max !== undefined) out.max = Number(max);
    if (step !== undefined) out.step = Number(step);
    return out;
  }
  return null;
}

/** 括号感知的 inputs 数组提取：select 的 options 内嵌 []，非贪婪正则会提前截断。 */
function extractInputsBlock(text) {
  const start = text.search(/inputs:\s*\[/);
  if (start === -1) return null;
  const open = text.indexOf("[", start);
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

function parseInputs(block) {
  const inner = extractInputsBlock(block);
  if (inner === null) return [];
  const items = splitTopLevel(inner, ",");
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const parsed = parseInputItem(item);
    if (parsed && parsed.key) out.push(parsed);
  }
  return out;
}

function parseEffects(source) {
  const blocks = source.split(/\n\t\{\n\t\tid: "effect\./).slice(1);
  const effects = [];
  for (const raw of blocks) {
    const id = "effect." + raw.slice(0, raw.indexOf(",")).replace(/"/g, "").trim();
    const block = raw.slice(0, raw.indexOf("\n\t},") > 0 ? raw.indexOf("\n\t},") : raw.length);
    const name = block.match(/name:\s*"([^"]+)"/)?.[1] || id;
    const keywords = extractStringArray(block);
    const inputs = parseInputs(block);
    effects.push({ id, name, keywords, category: "effect", appliesTo: ["video", "image", "text"], inputs });
  }
  return effects;
}

function main() {
  const source = fs.readFileSync(EFFECTS_SRC, "utf8");
  const effects = parseEffects(source);

  // MetalForge 内置组件（runtime/components/metalforge/*.tsx）：全屏背景与卡片，
  // 解析其 ComponentDefinition 字面量并入 catalog（inputs 含 select/color/boolean）。
  const MF_DIR = path.join(path.dirname(path.dirname(EFFECTS_SRC)), "metalforge");
  if (fs.existsSync(MF_DIR)) {
    for (const f of fs.readdirSync(MF_DIR).filter((x) => x.endsWith(".tsx"))) {
      const src = fs.readFileSync(path.join(MF_DIR, f), "utf8");
      for (const raw of src.split(/\nexport const \w+Component/).slice(1)) {
        const id = raw.match(/id:\s*"(mf\.[^"]+)"/)?.[1];
        if (!id) continue;
        const block = raw.slice(0, raw.indexOf("\nexport ") > 0 ? raw.indexOf("\nexport ") : raw.length);
        const name = block.match(/name:\s*"([^"]+)"/)?.[1] || id;
        const keywords = extractStringArray(block);
        const inputs = parseInputs(block);
        effects.push({
          id,
          name,
          keywords,
          category: "effect",
          appliesTo: ["video", "image", "text"],
          inputs,
        });
      }
    }
  }
  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedFrom: "apps/editor/ui/src/runtime/components/effects/index.ts (EFFECT_COMPONENTS)",
    effects,
    transitions: [],
    luts: [],
  };
  fs.mkdirSync(APP_CATALOG_DIR, { recursive: true });
  fs.mkdirSync(CDN_EFFECTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(APP_CATALOG_DIR, "effects.json"), JSON.stringify(doc, null, 2) + "\n");
  fs.writeFileSync(path.join(CDN_EFFECTS_DIR, "catalog.json"), JSON.stringify(doc, null, 2) + "\n");

  if (fs.existsSync(CDN_AUDIO)) {
    fs.copyFileSync(CDN_AUDIO, path.join(APP_CATALOG_DIR, "audio.json"));
  }

  console.log(`effects: ${effects.length} → apps/editor/catalog/effects.json + cdn/buckets/effects/catalog.json`);
  console.log(`audio: ${fs.existsSync(CDN_AUDIO) ? "synced → apps/editor/catalog/audio.json" : "MISSING (skip)"}`);
  for (const e of effects) {
    if (!e.inputs.length) console.warn(`  (no inputs) ${e.id}`);
  }
}

main();
