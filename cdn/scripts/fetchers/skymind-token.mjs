/**
 * Skymind Token API（new-api 网关）fetcher：rfc §3.2。
 *
 * 两阶段：
 *   fetchRaw  —— GET /v1/models 原始清单原样落盘到 buckets/providers/raw/skymind-token.raw.json
 *                （无 key 返回 401 时快照记空）；
 *   transform —— 原始清单按 supported_endpoint_types / 模型 ID 形态映射能力 +
 *                sources/skymind-token.models.json 人工策展段（视频等 /v1/models
 *                拿不到的模型）合并，策展段优先。
 *
 * 环境变量：SKYMIND_API_KEY（可选）、SKYMIND_API_BASE。
 */

const API_BASE = (process.env.SKYMIND_API_BASE ?? "https://token-api.skymind.pro").replace(/\/$/, "");

function inferFromEntry(entry) {
  const id = entry.id ?? "";
  const lower = id.toLowerCase();
  const endpoints = entry.supported_endpoint_types ?? [];
  // 图像：gpt-image / gemini-*-image / 任意 *image* 命名（new-api 网关不标 output_modalities）。
  if (endpoints.some((type) => type.includes("image")) || lower.includes("image")) return { capability: "image.generate", inputModes: ["text", "image"] };
  if (lower.includes("seedance")) return { capability: "video.generate", inputModes: ["text", "image", "video", "audio"] };
  if (lower.includes("tts") || lower.includes("speech")) return { capability: "speech.generate", inputModes: ["text"] };
  return null;
}

/** 剥离 sources 里以 "_" 开头的注释键。 */
function stripCommentKeys(model) {
  return Object.fromEntries(Object.entries(model).filter(([key]) => !key.startsWith("_")));
}

export default {
  id: "skymind-token",

  /** 阶段一：拉取上游原始模型清单（401/失败不阻塞，transform 退化为纯策展段）。 */
  async fetchRaw({ env, fetchJSON }) {
    const source = `GET ${API_BASE}/v1/models`;
    const headers = env.SKYMIND_API_KEY ? { Authorization: `Bearer ${env.SKYMIND_API_KEY}` } : {};
    try {
      const payload = await fetchJSON(`${API_BASE}/v1/models`, { headers });
      return { source, upstream: payload };
    } catch (error) {
      console.warn(`  [warn] ${source} 拉取失败（${error.message}），原始快照记为空`);
      return { source, upstream: null, error: error.message };
    }
  },

  /** 阶段二：原始清单 + 策展段 → catalog 候选。 */
  async transform({ raw, readJSON, sourcesDir }) {
    const models = new Map();
    for (const entry of raw?.upstream?.data ?? []) {
      const inferred = inferFromEntry(entry);
      if (!inferred) continue;
      models.set(`skymind-token/${entry.id}`, {
        id: `skymind-token/${entry.id}`,
        provider: "skymind-token",
        name: entry.id,
        capability: inferred.capability,
        apiModelId: entry.id,
        inputModes: inferred.inputModes,
        outputModes: inferred.capability === "image.generate" ? ["size", "quality"] : ["durationSeconds", "aspectRatio", "resolution"],
        available: true,
        configurable: true,
      });
    }
    for (const entry of readJSON(`${sourcesDir}/skymind-token.models.json`, [])) {
      const model = stripCommentKeys(entry);
      const normalized = { provider: "skymind-token", available: true, configurable: true, referenceBudgets: [], ...model, id: model.id.startsWith("skymind-token/") ? model.id : `skymind-token/${model.id}` };
      models.set(normalized.id, normalized);
    }
    return {
      provider: { id: "skymind-token", name: "Skymind Token API", protocol: "skymind", defaultApiBase: API_BASE },
      models: [...models.values()],
    };
  },
};
