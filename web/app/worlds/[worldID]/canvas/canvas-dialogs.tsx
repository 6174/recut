/*
 * [INPUT]: 依赖 canvas-store（creating/pendingRelation/promotingId 状态与 create/createRelation/promote 动作）
 * 与 lucide-react
 * [OUTPUT]: 对外提供画布对话框层：新建实体（entity type 目录选择）、受控关系确认（用户画的实体间箭头或面板
 * 发起 → 选受控词表 → createRelation 并清掉草稿箭头）、Promote 确认（便签→实体 / 箭头→关系）
 * [POS]: worlds/[worldID]/canvas 的对话框层；只读快照 + store 动作，语义写全部产出 revision
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useMemo, useState } from "react";
import type { WorldEntityType, WorldRelationType } from "@/lib/recut-worlds-client";
import { useWorldCanvasStore } from "./canvas-store";

export function CanvasDialogs() {
  const creating = useWorldCanvasStore((state) => state.creating);
  const pendingRelation = useWorldCanvasStore((state) => state.pendingRelation);
  const promotingId = useWorldCanvasStore((state) => state.promotingId);
  const promotingElement = useWorldCanvasStore((state) => state.elements.find((element) => element.id === promotingId));
  return (
    <>
      {creating && <CreateEntityDialog />}
      {pendingRelation && <RelateDialog />}
      {promotingElement && <PromoteDialog elementKind={promotingElement.kind} />}
    </>
  );
}

function CreateEntityDialog() {
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  const createEntity = useWorldCanvasStore((state) => state.createEntity);
  const [kind, setKind] = useState("character");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const types: WorldEntityType[] = entityTypes.length ? entityTypes : [{ id: "character", name: "人物", worldId: "", scope: "preset", fields: [], builtin: true, createdAt: "", updatedAt: "" }];
  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={() => setCreating(false)} role="dialog">
      <form
        className="w-full max-w-md rounded-md border bg-card p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || busy) return;
          setBusy(true);
          void createEntity(kind, title.trim()).then(() => setBusy(false));
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="text-base font-semibold">新建实体</h3>
        <div className="mt-3 space-y-3">
          <select className="w-full rounded-md border bg-background p-2 text-sm" onChange={(event) => setKind(event.target.value)} value={kind}>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}（{type.id}）
              </option>
            ))}
          </select>
          <input autoFocus className="w-full rounded-md border bg-background p-2 text-sm outline-none focus:border-primary" onChange={(event) => setTitle(event.target.value)} placeholder="实体名称" value={title} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setCreating(false)} type="button">取消</button>
          <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={!title.trim() || busy} type="submit">创建</button>
        </div>
      </form>
    </div>
  );
}

function RelateDialog() {
  const pendingRelation = useWorldCanvasStore((state) => state.pendingRelation);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const createRelation = useWorldCanvasStore((state) => state.createRelation);
  const setPendingRelation = useWorldCanvasStore((state) => state.setPendingRelation);
  const entities = useWorldCanvasStore((state) => state.elements);
  const titleOf = (id: string) => {
    const target = useWorldCanvasStore.getState().entities.find((entity) => entity.id === id);
    return target?.title ?? entities.find((element) => element.id === id)?.name ?? id.slice(0, 10);
  };
  const [type, setType] = useState("references");
  const groups = useMemo(() => {
    const map = new Map<string, WorldRelationType[]>();
    for (const item of relationTypes) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return map;
  }, [relationTypes]);
  if (!pendingRelation) return null;
  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={() => setPendingRelation(null)} role="dialog">
      <div className="w-full max-w-md rounded-md border bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <h3 className="text-base font-semibold">建立语义关系</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {titleOf(pendingRelation.fromEntityId)} → {titleOf(pendingRelation.toEntityId)}
        </p>
        <select className="mt-3 w-full rounded-md border bg-background p-2 text-sm" onChange={(event) => setType(event.target.value)} value={type}>
          {[...groups.entries()].map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.labelZh}（{item.id}）
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          关系将写入 world_relations（受控词表 + 自定义扩展），产出 revision。{entityTypes.length ? "" : ""}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setPendingRelation(null)} type="button">取消</button>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            onClick={() => void createRelation(pendingRelation.fromEntityId, pendingRelation.toEntityId, type)}
            type="button"
          >
            建立关系
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoteDialog({ elementKind }: { elementKind: string }) {
  const promotingId = useWorldCanvasStore((state) => state.promotingId);
  const setPromoting = useWorldCanvasStore((state) => state.setPromoting);
  const promote = useWorldCanvasStore((state) => state.promote);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const [kind, setKind] = useState(elementKind === "note" ? "reference" : "references");
  const isNote = elementKind === "note";
  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={() => setPromoting(null)} role="dialog">
      <div className="w-full max-w-md rounded-md border bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <h3 className="text-base font-semibold">{isNote ? "提升为正式实体" : "提升为语义关系"}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {isNote ? "便签将转为正式实体并产出 revision；原画布元素保留为投影。" : "箭头将写入 world_relations 并产出 revision；原画布元素保留为草稿投影。"}
        </p>
        {isNote ? (
          <select className="mt-3 w-full rounded-md border bg-background p-2 text-sm" onChange={(event) => setKind(event.target.value)} value={kind}>
            {entityTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}（{type.id}）
              </option>
            ))}
          </select>
        ) : (
          <select className="mt-3 w-full rounded-md border bg-background p-2 text-sm" onChange={(event) => setKind(event.target.value)} value={kind}>
            {relationTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.labelZh}（{type.id}）
              </option>
            ))}
          </select>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setPromoting(null)} type="button">取消</button>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            onClick={() => {
              if (!promotingId) return;
              void (isNote ? promote(promotingId, { kind }) : promote(promotingId, { relationType: kind }));
            }}
            type="button"
          >
            Promote
          </button>
        </div>
      </div>
    </div>
  );
}
