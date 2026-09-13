/*
 * [INPUT]: 依赖全局 fetch 与 CDN 上的 World 发布目录（https://cdn.recut.video/worlds/catalog.json）及各 world.json manifest
 *   （v2：entityTypes + 统一 entities[attrs/media] + canvases；旧 v1 evidence 仍兼容读取）
 * [OUTPUT]: 对外提供官网营销用的静态 World 目录数据 MarketingWorld（名称/类型/定位/语气/受众/封面/图片/实体摘要/
 *   只读画布投影 canvas）与 fetchMarketingWorlds()；CDN 不可达时返回空数组降级，不抛错
 * [POS]: web/lib 的公开营销内容加载器；只在服务端页面（首页 /worlds）构建期导入，客户端组件一律经 props 接收数据；
 *   绝不读取本地 service 或工作台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export type MarketingWorldEntity = { id: string; kind: string; title: string; summary: string; imageUrl?: string };

export type MarketingCanvasElement =
  | { kind: "entity"; key: string; x: number; y: number; width: number; height: number; name: string; imageUrl: string; typeLabel: string }
  | { kind: "media"; key: string; x: number; y: number; width: number; height: number; url: string; name: string }
  | { kind: "note"; key: string; x: number; y: number; width: number; height: number; text: string };

export type MarketingWorldCanvas = { width: number; height: number; elements: MarketingCanvasElement[] };

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
  /** 只读画布投影（manifest.canvases 根文档；无画布时为空）。 */
  canvas: MarketingWorldCanvas | null;
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

type ManifestMediaValue = { url?: string; assetId?: string; kind?: string; name?: string };
type ManifestAttr = { key?: string; label?: string; type?: string; value?: unknown };
type ManifestEntity = {
  id?: string;
  kind?: string;
  typeId?: string;
  title?: string;
  name?: string;
  summary?: string;
  intro?: string;
  attrs?: ManifestAttr[];
  content?: Record<string, unknown>;
};
type ManifestEvidence = { modality?: string; url?: string; status?: string; entityId?: string };
type ManifestCanvasElement = {
  id?: string;
  kind?: string;
  refKind?: string;
  refId?: string;
  name?: string;
  props?: Record<string, unknown>;
  geometry?: { x?: number; y?: number; width?: number; height?: number };
};
type ManifestCanvas = { contextId?: string; elements?: ManifestCanvasElement[] };

type WorldManifest = {
  manifestVersion?: number;
  world?: ManifestWorld;
  entities?: ManifestEntity[];
  evidence?: ManifestEvidence[];
  canvases?: ManifestCanvas[];
};

const MARKETING_ENTITY_KINDS = new Set(["character", "location", "object", "story", "style", "rule"]);
const MAX_IMAGES_PER_WORLD = 6;
const MAX_ENTITIES_PER_WORLD = 6;
const MAX_CANVAS_ELEMENTS = 60;

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

function attrMedia(value: unknown): ManifestMediaValue | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url : "";
  const assetId = typeof record.assetId === "string" ? record.assetId : "";
  if (!url && !assetId) return null;
  return { url, assetId, kind: typeof record.kind === "string" ? record.kind : undefined, name: typeof record.name === "string" ? record.name : undefined };
}

/** 实体 v2 media attrs / v1 content 里的图片 url（entity → 图片）。 */
function entityImages(entity: ManifestEntity): string[] {
  const urls: string[] = [];
  for (const attr of entity.attrs ?? []) {
    if (attr.type !== "media") continue;
    const media = attrMedia(attr.value);
    if (media?.url && (media.kind ?? "image") === "image") urls.push(media.url);
  }
  for (const [key, value] of Object.entries(entity.content ?? {})) {
    const media = attrMedia(value);
    if (media?.url && key !== "body") urls.push(media.url);
  }
  return urls;
}

function entityID(entity: ManifestEntity): string {
  return entity.id ?? "";
}

