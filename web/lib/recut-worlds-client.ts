/*
 * [INPUT]: 依赖 service 的 /v1/worlds REST facade 与结构化错误信封
 * [OUTPUT]: 对外提供浏览器端 recut.worlds 契约的唯一传输适配器：World/Entity 分页读取、创建/修改/Reference/Resolve
 * 与项目 World Context 读写的类型化方法；只被原生 Recut 页面（/worlds、Studio、Chat attachment picker）使用，App iframe 永不经它
 * [POS]: web/lib 的 Creation Worlds HTTP 客户端；请求/响应与全局 SDK 及 MCP 同构，错误统一解包为
 * RecutWorldsError，绝不把 Go error 字符串当作稳定契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export type WorldKind = "character_ip" | "creator_brand" | "brand" | "fiction_world" | "custom";
export type EntityKind = "character" | "location" | "story" | "style" | "rule" | "reference";
export type WorldPurpose = "chat" | "video" | "voice" | "image" | "cover" | "agent";
export type Page<T> = { items: T[]; nextCursor?: string };

export type WorldSummary = {
  id: string;
  name: string;
  type: WorldKind;
  description: string;
  coverAssetId?: string;
  currentRevisionId: string;
  entityCounts: Partial<Record<EntityKind, number>>;
  updatedAt: string;
};

export type WorldRevisionView = { id: string; canonicalHash: string; createdAt: string };

export type WorldDetail = WorldSummary & {
  identity: Record<string, unknown>;
  revision: WorldRevisionView;
  availableEntityKinds: EntityKind[];
};

export type WorldEntitySummary = {
  id: string;
  worldId: string;
  kind: EntityKind;
  title: string;
  summary: string;
  updatedAt: string;
};

export type WorldEntityRelation = { id: string; type: string; fromEntityId: string; toEntityId: string };

export type WorldAssetReference = { id?: string; assetId: string; role: string; label?: string; entityId?: string };

export type WorldEntity = WorldEntitySummary & {
  content: Record<string, unknown>;
  relations: WorldEntityRelation[];
  references: WorldAssetReference[];
};

export type WorldSelection = {
  storyId?: string;
  entityIds?: string[];
  assetRoles?: string[];
  purpose: WorldPurpose;
};

export type CreationContext = {
  world: { id: string; name: string; revisionId: string; canonicalHash: string };
  selection: WorldSelection;
  identity: Record<string, unknown>;
  entities: {
    characters?: Array<Record<string, unknown>>;
    locations?: Array<Record<string, unknown>>;
    stories?: Array<Record<string, unknown>>;
    styles?: Array<Record<string, unknown>>;
    rules?: Array<Record<string, unknown>>;
    story?: Record<string, unknown>;
  };
  constraints: { always?: string[]; never?: string[]; prefer?: string[] };
  references: WorldAssetReference[];
};

export type CreationContextBinding = {
  id: string;
  targetType: string;
  targetId: string;
  worldId: string;
  revisionId: string;
  selection: WorldSelection;
  role: string;
  createdAt: string;
};

export type RecutWorldsErrorCode =
  | "WORLD_NOT_FOUND"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_WORLD_MISMATCH"
  | "WORLD_REVISION_NOT_FOUND"
  | "WORLD_REVISION_CONFLICT"
  | "WORLD_CONTEXT_INVALID"
  | "ASSET_NOT_FOUND"
  | "ASSET_NOT_READY"
  | "PROJECT_WORLD_ALREADY_BOUND"
  | "WORLD_ACCESS_DENIED";

export class RecutWorldsError extends Error {
  readonly code: RecutWorldsErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: RecutWorldsErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RecutWorldsError";
    this.code = code;
    this.details = details;
  }
}

export const worldKindLabels: Record<WorldKind, string> = {
  character_ip: "角色 IP",
  creator_brand: "内容账号",
  brand: "品牌",
  fiction_world: "故事世界",
  custom: "自定义",
};

export const entityKindLabels: Record<EntityKind, string> = {
  character: "角色",
  location: "地点",
  story: "故事",
  style: "风格",
  rule: "规则",
  reference: "参考",
};

const referenceRoles = ["character_reference", "voice_reference", "location_reference", "style_reference", "story_reference", "brand_reference"];

export const referenceRoleLabels: Record<string, string> = {
  character_reference: "角色参考",
  voice_reference: "声音参考",
  location_reference: "地点参考",
  style_reference: "风格参考",
  story_reference: "故事参考",
  brand_reference: "品牌参考",
};

export function isReferenceRole(value: string): value is (typeof referenceRoles)[number] {
  return referenceRoles.includes(value);
}

export function worldTypes(): WorldKind[] {
  return ["character_ip", "creator_brand", "brand", "fiction_world", "custom"];
}

export function entityKinds(): EntityKind[] {
  return ["character", "location", "story", "style", "rule", "reference"];
}

export type RecutWorldsClient = {
  list(input?: { text?: string; type?: WorldKind; cursor?: string; limit?: number }): Promise<Page<WorldSummary>>;
  get(input: { worldId: string }): Promise<WorldDetail>;
  create(input: { name: string; type: WorldKind; description?: string; identity?: Record<string, unknown>; coverAssetId?: string }): Promise<WorldDetail>;
  update(input: { worldId: string; name?: string; description?: string; identity?: Record<string, unknown>; expectedRevisionId?: string }): Promise<WorldDetail>;
  entities: {
    list(input: { worldId: string; kind?: EntityKind; text?: string; cursor?: string; limit?: number }): Promise<Page<WorldEntitySummary>>;
    get(input: { worldId: string; entityId: string }): Promise<WorldEntity>;
    upsert(input: { worldId: string; entityId?: string; kind: EntityKind; title: string; summary?: string; content: Record<string, unknown>; expectedRevisionId?: string }): Promise<WorldEntity>;
  };
  references: {
    attach(input: { worldId: string; entityId?: string; assetId: string; role: string; label?: string; expectedRevisionId?: string }): Promise<WorldAssetReference>;
  };
  resolve(input: { worldId: string; revisionId?: string; selection: WorldSelection }): Promise<CreationContext>;
  project: {
    get(projectId: string): Promise<CreationContext | null>;
    put(projectId: string, input: { worldId: string; revisionId?: string; selection: WorldSelection; replace?: boolean }): Promise<CreationContextBinding>;
  };
};

export function createRecutWorldsClient(apiBase: string): RecutWorldsClient {
  return {
    list: async ({ text, type, cursor, limit } = {}) => {
      const query = new URLSearchParams();
      if (text) query.set("text", text);
      if (type) query.set("type", type);
      if (cursor) query.set("cursor", cursor);
      if (limit != null) query.set("limit", String(limit));
      return requestJSON<Page<WorldSummary>>(`${apiBase}/v1/worlds${query.size ? `?${query}` : ""}`);
    },
    get: ({ worldId }) => requestJSON<WorldDetail>(`${apiBase}/v1/worlds/${encodeURIComponent(worldId)}`),
    create: (input) => requestJSON<WorldDetail>(`${apiBase}/v1/worlds`, { method: "POST", body: input }),
    update: ({ worldId, ...rest }) => requestJSON<WorldDetail>(`${apiBase}/v1/worlds/${encodeURIComponent(worldId)}`, { method: "PATCH", body: rest }),
    entities: {
      list: ({ worldId, kind, text, cursor, limit }) => {
        const query = new URLSearchParams();
        if (kind) query.set("kind", kind);
        if (text) query.set("text", text);
        if (cursor) query.set("cursor", cursor);
        if (limit != null) query.set("limit", String(limit));
        return requestJSON<Page<WorldEntitySummary>>(`${apiBase}/v1/worlds/${encodeURIComponent(worldId)}/entities${query.size ? `?${query}` : ""}`);
      },
      get: ({ worldId, entityId }) => requestJSON<WorldEntity>(`${apiBase}/v1/worlds/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(entityId)}`),
      upsert: ({ worldId, entityId, ...rest }) => {
        const url = entityId
          ? `${apiBase}/v1/worlds/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(entityId)}`
          : `${apiBase}/v1/worlds/${encodeURIComponent(worldId)}/entities`;
        return requestJSON<WorldEntity>(url, { method: entityId ? "PATCH" : "POST", body: rest });
      },
    },
    references: {
      attach: ({ worldId, ...rest }) => requestJSON<WorldAssetReference>(`${apiBase}/v1/worlds/${encodeURIComponent(worldId)}/references`, { method: "POST", body: rest }),
    },
    resolve: ({ worldId, ...rest }) => requestJSON<CreationContext>(`${apiBase}/v1/worlds/${encodeURIComponent(worldId)}/resolve`, { method: "POST", body: rest }),
    project: {
      get: async (projectId) => {
        const response = await fetch(`${apiBase}/v1/projects/${encodeURIComponent(projectId)}/world-context`);
        if (response.status === 200) {
          const body = await response.json().catch(() => null);
          return (body as CreationContext | null) ?? null;
        }
        throw await errorFrom(response);
      },
      put: (projectId, input) => requestJSON<CreationContextBinding>(`${apiBase}/v1/projects/${encodeURIComponent(projectId)}/world-context`, { method: "PUT", body: input }),
    },
  };
}

type RequestOptions = { method?: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown };

async function requestJSON<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.ok) {
    return (await response.json()) as T;
  }
  throw await errorFrom(response);
}

async function errorFrom(response: Response): Promise<RecutWorldsError> {
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
  const code = body.error?.code ?? "WORLD_CONTEXT_INVALID";
  const message = body.error?.message ?? `请求失败（${response.status}）`;
  return new RecutWorldsError(code as RecutWorldsErrorCode, message, body.error?.details);
}
