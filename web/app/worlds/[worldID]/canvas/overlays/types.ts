/*
 * [INPUT]: 依赖 react（ReactNode，type-only）、@/app/media/media-types（Asset，type-only）、
 *          @/lib/recut-worlds-client（WorldCanvasElement/WorldEntity，type-only）
 * [OUTPUT]: 对外提供画布节点生成 overlay 的类型契约：OverlayModality、MediaGenerationSubject /
 *   EntityOverlaySubject / OverlaySubject、NodeOverlayKind、NodeOverlayContext、NodeOverlayPlugin
 * [POS]: worlds/[worldID]/canvas/overlays 的类型根；纯类型、无运行时依赖（RFC 2026-10-07）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ReactNode } from "react";
import type { Asset } from "@/app/media/media-types";
import type { WorldCanvasElement, WorldEntity } from "@/lib/recut-worlds-client";

export type OverlayModality = "image" | "video" | "audio";

// 可生成的媒体主体：独立媒体元素（kind=media）或属性媒体卡（kind=attr + props.media）。
export type MediaGenerationSubject = {
  kind: "media-element";
  blockId: string;
  elementId: string;
  element: WorldCanvasElement;
  modality: OverlayModality;
  assetId: string;
  url: string;
  asset?: Asset;
  // 空内容：无 assetId 且无 url（空白媒体卡）
  empty: boolean;
  // 已是 AI 生成内容：origin=generated/motion-graphic || proposed || 带生成配方
  aiGenerated: boolean;
  // 属性媒体卡所属实体（写回/上下文用）
  owningEntityId?: string;
  attrLabel?: string;
};

export type EntityOverlaySubject = {
  kind: "entity";
  blockId: string;
  entityId: string;
  entity: WorldEntity;
};

export type OverlaySubject = MediaGenerationSubject | EntityOverlaySubject;

export type NodeOverlayKind = "toolbar" | "composer";

export type NodeOverlayContext = {
  blockId: string;
  subject: OverlaySubject;
  presence: "selected" | "hovered";
  worldId: string;
  contextId: string;
  readOnly: boolean;
  scale: number;
};

export type NodeOverlayPlugin = {
  id: string;
  kind: NodeOverlayKind;
  // 是否对该 subject 出现；缺省不出现
  match: (ctx: NodeOverlayContext) => boolean;
  // 排序（大者靠前）；缺省 0
  priority?: number;
  render: (ctx: NodeOverlayContext) => ReactNode;
};
