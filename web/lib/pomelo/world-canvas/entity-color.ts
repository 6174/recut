/*
 * [INPUT]: 无依赖（纯映射表）
 * [OUTPUT]: 对外提供实体 kind → 卡片描边色；颜色只表达类型，不承载关系语义
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
