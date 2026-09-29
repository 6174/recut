/*
 * [INPUT]: 依赖 lucide-react 与 lib/world-entity-tree 的树类型（纯展示，无 store / 无请求）
 * [OUTPUT]: 对外提供 WorldEntityTree：世界实体树的共用渲染件——按类型分组的顶层分组标题 + 可展开/折叠的
 * 递归实体节点（当前项高亮、草稿徽标、按名称过滤后强制展开），展开状态与选中行为全部由宿主注入
 * [POS]: web/components 的世界实体树展示层；工作台画布大纲（canvas-outline）与官网世界画布预览
 * （marketing-world-canvas-preview）共用同一套结构与视觉，避免两处各写一棵树
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ChevronRight } from "lucide-react";
import type { EntityTreeGroup, EntityTreeNode } from "@/lib/world-entity-tree";

export type WorldEntityTreeProps = {
  groups: EntityTreeGroup[];
  /** 当前所在/选中的实体 id（高亮） */
  activeId?: string | null;
  /** 折叠集（默认全展开，只有显式折叠的节点在这里） */
  collapsedIds: Set<string>;
  onToggleCollapse: (entityId: string) => void;
  onSelect: (node: EntityTreeNode) => void;
  /** 类型 id → 分组标题文案 */
  labelOf: (typeId: string) => string;
  /** 过滤态：忽略折叠集，强制展开命中路径 */
  forceExpand?: boolean;
  /** 判断节点是否可聚焦（官网预览只对画布上存在的实体生效；缺省全部可聚焦） */
  isFocusable?: (node: EntityTreeNode) => boolean;
  className?: string;
};

export function WorldEntityTree({
  groups,
  activeId,
  collapsedIds,
  onToggleCollapse,
  onSelect,
  labelOf,
  forceExpand,
  isFocusable,
  className,
}: WorldEntityTreeProps) {
  if (groups.length === 0) return null;
  return (
    <div className={className}>
      {groups.map((group) => (
        <div className="mb-2.5" key={group.typeId}>
          <p className="px-1 pb-1 text-[10px] font-medium text-muted-foreground">
            {labelOf(group.typeId)} · {group.nodes.length}
          </p>
          <ul>
            {group.nodes.map((node) => (
              <TreeRow
                activeId={activeId}
                collapsedIds={collapsedIds}
                depth={0}
                forceExpand={forceExpand}
                isFocusable={isFocusable}
                key={node.id}
                node={node}
                onSelect={onSelect}
                onToggleCollapse={onToggleCollapse}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  activeId,
  collapsedIds,
  onToggleCollapse,
  onSelect,
  forceExpand,
  isFocusable,
}: {
  node: EntityTreeNode;
  depth: number;
  activeId?: string | null;
  collapsedIds: Set<string>;
  onToggleCollapse: (entityId: string) => void;
  onSelect: (node: EntityTreeNode) => void;
  forceExpand?: boolean;
  isFocusable?: (node: EntityTreeNode) => boolean;
}) {
  const hasChildren = node.children.length > 0;
  const expanded = forceExpand || !collapsedIds.has(node.id);
  const focusable = isFocusable ? isFocusable(node) : true;
  const active = activeId === node.id;
  return (
    <li>
      <div className="flex items-center gap-0.5" style={{ paddingLeft: depth * 12 }}>
        {hasChildren ? (
          <button
            aria-label={expanded ? `折叠「${node.name}」` : `展开「${node.name}」`}
            className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onToggleCollapse(node.id)}
            type="button"
          >
            <ChevronRight className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span aria-hidden className="size-4 shrink-0" />
        )}
        <button
          className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-xs hover:bg-muted ${
            active ? "bg-secondary font-medium text-foreground" : focusable ? "text-foreground/90" : "text-muted-foreground"
          }`}
          disabled={!focusable}
          onClick={() => onSelect(node)}
          title={node.name}
          type="button"
        >
          <span className="truncate">{node.name}</span>
          {node.isProvisional && <span className="shrink-0 text-[9px] text-warning">草稿</span>}
        </button>
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              activeId={activeId}
              collapsedIds={collapsedIds}
              depth={depth + 1}
              forceExpand={forceExpand}
              isFocusable={isFocusable}
              key={child.id}
              node={child}
              onSelect={onSelect}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
