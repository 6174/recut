/*
 * [INPUT]: 依赖 graph-theme（语义色单一真源：ENTITY_TYPE_COLORS/RELATION_TYPE_COLORS/ATTR_MEDIA_COLORS/RELATION_GROUP_COLORS）
 * [OUTPUT]: 对外提供实体 kind → 卡片描边色与关系 relationType → 连线色（对齐真实案例设计：
 * 家属=紫红、朋友=蓝、场景=绿、事件=橙红）；两类颜色只表达类型语义，不承载关系方向。
 * kind 色同时以 0xRRGGBB（entityColor）与 Rgba（entityColorRgba，供 vello 填充如实体卡类型前缀）两种形态给出。
 * 色值真源在 graph-theme，本文件只做「语义名称 → 颜色」的取用与数值转换。
 * [POS]: lib/pomelo/world-canvas 的颜色映射（与 worlds canvas canvas-store 的 typeColors 同源）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Rgba } from "../pomelo-vello/op-bridge";
import { ATTR_MEDIA_COLORS, ENTITY_TYPE_COLORS, RELATION_GROUP_COLORS, RELATION_TYPE_COLORS, rgba } from "./graph-theme";

/** 实体 kind → 描边色。 */
export const typeColors: Record<string, string> = ENTITY_TYPE_COLORS;

/** kind 色（0xRRGGBB）。 */
export function entityColor(kind: string): number {
  const hex = typeColors[kind] ?? RELATION_GROUP_COLORS.other;
  return Number.parseInt(hex.slice(1), 16);
}

/** kind 色（Rgba 元组，供 vello 文本/图形填充用；与 entityColor 同源）。 */
export function entityColorRgba(kind: string): Rgba {
  return rgba(typeColors[kind] ?? RELATION_GROUP_COLORS.other);
}

/** 关系语义色：连线与连线标签统一按 relationType 着色（真实案例设计：同色系归组）。 */
export const relationColors: Record<string, string> = RELATION_TYPE_COLORS;

/** relationType 色（0xRRGGBB）。 */
export function relationColor(relationType: string): number {
  const hex = relationColors[relationType] ?? attrMediaColors[relationType] ?? "#64748b";
  return Number.parseInt(hex.slice(1), 16);
}

/** 属性边颜色：文本/图片/音频/视频（「+」引导创建的属性节点连线）。 */
export const attrMediaColors: Record<string, string> = ATTR_MEDIA_COLORS;

/** 属性媒体色（0xRRGGBB）。 */
export function attrColor(media: string): number {
  const hex = attrMediaColors[`attr_${media}`] ?? "#64748b";
  return Number.parseInt(hex.slice(1), 16);
}

export function attrMediaLabel(media: string): string {
  const labels: Record<string, string> = { text: "文本", image: "图片", audio: "音频", video: "视频" };
  return labels[media] ?? "属性";
}

/** 关系分组色（T5/B.10）：people/world/story/video 四组 + 其他灰；色值真源在 graph-theme。 */
export function relationGroupColor(group: string): number {
  const hex = RELATION_GROUP_COLORS[group] ?? RELATION_GROUP_COLORS.other;
  return Number.parseInt(hex.slice(1), 16);
}
