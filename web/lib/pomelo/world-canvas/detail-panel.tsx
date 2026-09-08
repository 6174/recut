/*
 * [INPUT]: 依赖 react 与 demo-store（选中解析 + 写动作）
 * [OUTPUT]: 对外提供 DetailPanel：右侧全高详情面板（真实案例设计：选中 → 侧栏分区展示）——
 * 实体 = 头部（类型徽章/标题/副标题/关闭）+ 封面 + 标签 pills + 简介 + 基本信息字段行
 * （可编辑）+ 关系（按关系类型分组、可点击跳转到对应实体）+ 参考资料（emoji 占位）+ 笔记；
 * 便签/关系/World 节点各有简化分区；未选中显示操作提示
 * [POS]: lib/pomelo/world-canvas 的右侧详情面板（index.tsx 组合）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useWorldDemoStore, kindLabel, relationLabel, typeColors, type DemoRelation } from "./demo-store";
import { mediaMeta } from "./blocks/media-node-block";

export function DetailPanel() {
  const selectedId = useWorldDemoStore((state) => state.selectedId);
  const notes = useWorldDemoStore((state) => state.notes);
  const mediaNodes = useWorldDemoStore((state) => state.mediaNodes);
  const relations = useWorldDemoStore((state) => state.relations);
  const worldName = useWorldDemoStore((state) => state.worldName);

  const notice = useWorldDemoStore((state) => state.notice);

  if (!selectedId) {
    return (
      <aside className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col overflow-y-auto border-l border-border bg-card px-5 py-4 text-sm">
        <p className="mb-2 text-xs font-medium text-foreground">操作提示</p>
        <div className="text-xs leading-5 text-muted-foreground">
          <p>· 点击卡片/便签/连线查看与编辑</p>
          <p>· 拖拽卡片移动位置；滚轮平移</p>
          <p>· ⌘/Ctrl + 滚轮缩放；空格 + 拖拽平移</p>
          <p>· 「连线」模式：从一张卡拖到另一张卡</p>
          <p>· Delete 删除选中；⌘Z 撤销</p>
          {notice && <p className="mt-3 rounded-md border border-border bg-muted/60 px-2 py-1.5">{notice}</p>}
        </div>
      </aside>
    );
  }

  return (
    <aside className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col overflow-y-auto border-l border-border bg-card px-5 py-4 text-sm">
      {relations.find((item) => item.id === selectedId) ? (
        <RelationSection relationId={selectedId} />
      ) : notes.find((item) => item.id === selectedId) ? (
        <NoteSection noteId={selectedId} />
      ) : mediaNodes.find((item) => item.id === selectedId) ? (
        <MediaSection key={selectedId} mediaNodeId={selectedId} />
      ) : selectedId === "world" ? (
        <WorldSection />
      ) : (
        <EntitySection key={selectedId} entityId={selectedId} />
      )}
    </aside>
  );
}

function MediaSection({ mediaNodeId }: { mediaNodeId: string }) {
  const mediaNode = useWorldDemoStore((state) => state.mediaNodes.find((item) => item.id === mediaNodeId));
  if (!mediaNode) return null;
  const meta = mediaMeta(mediaNode.media);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">基础节点</p>
          <p className="font-semibold">
            {meta.icon} {meta.label}
          </p>
        </div>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => useWorldDemoStore.getState().select(null)} type="button" title="关闭">
          ✕
        </button>
      </div>
      <div className="grid h-40 place-items-center rounded-xl border border-border bg-muted/40 text-4xl text-muted-foreground">{meta.icon}</div>
      <p className="text-xs leading-5 text-muted-foreground">占位结构：后续在此接入「上传 / 生成」，当前 demo 只保留 UI 结构。</p>
      <div className="flex gap-2 pb-2">
        <button
          className="h-8 flex-1 rounded-md border border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
          onClick={() => useWorldDemoStore.getState().removeSelected()}
          type="button"
        >
          删除节点
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ label }: { label: string }) {
  return <p className="mb-2 text-xs font-semibold text-foreground">{label}</p>;
}

function FieldRow({ label, value, commit }: { label: string; value: string; commit: (value: string) => void }) {
  return (
    <div className="flex items-baseline gap-3 py-1 text-xs">
      <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
      <input
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 outline-none focus:border-primary/50 focus:bg-background"
        value={value}
        onChange={(event) => commit(event.target.value)}
      />
    </div>
  );
}

function EntitySection({ entityId }: { entityId: string }) {
  const entity = useWorldDemoStore((state) => state.entities.find((item) => item.id === entityId));
  const relations = useWorldDemoStore((state) => state.relations);
  const entities = useWorldDemoStore((state) => state.entities);
  const updateEntity = useWorldDemoStore((state) => state.updateEntity);
  const select = useWorldDemoStore((state) => state.select);
  const removeSelected = useWorldDemoStore((state) => state.removeSelected);
  const enterEntity = useWorldDemoStore((state) => state.enterEntity);
  if (!entity) return null;
  const color = typeColors[entity.kind] ?? "#94a3b8";

  const grouped = new Map<string, DemoRelation[]>();
  for (const relation of relations) {
    if (relation.fromEntityId !== entity.id && relation.toEntityId !== entity.id) continue;
    const list = grouped.get(relation.relationType) ?? [];
    list.push(relation);
    grouped.set(relation.relationType, list);
  }

  const commitField = (index: number, value: string) => {
    const fields = (entity.fields ?? []).map((item, i) => (i === index ? { ...item, value } : item));
    updateEntity(entity.id, { fields });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 头部 */}
      <div className="flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl text-lg"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}
        >
          {entity.cover ?? "◍"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{entity.title}</p>
          <p className="truncate text-xs text-muted-foreground">{entity.subtitle || kindLabel(entity.kind)}</p>
        </div>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => useWorldDemoStore.getState().select(null)} type="button" title="关闭">
          ✕
        </button>
      </div>

      {/* 封面 */}
      <div
        className="grid h-36 place-items-center rounded-xl text-6xl"
        style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${color} 22%, transparent), color-mix(in srgb, ${color} 8%, transparent))` }}
      >
        {entity.cover ?? "◍"}
      </div>

      {/* 标签 pills */}
      <div className="flex flex-wrap gap-1.5">
        {(entity.tags ?? []).map((tag) => (
          <span key={tag} className="rounded-full px-2.5 py-0.5 text-xs" style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
            {tag}
          </span>
        ))}
        <input
          className="min-w-0 flex-1 rounded-full border border-border bg-transparent px-2.5 text-xs outline-none focus:border-primary/50"
          placeholder="添加标签（回车）"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const value = event.currentTarget.value.trim();
            if (!value) return;
            event.currentTarget.value = "";
            updateEntity(entity.id, { tags: [...(entity.tags ?? []), value] });
          }}
        />
      </div>

      {/* 简介 */}
      <textarea
        className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
        defaultValue={entity.desc ?? ""}
        placeholder="实体简介（失焦提交）"
        rows={2}
        onBlur={(event) => updateEntity(entity.id, { desc: event.target.value })}
      />

      {/* 基本信息 */}
      <section className="rounded-xl border border-border p-3">
        <div className="mb-1 flex items-center justify-between">
          <SectionTitle label="基本信息" />
          <span className="text-[10px] text-muted-foreground">{(entity.fields ?? []).length} 项</span>
        </div>
        {(entity.fields ?? []).map((field, index) => (
          <FieldRow
            key={`${field.label}-${index}`}
            label={field.label}
            value={field.value}
            commit={(value) => commitField(index, value)}
          />
        ))}
        <button
          className="mt-2 text-[10px] text-muted-foreground hover:text-foreground"
          type="button"
          onClick={() => updateEntity(entity.id, { fields: [...(entity.fields ?? []), { label: "新字段", value: "" }] })}
        >
          + 添加字段
        </button>
      </section>

      {/* 关系（按关系类型分组，点击跳转到对端实体） */}
      <section>
        <SectionTitle label="关系" />
        <div className="flex flex-col gap-3">
          {[...grouped.entries()].map(([relationType, list]) => (
            <div key={relationType}>
              <p className="mb-1.5 text-[10px] text-muted-foreground">{relationLabel(relationType)}</p>
              <div className="flex flex-wrap gap-2">
                {list.map((relation) => {
                  const otherId = relation.fromEntityId === entity.id ? relation.toEntityId : relation.fromEntityId;
                  const other = entities.find((item) => item.id === otherId);
                  const otherColor = typeColors[other?.kind ?? ""] ?? "#94a3b8";
                  return (
                    <button
                      key={relation.id}
                      className="flex w-20 flex-col items-center gap-1 rounded-lg border border-border bg-background p-2 text-center hover:border-primary/50"
                      onClick={() => useWorldDemoStore.getState().select(otherId)}
                      type="button"
                    >
                      <span className="grid size-8 place-items-center rounded-lg text-base" style={{ backgroundColor: `color-mix(in srgb, ${otherColor} 12%, transparent)` }}>
                        {other?.cover ?? "◍"}
                      </span>
                      <span className="w-full truncate text-[10px] font-medium">{other?.title ?? "未知"}</span>
                      <span className="truncate text-[9px] text-muted-foreground">{relationLabel(relation.relationType)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {grouped.size === 0 && <p className="text-xs text-muted-foreground">暂无关系</p>}
        </div>
      </section>

      {/* 参考资料 */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <SectionTitle label={`参考资料（${(entity.photos ?? []).length}）`} />
        </div>
        {(() => {
          const list = entity.photos ?? [];
          return (
            <div className="grid grid-cols-4 gap-2">
              {list.slice(0, 8).map((photo, index) => (
                <span
                  key={index}
                  className="grid aspect-square place-items-center rounded-lg border border-border bg-muted/50 text-xl"
                >
                  {photo}
                </span>
              ))}
              <button
                className="grid aspect-square place-items-center rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground"
                type="button"
                onClick={() => updateEntity(entity.id, { photos: [...list, "🖼️"] })}
                title="添加资料（demo 占位）"
              >
                +
              </button>
            </div>
          );
        })()}
      </section>

      {/* 笔记 */}
      <section>
        <SectionTitle label="笔记" />
        <textarea
          className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
          defaultValue={entity.note ?? ""}
          placeholder="实体笔记（失焦提交）"
          rows={3}
          onBlur={(event) => updateEntity(entity.id, { note: event.target.value })}
        />
      </section>

      {/* 动作区 */}
      <div className="flex gap-2 pb-2">
        <button className="h-8 flex-1 rounded-md border border-border px-2 text-xs hover:bg-muted" onClick={() => enterEntity(entity.id)} type="button">
          进入容器
        </button>
        <button
          className="h-8 flex-1 rounded-md border border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
          onClick={removeSelected}
          type="button"
        >
          删除实体
        </button>
      </div>
    </div>
  );
}



function NoteSection({ noteId }: { noteId: string }) {
  const note = useWorldDemoStore((state) => state.notes.find((item) => item.id === noteId));
  const updateNoteText = useWorldDemoStore((state) => state.updateNoteText);
  if (!note) return null;
  return (
    <div>
      <div className="mb-2 flex items-start justify-between">
        <p className="font-semibold">便签</p>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => useWorldDemoStore.getState().select(null)} type="button" title="关闭">
          ✕
        </button>
      </div>
      <textarea
        className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
        defaultValue={note.text}
        placeholder="便签内容（失焦提交）"
        rows={4}
        onBlur={(event) => updateNoteText(note.id, event.target.value)}
      />
      <button
        className="mt-3 h-7 rounded-md border border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
        onClick={() => useWorldDemoStore.getState().removeSelected()}
        type="button"
      >
        删除便签
      </button>
    </div>
  );
}

function RelationSection({ relationId }: { relationId: string }) {
  const relation = useWorldDemoStore((state) => state.relations.find((item) => item.id === relationId));
  const entities = useWorldDemoStore((state) => state.entities);
  if (!relation) return null;
  const from = entities.find((item) => item.id === relation.fromEntityId);
  const to = entities.find((item) => item.id === relation.toEntityId);
  const emoji = (entity?: { cover?: string }) => entity?.cover ?? "◍";
  return (
    <div>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="font-semibold">语义关系 · {relationLabel(relation.relationType)}</p>
          <p className="mt-1 text-xs text-muted-foreground">几何锚点可在画布内拖拽调整</p>
        </div>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => useWorldDemoStore.getState().select(null)} type="button" title="关闭">
          ✕
        </button>
      </div>
      <div className="rounded-lg border border-border p-3">
        <p className="truncate">
          <span className="mr-1">{emoji(from)}</span>
          <span className="font-semibold">{from?.title ?? relation.fromEntityId}</span>
          <span className="mx-1.5 text-muted-foreground">→</span>
          <span className="mr-1">{emoji(to)}</span>
          <span className="font-semibold">{to?.title ?? relation.toEntityId}</span>
        </p>
      </div>
      <button
        className="mt-3 h-7 rounded-md border border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
        onClick={() => useWorldDemoStore.getState().removeRelation(relation.id)}
        type="button"
      >
        删除关系
      </button>
    </div>
  );
}

function WorldSection() {
  const worldName = useWorldDemoStore((state) => state.worldName);
  return (
    <div>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">World 节点</p>
          <p className="font-semibold">{worldName}</p>
        </div>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => useWorldDemoStore.getState().select(null)} type="button" title="关闭">
          ✕
        </button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">语义真相在 World 本体，节点只是画布入口。</p>
    </div>
  );
}
