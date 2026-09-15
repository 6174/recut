#!/usr/bin/env node
/**
 * 同步 Provider 模型目录到 cdn/buckets/providers/（rfc/2026-09-03-provider-model-catalog-cdn.md）。
 *
 * 两阶段流水线（每个 provider 一个 fetcher，scripts/fetchers/<id>.mjs，自动发现）：
 *   1. fetchRaw  —— 拉取上游原始模型清单，原样落盘 buckets/providers/raw/<id>.raw.json
 *                   （留档：审阅上游噪声、断网时 transform 仍可离线重跑）；
 *   2. transform —— 原始清单 + sources/<id>.*.json 策展/价格/修正 → 富 meta（pricing/
 *                   summary/docsUrl/tags）catalog 候选，经人工字段保护合并后写
 *                   buckets/providers/<id>.catalog.json。
 * 本入口负责统一契约、人工字段保护、参数面统一装配（catalog-surface.mjs：所有 provider 收敛为
 * 同构的 parameters/referenceFields/outputModes，缺失只告警、--strict 失败）、写盘与 index.json
 * （sha256 完整性锚点）。运行时只消费烘焙结果，绝不回源 provider schema。
 *
 * 用法：
 *   node scripts/fetch-models.mjs                  # 全部 fetcher：fetchRaw + transform（单个失败不阻塞其余）
 *   node scripts/fetch-models.mjs atlas-cloud      # 只跑单个 provider
 *   node scripts/fetch-models.mjs --fetch-only     # 只拉取/刷新原始快照，不 transform
 *   node scripts/fetch-models.mjs --transform-only # 不拉取，用现有原始快照离线 transform
 *   node scripts/fetch-models.mjs --reindex-only   # 不拉取，只重算 sha256 + index.json
 *   node scripts/fetch-models.mjs --no-upload      # 只落盘，不发布（审阅 diff 前用）
 *
 * 生成候选后默认发布到 R2 的 providers 前缀（skip-existing，仅上传缺失/变更对象；
 * raw/ 与 catalog 一并上传，CDN 同时可取原始清单与转换结果）。发布失败会报错退出，
 * 本地产物保留在 cdn/buckets/providers/，修复后重跑即可。用 --no-upload 只落盘待审阅。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyModelSurfaces, loadTemplates } from "./catalog-surface.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET_DIR = join(ROOT, "buckets", "providers");
const RAW_DIR = join(BUCKET_DIR, "raw");
const SOURCES_DIR = join(ROOT, "sources");
const SCHEMA = "recut.provider-catalog@1";
// 参数面未解析计数：--strict 时作为失败信号，避免 schema 缺失被静默发布。
let unresolvedTotal = 0;

export function readJSON(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.warn(`  [warn] ${path} 解析失败（${error.message}），忽略`);
    return fallback;
  }
}

export function fetchJSONFactory(env) {
  return async function fetchJSON(url, { method = "GET", headers = {}, body, timeoutMs = 20000 } = {}) {
    const response = await fetch(url, {
      method,
      headers: { "User-Agent": "recut-fetch-models/1.0", "Content-Type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  };
}

/**
 * 人工字段保护合并：对已存在条目只更新结构字段，不触碰 meta/status/名称/referenceBudgets；
 * 上游消失的条目置 retired（保留供历史 Route 解析）；extensions 整段沿用旧值。
 */
export function mergeCatalog(previous, next) {
  if (!previous) return { ...next, revision: 1 };
  const previousModels = new Map((previous.models ?? []).map((model) => [model.id, model]));
  const seen = new Set();
  const models = (next.models ?? []).map((incoming) => {
    seen.add(incoming.id);
    const old = previousModels.get(incoming.id);
    if (!old) {
      return { status: "new", referenceBudgets: [], ...incoming, status: incoming.status ?? "new" };
    }
    return {
      ...incoming,
      id: old.id,
      capability: old.capability ?? incoming.capability,
      name: old.name || incoming.name,
      // retired 不锁死：模型重新出现在上游（列表形态变化、重新上架）时恢复稳定态。
      status: old.status === "retired" ? (incoming.status ?? "stable") : (old.status ?? incoming.status ?? "stable"),
      referenceBudgets: old.referenceBudgets?.length ? old.referenceBudgets : incoming.referenceBudgets ?? [],
      // 人工字段逐字段胜出；价格允许随定价表流动（人工未写 pricing 时取上游新值）。
      meta: old.meta ? { ...incoming.meta, ...old.meta, pricing: old.meta.pricing ?? incoming.meta?.pricing } : incoming.meta,
    };
  });
  const retired = (previous.models ?? []).filter((model) => !seen.has(model.id)).map((model) => ({ ...model, status: "retired" }));
  return { ...next, models: [...models, ...retired], revision: (previous.revision ?? 0) + 1, updatedAt: next.updatedAt };
}

