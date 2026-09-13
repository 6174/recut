/*
 * [INPUT]: 依赖 recut-worlds-client（WorldEntity/EntityAttr/EntityAttrMediaValue 类型）
 * [OUTPUT]: 对外提供统一 Entity 模型（RFC 2026-09-09）的 attrs 只读辅助：attrListOf/attrOf/attrValueOf/
 * attrTextOf（按 key 取属性值）、attrMediaValueOf（media 属性 → {assetId,name,kind}）、
 * entityMediaAttrs（有素材值的 media 属性列表，面板/卡片共用）、newMediaAttr（挂接素材的新属性构造），
 * 以及一等实体字段（简介/正文）作为画布关联的保留映射 ENTITY_FIELD_ASSOCIATIONS / entityFieldKeyOfLabel
 * [POS]: worlds/[worldID]/canvas 的 entity attrs 单一访问点；消费方不再直读 entity.content（已退役）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { EntityAttr, EntityAttrMediaValue, WorldEntity } from "@/lib/recut-worlds-client";
import { entityAttrMediaRef } from "@/lib/recut-worlds-client";

// 一等实体字段（简介/正文）也能作为画布「关联」：属性卡 label ↔ entity 字段的保留映射。
// 创建属性卡时 label 用中文名，编辑其正文即回写 entity.intro / entity.detail（见 canvas-store.syncAttrValue）。
export const ENTITY_FIELD_ASSOCIATIONS = [
  { key: "intro", label: "简介" },
  { key: "detail", label: "正文" },
] as const;

export type EntityFieldKey = (typeof ENTITY_FIELD_ASSOCIATIONS)[number]["key"];

// 属性卡 label → 一等实体字段 key；非保留标签返回 null（走普通 attr 路径）。
// 兼容「介绍/内容」等同义写法，避免用户手动命名时落不到字段。
export function entityFieldKeyOfLabel(label: string): EntityFieldKey | null {
  const normalized = label.trim();
  if (normalized === "简介" || normalized === "介绍" || normalized === "intro") return "intro";
  if (normalized === "正文" || normalized === "内容" || normalized === "正文内容" || normalized === "detail") return "detail";
  return null;
}

export function attrListOf(entity: Pick<WorldEntity, "attrs">): EntityAttr[] {
  return entity.attrs ?? [];
}

export function attrOf(entity: Pick<WorldEntity, "attrs">, key: string): EntityAttr | undefined {
  return attrListOf(entity).find((attr) => attr.key === key);
}

// 属性原始值（无该属性 = undefined）
export function attrValueOf(entity: Pick<WorldEntity, "attrs">, key: string): unknown {
  return attrOf(entity, key)?.value;
}

// 属性值文本化（面板 FieldRow / 建议字段预填共用）
export function attrTextOf(entity: Pick<WorldEntity, "attrs">, key: string): string {
  const value = attrValueOf(entity, key);
  if (value == null) return "";
  return typeof value === "string" ? value : String(value);
}

// media 属性值 → {assetId|url, name?, kind?, recipe?}；无有效引用 = null
export function attrMediaValueOf(entity: Pick<WorldEntity, "attrs">, key: string): EntityAttrMediaValue | null {
  return entityAttrMediaRef(attrValueOf(entity, key));
}

// 有素材值的 media 属性（素材区网格 / 卡片封面与资料格的来源）
export function entityMediaAttrs(entity: Pick<WorldEntity, "attrs">): EntityAttr[] {
  return attrListOf(entity).filter((attr) => attr.type === "media" && attrMediaValueOf(entity, attr.key));
}

// 挂接素材构造新 media 属性（key 生成 `a_<ts>`，label 缺省 = 媒体类型中文）
export function newMediaAttr(label?: string, value?: EntityAttrMediaValue): EntityAttr {
  return {
    key: `a_${Date.now().toString(36)}`,
    label: label ?? "素材",
    type: "media",
    ...(value ? { value: value as unknown } : {}),
  };
}
