/*
 * [INPUT]: 依赖 react、canvas-store（updateRelation/changeRelationType/swapRelationDirection/removeRelation/toast）、
 * recut-worlds-client 类型、lucide-react
 * [OUTPUT]: 对外提供 RelationPanel（B.8 Relation 态，T5）：类型可换（受控词表分组选择 + 自定义关系名）、
 * 方向可改（一步交换两端 A↔B，保留 relation id 与画布锚点）、范围（只读文本，改范围 P1）、
 * 删除两步确认（确认后 toast）
 * [POS]: worlds/[worldID]/canvas/panel 的 Relation 态面板
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeftRight, Trash2 } from "lucide-react";
import { useState } from "react";
import type { WorldEntityRelation } from "@/lib/recut-worlds-client";
import { useWorldCanvasStore } from "../canvas-store";

export function RelationPanel({ relation }: { relation: WorldEntityRelation }) {
  const entities = useWorldCanvasStore((state) => state.entities);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const changeRelationType = useWorldCanvasStore((state) => state.changeRelationType);
  const swapRelationDirection = useWorldCanvasStore((state) => state.swapRelationDirection);
  const removeRelation = useWorldCanvasStore((state) => state.removeRelation);
  const select = useWorldCanvasStore((state) => state.select);
  const [armed, setArmed] = useState(false);
  const titleOf = (id: string) => entities.find((item) => item.id === id)?.name ?? "…";
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">类型</p>
        {readOnly ? (
          <p className="mt-0.5 text-sm">{relation.type}</p>
        ) : (
          <>
            <select
              className="mt-1 w-full rounded-md border bg-background p-1.5 text-sm outline-none focus:border-primary"
              onChange={(event) => void changeRelationType(relation, event.target.value)}
              value={relationTypes.some((item) => item.id === relation.type) ? relation.type : ""}
            >
              {!relationTypes.some((item) => item.id === relation.type) && (
                <option value="">{relation.type}（自定义）</option>
              )}
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
            <CustomRelationType current={relation.type} onConfirm={(relationType) => void changeRelationType(relation, relationType)} />
          </>
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
          {!readOnly && (
            <button
              aria-label="交换方向"
              className="ml-auto grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"
              onClick={() => void swapRelationDirection(relation)}
              title="交换方向"
              type="button"
            >
              <ArrowLeftRight className="size-3.5" />
            </button>
          )}
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

// 自定义关系类型（RFC：relation_type 对自由扩展开放）：受控词表之外就地输入关系名，回车或「确定」提交
function CustomRelationType({ current, onConfirm }: { current: string; onConfirm: (relationType: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const submit = () => {
    const next = value.trim();
    if (!next) return;
    setOpen(false);
    onConfirm(next);
  };
  if (!open) {
    return (
      <button className="mt-1 block text-left text-[11px] text-primary hover:underline" onClick={() => setOpen(true)} type="button">
        ＋ 自定义关系…
      </button>
    );
  }
  return (
    <div
      className="mt-1 flex gap-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        autoFocus
        className="min-w-0 flex-1 rounded-md border bg-background px-1.5 py-1 text-xs outline-none focus:border-primary"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder={`自定义（当前：${current}）`}
        value={value}
      />
      <button
        className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        disabled={!value.trim()}
        onClick={submit}
        type="button"
      >
        确定
      </button>
    </div>
  );
}