/** fetcher 声明的 provider 骨架校验 + 模型 ID 前缀与 capability 校验。 */
export function validateCatalog(catalog) {
  const providerID = catalog?.provider?.id;
  if (!providerID || !catalog.provider.protocol) throw new Error("catalog 缺少 provider.id / provider.protocol");
  for (const model of catalog.models ?? []) {
    if (!model.id.startsWith(`${providerID}/`)) throw new Error(`模型 ${model.id} 不以 provider id "${providerID}/" 开头`);
    if (!["image.generate", "video.generate", "speech.generate"].includes(model.capability)) throw new Error(`模型 ${model.id} capability 非法: ${model.capability}`);
    if (!Array.isArray(model.inputModes)) throw new Error(`模型 ${model.id} 缺少 inputModes`);
  }
  return catalog;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** 读取 cdn/.env（KEY=VALUE 每行一条，# 注释），不覆盖已有 process.env。 */
function loadEnvFile(path) {
  const env = { ...process.env };
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (!(match[1] in env) || !env[match[1]]) env[match[1]] = value;
  }
  return env;
}

/**
 * 执行一个 fetcher。mode: full（fetchRaw + transform）| fetch-only | transform-only。
 * 返回 { fetched: boolean, transformed: boolean }。
 */
async function runFetcher(fetcherID, env, mode) {
  const fetcherPath = join(ROOT, "scripts", "fetchers", `${fetcherID}.mjs`);
  const { default: fetcher } = await import(fetcherPath);
  if (fetcher.id !== fetcherID) throw new Error(`fetcher id 不匹配: ${fetcherPath} 声明为 ${fetcher.id}`);

  mkdirSync(RAW_DIR, { recursive: true });
  const rawPath = join(RAW_DIR, `${fetcherID}.raw.json`);
  let raw = readJSON(rawPath, null);
  let fetched = false;
  if (mode !== "transform-only") {
    if (typeof fetcher.fetchRaw !== "function") throw new Error(`fetcher ${fetcherID} 缺少 fetchRaw()`);
    console.log(`[${fetcherID}] 拉取上游原始清单…`);
    const snapshot = await fetcher.fetchRaw({ env, readJSON, fetchJSON: fetchJSONFactory(env) });
    raw = { provider: fetcherID, fetchedAt: new Date().toISOString(), ...snapshot };
    writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
    fetched = true;
    const upstreamCount = Array.isArray(raw?.upstream?.data) ? raw.upstream.data.length : 0;
    console.log(`[${fetcherID}] 原始快照${upstreamCount ? `（${upstreamCount} 条上游条目）` : ""} -> ${rawPath}`);
  } else if (!raw) {
    throw new Error(`没有原始快照 ${rawPath}；先执行 --fetch-only 或去掉 --transform-only`);
  }

  if (mode === "fetch-only") return { fetched, transformed: false };

  if (typeof fetcher.transform !== "function") throw new Error(`fetcher ${fetcherID} 缺少 transform()`);
  const bucketPath = join(BUCKET_DIR, `${fetcherID}.catalog.json`);
  const previous = readJSON(bucketPath, null);
  const candidate = await fetcher.transform({ env, sourcesDir: SOURCES_DIR, readJSON, raw, previous });
  // 统一装配参数面：所有 provider（有/无上游 schema）在这里收敛为同构的
  // parameters/referenceFields/outputModes；缺失只告警，不静默（--strict 时失败）。
  const unresolved = applyModelSurfaces(candidate.models, { templates: loadTemplates(SOURCES_DIR) });
  if (unresolved.length) {
    unresolvedTotal += unresolved.length;
    console.warn(`[${fetcherID}] ${unresolved.length} 个模型没有参数面（UI 将无可调项）: ${unresolved.slice(0, 8).join(", ")}${unresolved.length > 8 ? " …" : ""}`);
  }
  candidate.schema = SCHEMA;
  candidate.updatedAt = new Date().toISOString();
  const catalog = validateCatalog(mergeCatalog(previous, candidate));
  writeFileSync(bucketPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`[${fetcherID}] ${catalog.models.length} 个模型（revision ${catalog.revision}）-> ${bucketPath}`);
  return { fetched, transformed: true };
}

