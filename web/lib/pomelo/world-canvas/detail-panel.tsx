/*
 * [INPUT]: 依赖 react 与 demo-store（选中解析 + 写动作）
 * [OUTPUT]: 对外提供 DetailPanel：右侧详情面板——按选中对象（实体/便签/关系/World 节点）渲染
 * 标题/简述/文本的可编辑字段（失焦提交）与删除动作；未选中显示操作提示（loomic 交互结构锚定：
 * 选中 → 右侧面板）
 * [POS]: lib/pomelo/world-canvas 的右侧详情面板（index.tsx 组合）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useWorldDemoStore, kindLabel, relationLabel, typeColors } from "./demo-store";

export function DetailPanel() {
  const selectedId = useWorldDemoStore((state) => state.selectedId);
  const entities = useWorldDemoStore((state) => state.entities);
  const notes = useWorldDemoStore((state) => state.notes);
  const relations = useWorldDemoStore((state) => state.relations);
  const worldName = useWorldDemoStore((state) => state.worldName);

  const entity = entities.find((item) => item.id === selectedId);
  const note = notes.find((item) => item.id === selectedId);
  const relation = relations.find((item) => item.id === selectedId);

  return (
    <div className="absolute right-3 top-3 z-10 w-72 rounded-xl border border-border bg-card/95 p-4 text-sm shadow-xl backdrop-blur">
      {entity && <EntitySection key={entity.id} entityId={entity.id} />}
      {note && <NoteSection key={note.id} noteId={note.id} />}
      {relation && <RelationSection key={relation.id} relationId={relation.id} />}
      {selectedId === "world" && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">World 节点</p>
          <p className="font-semibold">{worldName}</p>
          <p className="mt-2 text-xs text-muted-foreground">语义真相在 World 本体，节点只是画布入口。</p>
        </div>
      )}
      {!selectedId && (
        <div className="text-xs leading-5 text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">操作提示</p>
          <p>· 点击卡片/便签/连线查看与编辑</p>
          <p>· 拖拽卡片移动位置；滚轮平移</p>
          <p>· ⌘/Ctrl + 滚轮缩放；空格 + 拖拽平移</p>
          <p>· 「连线」模式：从一张卡拖到另一张卡</p>
          <p>· Delete 删除选中；⌘Z 撤销</p>
        </div>
      )}
    </div>
  );
}

function EntitySection({ entityId }: { entityId: string }) {
  const entity = useWorldDemoStore((state) => state.entities.find((item) => item.id === entityId));
  const updateEntitySummary = useWorldDemoStore((state) => state.updateEntitySummary);
  const enterEntity = useWorldDemoStore((state) => state.enterEntity);
  if (!entity) return null;
  const color = typeColors[entity.kind] ?? "#94a3b8";
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs text-muted-foreground">{kindLabel(entity.kind)}</span>
      </div>
      <p className="font-semibold">{entity.title}</p>
      <textarea
        className="mt-2 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
        defaultValue={entity.summary}
        placeholder="实体简述（失焦提交）"
        rows={3}
        onBlur={(event) => updateEntitySummary(entity.id, event.target.value)}
      />
      <button
        className="mt-2 h-7 rounded-md border border-primary/40 px-2 text-xs text-primary hover:bg-primary/10"
        onClick={() => enterEntity(entity.id)}
        type="button"
      >
        进入容器（demo 提示）
      </button>
    </div>
  );
}

function NoteSection({ noteId }: { noteId: string }) {
  const note = useWorldDemoStore((state) => state.notes.find((item) => item.id === noteId));
  const updateNoteText = useWorldDemoStore((state) => state.updateNoteText);
  if (!note) return null;
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">便签</p>
      <textarea
        className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
        defaultValue={note.text}
        placeholder="便签内容（失焦提交）"
        rows={4}
        onBlur={(event) => updateNoteText(note.id, event.target.value)}
      />
    </div>
  );
}

function RelationSection({ relationId }: { relationId: string }) {
  const relation = useWorldDemoStore((state) => state.relations.find((item) => item.id === relationId));
  const entities = useWorldDemoStore((state) => state.entities);
  const removeRelation = useWorldDemoStore((state) => state.removeRelation);
  if (!relation) return null;
  const from = entities.find((item) => item.id === relation.fromEntityId);
  const to = entities.find((item) => item.id === relation.toEntityId);
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">语义关系 · {relationLabel(relation.relationType)}</p>
      <p className="truncate">
        <span className="font-semibold">{from?.title ?? relation.fromEntityId}</span>
        <span className="mx-1.5 text-muted-foreground">→</span>
        <span className="font-semibold">{to?.title ?? relation.toEntityId}</span>
      </p>
      <button
        className="mt-3 h-7 rounded-md border border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
        onClick={() => removeRelation(relation.id)}
        type="button"
      >
        删除关系
      </button>
    </div>
  );
}
