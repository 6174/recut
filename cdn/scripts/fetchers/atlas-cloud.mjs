/**
 * Atlas Cloud fetcher：媒体模型全量同步（rfc §3.2.1）。
 *
 * 两阶段：
 *   fetchRaw  —— GET /api/v1/catalog/models（媒体模型主源：pricing、input/output_modalities、
 *                description、tags、schema_url）+ GET /api/v1/models（补充源：profile 长描述、
 *                readme/docs、封面），各自原样落盘 buckets/providers/raw/atlas-cloud.raw.json。
 *                注意：GET /v1/models 是 LLM 列表，不含媒体模型，不再使用。
 *   transform —— catalog 条目按 type（image/video/audio，chat 排除）→ capability；
 *                pricing 归一化（image $x/张、video $x/秒含分辨率分档、token 价 $x/M）；
 *                语音模型从 schema 提取 per-model 音色（voice/voice_id 或
 *                references[].speaker 枚举）与请求形态 speechStyle（如 "seed-audio"）；
 *                sources/atlas-cloud.models.json 策展段优先（补 referenceBudgets）；
 *                sources/atlas-cloud.pricing.json 人工价格优先；overrides.json 修正面。
 *
 * 环境变量：ATLASCLOUD_API_KEY（可选）、ATLAS_API_BASE。
 */

const API_BASE = (process.env.ATLAS_API_BASE ?? "https://api.atlascloud.ai").replace(/\/$/, "");

const capabilityByType = { image: "image.generate", video: "video.generate", audio: "speech.generate" };
const defaultOutputs = {
  image: ["size", "quality"],
  video: ["durationSeconds", "aspectRatio", "resolution"],
  speech: ["voice", "speed"],
};

/** per-token 美元 → $x.xx / M tokens 展示串。 */
function formatTokenPrice(perToken) {
  const perMillion = Number(perToken) * 1_000_000;
  if (!Number.isFinite(perMillion) || perMillion <= 0) return "";
  const digits = perMillion < 0.1 ? 3 : perMillion < 1 ? 2 : 1;
  return `$${perMillion.toFixed(digits)}/M`;
}

function dollars(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `$${n.toFixed(digits)}`;
}

/** catalog pricing 归一化为展示串：image $x/张；video $x/秒（多分辨率给区间）；token 价 $x/M。 */
function pricingFor(entry) {
  const price = entry.pricing ?? {};
  const lines = [];
  const perImage = dollars(price.image, price.image < 0.1 ? 4 : 2);
  if (perImage) lines.push(`≈ ${perImage}/张`);
  const perSecond = dollars(price.video, price.video < 0.1 ? 3 : 2);
  if (perSecond && price.unit === "second") {
    const tiers = (price.resolutions ?? []).filter((tier) => Number(tier.video) > 0).map((tier) => `${dollars(tier.video, tier.video < 0.1 ? 3 : 2)}/秒（${tier.resolution}）`);
    lines.push(tiers.length > 1 ? `≈ ${tiers.join(" – ")}` : `≈ ${perSecond}/秒`);
  }
  const input = formatTokenPrice(price.prompt);
  const output = formatTokenPrice(price.completion);
  if (input && output && input !== output) lines.push(`输入 ${input} · 输出 ${output}`);
  else if (input && !perImage && !perSecond) lines.push(`输入/输出 ${input}`);
  return lines.join("\n");
}

/** 剥离 sources 里以 "_" 开头的注释键。 */
function stripCommentKeys(model) {
  return Object.fromEntries(Object.entries(model).filter(([key]) => !key.startsWith("_")));
}

const mediaKinds = new Set(["text", "image", "video", "audio"]);
const parameterTypes = new Set(["string", "integer", "number", "boolean", "array"]);

/** 简单并发池：保持上游 schema 拉取并行但不过量。 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const schemaCache = new Map();

/** 拉取并缓存一个模型的 OpenAPI schema（失败静默返回 null，模型照常上架）。 */
function readSchema(url) {
  if (!url) return Promise.resolve(null);
  if (!schemaCache.has(url)) {
    schemaCache.set(url, (async () => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    })());
  }
  return schemaCache.get(url);
}

/**
 * 从模型 OpenAPI schema 提取 per-model 参数面：
 *   - referenceFields：图片/视频/音频参考分别落到哪个上游字段（images/image 等）；
 *   - parameters：其余可提交字段（name = providerKey = 上游字段名），带类型/enum/默认/范围/必填。
 * model/prompt 与参考字段由平台统一承载，不作为用户参数暴露。
 */
