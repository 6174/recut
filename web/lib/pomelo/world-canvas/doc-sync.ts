/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditorState）与 demo-store
 * [OUTPUT]: 对外提供 buildDemoBlocks 与 syncDocFromStore：把 demo-store 的实体/便签/关系/World 节点
 * 映射为 block record 并以一次 transact 全量重建编辑器文档；画布 id 约定 entity:/note:/arrow: 与 world
 * [POS]: lib/pomelo/world-canvas 的文档同步层（结构变化 → 重建；拖拽位移走插件 transact，不重建）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditorState } from "../pomelo-core/pomelo-state";
import type { PomeloBlockRecord } from "../pomelo-core/pomelo-renderer";
import {
  ENTITY_SIZE,
  NOTE_SIZE,
  WORLD_NODE_ID,
  WORLD_NODE_SIZE,
  relationLabel,
  useWorldDemoStore,
} from "./demo-store";

export function worldNodeBlock(worldName: string): PomeloBlockRecord {
  return {
    id: WORLD_NODE_ID,
    type: "world-node",
    attrs: { x: 80, y: -160, ...WORLD_NODE_SIZE, title: worldName },
  };
}

export function buildDemoBlocks(data: ReturnType<typeof useWorldDemoStore.getState>): PomeloBlockRecord[] {
  const blocks: PomeloBlockRecord[] = [];
  blocks.push(worldNodeBlock(data.worldName));
  data.entities.forEach((entity) => {
    blocks.push({
      id: `entity:${entity.id}`,
      type: "entity-card",
      attrs: {
        x: entity.x,
        y: entity.y,
        width: entity.width ?? ENTITY_SIZE.width,
        height: entity.height ?? ENTITY_SIZE.height,
        title: entity.title,
        subtitle: entity.subtitle ?? "",
        tags: entity.tags ?? [],
        desc: entity.desc,
        cover: entity.cover ?? "",
        photos: entity.photos ?? [],
        kind: entity.kind,
        isProvisional: entity.isProvisional ? true : undefined,
      },
    });
  });
  data.notes.forEach((note) => {
    blocks.push({
      id: `note:${note.id}`,
      type: "note",
      attrs: { x: note.x, y: note.y, width: note.width, height: note.height, text: note.text },
    });
  });
  data.mediaNodes.forEach((mediaNode) => {
    blocks.push({
      id: `media:${mediaNode.id}`,
      type: "media-node",
      attrs: { x: mediaNode.x, y: mediaNode.y, width: mediaNode.width, height: mediaNode.height, media: mediaNode.media },
    });
  });
  data.relations.forEach((relation) => {
    blocks.push({
      id: `arrow:${relation.id}`,
      type: "relation-arrow",
      attrs: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        fromId: `entity:${relation.fromEntityId}`,
        toId: `entity:${relation.toEntityId}`,
        label: relationLabel(relation.relationType),
        relationType: relation.relationType,
        ...(relation.fromAnchor ? { fromAnchor: relation.fromAnchor } : {}),
        ...(relation.toAnchor ? { toAnchor: relation.toAnchor } : {}),
        ...(relation.bend ? { bend: relation.bend } : {}),
      },
    });
  });
  return blocks;
}

// 全量重建：先删掉现有子 block，再按 store 数据添加（仅结构变化时调用，拖拽位移不重建）
export function syncDocFromStore(state: PomeloEditorState) {
  const data = useWorldDemoStore.getState();
  const existing = state.getAllBlocks((record) => !record.isRoot).map((record) => record.id);
  state.transact((hook) => {
    existing.forEach((id) => hook.removeBlock(id));
    buildDemoBlocks(data).forEach((record) => hook.addBlock(record));
  });
}
