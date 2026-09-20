/*
 * [INPUT]: 依赖 react、lucide（Search）、canvas-store（creating/creatingAt/entityTypes 与
 * createEntity/addNote/addFreeElement/addMediaElement/setCreating/setAiDialogOpen/load 动作）、
 * recut-worlds-client、readLastKind/readRecentCustomTypes
 * [OUTPUT]: 对外提供 CreateMenu（B.7 创建菜单，@ 面板式双栏）：顶部搜索框 + 左侧分组列表
 * （最近使用 / 设定 / 自定义类型 / 画布元素 / 操作，组标题分隔）+ 右侧 hover/高亮预览，
 * [＋ 新建设定类型…]（名称+emoji，最小「描述」字段 schema，创建后可选落第一张草稿卡）；
 * 锚点 = creatingAt（双击空白 / Header ＋ 按钮正下方）或视口中心
 * [POS]: worlds/[worldID]/canvas 的创建系统菜单层；选类型即在锚点处落正式卡片并进入命名态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PomeloRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-renderer";
import type { WorldEntityType } from "@/lib/recut-worlds-client";
import { createRecutWorldsClient, entityKindLabels } from "@/lib/recut-worlds-client";
import { readRecentCustomTypes, useWorldCanvasStore } from "./canvas-store";

// 视口中心的世界坐标（无 creatingAt 时的兜底落点）
function viewportCenterWorld(): { x: number; y: number } {
  const editor = useWorldCanvasStore.getState().editor;
  if (!editor) return { x: 300, y: 240 };
  const adapter = editor.renderAdapter as PomeloRendererAdapter;
  const view = adapter.getView();
  if (!view) return { x: 300, y: 240 };
  const rect = view.getBoundingClientRect();
  const t = adapter.transform;
  return { x: (rect.width / 2 - t.x) / t.scale, y: (rect.height / 2 - t.y) / t.scale };
}

// 创建锚点（creatingAt 屏幕坐标）换算为世界坐标：元素落在触发菜单时的光标处
function cursorWorld(at: { screenX: number; screenY: number } | null): { x: number; y: number } {
  if (!at) return viewportCenterWorld();
  const editor = useWorldCanvasStore.getState().editor;
  if (!editor) return viewportCenterWorld();
  const adapter = editor.renderAdapter as PomeloRendererAdapter;
  const view = adapter.getView();
  if (!view) return viewportCenterWorld();
  const rect = view.getBoundingClientRect();
  const t = adapter.transform;
  return { x: (at.screenX - rect.left - t.x) / t.scale, y: (at.screenY - rect.top - t.y) / t.scale };
}

const KIND_ICONS: Record<string, string> = {
  character: "👤",
  location: "📍",
  object: "📦",
  story: "📖",
  script: "🎬",
  style: "🎨",
  rule: "⚖️",
  reference: "📎",
};

// 类型显示名：目录 name 优先，静态 label 兜底
function typeNameOf(type: WorldEntityType): string {
  return type.name || entityKindLabels[type.id as keyof typeof entityKindLabels] || type.id;
}

// 面板尺寸（用于锚点夹取；与 JSX 里的 w/h 保持一致）
const PANEL_W = 600;
const PANEL_H = 460;

// 预览 = 右侧详情栏渲染所需的最小数据
type CreatePreview = {
  icon: string;
  title: string;
  subtitle?: string;
  body?: string;
  facts?: Array<{ label: string; value: string }>;
};

type CreateItem = {
  key: string;
  label: string;
  icon: string;
  hint?: string;
  preview: CreatePreview;
  run: () => void;
};

type CreateGroup = { key: string; title: string; items: CreateItem[] };

export function CreateMenu() {
  const creating = useWorldCanvasStore((state) => state.creating);
  const creatingAt = useWorldCanvasStore((state) => state.creatingAt);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  const [newTypeOpen, setNewTypeOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 每次打开都重置搜索与高亮，避免上次会话残留
  useEffect(() => {
    if (creating) {
      setQuery("");
      setActiveKey(null);
    }
  }, [creating]);

  if (!creating) return null;

  const recentIds = readRecentCustomTypes();
  const customTypes = entityTypes.filter((type) => type.scope === "custom");
  const recentTypes = customTypes.filter((type) => recentIds.includes(type.id));
  const otherCustomTypes = customTypes.filter((type) => !recentIds.includes(type.id));
  const presetTypes = entityTypes.filter((type) => type.scope !== "custom");

  const close = () => {
    setCreating(false);
    setNewTypeOpen(false);
  };
  const create = (kind: string) => {
    close();
    void useWorldCanvasStore.getState().createEntity(kind, { pos: cursorWorld(creatingAt) });
  };

  const typeItem = (type: WorldEntityType): CreateItem => {
    const icon = type.icon || KIND_ICONS[type.id] || "◍";
    const name = typeNameOf(type);
    return {
      key: `type:${type.id}`,
      label: name,
      icon,
      hint: type.scope === "custom" ? "自定义" : "预设",
      preview: {
        icon,
        title: name,
        subtitle: type.scope === "custom" ? "自定义设定类型" : "预设设定类型",
        body: "在画布上落一张设定卡，随后在右侧面板填写字段。草稿确认后才转正式。",
        facts: [
          { label: "类型 ID", value: type.id },
          ...(type.baseKind ? [{ label: "基于", value: entityKindLabels[type.baseKind as keyof typeof entityKindLabels] ?? type.baseKind }] : []),
          ...(type.fields.length ? [{ label: "字段", value: type.fields.map((field) => field.label ?? field.key).join("、") }] : []),
        ],
      },
      run: () => create(type.id),
    };
  };

  // 画布元素：便签 / 文本 / 媒体（图片·视频·音频直接落空卡，来源在右侧详情面板选）
  const elementItems: CreateItem[] = [
    {
      key: "element:note",
      label: "便签",
      icon: "📝",
      hint: "随手草稿",
      preview: { icon: "📝", title: "便签", subtitle: "画布草稿", body: "落一张自由便签，记录临时想法；日后可用箭头把它提升为正式设定。" },
      run: () => {
        close();
        void useWorldCanvasStore.getState().addNote(cursorWorld(creatingAt));
      },
    },
    {
      key: "element:text",
      label: "文本",
      icon: "Ｔ",
      hint: "自由文字",
      preview: { icon: "Ｔ", title: "文本", subtitle: "画布文字", body: "落一段自由文本，用于标注、标题或说明，不进入设定语义。" },
      run: () => {
        close();
        void useWorldCanvasStore.getState().addFreeElement("text", cursorWorld(creatingAt));
      },
    },
    ...([["🖼", "图片", "image"], ["🎬", "视频", "video"], ["🎙", "音频", "audio"]] as const).map(
      ([icon, label, modality]): CreateItem => ({
        key: `element:${modality}`,
        label,
        icon,
        hint: "媒体卡",
        preview: { icon, title: label, subtitle: "媒体卡", body: `落一张空白${label}卡，占位引导；选中后在右侧详情面板选择来源或生成。` },
        run: () => {
          close();
          void useWorldCanvasStore.getState().addMediaElement({ modality }, cursorWorld(creatingAt));
        },
      }),
    ),
  ];

  const actionItems: CreateItem[] = [
    {
      key: "action:new-type",
      label: "新建设定类型…",
      icon: "＋",
      hint: "自定义 schema",
      preview: { icon: "＋", title: "新建设定类型", subtitle: "自定义 schema", body: "定义一个属于这个世界的新类型：名称 + 图标，初始字段为「描述」，颜色自动分配，之后可继续添加字段。" },
      run: () => setNewTypeOpen(true),
    },
    {
      key: "action:ai",
      label: "用描述添加设定…",
      icon: "✨",
      hint: "交给 AI",
      preview: { icon: "✨", title: "用描述添加设定", subtitle: "AI 生成候选", body: "用一句自然语言描述，让 AI 生成若干设定候选，确认后再落到画布。" },
      run: () => {
        close();
        useWorldCanvasStore.getState().setAiDialogOpen(true);
      },
    },
  ];

  const groups: CreateGroup[] = [
    { key: "recent", title: "最近使用", items: recentTypes.map(typeItem) },
    { key: "preset", title: "设定", items: presetTypes.map(typeItem) },
    { key: "custom", title: "自定义类型", items: otherCustomTypes.map(typeItem) },
    { key: "element", title: "画布元素", items: elementItems },
    { key: "action", title: "操作", items: actionItems },
  ].filter((group) => group.items.length > 0);

  const needle = query.trim().toLowerCase();
  const visibleGroups = needle
    ? groups
        .map((group) => ({ ...group, items: group.items.filter((item) => `${item.label} ${item.hint ?? ""}`.toLowerCase().includes(needle)) }))
        .filter((group) => group.items.length > 0)
    : groups;
  const flatItems = visibleGroups.flatMap((group) => group.items);
  const activeItem = flatItems.find((item) => item.key === activeKey) ?? flatItems[0] ?? null;

  const moveHighlight = (delta: number) => {
    if (flatItems.length === 0) return;
    const currentIndex = Math.max(0, flatItems.findIndex((item) => item.key === activeItem?.key));
    const nextIndex = Math.max(0, Math.min(flatItems.length - 1, currentIndex + delta));
    const next = flatItems[nextIndex];
    setActiveKey(next.key);
    listRef.current?.querySelector(`[data-create-key="${next.key}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activeItem?.run();
    }
  };

  const winW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = creatingAt
    ? Math.min(Math.max(16, creatingAt.screenX), Math.max(16, winW - PANEL_W - 16))
    : Math.max(16, winW / 2 - PANEL_W / 2);
  const top = creatingAt
    ? Math.min(Math.max(60, creatingAt.screenY), Math.max(60, winH - PANEL_H - 16))
    : Math.max(60, winH / 2 - PANEL_H / 2);

  return (
    <div className="fixed inset-0 z-[70]" onPointerDown={close}>
      <div
        className="absolute flex h-[min(460px,calc(100vh-5rem))] w-[min(600px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-[var(--shadow-overlay)]"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        style={{ left, top }}
      >
        <div className="relative border-b p-2.5">
          <Search className="pointer-events-none absolute left-4.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            className="h-8 w-full rounded-sm border bg-background pl-8 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索设定类型、便签、文本、媒体…"
            type="search"
            value={query}
          />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-r p-1.5" ref={listRef} role="listbox">
            {visibleGroups.length === 0 ? (
              <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">没有匹配的项</p>
            ) : (
              visibleGroups.map((group) => (
                <div key={group.key} role="group">
                  <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
                  {group.items.map((item) => (
                    <button
                      aria-selected={activeItem?.key === item.key}
                      className={`flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left ${activeItem?.key === item.key ? "bg-accent" : "hover:bg-muted"}`}
                      data-create-key={item.key}
                      key={item.key}
                      onClick={item.run}
                      onFocus={() => setActiveKey(item.key)}
                      onMouseEnter={() => setActiveKey(item.key)}
                      role="option"
                      type="button"
                    >
                      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-sm border bg-background text-xs">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{item.label}</span>
                        {item.hint && <span className="block truncate text-[10px] text-muted-foreground">{item.hint}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
          <PreviewPane item={activeItem} />
        </div>
      </div>
      {newTypeOpen && <NewTypeDialog onClose={close} />}
    </div>
  );
}

function PreviewPane({ item }: { item: CreateItem | null }) {
  if (!item) {
    return <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">悬停或选择一项查看详情</div>;
  }
  const { preview } = item;
  return (
    <div aria-live="polite" className="flex h-full min-h-0 flex-col overflow-y-auto p-4 text-xs">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md border bg-background text-lg">
          {preview.icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{preview.title}</p>
          {preview.subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{preview.subtitle}</p>}
        </div>
      </div>
      {preview.body && <p className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">{preview.body}</p>}
      {preview.facts && preview.facts.length > 0 && (
        <dl className="mt-3 space-y-2">
          {preview.facts.map((fact) => (
            <div className="flex items-start justify-between gap-3" key={fact.label}>
              <dt className="shrink-0 pt-0.5 text-muted-foreground">{fact.label}</dt>
              <dd className="min-w-0 text-right font-medium break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-auto border-t pt-3">
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={item.run}
          type="button"
        >
          创建
        </button>
      </div>
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
        onPointerDown={(event) => event.stopPropagation()}
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