function schemaSurface(schema) {
  const input = schema?.components?.schemas?.Input;
  const properties = input?.properties ?? {};
  const required = new Set(input?.required ?? []);
  const referenceFields = {};
  const referenceNames = new Set();
  const referenceSpecs = [
    ["image", ["images", "image"]],
    ["video", ["videos", "video"]],
    ["audio", ["audios", "audio"]],
  ];
  for (const [kind, names] of referenceSpecs) {
    const name = names.find((candidate) => properties[candidate]);
    if (name) {
      referenceFields[kind] = name;
      referenceNames.add(name);
    }
  }
  const parameters = [];
  for (const [name, property] of Object.entries(properties)) {
    if (name === "model" || name === "prompt" || name === "text" || referenceNames.has(name)) continue;
    const type = property.type ?? "string";
    if (!parameterTypes.has(type)) continue;
    const parameter = { name, providerKey: name, type };
    if (Array.isArray(property.enum) && property.enum.length) {
      parameter.enum = property.enum.filter((value) => value !== null).map(String);
    }
    if ("default" in property && property.default !== null) parameter.default = property.default;
    if (required.has(name)) parameter.required = true;
    if (typeof property.minimum === "number") parameter.minimum = property.minimum;
    if (typeof property.maximum === "number") parameter.maximum = property.maximum;
    if (typeof property.description === "string" && property.description.trim()) parameter.description = property.description.trim();
    parameters.push(parameter);
  }
  return { parameters, referenceFields };
}

/** voice 参数（enum + x-enum-options）→ 音色清单；无枚举返回 null。 */
function voicesFromVoiceParam(voiceParam) {
  if (!Array.isArray(voiceParam?.enum) || !voiceParam.enum.length) return null;
  const options = voiceParam["x-enum-options"] ?? {};
  return voiceParam.enum
    .filter((id) => typeof id === "string" && id)
    .map((id) => {
      const option = options[id] ?? {};
      const voice = { id, name: option.name || id, category: option.language || "multilingual" };
      if (option.example) voice.previewUrl = option.example;
      return voice;
    });
}

/** 定位承载音色的 schema 参数：顶层 voice/voice_id，或 references[].speaker（Seed Audio 形态）。 */
function voiceParamFromSchema(schema) {
  const properties = schema?.components?.schemas?.Input?.properties ?? {};
  return properties.voice_id ?? properties.voice ?? properties.references?.items?.properties?.speaker;
}

/**
 * 从已解析的模型 schema（OpenAPI）提取 per-model 内置音色清单：voice/voice_id 或
 * references[].speaker 的 enum + x-enum-options（name / example 试听 mp3 / language）。
 * 音色随模型走，不同 TTS 模型的音色集不通用；解析失败返回 null（模型照常上架，只是无 voices）。
 */
function voicesFromSchemaObject(schema) {
  return voicesFromVoiceParam(voiceParamFromSchema(schema));
}

/**
 * 从 schema 推断语音请求形态：音色经 references[].speaker 提交的（Seed Audio）标记为
 * "seed-audio"，其余留空走默认 xAI/tts 形状。纯 schema 判定，不硬编码模型 ID。
 */
function speechStyleFromSchema(schema) {
  const properties = schema?.components?.schemas?.Input?.properties ?? {};
  return properties.references?.items?.properties?.speaker ? "seed-audio" : "";
}

