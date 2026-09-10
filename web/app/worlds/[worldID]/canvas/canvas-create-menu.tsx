/*
 * [INPUT]: 依赖 react、canvas-store（creating/creatingAt/entityTypes 与 createEntity/addNote/
 * addFreeElement/setCreating/load 动作）、recut-worlds-client、readLastKind/readRecentCustomTypes
 * [OUTPUT]: 对外提供 CreateMenu（B.7 创建菜单，替代旧「类型下拉+标题」弹窗）：类型目录驱动的
 * 2 列网格（预设 + 最近自定义类型）、便签/文本行、[＋ 新建设定类型…]（名称+emoji，最小
 * 「描述」字段 schema，创建后可选落第一张草稿卡）；锚点 = creatingAt（双击空白 / Header ＋ 按钮正下方）或视口中心
 * [POS]: worlds/[worldID]/canvas 的创建系统菜单层；选类型即在锚点处落正式卡片并进入命名态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useState } from "react";
import type { PixiRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import type { WorldEntityType } from "@/lib/recut-worlds-client";
import { createRecutWorldsClient, entityKindLabels } from "@/lib/recut-worlds-client";
import { readRecentCustomTypes, useWorldCanvasStore } from "./canvas-store";

// 视口中心的世界坐标（无 creatingAt 时的兜底落点）
function viewportCenterWorld(): { x: number; y: number } {
  const editor = useWorldCanvasStore.getState().editor;
  if (!editor) return { x: 300, y: 240 };
  const adapter = editor.renderAdapter as PixiRendererAdapter;
  const view = adapter.app.view as HTMLCanvasElement;
  const rect = view.getBoundingClientRect();
  const t = adapter.transform;
  return { x: (rect.width / 2 - t.x) / t.scale, y: (rect.height / 2 - t.y) / t.scale };
}

// 创建锚点（creatingAt 屏幕坐标）换算为世界坐标：元素落在触发菜单时的光标处
function cursorWorld(at: { screenX: number; screenY: number } | null): { x: number; y: number } {
  if (!at) return viewportCenterWorld();
  const editor = useWorldCanvasStore.getState().editor;
  if (!editor) return viewportCenterWorld();
  const adapter = editor.renderAdapter as PixiRendererAdapter;
  const view = adapter.app.view as HTMLCanvasElement;
  const rect = view.getBoundingClientRect();
  const t = adapter.transform;
  return { x: (at.screenX - rect.left - t.x) / t.scale, y: (at.screenY - rect.top - t.y) / t.scale };
}

const KIND_ICONS: Record<string, string> = {
  character: "👤",
  location: "📍",
  object: "📦",
  story: "📖",
  style: "🎨",
  rule: "⚖️",
  reference: "📎",
};

// 类型显示名：目录 name 优先，静态 label 兜底
function typeNameOf(type: WorldEntityType): string {
  return type.name || entityKindLabels[type.id as keyof typeof entityKindLabels] || type.id;
}

export function CreateMenu() {
  const creating = useWorldCanvasStore((state) => state.creating);
  const creatingAt = useWorldCanvasStore((state) => state.creatingAt);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  const [newTypeOpen, setNewTypeOpen] = useState(false);
  if (!creating) return null;

  const recentIds = readRecentCustomTypes();
  const customTypes = entityTypes.filter((type) => type.scope === "custom" && recentIds.includes(type.id)).slice(0, 3);
  const presetTypes = entityTypes.filter((type) => !customTypes.includes(type));
  const close = () => {
    setCreating(false);
    setNewTypeOpen(false);
  };
  const create = (kind: string) => {
    close();
    void useWorldCanvasStore.getState().createEntity(kind, { pos: cursorWorld(creatingAt) });
  };
  const left = creatingAt ? Math.min(Math.max(16, creatingAt.screenX), (typeof window !== "undefined" ? window.innerWidth - 300 : 600)) : Math.max(16, (typeof window !== "undefined" ? window.innerWidth / 2 - 140 : 300));
  const top = creatingAt ? Math.min(Math.max(60, creatingAt.screenY), (typeof window !== "undefined" ? window.innerHeight - 380 : 400)) : Math.max(60, (typeof window !== "undefined" ? window.innerHeight / 2 - 180 : 200));

  return (
    <div className="fixed inset-0 z-[70]" onPointerDown={close}>
      <div
        className="absolute w-72 rounded-xl border border-border bg-card p-2 text-sm shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        style={{ left, top }}
      >
        <p className="px-1.5 py-1 text-[10px] font-medium text-muted-foreground">新建</p>
        <div className="grid grid-cols-2 gap-1">
          {presetTypes.map((type) => (
            <button
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
              key={type.id}
              onClick={() => create(type.id)}
              type="button"
            >
              <span aria-hidden>{type.icon || KIND_ICONS[type.id] || "◍"}</span>
              <span className="truncate">{typeNameOf(type)}</span>
            </button>
          ))}
          {customTypes.map((type) => (
            <button
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
              key={type.id}
              onClick={() => create(type.id)}
              type="button"
            >
              <span aria-hidden>{type.icon || "◍"}</span>
              <span className="truncate">{typeNameOf(type)}</span>
            </button>
          ))}
        </div>
        <div className="my-1.5 h-px bg-border" />
        <div className="grid grid-cols-2 gap-1">
          <button
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => {
              close();
              void useWorldCanvasStore.getState().addNote(cursorWorld(creatingAt));
            }}
            type="button"
          >
            <span aria-hidden>📝</span> 便签
          </button>
          <button
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => {
              close();
              void useWorldCanvasStore.getState().addFreeElement("text", cursorWorld(creatingAt));
            }}
            type="button"
          >
            <span aria-hidden>Ｔ</span> 文本
          </button>
        </div>
        <div className="my-1.5 h-px bg-border" />
        <div className="grid grid-cols-3 gap-1">
          {/* 媒体项（T8）：打开素材来源浮层（无目标实体 = 独立媒体元素） */}
          {[["🖼", "图片", "image"], ["🎬", "视频", "video"], ["🎙", "音频", "audio"]] .map(([icon, label, modality]) => (
            <button
              className="flex items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-left text-xs hover:bg-muted"
              key={modality}
              onClick={() => {
                close();
                useWorldCanvasStore.getState().setMediaSource(null);
              }}
              type="button"
            >
              <span aria-hidden>{icon}</span>
              {label}
            </button>
          ))}
        </div>
        <div className="my-1.5 h-px bg-border" />
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
          onClick={() => setNewTypeOpen(true)}
          type="button"
        >
          ＋ 新建设定类型…
        </button>
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
          onClick={() => {
            close();
            useWorldCanvasStore.getState().setAiDialogOpen(true);
          }}
          type="button"
        >
          ✨ 用描述添加设定…
        </button>
      </div>
      {newTypeOpen && <NewTypeDialog onClose={close} />}
    </div>
  );
}

