/*
 * [INPUT]: 依赖 react、canvas-store（World 态数据与 updateWorldMeta/locate 动作）、panel/field-row
 * [OUTPUT]: 对外提供 WorldPanel：空选/选中 World 节点时的详情面板（B.8 World 态）——
 * 名称与简介就地编辑、世界快照（类型计数）、待关注列表（无简介/无素材/待确认草稿，[定位]），
 * [＋ 添加设定…] 打开创建菜单
 * [POS]: worlds/[worldID]/canvas/panel 的 World 态面板（不暴露 revision/canonical/hash，B.2）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Plus, Crosshair } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorldDetail, WorldEntity } from "@/lib/recut-worlds-client";
import { useWorldsStore } from "@/lib/worlds-store";
import { useWorldCanvasStore } from "../canvas-store";
import { FieldRow, typeLabelOf } from "./field-row";

export function WorldPanel({ worldDetail }: { worldDetail: WorldDetail | undefined }) {
  const store = useWorldCanvasStore();
  const entities = useWorldCanvasStore((state) => state.entities);
  const relations = useWorldCanvasStore((state) => state.relations);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);

  // 待关注（至多 5 条）：当前上下文内 缺简介 / 缺素材 / 待确认草稿（B.8；快照为全世界计数）
  const attention: Array<{ key: string; text: string; entity?: WorldEntity }> = [];
  for (const entity of entities) {
    if (!entity.summary.trim()) attention.push({ key: `${entity.id}-summary`, text: `${entity.title} 还没有简介`, entity });
    if (!(entity.references ?? []).length) attention.push({ key: `${entity.id}-evidence`, text: `${entity.title} 还没有参考素材`, entity });
    if (entity.isProvisional) attention.push({ key: `${entity.id}-draft`, text: `${entity.title} 待确认设定`, entity });
  }
  const counts = worldDetail?.entityCounts;
  const snapshot = counts
    ? Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} 个${typeLabelOf({ kind } as WorldEntity, store.entityTypes)}`)
        .join(" · ")
    : "";
  const summary = [snapshot, `${relations.length} 条关系`].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4 text-sm">
      <FieldRow label="名称" value={store.worldName} onSave={(value) => store.updateWorldMeta({ name: String(value) })} />
      <FieldRow
        label="简介"
        value={worldDetail?.description ?? ""}
        multiline
        placeholder="一句话描述这个世界…"
        onSave={(value) => store.updateWorldMeta({ description: String(value) })}
      />
      <div className="border-t pt-3">
        <p className="text-[11px] font-medium text-muted-foreground">世界快照</p>
        <p className="mt-1 text-sm leading-6">{summary || "（空世界）"}</p>
      </div>
      {attention.length > 0 && (
        <div className="border-t pt-3">
          <p className="text-[11px] font-medium text-muted-foreground">待关注</p>
          <ul className="mt-1 space-y-1">
            {attention.slice(0, 5).map((item) => (
              <li className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1.5 text-xs" key={item.key}>
                <span className="truncate">{item.text}</span>
                {item.entity && (
                  <button
                    aria-label="定位"
                    className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => useWorldCanvasStore.getState().select({ type: "entity", entity: item.entity! })}
                    type="button"
                  >
                    <Crosshair className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!store.readOnly && (
        <button
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => setCreating(true)}
          type="button"
        >
          <Plus className="size-3.5" /> 添加设定…
        </button>
      )}
    </div>
  );
}
