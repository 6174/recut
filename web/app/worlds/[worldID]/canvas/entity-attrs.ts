/*
 * [INPUT]: 依赖 recut-worlds-client（WorldEntity/EntityAttr/EntityAttrMediaValue 类型）
 * [OUTPUT]: 对外提供统一 Entity 模型（RFC 2026-09-09）的 attrs 只读辅助：attrListOf/attrOf/attrValueOf/
 * attrTextOf（按 key 取属性值）、attrMediaValueOf（media 属性 → {assetId,name,kind}）、
 * entityMediaAttrs（有素材值的 media 属性列表，面板/卡片共用）、newMediaAttr（挂接素材的新属性构造）
 * [POS]: worlds/[worldID]/canvas 的 entity attrs 单一访问点；消费方不再直读 entity.content（已退役）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { EntityAttr, EntityAttrMediaValue, WorldEntity } from "@/lib/recut-worlds-client";

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

// media 属性值 → {assetId, name?, kind?}；无有效 assetId = null
export function attrMediaValueOf(entity: Pick<WorldEntity, "attrs">, key: string): EntityAttrMediaValue | null {
  const value = attrValueOf(entity, key);
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.assetId !== "string" || !record.assetId) return null;
  return {
    assetId: record.assetId,
    name: typeof record.name === "string" ? record.name : undefined,
    kind: typeof record.kind === "string" ? record.kind : undefined,
  };
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
