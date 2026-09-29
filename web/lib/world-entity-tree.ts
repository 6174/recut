/*
 * [INPUT]: 无外部依赖（纯函数，仅类型）
 * [OUTPUT]: 对外提供 EntityTreeItem / EntityTreeNode / EntityTreeGroup 与 buildEntityTreeGroups /
 * filterEntityTreeGroups：把扁平的实体摘要（含 parentId）装配成「按根实体类型分组 + 子实体逐级嵌套」的
 * 世界实体树（递归容器语义），并提供按名称过滤（保留命中节点的祖先链）
 * [POS]: web/lib 的世界实体树纯函数层；无 React、无 I/O。工作台画布大纲与官网世界画布预览共用同一棵树，
 * 两个宿主各自提供数据源与选中行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type EntityTreeItem = {
  id: string;
  name: string;
  typeId: string;
  /** 递归容器：父实体 id；缺省 = 根实体 */
  parentId?: string;
  isProvisional?: boolean;
};

export type EntityTreeNode = EntityTreeItem & { children: EntityTreeNode[] };

/** 顶层分组：按「根实体的类型」归拢，组内是根节点及其递归子树 */
export type EntityTreeGroup = { typeId: string; nodes: EntityTreeNode[] };

// 父链解析：parentId 指向集合内实体且父链收敛时返回该 parentId，否则视为根
// （父实体不在集合内 / 自引用 / 互相引用成环都按根处理，避免节点凭空消失或渲染死循环）
function resolveParentId(item: EntityTreeItem, byId: Map<string, EntityTreeItem>): string {
  let parentId = item.parentId ?? "";
  if (!parentId) return "";
  const seen = new Set<string>([item.id]);
  while (parentId) {
    if (seen.has(parentId)) return "";
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return "";
    parentId = parent.parentId ?? "";
  }
  return item.parentId ?? "";
}

/** 扁平实体摘要 → 分组树。顺序保持入参顺序（组按根实体首次出现顺序，同级按入参顺序）。 */
export function buildEntityTreeGroups(items: EntityTreeItem[]): EntityTreeGroup[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const nodes = new Map<string, EntityTreeNode>();
  for (const item of items) nodes.set(item.id, { ...item, children: [] });
  const grouped = new Map<string, EntityTreeNode[]>();
  for (const item of items) {
    const node = nodes.get(item.id) as EntityTreeNode;
    const parentId = resolveParentId(item, byId);
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
      continue;
    }
    const roots = grouped.get(node.typeId) ?? [];
    roots.push(node);
    grouped.set(node.typeId, roots);
  }
  return [...grouped.entries()].map(([typeId, nodes]) => ({ typeId, nodes }));
}

/** 按名称过滤：保留命中节点及其祖先链；查询为空时原样返回 */
export function filterEntityTreeGroups(groups: EntityTreeGroup[], query: string): EntityTreeGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  const keep = (node: EntityTreeNode): EntityTreeNode | null => {
    const children = node.children.map(keep).filter((child): child is EntityTreeNode => child !== null);
    if (!node.name.toLowerCase().includes(needle) && children.length === 0) return null;
    return { ...node, children };
  };
  return groups
    .map((group) => ({ typeId: group.typeId, nodes: group.nodes.map(keep).filter((node): node is EntityTreeNode => node !== null) }))
    .filter((group) => group.nodes.length > 0);
}