export default {
  id: "atlas-cloud",

  /** 阶段一：拉取媒体模型两个原始列表（失败不阻塞，transform 退化为纯策展段）。 */
  async fetchRaw({ env, fetchJSON }) {
    const headers = env.ATLASCLOUD_API_KEY || env.ATLAS_API_KEY ? { Authorization: `Bearer ${env.ATLASCLOUD_API_KEY ?? env.ATLAS_API_KEY}` } : {};
    const snapshot = {};
    for (const [key, path] of [["catalog", "/api/v1/catalog/models"], ["enrichment", "/api/v1/models"]]) {
      const source = `GET ${API_BASE}${path}`;
      try {
        snapshot[key] = { source, upstream: await fetchJSON(`${API_BASE}${path}`, { headers }) };
      } catch (error) {
        console.warn(`  [warn] ${source} 拉取失败（${error.message}）`);
        snapshot[key] = { source, upstream: null, error: error.message };
      }
    }
    return snapshot;
  },

  /** 阶段二：原始 catalog 条目 + 策展/价格/修正 sources → 富 meta catalog 候选。 */
  async transform({ raw, readJSON, sourcesDir }) {
    const pricingManual = readJSON(`${sourcesDir}/atlas-cloud.pricing.json`, {});
    const overrides = readJSON(`${sourcesDir}/atlas-cloud.overrides.json`, {});
    const curated = readJSON(`${sourcesDir}/atlas-cloud.models.json`, []);
    const models = new Map();
    // 策展段优先：referenceBudgets、上游列表缺失/异常的模型都在这里。
    for (const entry of curated) {
      const model = stripCommentKeys(entry);
      const normalized = { provider: "atlas-cloud", available: true, configurable: true, ...model, id: model.id.startsWith("atlas-cloud/") ? model.id : `atlas-cloud/${model.id}` };
      if (!normalized.meta?.pricing) {
        const price = pricingManual[normalized.id] ?? pricingManual[normalized.apiModelId];
        if (price) normalized.meta = { ...normalized.meta, pricing: price };
      }
      models.set(normalized.id, normalized);
    }
    // 上游全量：catalog 条目为主，/api/v1/models 的 profile/readme 按模型 ID 合并补 meta。
    const entries = raw?.catalog?.upstream?.data ?? [];
    const enrich = new Map((raw?.enrichment?.upstream?.data ?? []).map((item) => [item.model, item]));
    // 图像模型在上游按变体拆分（<base>/text-to-image + <base>/edit），每个变体
    // 都是 Atlas 官网可独立选购的模型，作为独立平台条目输出（edit 变体自带
    // ["text","image"] 输入模态，服务端按 apiModelId 提交，无需合并）。
    const upstream = [];
    for (const entry of entries) {
      const kind = entry.media_type ?? entry.type;
      if (kind === "image" || kind === "video" || kind === "audio") {
        upstream.push({ entry, platformBase: entry.id });
      }
    }
    // 逐模型拉取上游 schema：参数面由 schema 驱动，新增模型零代码。
    const schemas = await mapLimit(upstream, 12, ({ entry }) => readSchema(entry.schema_url));
    // 语音模型的音色/请求形态统一在下方按 platform 模型 ID 回查 schema：catalog 优先，
    // /v1/models 的 enrichment schema 兜底（两者多为同一 URL）。
    const schemaByPlatformID = new Map();
    for (let index = 0; index < upstream.length; index += 1) {
      const { entry, platformBase } = upstream[index];
      const kind = entry.media_type ?? entry.type;
      const capability = capabilityByType[kind];
      if (!capability) continue; // chat 及未知类型排除
      const apiModelId = entry.id;
      const platformID = `atlas-cloud/${platformBase}`;
      if (models.has(platformID)) continue;
      const extra = enrich.get(apiModelId) ?? {};
      const inputModes = (entry.input_modalities ?? ["text"]).filter((mode) => mediaKinds.has(mode));
      const meta = {};
      const summary = (typeof extra.profile === "string" && extra.profile.trim()) || (typeof entry.description === "string" && entry.description.trim()) || "";
      if (summary) meta.summary = summary;
      const pricingLine = pricingManual[platformID] ?? pricingManual[apiModelId] ?? pricingFor(entry);
      if (pricingLine) meta.pricing = pricingLine;
      if (extra.readme) meta.docsUrl = extra.readme;
      if (Array.isArray(entry.tags) && entry.tags.length) meta.tags = entry.tags;
      if (Number.isFinite(entry.context_length) && entry.context_length > 0) meta.contextLength = entry.context_length;
      // 语音模型走平台 voice/engine 契约（output.voiceId + codec/sampleRate），
      // 不暴露 schema 参数，避免与 reserved 键（format/speed…）冲突。
      // 非语音：schema 抓到就落 parameters（即使为空数组 = 声明「无可调项」），
      // 让 applyModelSurfaces 能区分「已解析为空」与「没有 schema」。
      const schema = schemas[index];
      if (schema) schemaByPlatformID.set(platformID, schema);
      const surface = capability === "speech.generate" || !schema ? null : schemaSurface(schema);
      const outputKey = capability === "image.generate" ? "image" : capability === "video.generate" ? "video" : "speech";
      models.set(platformID, {
        id: platformID,
        provider: "atlas-cloud",
        name: extra.displayName || entry.name || platformBase,
        capability,
        apiModelId,
        inputModes: inputModes.length ? inputModes : ["text"],
        outputModes: defaultOutputs[outputKey],
        available: true,
        configurable: true,
        ...(surface ? { parameters: surface.parameters } : {}),
        ...(surface && Object.keys(surface.referenceFields).length ? { referenceFields: surface.referenceFields } : {}),
        ...(Object.keys(meta).length ? { meta } : {}),
      });
    }
    for (const model of models.values()) {
      const override = overrides[model.id];
      if (!override) continue;
      if (override.capability) model.capability = override.capability;
      if (override.inputModes) model.inputModes = override.inputModes;
      if (override.name) model.name = override.name;
      if (override.summary || override.docsUrl || override.tags) model.meta = { ...model.meta, summary: override.summary, docsUrl: override.docsUrl, tags: override.tags };
      if (override.status) model.status = override.status;
    }
    // per-model 内置音色与请求形态：语音模型从其 schema 提取（音色随模型走，不同 TTS
    // 模型的音色集不通用）。不再按模型名猜 TTS——ASR/音乐等没有音色枚举，自然为空；
    // 缺 schema 或解析失败照常上架，只是不带 voices/speechStyle。
    for (const model of models.values()) {
      if (model.capability !== "speech.generate") continue;
      const schema = (await readSchema(enrich.get(model.apiModelId)?.schema)) ?? schemaByPlatformID.get(model.id) ?? null;
      if (!schema) continue;
      const voices = voicesFromSchemaObject(schema);
      if (voices?.length) model.voices = voices;
      const speechStyle = speechStyleFromSchema(schema);
      if (speechStyle) model.speechStyle = speechStyle;
    }
    return {
      provider: { id: "atlas-cloud", name: "Atlas Cloud", protocol: "atlas", defaultApiBase: API_BASE },
      models: [...models.values()],
    };
  },
};
