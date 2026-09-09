/*
 * [INPUT]: 无依赖（纯映射表）
 * [OUTPUT]: 对外提供实体 kind → 卡片描边色与关系 relationType → 连线色（对齐真实案例设计：
 * 家属=紫红、朋友=蓝、场景=绿、事件=橙红）；两类颜色只表达类型语义，不承载关系方向
 * [POS]: lib/pomelo/world-canvas 的颜色映射（与 worlds canvas canvas-store 的 typeColors 保持一致）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export const typeColors: Record<string, string> = {
  character: "#e879f9",
  location: "#60a5fa",
  story: "#f59e0b",
  style: "#34d399",
  rule: "#a78bfa",
  reference: "#94a3b8",
};

export function entityColor(kind: string): number {
  const hex = typeColors[kind] ?? "#94a3b8";
  return parseInt(hex.slice(1), 16);
}

// 关系语义色：连线与连线标签统一按 relationType 着色（真实案例设计：同色系归组）
export const relationColors: Record<string, string> = {
  belongs_to: "#d946ef", // 家庭/师门
  friend: "#3b82f6",
  references: "#10b981",
  appears_in: "#f97316",
  located_in: "#e11d48",
  father: "#d946ef",
  mother: "#d946ef",
  enemy: "#ef4444",
};

export function relationColor(relationType: string): number {
  const hex = relationColors[relationType] ?? attrMediaColors[relationType] ?? "#64748b";
  return parseInt(hex.slice(1), 16);
}

// 属性边颜色：文本/图片/音频/视频（「+」引导创建的属性节点连线）
export const attrMediaColors: Record<string, string> = {
  attr_text: "#38bdf8",
  attr_image: "#a78bfa",
  attr_audio: "#34d399",
  attr_video: "#f59e0b",
};

export function attrColor(media: string): number {
  const hex = attrMediaColors[`attr_${media}`] ?? "#64748b";
  return parseInt(hex.slice(1), 16);
}

export function attrMediaLabel(media: string): string {
  const labels: Record<string, string> = { text: "文本", image: "图片", audio: "音频", video: "视频" };
  return labels[media] ?? "属性";
}

// 关系分组色（T5/B.10）：people/world/story/video 四组 + 其他灰；
// app 层的候选映射表（canvas-relation-candidates.ts）复用本函数
export function relationGroupColor(group: string): number {
  switch (group) {
    case "people":
      return 0xe879f9;
    case "world":
      return 0x60a5fa;
    case "story":
      return 0xf59e0b;
    case "video":
      return 0xa78bfa;
    default:
      return 0x94a3b8;
  }
}