// 新建设定类型（RFC 5.4「随手建」产品化）：名称必填 + emoji 可选（默认 ◍）+ 自动分配颜色；
// 字段 schema = 最小「描述」多行；成功后问一句「现在创建第一个？」
function NewTypeDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const { apiBase, worldId } = useWorldCanvasStore.getState();
      const id = `t_${Date.now()}`;
      await createRecutWorldsClient(apiBase).entityTypes.upsert({
        worldId,
        id,
        name: trimmed,
        icon: icon.trim() || "◍",
        fields: [{ key: "description", label: "描述", type: "textarea" }],
      });
      await useWorldCanvasStore.getState().load(true);
      onClose();
      if (window.confirm(`「${trimmed}」已创建。现在用它创建第一个设定？`)) {
        void useWorldCanvasStore.getState().createEntity(id, { pos: cursorWorld(useWorldCanvasStore.getState().creatingAt) });
      }
    } catch (cause) {
      useWorldCanvasStore.setState({ notice: cause instanceof Error ? cause.message : "创建类型失败" });
      setBusy(false);
    }
  };
  return (
    <div aria-modal="true" className="fixed inset-0 z-[80] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog">
      <form
        className="w-full max-w-xs rounded-md border bg-card p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="text-base font-semibold">新建设定类型</h3>
        <div className="mt-3 space-y-3">
          <input autoFocus className="w-full rounded-md border bg-background p-2 text-sm outline-none focus:border-primary" onChange={(event) => setName(event.target.value)} placeholder="类型名（如：机甲）" value={name} />
          <input className="w-full rounded-md border bg-background p-2 text-sm outline-none focus:border-primary" maxLength={2} onChange={(event) => setIcon(event.target.value)} placeholder="图标 emoji（可选）" value={icon} />
          <p className="text-[10px] text-muted-foreground">初始字段为「描述」；颜色自动分配，之后可添加更多字段。</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={onClose} type="button">取消</button>
          <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={!name.trim() || busy} type="submit">创建</button>
        </div>
      </form>
    </div>
  );
}
