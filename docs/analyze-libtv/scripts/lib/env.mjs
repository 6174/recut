/*
 * [INPUT]: 依赖 node 标准库（fs/path/url）；可选用仓库内 web/node_modules 的 playwright
 * [OUTPUT]: 对外提供路径常量（REPO_ROOT / SCRIPTS_DIR / DEFAULT_OUT_ROOT）、parseArgs、extractUuid、
 *   apiUrl/detailUrl、outDirFor、loadChromium、UA、writeJson
 * [POS]: docs/analyze-libtv/scripts 的公共工具层（被 fetch-project / analyze-snapshot / browser-probe 共享）
 * [PROTOCOL]: 变更时更新此头部，然后检查 docs/analyze-libtv/README.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url)); // docs/analyze-libtv/scripts/lib
export const SCRIPTS_DIR = path.resolve(HERE, ".."); // docs/analyze-libtv/scripts
export const ANALYZE_DIR = path.resolve(HERE, "../.."); // docs/analyze-libtv
export const REPO_ROOT = path.resolve(HERE, "../../../.."); // 仓库根

/** 默认输出目录（output/ 已在 .gitignore，不会污染 git） */
export const DEFAULT_OUT_ROOT = path.join(REPO_ROOT, "output", "analyze-libtv");

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** 极简 CLI 参数解析：--key value / --key=value / --flag；位置参数进 _ */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=");
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) args[key] = inline;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) args[key] = argv[++i];
      else args[key] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

/** 从 detail URL 或裸 uuid 里取出 32 位 uuid */
export function extractUuid(input) {
  if (!input) return "";
  const m = String(input).match(/[0-9a-f]{32}/i);
  return m ? m[0] : String(input).trim();
}

export function detailUrl(uuid) {
  return `https://www.liblib.tv/detail/${uuid}`;
}

export function apiUrl(uuid) {
  return `https://api.liblib.tv/api/community/project/template/detail?projectTemplateUuid=${uuid}&withRecommendList=true`;
}

export function outDirFor(uuid, outArg) {
  const dir = outArg ? path.resolve(outArg) : path.join(DEFAULT_OUT_ROOT, uuid || "manual");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 定位仓库内的 playwright（web/node_modules），避免 docs/ 下裸 import 找不到 */
export async function loadChromium() {
  const candidates = [
    process.env.RECUT_PLAYWRIGHT,
    path.join(REPO_ROOT, "web", "node_modules", "playwright", "index.js"),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (!fs.existsSync(c)) continue;
      const mod = await import(pathToFileURL(c).href);
      const pw = mod.default ?? mod;
      if (pw.chromium) return pw.chromium;
    } catch {
      /* 试下一个 */
    }
  }
  try {
    const mod = await import("playwright");
    const pw = mod.default ?? mod;
    if (pw.chromium) return pw.chromium;
  } catch {
    /* fallthrough */
  }
  throw new Error(
    "找不到 playwright。请先在 web/ 安装依赖（pnpm i），或设置 RECUT_PLAYWRIGHT=<path-to-playwright/index.js>",
  );
}

export function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

export function writeText(file, text) {
  fs.writeFileSync(file, text);
}

/** 计数器：把数组按 key 函数聚合成 {value: count}，按次数降序 */
export function countBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (k === undefined || k === null) continue;
    const key = typeof k === "string" ? k : JSON.stringify(k);
    m.set(key, (m.get(key) || 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}
