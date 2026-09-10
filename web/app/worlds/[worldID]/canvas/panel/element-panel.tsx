/*
 * [INPUT]: 依赖 react、canvas-store（promote/removeElement/setPromoting/persistGeometry/upsertElement/
 * renameAttrLabel/syncAttrValue）、panel/field-row（FieldRow 共用编辑原语）、lucide-react
 * [OUTPUT]: 对外提供 ElementPanel（B.8 Canvas 元素态）：便签/文本正文就地编辑（T4 面板侧）、
 * 箭头（草稿）可编辑——属性边改属性名（renameAttrLabel 同步实体字段）与文本值、实体间草稿边改关系类型
 * （persist edgeType+relationType，提升时沿用）、提升为设定 / 提升为语义关系、删除；
 * 媒体元素态（图片/视频：kind=media 独立媒体 或 kind=attr 媒体属性卡）路由到
 * panel/media-editor 的 MediaElementEditor（预览/来源三选/生成配方/素材指针历史，RFC 2026-09-10）
 * [POS]: worlds/[worldID]/canvas 的自由画布元素面板
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useWorldCanvasStore } from "../canvas-store";
import { FieldRow } from "./field-row";
import { MediaElementEditor } from "./media-editor";

// attr 媒体卡（kind=attr 且 props.media≠text）与独立媒体元素（kind=media）的类型标签
function mediaLabelOf(media: string): string {
  return ({ image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[media] ?? media;
}

// attr 媒体卡的属性名称编辑（与文本卡同一 renameAttrLabel 通道：label + 元素名 + 边名 + 实体字段映射）
function AttrLabelEditor({ attrId, initialLabel }: { attrId: string; initialLabel: string }) {
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const renameAttrLabel = useWorldCanvasStore((state) => state.renameAttrLabel);
  return <FieldRow label="属性名称" value={initialLabel} placeholder="属性名…" readOnly={readOnly} onSave={(value) => renameAttrLabel(attrId, String(value))} />;
}

// attr 文本卡（kind=attr 且 props.media=text）：属性名称 + 面板正文编辑（FieldRow：blur/⌘↵ 保存与全屏放大）。
// 保存通道与画布就地编辑同源：persistGeometry 写 props.text，再 syncAttrValue 按字段映射回写实体；
// 名称走 renameAttrLabel（label 元素名+边名+实体字段一次完成）
function AttrTextCardEditor({ attrId, initialText }: { attrId: string; initialText: string }) {
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const renameAttrLabel = useWorldCanvasStore((state) => state.renameAttrLabel);
  const persistGeometry = useWorldCanvasStore((state) => state.persistGeometry);
  const syncAttrValue = useWorldCanvasStore((state) => state.syncAttrValue);
  const elements = useWorldCanvasStore((state) => state.elements);
  const label = String(elements.find((item) => item.id === attrId)?.props?.label ?? "") || String(elements.find((item) => item.id === attrId)?.name ?? "").replace(/^属性 · /, "");
  const save = (value: string) => {
    const attr = useWorldCanvasStore.getState().elements.find((item) => item.id === attrId);
    if (!attr) return;
    return persistGeometry(attrId, undefined, { text: value }).then(() => {
      const named = useWorldCanvasStore.getState().elements.find((item) => item.id === attrId);
      if (named) return syncAttrValue(named, value);
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{initialText.length} 字</span>
        <button
          className="rounded-md border px-2 py-0.5 hover:bg-muted"
          onClick={() => void navigator.clipboard.writeText(initialText)}
          title="复制正文"
          type="button"
        >
          复制
        </button>
      </div>
      <FieldRow
        label="属性名称"
        value={label}
        placeholder="属性名…"
        readOnly={readOnly}
        onSave={(value) => renameAttrLabel(attrId, String(value))}
      />
      <FieldRow
        label="正文"
        multiline
        value={initialText}
        placeholder="点击填写（放大编辑可看全文）"
        readOnly={readOnly}
        onSave={(value) => save(String(value))}
      />
    </div>
  );
}

export function ElementPanel({ fromEntityId: fromEntityIdProp, toEntityId: toEntityIdProp }: { fromEntityId?: string; toEntityId?: string }) {  const element = useWorldCanvasStore((state) => (state.selection?.type === "canvas" ? state.selection.element : null));
  const entities = useWorldCanvasStore((state) => state.entities);
  const elements = useWorldCanvasStore((state) => state.elements);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const removeElement = useWorldCanvasStore((state) => state.removeElement);
  const setPromoting = useWorldCanvasStore((state) => state.setPromoting);
  const titleOf = (id?: string) => (id ? entities.find((item) => item.id === id)?.name ?? "…" : "—");
  if (!element) return null;
  const isArrow = element.kind === "arrow";
  const isMediaElement = element.kind === "media";
  const isNote = element.kind === "note";
  const isText = element.kind === "text";
  const isAttrCard = element.kind === "attr" && String(element.props?.media ?? "text") !== "text";
  const isAttrTextCard = element.kind === "attr" && String(element.props?.media ?? "text") === "text";
  // 箭头端点（原始元素 id）：属性边 to 端是 attr 元素，实体边两端都是实体元素
  const fromRaw = String(element.props?.fromElementId ?? "");
  const toRaw = String(element.props?.toElementId ?? "");
  const attrTarget = elements.find((item) => item.id === toRaw && item.kind === "attr");
  const isAttrEdge = isArrow && (Boolean(String(element.props?.attrMedia ?? "")) || Boolean(attrTarget));
  const fromEntityId = fromEntityIdProp ?? fromRaw.replace(/^shape:/, "");
  const toEntityId = toEntityIdProp ?? toRaw.replace(/^shape:/, "");
  const connectable = Boolean(fromEntityId && toEntityId && fromEntityId !== toEntityId);
  const fromTitle = titleOf(fromEntityId);
  const toTitle = attrTarget ? `「${String(attrTarget.props?.label ?? "") || String(attrTarget.name ?? "").replace(/^属性 · /, "")}」` : titleOf(toEntityId);
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">元素类型</p>
        <p className="mt-0.5 text-sm">{isMediaElement ? "媒体" : isAttrCard ? `${mediaLabelOf(String(element.props?.media ?? "image"))}属性` : isAttrTextCard ? "文本属性" : isNote ? "便签" : isText ? "文本" : isArrow ? (isAttrEdge ? "属性边" : "关系边（草稿）") : element.kind === "shape" ? "形状" : element.kind}</p>
      </div>
      {(isMediaElement || isAttrCard) && <MediaElementEditor element={element} />}
      {isAttrCard && <AttrLabelEditor attrId={element.id} initialLabel={String(element.props?.label ?? "") || String(element.name ?? "").replace(/^属性 · /, "")} />}
      {(isNote || isText) && <ElementBodyEditor elementId={element.id} initialText={String(element.props?.text ?? "")} />}
      {isAttrTextCard && <AttrTextCardEditor attrId={element.id} initialText={String(element.props?.text ?? "")} />}
      {isArrow && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">连接</p>
          <p className="mt-0.5 text-sm">
            {fromTitle} → {toTitle}
          </p>
        </div>
      )}
      {isAttrEdge && attrTarget && (
        <AttrEdgeEditor attrId={attrTarget.id} initialLabel={String(attrTarget.props?.label ?? "") || String(attrTarget.name ?? "").replace(/^属性 · /, "")} media={String(attrTarget.props?.media ?? "text")} initialText={String(attrTarget.props?.text ?? "")} />
      )}
      {isArrow && !isAttrEdge && connectable && (
        <DraftRelationTypeEditor arrowId={element.id} currentType={String(element.props?.relationType ?? element.props?.edgeType ?? "")} />
      )}
      {isArrow && !isAttrEdge && connectable && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          该箭头连接两个实体。提升后将写入语义关系（产出 revision），画布草稿保留为投影。
        </p>
      )}
      {!readOnly && (
        <div className="space-y-2">
          {isNote && (
            <button
              className="flex h-8 w-full items-center justify-center rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => setPromoting(element.id)}
              type="button"
            >
              ↑ 提升为设定…
            </button>
          )}
          {isArrow && !isAttrEdge && connectable && (
            <button
              className="flex h-8 w-full items-center justify-center rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => setPromoting(element.id)}
              type="button"
            >
              ↑ 提升为语义关系…
            </button>
          )}
          <button
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => void removeElement(element.id)}
            type="button"
          >
            <Trash2 className="size-3.5" /> 删除
          </button>
        </div>
      )}
    </div>
  );
}

// 属性边编辑：属性名称（renameAttrLabel：label + 元素名 + 边名 + 实体 content 字段映射一次完成）、
// 文本值（persistGeometry + syncAttrValue；媒体属性值走画布/素材流，不在面板编辑）
function AttrEdgeEditor({ attrId, initialLabel, media, initialText }: { attrId: string; initialLabel: string; media: string; initialText: string }) {
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const renameAttrLabel = useWorldCanvasStore((state) => state.renameAttrLabel);
  const persistGeometry = useWorldCanvasStore((state) => state.persistGeometry);
  const syncAttrValue = useWorldCanvasStore((state) => state.syncAttrValue);
  const elements = useWorldCanvasStore((state) => state.elements);
  return (
    <div className="space-y-3">
      <FieldRow label="属性名称" value={initialLabel} placeholder="属性名…" readOnly={readOnly} onSave={(value) => renameAttrLabel(attrId, String(value))} />
      {media === "text" && (
        <FieldRow
          label="值"
          multiline
          value={initialText}
          placeholder="点击填写"
          readOnly={readOnly}
          onSave={(value) => {
            const attr = useWorldCanvasStore.getState().elements.find((item) => item.id === attrId);
            if (!attr) return;
            return persistGeometry(attrId, undefined, { text: String(value) }).then(() => {
              const named = elements.find((item) => item.id === attrId);
              if (named) return syncAttrValue(named, String(value));
            });
          }}
        />
      )}
      {media !== "text" && <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">{media === "image" ? "图片" : media === "video" ? "视频" : "音频"}属性：双击画布上的属性卡可预览/更换素材。</p>}
    </div>
  );
}

// 实体间草稿边的关系类型：选中即持久化（edgeType + relationType 双写，画布标签与提升语义共用）
function DraftRelationTypeEditor({ arrowId, currentType }: { arrowId: string; currentType: string }) {
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const upsertElement = useWorldCanvasStore((state) => state.upsertElement);
  const change = (type: string) => {
    const arrow = useWorldCanvasStore.getState().elements.find((item) => item.id === arrowId);
    if (!arrow) return;
    void upsertElement({
      id: arrow.id,
      contextId: arrow.contextId ?? "",
      kind: arrow.kind,
      refKind: arrow.refKind ?? "",
      refId: arrow.refId ?? "",
      name: arrow.name ?? "",
      props: { ...(arrow.props ?? {}), edgeType: type, relationType: type },
      geometry: arrow.geometry ?? {},
      style: arrow.style ?? {},
      layer: arrow.layer ?? "0",
    });
  };
  if (readOnly) return null;
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">关系类型</p>
      <select
        className="mt-1 w-full rounded-md border bg-background p-1.5 text-sm outline-none focus:border-primary"
        onChange={(event) => change(event.target.value)}
        value={currentType}
      >
        <option value="">未指定（提升时再选）</option>
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
    </div>
  );
}

// 便签/文本正文编辑（T4 面板侧）：与画布就地编辑同一保存通道（persistGeometry props.text）
function ElementBodyEditor({ elementId, initialText }: { elementId: string; initialText: string }) {
  const [value, setValue] = useState(initialText);
  const [saved, setSaved] = useState(false);
  const save = () => {
    if (value === initialText) return;
    void useWorldCanvasStore
      .getState()
      .persistGeometry(elementId, undefined, { text: value })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      });
  };
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">内容</p>
      <textarea
        className="mt-1 min-h-20 w-full resize-y rounded-md border bg-background p-2 text-xs leading-5 outline-none focus:border-primary"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
        value={value}
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">⌘↵ 保存</span>
        {saved ? (
          <span className="text-[10px] text-primary">已保存</span>
        ) : (
          <button className="rounded-md border px-2 py-0.5 text-[10px] hover:bg-muted" onClick={save} type="button">
            保存
          </button>
        )}
      </div>
    </div>
  );
}
