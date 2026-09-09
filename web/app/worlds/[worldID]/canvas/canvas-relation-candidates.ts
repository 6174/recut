/*
 * [INPUT]: 无依赖（产品资产表，B.10 候选 Top4 映射）
 * [OUTPUT]: 对外提供 relationCandidatesOf(fromKind, toKind)：按两端实体 kind 推荐的关系类型
 * Top4（受控词表 id），自定义类型按兜底行；转出关系分组色 relationGroupColor（B.10 线色）
 * [POS]: worlds/[worldID]/canvas 的关系候选与分组色（v1 硬编码产品资产，P1 可迁配置）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// 候选映射表：from kind → to kind → Top4（受控词表关系 id）
const CANDIDATES: Record<string, Record<string, string[]>> = {
  character: {
    character: ["friend", "partner", "enemy", "colleague"],
    location: ["located_in", "appears_in", "belongs_to", "references"],
    story: ["appears_in", "created_by", "references", "part_of"],
    object: ["owns", "belongs_to", "references", "part_of"],
    fallback: ["references", "depends_on", "part_of", "belongs_to"],
  },
  location: {
    character: ["references", "appears_in"],
    location: ["contains", "located_in", "part_of"],
    story: ["appears_in", "references", "part_of"],
    object: ["contains", "belongs_to", "references"],
    fallback: ["references", "contains"],
  },
  story: {
    character: ["references", "part_of", "depends_on", "causes"],
    location: ["appears_in", "references"],
    story: ["part_of", "adapted_from", "causes", "references"],
    object: ["contains", "references", "part_of"],
    fallback: ["references", "depends_on"],
  },
  object: {
    character: ["owns", "belongs_to", "references"],
    location: ["located_in", "contains", "references"],
    story: ["references", "part_of"],
    object: ["part_of", "belongs_to", "contains", "references"],
    fallback: ["references", "depends_on"],
  },
};

const FALLBACK_ROW = ["references", "part_of", "belongs_to", "contains"];

export function relationCandidatesOf(fromKind: string, toKind: string): string[] {
  const row = CANDIDATES[fromKind] ?? {};
  return (row[toKind] ?? row.fallback ?? FALLBACK_ROW).filter(Boolean);
}

// 关系分组色（B.10）实现在 lib/pomelo/world-canvas/entity-color.ts（连线 Block 同源），此处转出
export { relationGroupColor } from "@/lib/pomelo/world-canvas/entity-color";
