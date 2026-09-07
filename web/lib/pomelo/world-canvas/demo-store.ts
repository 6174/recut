/*
 * [INPUT]: 依赖 zustand（仅本地状态，不依赖后端）
 * [OUTPUT]: 对外提供 pomelo world canvas demo 的领域数据源：实体/关系/便签/World 核心节点、
 * 视口 transform、选中、连接模式与全部写动作；数据保存在内存中，仅供 demo 路由跑通前端逻辑
 * [POS]: lib/pomelo/world-canvas 的 zustand 状态层；画布插件经它读写语义数据，不直接碰 yjs
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { typeColors } from "./entity-color";

export type DemoEntity = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  isProvisional?: boolean;
  x: number;
  y: number;
  hasChildren?: boolean;
};

export type DemoRelation = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
};

export type DemoNote = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const ENTITY_SIZE = { width: 200, height: 110 };
export const NOTE_SIZE = { width: 160, height: 110 };
export const WORLD_NODE_SIZE = { width: 260, height: 96 };
export const WORLD_NODE_ID = "world";

export type Transform = { x: number; y: number; scale: number };

export type DemoSelection =
  | { type: "entity"; entity: DemoEntity }
  | { type: "note"; note: DemoNote }
  | { type: "relation"; relation: DemoRelation }
  | { type: "world" }
  | null;

type WorldDemoState = {
  worldName: string;
  entities: DemoEntity[];
  notes: DemoNote[];
  relations: DemoRelation[];
  transform: Transform;
  selectedId: string | null;
  mode: "select" | "connect";
  connectFrom: string | null;
  dataVersion: number;
  notice: string;

  addEntity: (kind: string) => void;
  addNote: () => void;
  removeSelected: () => void;
  createRelation: (fromEntityId: string, toEntityId: string) => void;
  removeRelation: (relationId: string) => void;
  updateEntityPosition: (id: string, x: number, y: number) => void;
  updateNote: (id: string, patch: Partial<DemoNote>) => void;
  updateNoteText: (id: string, text: string) => void;
  updateEntitySummary: (id: string, summary: string) => void;
  enterEntity: (id: string) => void;
  setTransform: (transform: Transform) => void;
  select: (id: string | null) => void;
  setMode: (mode: "select" | "connect") => void;
  setNotice: (notice: string) => void;
};

let counter = 0;
function genId(prefix: string) {
  counter += 1;
  // 种子数据使用 relation-demo-N 等固定 id，生成 id 加入时间片避免碰撞
  return `${prefix}-demo-${Date.now().toString(36)}-${counter}`;
}

function gridPos(index: number) {
  return { x: 60 + (index % 4) * 280, y: 80 + Math.floor(index / 4) * 200 };
}

const seedEntities: DemoEntity[] = [
  { id: "entity-demo-1", kind: "character", title: "凌霜", summary: "北境剑修，外冷内热，背负师门血案", x: 60, y: 80 },
  { id: "entity-demo-2", kind: "character", title: "沈昭", summary: "朝廷密探，擅长易容与情报编织", x: 340, y: 80 },
  { id: "entity-demo-3", kind: "location", title: "霜落城", summary: "北境边陲雪城，故事主线舞台", x: 60, y: 280 },
  { id: "entity-demo-4", kind: "story", title: "雪夜追凶", summary: "第一卷主线：连环失踪案的真相", x: 340, y: 280 },
];

const seedRelations: DemoRelation[] = [
  { id: "relation-demo-1", fromEntityId: "entity-demo-1", toEntityId: "entity-demo-4", relationType: "appears_in" },
  { id: "relation-demo-2", fromEntityId: "entity-demo-3", toEntityId: "entity-demo-4", relationType: "located_in" },
];

const seedNotes: DemoNote[] = [
  { id: "note-demo-1", text: "凌霜与沈昭的相遇放在霜落城的酒肆", x: 640, y: 120, width: 160, height: 110 },
];

export const useWorldDemoStore = create<WorldDemoState>((set, get) => ({
  worldName: "雪境志",
  entities: seedEntities,
  notes: seedNotes,
  relations: seedRelations,
  transform: { x: 0, y: 0, scale: 1 },
  selectedId: null,
  mode: "select",
  connectFrom: null,
  dataVersion: 0,
  notice: "",

  addEntity: (kind) => {
    const pos = gridPos(get().entities.length);
    const entity: DemoEntity = {
      id: genId("entity"),
      kind,
      title: `新${kindLabel(kind)}`,
      summary: "",
      x: pos.x,
      y: pos.y,
    };
    set((state) => ({ entities: [...state.entities, entity], dataVersion: state.dataVersion + 1, selectedId: entity.id }));
  },

  addNote: () => {
    const note: DemoNote = { id: genId("note"), text: "", ...gridPos(get().notes.length + 8), ...NOTE_SIZE };
    set((state) => ({ notes: [...state.notes, note], dataVersion: state.dataVersion + 1, selectedId: note.id }));
  },

  removeSelected: () => {
    const { selectedId, entities, notes, relations } = get();
    if (!selectedId) return;
    if (selectedId === WORLD_NODE_ID) return;
    const entity = entities.find((item) => item.id === selectedId);
    if (entity) {
      set((state) => ({
        entities: state.entities.filter((item) => item.id !== selectedId),
        relations: state.relations.filter((relation) => relation.fromEntityId !== selectedId && relation.toEntityId !== selectedId),
        dataVersion: state.dataVersion + 1,
        selectedId: null,
      }));
      return;
    }
    const note = notes.find((item) => item.id === selectedId);
    if (note) {
      set((state) => ({ notes: state.notes.filter((item) => item.id !== selectedId), dataVersion: state.dataVersion + 1, selectedId: null }));
      return;
    }
    const relation = relations.find((item) => item.id === selectedId);
    if (relation) {
      get().removeRelation(relation.id);
    }
  },

  createRelation: (fromEntityId, toEntityId) => {
    if (fromEntityId === toEntityId) return;
    if (get().relations.some((relation) => relation.fromEntityId === fromEntityId && relation.toEntityId === toEntityId)) return;
    const relation: DemoRelation = { id: genId("relation"), fromEntityId, toEntityId, relationType: "references" };
    set((state) => ({ relations: [...state.relations, relation], dataVersion: state.dataVersion + 1 }));
  },

  removeRelation: (relationId) =>
    set((state) => ({
      relations: state.relations.filter((relation) => relation.id !== relationId),
      dataVersion: state.dataVersion + 1,
      selectedId: state.selectedId === relationId ? null : state.selectedId,
    })),

  updateEntityPosition: (id, x, y) =>
    set((state) => ({
      entities: state.entities.map((entity) => (entity.id === id ? { ...entity, x, y } : entity)),
    })),

  updateNote: (id, patch) =>
    set((state) => ({
      notes: state.notes.map((note) => (note.id === id ? { ...note, ...patch } : note)),
    })),

  updateNoteText: (id, text) =>
    set((state) => ({
      notes: state.notes.map((note) => (note.id === id ? { ...note, text } : note)),
      dataVersion: state.dataVersion + 1,
    })),

  updateEntitySummary: (id, summary) =>
    set((state) => ({
      entities: state.entities.map((entity) => (entity.id === id ? { ...entity, summary } : entity)),
      dataVersion: state.dataVersion + 1,
    })),

  enterEntity: (id) => set({ notice: `容器递归进入「${id}」在正式画布中走 setContext，demo 略过` }),

  setTransform: (transform) => set({ transform }),
  select: (selectedId) => set({ selectedId }),
  setMode: (mode) => set((state) => ({ mode, connectFrom: null, selectedId: mode === "select" ? state.selectedId : null })),
  setNotice: (notice) => set({ notice }),
}));

export function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    character: "角色",
    location: "地点",
    story: "故事",
    style: "风格",
    rule: "规则",
    reference: "参考",
  };
  return labels[kind] ?? kind;
}

export function relationLabel(relationType: string): string {
  const labels: Record<string, string> = {
    appears_in: "出现于",
    located_in: "位于",
    references: "引用",
    father: "父亲",
    mother: "母亲",
    friend: "朋友",
    enemy: "敌对",
  };
  return labels[relationType] ?? relationType;
}

export { typeColors };