/** v2 manifest → 只读画布投影（根文档）；实体元素解析为实体卡（名称/封面/类型）。 */
function buildCanvas(manifest: WorldManifest, imagesById: Map<string, string>): MarketingWorldCanvas | null {
  const root = (manifest.canvases ?? []).find((canvas) => !canvas.contextId) ?? (manifest.canvases ?? [])[0];
  if (!root?.elements?.length) return null;
  const byId = new Map((manifest.entities ?? []).map((entity) => [entityID(entity), entity]));
  const elements: MarketingCanvasElement[] = [];
  let maxX = 0;
  let maxY = 0;
  for (const element of root.elements.slice(0, MAX_CANVAS_ELEMENTS)) {
    const x = Number(element.geometry?.x) || 0;
    const y = Number(element.geometry?.y) || 0;
    const width = Number(element.geometry?.width) || 220;
    const height = Number(element.geometry?.height) || 140;
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
    if (element.kind === "entity" || element.refKind === "entity") {
      const rawRef = element.refId ?? "";
      const localRef = rawRef.includes(":") ? rawRef.slice(rawRef.indexOf(":") + 1) : rawRef;
      const entity = byId.get(rawRef) ?? byId.get(localRef);
      elements.push({
        kind: "entity",
        key: element.id ?? rawRef,
        x, y, width, height,
        name: entity?.name ?? entity?.title ?? element.name ?? localRef,
        imageUrl: entity ? imagesById.get(entityID(entity)) ?? "" : "",
        typeLabel: (entity?.typeId ?? entity?.kind ?? "object").toString(),
      });
      continue;
    }
    const props = element.props ?? {};
    const url = typeof props.url === "string" ? props.url : "";
    if (url) {
      elements.push({ kind: "media", key: element.id ?? url, x, y, width, height, url, name: element.name ?? String(props.label ?? "素材") });
      continue;
    }
    const text = typeof props.text === "string" && props.text.trim() ? props.text.trim() : "";
    if (text) elements.push({ kind: "note", key: element.id ?? text, x, y, width, height, text });
  }
  if (!elements.length) return null;
  return { width: maxX + 40, height: maxY + 40, elements };
}

async function fetchWorld(entry: CatalogEntry): Promise<MarketingWorld | null> {
  const manifest = await fetchJSON(entry.manifestUrl as string) as WorldManifest | null;
  const world = manifest?.world;
  if (!world?.name) return null;
  const identity = world.identity ?? {};
  const isV2 = manifest?.manifestVersion === 2;

  const entities = (manifest?.entities ?? []).filter((entity) => {
    const kind = entity.typeId ?? entity.kind ?? "";
    return MARKETING_ENTITY_KINDS.has(kind);
  });
  const imagesById = new Map<string, string>();
  const entityImagesList: string[] = [];
  for (const entity of entities) {
    const urls = entityImages(entity);
    if (urls[0]) imagesById.set(entityID(entity), urls[0]);
    entityImagesList.push(...urls);
  }
  // v1 manifest 无 attrs：回退 evidence 图片。
  const evidenceImages = (manifest?.evidence ?? [])
    .filter((item) => item.modality === "image" && typeof item.url === "string")
    .sort((a, b) => (a.status === "primary" ? -1 : 0) - (b.status === "primary" ? -1 : 0))
    .map((item) => item.url as string);
  const allImages = [...new Set([...entityImagesList, ...(isV2 ? [] : evidenceImages)])].slice(0, MAX_IMAGES_PER_WORLD);

  const projectedEntities = entities.slice(0, MAX_ENTITIES_PER_WORLD).map((entity) => ({
    id: entityID(entity),
    kind: (entity.typeId ?? entity.kind ?? "").toString(),
    title: entity.name ?? entity.title ?? "",
    summary: entity.intro ?? entity.summary ?? (typeof entity.content?.text === "string" ? entity.content.text : ""),
    imageUrl: imagesById.get(entityID(entity)),
  })).filter((entity) => entity.title);

  return {
    id: world.id ?? entry.id ?? "",
    name: world.name,
    type: world.type ?? "",
    version: entry.version ?? "",
    description: world.description ?? "",
    positioning: identity.positioning ?? "",
    tone: identity.tone ?? "",
    audience: Array.isArray(identity.audience) ? identity.audience : typeof identity.audience === "string" ? [identity.audience] : [],
    coverUrl: world.coverUrl || allImages[0] || evidenceImages[0] || "",
    images: allImages.length ? allImages : evidenceImages.slice(0, MAX_IMAGES_PER_WORLD),
    entities: projectedEntities,
    canvas: isV2 ? buildCanvas(manifest!, imagesById) : null,
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
