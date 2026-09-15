/*
 * [INPUT]: 依赖 rich-composer/protocol/xml 的属性序列化（纯函数）、guided/types
 * [OUTPUT]: 对外提供引用标记生成：mediaTag（素材）、entityTag（实体）、primaryTag（当前主体）+ mediaTags 列表，
 *   输出与 @ 面板一致的 `<media type assetid name />` / `<creation_entity worldid entityid kind name />` XML
 * [POS]: web/lib/world-entity/guided 的引用序列化层；让引导提示预填后与富文本 @ 出来的 chip 完全同构
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { serializeAttributes } from "@/lib/rich-composer/protocol/xml";
import type { GuidedPromptContext, MediaRef } from "./types";

const MEDIA_ATTRS = ["type", "assetid", "name"] as const;
const ENTITY_ATTRS = ["worldid", "entityid", "kind", "name"] as const;

// 与 context-catalog/sources/media 的协议一致：type/assetid/name；URL-only 素材没有 assetid，无法成为 chip。
export function mediaTag(ref: MediaRef): string | null {
  if (!ref.assetId) return null;
  return `<media${serializeAttributes({ type: ref.kind || "image", assetid: ref.assetId, name: ref.label }, MEDIA_ATTRS)} />`;
}

export function mediaTags(refs: MediaRef[]): string[] {
  return refs.map(mediaTag).filter((tag): tag is string => Boolean(tag));
}

// 与 context-catalog/sources/entities 的协议一致：worldid/entityid/kind/name
export function entityTag(entity: { id: string; typeId: string; name: string }, worldId: string): string {
  return `<creation_entity${serializeAttributes({ worldid: worldId, entityid: entity.id, kind: entity.typeId, name: entity.name }, ENTITY_ATTRS)} />`;
}

// 当前动作主体的锚点标签：实体主体 → 实体 chip；媒体主体 → 该素材 chip（无 assetId 时为 null）
export function primaryTag(ctx: GuidedPromptContext): string | null {
  if (ctx.subject.kind === "entity") return entityTag(ctx.subject.entity, ctx.worldId);
  const s = ctx.subject;
  return mediaTag({
    ...(s.assetId ? { assetId: s.assetId } : {}),
    label: s.attrLabel || s.assetName || s.elementName || "素材",
    kind: s.modality,
  });
}
