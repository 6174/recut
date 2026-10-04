/*
 * [INPUT]: 依赖 recut-worlds-client 的类型（EntityAttr / EntityAttrMediaValue / WorldCanvasElement /
 * WorldEntity / WorldEntityRelation）
 * [OUTPUT]: 对外提供 World Canvas 剪贴板的数据契约与持久化：CanvasClipboardFragment（实体/画布元素/关系快照 +
 * 来源 world/context + copy|cut 模式）、buildCanvasFragment（从当前选中集合抽取自包含片段）、
 * writeCanvasClipboard / readCanvasClipboard / clearCanvasClipboard（模块单例 + localStorage `wc:clipboard`，
 * 跨整页导航与跨标签保留）。
 * [POS]: worlds/[worldID]/canvas 的剪贴板数据层（无 UI、无网络）；由 canvas-store 的 copy/cut/paste 动作读写。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type {
  EntityAttr,
  EntityAttrMediaValue,
  WorldCanvasElement,
  WorldEntity,
  WorldEntityRelation,
} from "@/lib/recut-worlds-client";

// 与 canvas-store 的 WORLD_ELEMENT_ID 同值（本地重复以避免 store ←→ clipboard 循环依赖）。
const WORLD_ELEMENT_ID = "shape:world";
const RELATION_PREFIX = "arrow:";
const ENTITY_PREFIX = "entity:";
const CLIPBOARD_STORAGE_KEY = "wc:clipboard";
const CLIPBOARD_VERSION = 1;

// 片段里的实体快照：只保留跨 world 可重建的字段（不含 worldId/relations/children 等派生或命名空间字段）。
export type CanvasClipboardEntity = {
  id: string;
  typeId: string;
  name: string;
  intro: string;
  detail: string;
  cover?: EntityAttrMediaValue | null;
  attrs: EntityAttr[];
  parentId?: string;
  containerRole?: string;
  isProvisional?: boolean;
};

// 剪贴板片段：一次 copy/cut 的自包含快照。copy=克隆副本；cut=同 world 粘贴为真移动（保留 id），
// 跨 world 粘贴克隆新 id 并删除源实体。
export type CanvasClipboardFragment = {
  version: number;
  mode: "copy" | "cut";
  sourceWorldId: string;
  sourceContextId: string;
  createdAt: string;
  entities: CanvasClipboardEntity[];
  elements: WorldCanvasElement[];
  relations: WorldEntityRelation[];
};

export type BuildFragmentInput = {
  selectedIds: string[];
  entities: WorldEntity[];
  elements: WorldCanvasElement[];
  relations: WorldEntityRelation[];
  worldId: string;
  contextId: string;
  mode: "copy" | "cut";
};

// resolve 选中项分类：把 pomelo block id（`entity:<id>` / `arrow:<relationId>` / 自由元素 id / 实体投影 id）
// 归一为实体 id / 关系 id / 元素 id 三个集合。`shape:world`（当前 world 根节点）被显式过滤——
// 根节点不能与它的 sub 一起复制/剪切（否则会试图把整个 world 克隆进自身或另一个 world）。
function classifySelection(input: Pick<BuildFragmentInput, "selectedIds" | "entities">) {
  const entityIdSet = new Set(input.entities.map((entity) => entity.id));
  const entityIds = new Set<string>();
  const relationIds = new Set<string>();
  const elementIds = new Set<string>();
  for (const raw of input.selectedIds) {
    if (!raw || raw === WORLD_ELEMENT_ID) continue;
    if (raw.startsWith(RELATION_PREFIX)) {
      relationIds.add(raw.slice(RELATION_PREFIX.length));
      continue;
    }
    if (raw.startsWith(ENTITY_PREFIX)) {
      entityIds.add(raw.slice(ENTITY_PREFIX.length));
      continue;
    }
    const bare = raw.startsWith("shape:") ? raw.slice("shape:".length) : raw;
    if (entityIdSet.has(bare)) entityIds.add(bare);
    else elementIds.add(raw);
  }
  return { entityIds, relationIds, elementIds };
}

// 箭头端点是否落在复制集合内：端点可以是实体投影 `shape:<entityId>`、裸实体 id，或选中的自由元素 id。
// 只有两端都在集合内的箭头（属性边）才会被复制，指向未选中对象的箭头整条丢弃（与关系重建规则一致）。
function endpointInSet(ref: unknown, entityIds: Set<string>, elementIds: Set<string>): boolean {
  const value = typeof ref === "string" ? ref : "";
  if (!value) return false;
  if (entityIds.has(value)) return true;
  if (value.startsWith("shape:") && entityIds.has(value.slice("shape:".length))) return true;
  return elementIds.has(value);
}

// 从当前选中集合抽取自包含片段：实体（含其一等字段/属性/封面）+ 其实体卡投影 + 选中的自由元素
// + 两端都在选中集合内的关系与属性边。返回 null 表示过滤根节点后没有可复制的对象。
export function buildCanvasFragment(input: BuildFragmentInput): CanvasClipboardFragment | null {
  const { entityIds, relationIds, elementIds } = classifySelection(input);
  if (entityIds.size === 0 && elementIds.size === 0 && relationIds.size === 0) return null;

  // 实体卡投影元素（`shape:<entityId>`）即使未显式选中也要带上，否则粘贴后实体没有可落位的卡。
  const projectionIds = new Set<string>();
  for (const entityId of entityIds) projectionIds.add(`shape:${entityId}`);

  // 关系：两端实体都在选中集合内即纳入（不必显式选中箭头），与「只重建两端都在选择内的关系」一致。
  const relations = input.relations.filter(
    (relation) => entityIds.has(relation.fromEntityId) && entityIds.has(relation.toEntityId),
  );

  // 画布元素：选中的自由元素 + 选中实体的投影卡；箭头（属性边）无论是否显式选中，都要求两端都在
  // 集合内，否则克隆后端点会指向目标世界不存在的元素（服务端 link-start 校验直接拒绝整批保存）。
  const elements = input.elements.filter((element) => {
    if (element.kind === "arrow") {
      return (
        endpointInSet(element.props?.fromElementId, entityIds, elementIds) &&
        endpointInSet(element.props?.toElementId, entityIds, elementIds)
      );
    }
    if (elementIds.has(element.id)) return true;
    if ((element.kind === "entity" || element.refKind === "entity") && element.refId) return entityIds.has(element.refId);
    return projectionIds.has(element.id);
  });

  const entities: CanvasClipboardEntity[] = input.entities
    .filter((entity) => entityIds.has(entity.id))
    .map((entity) => ({
      id: entity.id,
      typeId: entity.typeId,
      name: entity.name,
      intro: entity.intro,
      detail: entity.detail,
      ...(entity.cover !== undefined ? { cover: entity.cover } : {}),
      attrs: (entity.attrs ?? []).map((attr) => ({ ...attr })),
      ...(entity.parentId ? { parentId: entity.parentId } : {}),
      ...(entity.containerRole ? { containerRole: entity.containerRole } : {}),
      ...(entity.isProvisional ? { isProvisional: true } : {}),
    }));

  if (entities.length === 0 && elements.length === 0 && relations.length === 0) return null;

  return {
    version: CLIPBOARD_VERSION,
    mode: input.mode,
    sourceWorldId: input.worldId,
    sourceContextId: input.contextId,
    createdAt: new Date().toISOString(),
    entities,
    elements,
    relations,
  };
}

export function writeCanvasClipboard(fragment: CanvasClipboardFragment): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(fragment));
  } catch {
    // 隐私模式/配额不足时静默：本次会话内仍可由调用方直接使用 fragment
  }
}

export function readCanvasClipboard(): CanvasClipboardFragment | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CLIPBOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CanvasClipboardFragment;
    if (!parsed || parsed.version !== CLIPBOARD_VERSION || !Array.isArray(parsed.entities)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCanvasClipboard(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CLIPBOARD_STORAGE_KEY);
  } catch {
    // 同 writeCanvasClipboard
  }
}
