/*
 * [INPUT]: 依赖 react、canvas-store（changeRelationType/removeRelation/toast）、recut-worlds-client 类型、
 * lucide-react
 * [OUTPUT]: 对外提供 RelationPanel（B.8 Relation 态，T5）：类型就地换（删+建兜底，保留 scope）、
 * 方向（点击端名选中该实体）、范围（只读文本，改范围 P1）、删除两步确认（确认后 toast）
 * [POS]: worlds/[worldID]/canvas/panel 的 Relation 态面板
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { WorldEntityRelation } from "@/lib/recut-worlds-client";
import { useWorldCanvasStore } from "../canvas-store";

export function RelationPanel({ relation }: { relation: WorldEntityRelation }) {
  const entities = useWorldCanvasStore((state) => state.entities);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const changeRelationType = useWorldCanvasStore((state) => state.changeRelationType);
  const removeRelation = useWorldCanvasStore((state) => state.removeRelation);
  const select = useWorldCanvasStore((state) => state.select);
  const [armed, setArmed] = useState(false);
  const titleOf = (id: string) => entities.find((item) => item.id === id)?.title ?? "…";
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">类型</p>
        {readOnly ? (
          <p className="mt-0.5 text-sm">{relation.type}</p>
        ) : (
          <select
            className="mt-1 w-full rounded-md border bg-background p-1.5 text-sm outline-none focus:border-primary"
            onChange={(event) => void changeRelationType(relation, event.target.value)}
            value={relation.type}
          >
            {[...new Map(relationTypes.map((item) => [item.group, relationTypes.filter((t) => t.group === item.group)])).entries()].map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.labelZh}（{item.id}）
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">方向</p>
        <p className="mt-0.5 flex items-center gap-1 text-sm">
          <button className="rounded px-1 hover:bg-muted" onClick={() => select({ type: "entity", entity: entities.find((item) => item.id === relation.fromEntityId)! })} type="button">
            {titleOf(relation.fromEntityId)}
          </button>
          <span className="text-muted-foreground">→</span>
          <button className="rounded px-1 hover:bg-muted" onClick={() => select({ type: "entity", entity: entities.find((item) => item.id === relation.toEntityId)! })} type="button">
            {titleOf(relation.toEntityId)}
          </button>
        </p>
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">范围</p>
        <p className="mt-0.5 text-sm">{relation.scopeEntityId ? `仅「${titleOf(relation.scopeEntityId)}」内部可见 · 局部` : "全局"}</p>
      </div>
      {!readOnly && (
        armed ? (
          <div className="flex gap-2">
            <button className="h-8 flex-1 rounded-md border text-xs hover:bg-muted" onClick={() => setArmed(false)} type="button">
              取消
            </button>
            <button
              className="h-8 flex-1 rounded-md bg-destructive text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setArmed(false);
                void removeRelation(relation.id);
              }}
              type="button"
            >
              确认删除
            </button>
          </div>
        ) : (
          <button
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => setArmed(true)}
            type="button"
          >
            <Trash2 className="size-3.5" /> 删除此关系
          </button>
        )
      )}
    </div>
  );
}
