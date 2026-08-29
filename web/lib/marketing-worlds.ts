/*
 * [INPUT]: 依赖全局 fetch 与 CDN 上的 World 发布目录（https://cdn.recut.video/worlds/catalog.json）及各 world.json manifest（world 概览、entities 摘要、evidence 图片 URL）
 * [OUTPUT]: 对外提供官网营销用的静态 World 目录数据 MarketingWorld（名称/类型/定位/语气/受众/封面/图片/实体摘要）与 fetchMarketingWorlds()；CDN 不可达时返回空数组降级，不抛错
 * [POS]: web/lib 的公开营销内容加载器；只在服务端页面（首页 /worlds）构建期导入，客户端组件一律经 props 接收数据；绝不读取本地 service 或工作台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export type MarketingWorldEntity = { id: string; kind: string; title: string; summary: string };

export type MarketingWorld = {
  id: string;
  name: string;
  type: string;
  version: string;
  description: string;
  positioning: string;
  tone: string;
  audience: string[];
  coverUrl: string;
  images: string[];
  entities: MarketingWorldEntity[];
};

type CatalogEntry = { id?: string; manifestUrl?: string; status?: string; version?: string; order?: number };

type ManifestWorld = {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
  coverUrl?: string;
  identity?: { positioning?: string; tone?: string; audience?: string[] | string };
};

type ManifestEntity = { id?: string; kind?: string; title?: string; summary?: string; content?: Record<string, unknown> };

type ManifestEvidence = { modality?: string; url?: string; status?: string };

type WorldManifest = {
  world?: ManifestWorld;
  entities?: ManifestEntity[];
  evidence?: ManifestEvidence[];
};

const MARKETING_ENTITY_KINDS = new Set(["character", "location", "story", "style", "rule"]);
const MAX_IMAGES_PER_WORLD = 6;
const MAX_ENTITIES_PER_WORLD = 6;

// 构建期多个页面/worker 共享同一次抓取结果：memoize + Next 数据缓存（revalidate 1h），
// 避免某一页的瞬时网络失败让该页静默丢失整个世界观区块。
let worldsPromise: Promise<MarketingWorld[]> | null = null;

export function fetchMarketingWorlds(): Promise<MarketingWorld[]> {
  worldsPromise ??= loadMarketingWorlds();
  return worldsPromise;
}

async function loadMarketingWorlds(): Promise<MarketingWorld[]> {
  try {
    const catalog = await fetchJSON("https://cdn.recut.video/worlds/catalog.json") as { worlds?: CatalogEntry[] } | null;
    if (!catalog?.worlds?.length) return [];
    const ORDER = ["pgc.xiaohuige", "pgc.chengzi", "pgc.adan", "pgc.xiaohei"];
    const entries = catalog.worlds
      .filter((entry) => entry.manifestUrl && entry.status !== "archived")
      .sort((a, b) => {
        const ia = ORDER.indexOf(a.id ?? "");
        const ib = ORDER.indexOf(b.id ?? "");
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return (a.order ?? 0) - (b.order ?? 0);
      });
    const settled = await Promise.allSettled(entries.map((entry) => fetchWorld(entry)));
    const worlds = settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
    worlds.sort((a, b) => {
      const ia = ORDER.indexOf(a.id);
      const ib = ORDER.indexOf(b.id);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return 0;
    });
    return worlds;
  } catch {
    return [];
  }
}

async function fetchWorld(entry: CatalogEntry): Promise<MarketingWorld | null> {
  const manifest = await fetchJSON(entry.manifestUrl as string) as WorldManifest | null;
  const world = manifest?.world;
  if (!world?.name) return null;
  const identity = world.identity ?? {};
  const evidenceImages = (manifest?.evidence ?? [])
    .filter((item) => item.modality === "image" && typeof item.url === "string")
    .sort((a, b) => (a.status === "primary" ? -1 : 0) - (b.status === "primary" ? -1 : 0))
    .map((item) => item.url as string)
    .slice(0, MAX_IMAGES_PER_WORLD);
  const entities = (manifest?.entities ?? [])
    .filter((entity) => MARKETING_ENTITY_KINDS.has(entity.kind ?? ""))
    .map((entity) => ({
      id: entity.id ?? "",
      kind: entity.kind ?? "",
      title: entity.title ?? "",
      summary: entity.summary ?? (typeof entity.content?.text === "string" ? entity.content.text : ""),
    }))
    .filter((entity) => entity.title)
    .slice(0, MAX_ENTITIES_PER_WORLD);
  return {
    id: world.id ?? entry.id ?? "",
    name: world.name,
    type: world.type ?? "",
    version: entry.version ?? "",
    description: world.description ?? "",
    positioning: identity.positioning ?? "",
    tone: identity.tone ?? "",
    audience: Array.isArray(identity.audience) ? identity.audience : typeof identity.audience === "string" ? [identity.audience] : [],
    coverUrl: world.coverUrl || evidenceImages[0] || "",
    images: evidenceImages,
    entities,
  };
}

async function fetchJSON(url: string): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { next: { revalidate: 3600 } });
      if (response.ok) return response.json();
      if (response.status >= 500 || response.status === 429) { lastError = new Error(`HTTP ${response.status}`); continue; }
      return null;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) console.warn(`marketing-worlds: failed to fetch ${url}`, lastError);
  return null;
}
