/*
 * [INPUT]: 依赖 recut-worlds-client 类型与 entityAttrMediaRef、guided/types、guided/media-purpose
 * [OUTPUT]: 对外提供由实体/媒体元素构造 GuidedPromptContext 的纯函数（buildEntityContext / buildMediaContext）、
 *   mediaRefsFromEntity（media 属性 → MediaRef，含 role 推断）与 prompt 组装辅助（attrText/refsLine/detailOf）
 * [POS]: web/lib/world-entity/guided 的上下文装配层；把 store 数据规范化成动作 build 的输入（无 React/无 I/O）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { entityAttrMediaRef, type EntityAttr, type WorldEntity } from "@/lib/recut-worlds-client";
import { inferMediaPurpose } from "./media-purpose";
import { mediaTag } from "./refs";
import type {
  GuidedEntitySubject,
  GuidedMediaSubject,
  GuidedPromptContext,
  MediaModality,
  MediaRef,
} from "./types";

export function attrText(entity: WorldEntity | null | undefined, key: string): string {
  const attr = entity?.attrs?.find((item) => item.key === key);
  const value = attr?.value;
  if (value == null) return "";
  if (typeof value === "object") return "";
  return String(value);
}

export function attrLabelText(entity: WorldEntity | null | undefined, label: string): string {
  const attr = entity?.attrs?.find((item) => item.label === label);
  const value = attr?.value;
  if (value == null) return "";
  if (typeof value === "object") return "";
  return String(value);
}

// media 属性 → 可引用项（含 role 推断）；仅接受带 assetId 或 url 的项
export function mediaRefsFromEntity(entity: WorldEntity | null | undefined): MediaRef[] {
  if (!entity?.attrs?.length) return [];
  const refs: MediaRef[] = [];
  for (const attr of entity.attrs as EntityAttr[]) {
    if (attr.type !== "media") continue;
    const media = entityAttrMediaRef(attr.value);
    if (!media) continue;
    const kind = (media.kind as MediaModality | undefined) ?? "image";
    const purpose = inferMediaPurpose({ attrLabel: attr.label, assetName: media.name, modality: kind });
    refs.push({
      ...(media.assetId ? { assetId: media.assetId } : {}),
      ...(media.url ? { url: media.url } : {}),
      label: media.name || attr.label || attr.key,
      kind,
      ...(purpose.role ? { role: purpose.role } : {}),
    });
  }
  return refs;
}

// refsLine 输出内联引用标记（与 @ 面板同构的 XML chip），URL-only 素材退回名称文本
export function refsLine(refs: MediaRef[], empty = "（暂无）"): string {
  if (!refs.length) return empty;
  return refs.map((ref) => mediaTag(ref) ?? `「${ref.label}」`).join("、");
}

// 从世界内的「风格」实体派生 STYLE LOCK（visual + guidance）；多个风格实体拼接。
// M1 先在客户端就地推导，M2 由 Agent 侧 world.md/风格实体统一注入。
export function styleLockFromEntities(entities: WorldEntity[] | null | undefined): string | undefined {
  if (!entities?.length) return undefined;
  const parts: string[] = [];
  for (const entity of entities) {
    if (entity.typeId !== "style") continue;
    const text = [attrText(entity, "visual"), attrText(entity, "guidance")].filter(Boolean).join("；");
    if (text) parts.push(text);
  }
  return parts.length ? parts.join("\n") : undefined;
}

export function buildEntityContext(input: {
  entity: WorldEntity;
  typeLabel: string;
  worldId: string;
  worldName: string;
  locale?: "zh" | "en";
  styleLock?: string;
}): GuidedPromptContext {
  const subject: GuidedEntitySubject = {
    kind: "entity",
    entity: input.entity,
    typeLabel: input.typeLabel,
    mediaRefs: mediaRefsFromEntity(input.entity),
  };
  return {
    locale: input.locale ?? "zh",
    worldId: input.worldId,
    worldName: input.worldName,
    subject,
    ...(input.styleLock ? { styleLock: input.styleLock } : {}),
  };
}

type MediaElementLike = { name?: string; props?: Record<string, unknown> | null; kind?: string };

export function buildMediaContext(input: {
  element: MediaElementLike;
  modality: MediaModality;
  owningEntity?: WorldEntity | null;
  worldId: string;
  worldName: string;
  locale?: "zh" | "en";
  styleLock?: string;
}): GuidedPromptContext {
  const props = input.element.props ?? {};
  const attrLabel = typeof props.label === "string" ? props.label : undefined;
  const elementName = typeof input.element.name === "string" ? input.element.name : undefined;
  const assetName = String(props.assetName ?? props.name ?? "") || undefined;
  const assetId = String(props.assetId ?? "") || undefined;
  const inferred = inferMediaPurpose({ attrLabel, elementName, assetName, modality: input.modality });
  const owningEntity = input.owningEntity ?? undefined;
  const references = mediaRefsFromEntity(owningEntity);
  const subject: GuidedMediaSubject = {
    kind: "media",
    modality: input.modality,
    ...(assetId ? { assetId } : {}),
    ...(attrLabel ? { attrLabel } : {}),
    ...(elementName ? { elementName } : {}),
    ...(assetName ? { assetName } : {}),
    inferred,
    references,
    ...(owningEntity ? { owningEntity } : {}),
  };
  return {
    locale: input.locale ?? "zh",
    worldId: input.worldId,
    worldName: input.worldName,
    subject,
    ...(input.styleLock ? { styleLock: input.styleLock } : {}),
  };
}

export function entityOf(ctx: GuidedPromptContext): GuidedEntitySubject {
  if (ctx.subject.kind !== "entity") throw new Error("guided action expects an entity subject");
  return ctx.subject;
}

export function mediaOf(ctx: GuidedPromptContext): GuidedMediaSubject {
  if (ctx.subject.kind !== "media") throw new Error("guided action expects a media subject");
  return ctx.subject;
}

export function mediaLabel(ctx: GuidedPromptContext): string {
  const s = ctx.subject;
  if (s.kind !== "media") return "";
  return s.attrLabel || s.assetName || s.elementName || "这张素材";
}
