/**
 * MiniMax fetcher：人工策展为主（MiniMax 无公开 /v1/models 端点），rfc §3.2。
 *
 * 两阶段：
 *   fetchRaw  —— 可选：设置 MINIMAX_API_KEY 时经 POST /v1/get_voice 拉取系统音色
 *                原始响应，落盘到 buckets/providers/raw/minimax.raw.json（无 key 时
 *                快照记空，transform 保留旧 extensions 缓存不动）；
 *   transform —— sources/minimax.models.json（speech-2.8 系列 / T2V / Hailuo 视频
 *                模型，以官方定价页为准，人工维护）→ catalog 候选。
 */

const API_BASE = (process.env.MINIMAX_API_BASE ?? "https://api.minimaxi.com").replace(/\/$/, "");

export default {
  id: "minimax",

  /** 阶段一：拉取 voices 原始响应（可选，失败不阻塞）。 */
  async fetchRaw({ env, fetchJSON }) {
    if (!env.MINIMAX_API_KEY) {
      return { source: null, upstream: null, note: "未设置 MINIMAX_API_KEY，跳过 voices 在线刷新" };
    }
    const source = "POST /v1/get_voice";
    try {
      const response = await fetchJSON(`${API_BASE}/v1/get_voice`, { method: "POST", headers: { Authorization: `Bearer ${env.MINIMAX_API_KEY}` }, body: JSON.stringify({ voice_type: "all" }) });
      return { source, upstream: response?.base_resp?.status_code === 0 ? response : null, error: response?.base_resp?.status_code !== 0 ? `status_code=${response?.base_resp?.status_code}` : undefined };
    } catch (error) {
      console.warn(`  [warn] ${source} 拉取失败（${error.message}），原始快照记为空`);
      return { source, upstream: null, error: error.message };
    }
  },

  /** 阶段二：策展模型 + voices 原始响应归一化 → catalog 候选。 */
  async transform({ raw, readJSON, sourcesDir, previous }) {
    const curated = readJSON(`${sourcesDir}/minimax.models.json`, []);
    if (!curated.length) throw new Error("sources/minimax.models.json 为空；MiniMax 模型清单需要人工策展");
    const models = curated
      .filter((model) => !model._comment)
      .map((model) => ({ provider: "minimax", available: true, configurable: true, referenceBudgets: [], ...model, id: model.id.startsWith("minimax/") ? model.id : `minimax/${model.id}` }));
    const extensions = { ...(previous?.extensions ?? {}) };
    if (raw?.upstream) {
      const response = raw.upstream;
      const voices = [...(response.system_voice ?? []), ...(response.voice_cloning ?? []), ...(response.voice_generation ?? [])].map((voice) => ({ id: voice.voice_id, name: voice.voice_name || voice.voice_id, category: response.system_voice?.some((item) => item.voice_id === voice.voice_id) ? "system" : "cloning", description: (voice.description ?? []).join(" · ") }));
      if (voices.length) extensions.voices = voices;
    }
    return {
      provider: { id: "minimax", name: "MiniMax", protocol: "minimax", defaultApiBase: API_BASE },
      models,
      extensions,
    };
  },
};
