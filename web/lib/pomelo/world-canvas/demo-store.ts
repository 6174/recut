/*
 * [INPUT]: 依赖 zustand（仅本地状态，不依赖后端）
 * [OUTPUT]: 对外提供 pomelo world canvas demo 的领域数据源：实体（含 subtitle/tags/desc/
 * fields/cover/photos/note 结构化字段，画布卡与右栏面板同源）/关系/便签/World 核心节点、
 * 视口 transform、选中、连接模式与全部写动作；数据保存在内存中，仅供 demo 路由跑通前端逻辑
 * [POS]: lib/pomelo/world-canvas 的 zustand 状态层；画布插件经它读写语义数据，不直接碰 yjs
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { typeColors } from "./entity-color";

export type DemoEntityField = { label: string; value: string };

export type DemoEntity = {
  id: string;
  kind: string;
  title: string;
  // 卡片副标题（如拼音/英文名），与真实案例中的 subtitle 对应
  subtitle?: string;
  // 类型标签（-pills），与右侧面板同一份数据
  tags?: string[];
  // 一段简介（卡片两行 + 面板段落）
  desc?: string;
  // 基本信息字段（面板「基本信息」区；卡片不展示，避免拥挤）
  fields?: DemoEntityField[];
  // 封面 emoji（demo 无真实图片素材，以 emoji 占位表达「图」层）
  cover?: string;
  // 资料缩略图 emoji 列表（卡片底部条 + 面板「参考资料」区）
  photos?: string[];
  // 实体笔记
  note?: string;
  isProvisional?: boolean;
  x: number;
  y: number;
  width?: number;
  height?: number;
  hasChildren?: boolean;
};

export type DemoRelation = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
  // 起止控制点：归一化锚点（节点内比例位置），默认节点中心 { x: 0.5, y: 0.5 }
  fromAnchor?: { x: number; y: number };
  toAnchor?: { x: number; y: number };
  // 中间控制点：相对直线中点的偏移，控制曲线弯曲
  bend?: { dx: number; dy: number };
};

export type DemoNote = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

// 基础素材节点（文本/图片/音频/视频）：当前仅 UI 结构，上传/生成后续接入
export type DemoMediaNode = {
  id: string;
  media: "text" | "image" | "audio" | "video";
  x: number;
  y: number;
  width: number;
  height: number;
};

export const ENTITY_SIZE = { width: 264, height: 328 };
export const NOTE_SIZE = { width: 160, height: 110 };
export const WORLD_NODE_SIZE = { width: 260, height: 96 };
export const MEDIA_NODE_SIZE = { width: 220, height: 150 };
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
  mediaNodes: DemoMediaNode[];
  relations: DemoRelation[];
  transform: Transform;
  selectedId: string | null;
  mode: "select" | "connect";
  connectFrom: string | null;
  dataVersion: number;
  notice: string;

  addEntity: (kind: string) => void;
  addNote: () => void;
  addMediaNode: (media: DemoMediaNode["media"]) => void;
  removeSelected: () => void;
  createRelation: (fromEntityId: string, toEntityId: string) => void;
  removeRelation: (relationId: string) => void;
  updateRelationGeometry: (relationId: string, geometry: { fromAnchor?: { x: number; y: number }; toAnchor?: { x: number; y: number }; bend?: { dx: number; dy: number } }) => void;
  updateEntityPosition: (id: string, x: number, y: number) => void;
  updateEntity: (id: string, patch: Partial<Omit<DemoEntity, "id">>) => void;
  updateNote: (id: string, patch: Partial<DemoNote>) => void;
  updateNoteText: (id: string, text: string) => void;
  updateMediaNode: (id: string, patch: Partial<Omit<DemoMediaNode, "id">>) => void;
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
  return { x: 60 + (index % 3) * 300, y: 80 + Math.floor(index / 3) * 370 };
}

const seedEntities: DemoEntity[] = [
  {
    id: "entity-demo-1",
    kind: "character",
    title: "凌霜",
    subtitle: "Ling Shuang",
    tags: ["角色", "剑客", "北境"],
    desc: "北境剑修，外冷内热，背负师门血案。",
    fields: [
      { label: "类型", value: "角色" },
      { label: "身份", value: "剑客" },
      { label: "师承", value: "霜落城 · 雪堂" },
      { label: "性格", value: "冷傲 / 重情" },
    ],
    cover: "🗡️",
    photos: ["❄️", "🏔️", "⚔️", "🏮"],
    note: "· 日常习惯擦拭长剑\n· 关键台词「雪落之前，债要还」",
    x: 60,
    y: 80,
  },
  {
    id: "entity-demo-2",
    kind: "character",
    title: "沈昭",
    subtitle: "Shen Zhao",
    tags: ["角色", "密探", "朝廷"],
    desc: "朝廷密探，擅长易容与情报编织。",
    fields: [
      { label: "类型", value: "角色" },
      { label: "身份", value: "密探" },
      { label: "职能", value: "情报编织" },
      { label: "性格", value: "机变 / 谨慎" },
    ],
    cover: "🎭",
    photos: ["📜", "🕯️", "🏮"],
    x: 380,
    y: 80,
  },
  {
    id: "entity-demo-3",
    kind: "location",
    title: "霜落城",
    subtitle: "Frostfall City",
    tags: ["场景", "边塞"],
    desc: "北境边陲雪城，故事主线舞台。",
    fields: [
      { label: "类型", value: "场景" },
      { label: "归属", value: "北境" },
      { label: "地貌", value: "雪原关城" },
    ],
    cover: "🏯",
    photos: ["❄️", "🗺️", "🌒"],
    x: 60,
    y: 470,
  },
  {
    id: "entity-demo-4",
    kind: "story",
    title: "雪夜追凶",
    subtitle: "The Snow Night",
    tags: ["故事", "悬疑", "第一卷"],
    desc: "第一卷主线：连环失踪案的真相。",
    fields: [
      { label: "类型", value: "故事" },
      { label: "卷", value: "第一卷" },
      { label: "基调", value: "悬疑 / 冷冽" },
    ],
    cover: "🔍",
    photos: ["🕯️", "📜", "❄️", "🌒"],
    x: 380,
    y: 470,
  },
];

const seedRelations: DemoRelation[] = [
  { id: "relation-demo-1", fromEntityId: "entity-demo-1", toEntityId: "entity-demo-4", relationType: "appears_in" },
  { id: "relation-demo-2", fromEntityId: "entity-demo-3", toEntityId: "entity-demo-4", relationType: "located_in" },
  { id: "relation-demo-3", fromEntityId: "entity-demo-2", toEntityId: "entity-demo-1", relationType: "references" },
];

const seedNotes: DemoNote[] = [
  { id: "note-demo-1", text: "凌霜与沈昭的相遇放在霜落城的酒肆", x: 660, y: 140, width: 160, height: 110 },
];

const seedMediaNodes: DemoMediaNode[] = [
  { id: "media-demo-1", media: "image", x: 680, y: 330, ...MEDIA_NODE_SIZE },
];

export const useWorldDemoStore = create<WorldDemoState>((set, get) => ({
  worldName: "雪境志",
  entities: seedEntities,
  notes: seedNotes,
  mediaNodes: seedMediaNodes,
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
      subtitle: "",
      tags: [kindLabel(kind)],
      desc: "",
      fields: [{ label: "类型", value: kindLabel(kind) }],
      photos: [],
      x: pos.x,
      y: pos.y,
    };
    set((state) => ({ entities: [...state.entities, entity], dataVersion: state.dataVersion + 1, selectedId: entity.id }));
  },

  addNote: () => {
    const note: DemoNote = { id: genId("note"), text: "", ...gridPos(get().notes.length + 8), ...NOTE_SIZE };
    set((state) => ({ notes: [...state.notes, note], dataVersion: state.dataVersion + 1, selectedId: note.id }));
  },

  addMediaNode: (media) => {
    const mediaNode: DemoMediaNode = { id: genId("media"), media, x: 720, y: 120 + get().mediaNodes.length * 190, ...MEDIA_NODE_SIZE };
    set((state) => ({ mediaNodes: [...state.mediaNodes, mediaNode], dataVersion: state.dataVersion + 1, selectedId: mediaNode.id }));
  },

  removeSelected: () => {
    const { selectedId, entities, notes, mediaNodes, relations } = get();
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
    const mediaNode = mediaNodes.find((item) => item.id === selectedId);
    if (mediaNode) {
      set((state) => ({ mediaNodes: state.mediaNodes.filter((item) => item.id !== selectedId), dataVersion: state.dataVersion + 1, selectedId: null }));
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

  updateRelationGeometry: (relationId, geometry) =>
    set((state) => ({
      relations: state.relations.map((relation) =>
        relation.id === relationId ? { ...relation, ...geometry } : relation,
      ),
      dataVersion: state.dataVersion + 1,
    })),

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

  updateEntity: (id, patch) =>
    set((state) => ({
      entities: state.entities.map((entity) => (entity.id === id ? { ...entity, ...patch } : entity)),
      dataVersion: state.dataVersion + 1,
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

  updateMediaNode: (id, patch) =>
    set((state) => ({
      mediaNodes: state.mediaNodes.map((mediaNode) => (mediaNode.id === id ? { ...mediaNode, ...patch } : mediaNode)),
      dataVersion: state.dataVersion + 1,
    })),

  updateEntitySummary: (id, summary) => get().updateEntity(id, { desc: summary }),

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
    belongs_to: "师门",
    father: "父亲",
    mother: "母亲",
    friend: "朋友",
    enemy: "敌对",
  };
  return labels[relationType] ?? relationType;
}

export { typeColors };
