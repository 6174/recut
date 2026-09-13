/*
 * [INPUT]: 依赖 world-canvas/blocks 下各 *-block-v（EntityCard/Note/WorldNode/MediaNode/RelationArrow/RealMedia/FreeElement）
 * [OUTPUT]: 对外提供 world-canvas 业务 block 的 vello-native 版本聚合出口：
 *           EntityCardBlockV / NoteBlockV / WorldNodeBlockV / MediaNodeBlockV / RelationArrowBlockV /
 *           RealMediaBlockV / FreeElementBlockV / entityCardRectV / WORLD_VELLO_BLOCKS。
 * [POS]: lib/pomelo/world-canvas/blocks 的聚合 barrel（具体实现见各 Block 文件；几何共用 entity-card-metrics / arrow-geometry）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export { EntityCardBlockV, entityCardRectV } from "./entity-card-block-v";
export { NoteBlockV } from "./note-block-v";
export { WorldNodeBlockV } from "./world-node-block-v";
export { MediaNodeBlockV } from "./media-node-block-v";
export { RelationArrowBlockV } from "./relation-arrow-block-v";
export { RealMediaBlockV } from "./real-media-block-v";
export { FreeElementBlockV } from "./free-element-block-v";

import { EntityCardBlockV } from "./entity-card-block-v";
import { NoteBlockV } from "./note-block-v";
import { WorldNodeBlockV } from "./world-node-block-v";
import { MediaNodeBlockV } from "./media-node-block-v";
import { RelationArrowBlockV } from "./relation-arrow-block-v";
import { RealMediaBlockV } from "./real-media-block-v";
import { FreeElementBlockV } from "./free-element-block-v";

export const WORLD_VELLO_BLOCKS = [
  EntityCardBlockV,
  NoteBlockV,
  WorldNodeBlockV,
  MediaNodeBlockV,
  RelationArrowBlockV,
  RealMediaBlockV,
  FreeElementBlockV,
];
