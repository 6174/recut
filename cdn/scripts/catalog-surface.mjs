/**
 * Provider 参数面解析（构建期，唯一真相的装配点）。
 *
 * 每个模型的「参数面」= parameters（用户可调项，name 为用户面 key，providerKey 为上游字段）
 * + referenceFields（参考素材落哪个上游字段）。运行时只消费烘焙进 catalog 的结果，绝不回源
 * provider 的 schema。
 *
 * resolveModelSurface 的分级来源（高 → 低），任何提交路径都必须命中其一：
 *   1. model.parameters 显式声明（含 []，用于「确实无可调项」）；策展/上游 schema 都落这一级
 *   2. model.template 引用 sources/templates/<name>.json（无 schema 的 provider 用它）
 *   3. machine：调用方传入的机器 schema 抽取结果（如 Atlas schema_url）
 *   4. capability=speech.generate → 平台 voice/engine 契约，参数面为空但已解析
 *   5. 都没有 → source "none"（调用方必须告警/失败，禁止静默）
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 读取 sources/templates/*.json 为 { name: { parameters, referenceFields } }。 */
export function loadTemplates(sourcesDir) {
  const dir = join(sourcesDir, "templates");
  const templates = {};
  if (!existsSync(dir)) return templates;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const id = name.replace(/\.json$/, "");
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), "utf8"));
      templates[id] = { parameters: raw.parameters ?? [], referenceFields: raw.referenceFields ?? {} };
    } catch (error) {
      throw new Error(`template ${name} is invalid: ${error.message}`);
    }
  }
  return templates;
}

function hasOwn(model, key) {
  return Object.prototype.hasOwnProperty.call(model, key);
}

/** 解析一个模型的参数面；source 标明命中哪一级，"none" 表示未解析。 */
export function resolveModelSurface(model, { templates = {}, machine } = {}) {
  if (hasOwn(model, "parameters")) {
    return { parameters: model.parameters ?? [], referenceFields: model.referenceFields ?? machine?.referenceFields ?? {}, source: "model" };
  }
  if (model.template && templates[model.template]) {
    const template = templates[model.template];
    return { parameters: template.parameters ?? [], referenceFields: { ...template.referenceFields, ...(model.referenceFields ?? {}) }, source: "template" };
  }
  if (machine) {
    return { parameters: machine.parameters ?? [], referenceFields: { ...machine.referenceFields, ...(model.referenceFields ?? {}) }, source: "schema" };
  }
  if (model.capability === "speech.generate") {
    return { parameters: [], referenceFields: {}, source: "platform" };
  }
  return { parameters: undefined, referenceFields: undefined, source: "none" };
}

/** 参数面存在时由其派生 outputModes；否则保留策展/默认值。 */
export function deriveOutputModes(parameters, fallback) {
  if (Array.isArray(parameters) && parameters.length > 0) return parameters.map((parameter) => parameter.name);
  return fallback;
}

/**
 * 对一批模型统一装配参数面，返回未解析清单（调用方负责告警；retired/不可用不算缺失）。
 * 命中后写回 model.parameters/referenceFields/outputModes，保证 catalog 与 adapter 同构。
 */
export function applyModelSurfaces(models, { templates = {} } = {}) {
  const unresolved = [];
  for (const model of models ?? []) {
    const surface = resolveModelSurface(model, { templates });
    if (surface.source === "none") {
      if (model.status !== "retired" && model.available !== false) unresolved.push(model.id);
      continue;
    }
    if (!hasOwn(model, "parameters")) model.parameters = surface.parameters;
    if (!hasOwn(model, "referenceFields") && surface.referenceFields) model.referenceFields = surface.referenceFields;
    model.outputModes = deriveOutputModes(model.parameters, model.outputModes);
  }
  return unresolved;
}