function reindex() {
  const providers = [];
  for (const file of readdirSync(BUCKET_DIR).filter((name) => name.endsWith(".catalog.json")).sort()) {
    const text = readFileSync(join(BUCKET_DIR, file), "utf8");
    const catalog = JSON.parse(text);
    validateCatalog(catalog);
    providers.push({
      id: catalog.provider.id,
      protocol: catalog.provider.protocol,
      catalogUrl: `https://cdn.recut.video/providers/${file}`,
      sha256: sha256(text),
      revision: catalog.revision ?? 0,
      modelCount: (catalog.models ?? []).length,
    });
  }
  const index = { schema: SCHEMA, updatedAt: new Date().toISOString(), providers };
  writeFileSync(join(BUCKET_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`index.json：${providers.length} 个 provider -> ${join(BUCKET_DIR, "index.json")}`);
}

const env = loadEnvFile(join(ROOT, ".env"));
const noUpload = process.argv.includes("--no-upload");
const argv = process.argv.slice(2).filter((a) => a !== "--no-upload");
const arg = argv[0];
mkdirSync(BUCKET_DIR, { recursive: true });

/** 把 providers 前缀发布到 R2（skip-existing：只传缺失/变更）。失败抛错，由调用方保留本地产物后退出。 */
async function publishProviders() {
  if (noUpload) {
    console.log("已跳过发布（--no-upload）。审阅 git diff 后执行 make sync-models 或 make upload PREFIX=providers ARGS=--skip-existing 上传。");
    return;
  }
  const { uploadPrefix } = await import("./r2.mjs");
  console.log("发布 providers 前缀到 R2（skip-existing，仅传缺失/变更）…");
  await uploadPrefix("providers", { skipExisting: true, throwOnFailure: true });
}

try {
  if (arg === "--reindex-only") {
    reindex();
    await publishProviders();
  } else {
    let mode = "full";
    let providerArg = arg;
    if (arg === "--fetch-only" || arg === "--transform-only") {
      mode = arg.slice(2);
      providerArg = argv[1];
    }
    const discovered = readdirSync(join(ROOT, "scripts", "fetchers")).filter((name) => name.endsWith(".mjs")).map((name) => name.replace(/\.mjs$/, ""));
    const targets = providerArg && !providerArg.startsWith("--") ? [providerArg] : discovered;
    if (providerArg && !discovered.includes(providerArg)) {
      console.error(`未知 provider "${providerArg}"；可用：${discovered.join(", ")}`);
      process.exit(1);
    }
    const failures = [];
    for (const id of targets) {
      try {
        await runFetcher(id, env, mode);
      } catch (error) {
        failures.push(id);
        console.error(`[${id}] 失败：${error.message}`);
      }
    }
    reindex();
    await publishProviders();
    if (failures.length) {
      console.error(`完成，但 ${failures.length} 个 fetcher 失败：${failures.join(", ")}`);
      process.exit(1);
    }
    if (unresolvedTotal > 0 && process.argv.includes("--strict")) {
      console.error(`--strict：${unresolvedTotal} 个模型没有参数面，拒绝视为完成`);
      process.exit(1);
    }
    console.log(noUpload ? "完成（未发布）。" : "完成并已发布 providers。");
  }
} catch (error) {
  console.error(`发布失败：${error.message}`);
  console.error("本地产物已保留在 cdn/buckets/providers/，修复后重跑或执行 make upload PREFIX=providers ARGS=--skip-existing。");
  process.exit(1);
}
