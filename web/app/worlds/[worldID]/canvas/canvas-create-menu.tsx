// File: web/app/worlds/[worldID]/canvas/canvas-create-menu.tsx (tsx)
/*
 * [INPUT]: 依赖 react、canvas-store（creating/creatingAt/entityTypes 与
 * createEntity/addNote/addFreeElement/addMediaElement/addGroup/setCreating/setAiDialogOpen/load 动作）、
 * recut-worlds-client、readLastKind/readRecentCustomTypes、canvas-create-panel（共用创建面板外壳）
 * [OUTPUT]: 对外提供 CreateMenu（B.7 创建菜单）：构建**三个粗分组**（设定（含容器子类型 / 最近使用 /
 * 预设 / 生产结构（场次·镜头）/ 自定义类型）→ 画布元素 → 操作）与 [＋ 新建设定类型…] 对话框，
 * 面板本身由 CreatePanel 渲染（顶部搜索 + 左侧分组卡片网格（badge 角标分类）+ 右侧详情预览 + 「创建」）；
 * 锚点 = creatingAt（双击空白 / Header ＋ 按钮正下方）或视口中心
 * [POS]: worlds/[worldID]/canvas 的创建系统菜单层；选类型即在锚点处落正式卡片并进入命名态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useState } from "react";
import type { PomeloRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-renderer";
import type { WorldEntityType } from "@/lib/recut-worlds-client";
import { createRecutWorldsClient, entityKindLabels, isProductionEntityKind, isRetiredEntityKind, PRODUCTION_ENTITY_KINDS, productionKindIcons, productionKindLabels } from "@/lib/recut-worlds-client";
import { CreatePanel, type CreateGroup, type CreateItem } from "./canvas-create-panel";
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
  work: "📽",
  character: "👤",
  location: "📍",
  prop: "🧰",
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

export function CreateMenu() {
  const creating = useWorldCanvasStore((state) => state.creating);
  const creatingAt = useWorldCanvasStore((state) => state.creatingAt);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const entities = useWorldCanvasStore((state) => state.entities);
  const context = useWorldCanvasStore((state) => state.context);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  const [newTypeOpen, setNewTypeOpen] = useState(false);

  if (!creating) return null;

  const recentIds = readRecentCustomTypes();
  const customTypes = entityTypes.filter((type) => type.scope === "custom");
  const recentTypes = customTypes.filter((type) => recentIds.includes(type.id));
  const otherCustomTypes = customTypes.filter((type) => !recentIds.includes(type.id));
  // 预设组只列**默认集**：退役预设（object/story/style/rule/reference）可能仍在类型目录里
  // （旧世界有对应实体时类型行会保留），但不再作为"新建"提供；生产类型（场次/镜头）另走容器子类型组。
  const presetTypes = entityTypes.filter(
    (type) => type.scope !== "custom" && !isRetiredEntityKind(type.id) && !isProductionEntityKind(type.id),
  );

  // §7.2：容器内可新建什么，由**当前容器类型的 childTypes** 声明（advisory）。
  // scene/shot 不是预设（用到即建，目录里可能还没有行），所以直接按声明的 id 提供入口——
  // 建出来的节点由 createEntity 自动挂 parentId = 当前容器，归属 + 落卡一并完成。
  const contextEntity = context?.entityId ? entities.find((entity) => entity.id === context.entityId) : undefined;
  const contextType = contextEntity ? entityTypes.find((type) => type.id === contextEntity.typeId) : undefined;
  const childTypeIds = (contextType?.childTypes ?? []).filter(
    (id) => !presetTypes.some((type) => type.id === id) && !customTypes.some((type) => type.id === id),
  );
  const childTypeItems: CreateItem[] = childTypeIds.map((id) => {
    const declared = entityTypes.find((type) => type.id === id);
    const icon = declared?.icon || productionKindIcons[id] || "◍";
    const name = declared?.name || productionKindLabels[id] || id;
    return {
      key: `child:${id}`,
      label: name,
      icon,
      hint: "此容器可容纳",
      badge: "子类型",
      preview: {
        icon,
        title: name,
        subtitle: `新建于「${contextType?.name ?? ""}」`,
        body: `在「${context?.title ?? ""}」内新建一张${name}卡；它同时归属该容器（parentId）并落在其内层画布。`,
      },
      run: () => create(id),
    };
  });

  // 生产结构（§7.2）：场次/镜头是系统类型，用到即建（目录里可能还没有行），因此按声明 id 直接给入口；
  // 容器内已通过 childTypes 提供时不再重复列出。
  const productionItems: CreateItem[] = [...PRODUCTION_ENTITY_KINDS]
    .filter((id) => !childTypeIds.includes(id))
    .map((id) => {
      const declared = entityTypes.find((type) => type.id === id);
      const icon = declared?.icon || productionKindIcons[id] || "◍";
      const name = declared?.name || productionKindLabels[id] || id;
      return {
        key: `production:${id}`,
        label: name,
        icon,
        hint: "生产结构",
        badge: "生产",
        preview: {
          icon,
          title: name,
          subtitle: "预设设定类型",
          body: `在画布上落一张${name}卡，随后在右侧面板填写字段。场次/镜头通常归属「视频脚本」或「作品」。`,
          facts: [{ label: "类型 ID", value: id }],
        },
        run: () => create(id),
      };
    });

  const close = () => {
    setCreating(false);
    setNewTypeOpen(false);
  };
  const create = (kind: string) => {
    close();
    void useWorldCanvasStore.getState().createEntity(kind, { pos: cursorWorld(creatingAt) });
  };

  const typeItem = (type: WorldEntityType, badge?: string): CreateItem => {
    const icon = type.icon || KIND_ICONS[type.id] || "◍";
    const name = typeNameOf(type);
    const scopeBadge = type.scope === "custom" ? "自定义" : "预设";
    return {
      key: `type:${type.id}`,
      label: name,
      icon,
      hint: scopeBadge,
      badge: badge ?? scopeBadge,
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

  // 画布元素：分组 / 便签 / 文本 / 媒体（图片·视频·音频直接落空卡，来源在右侧详情面板选）
  const elementItems: CreateItem[] = [
    {
      key: "element:group",
      label: "分组",
      icon: "▢",
      hint: "容器",
      badge: "元素",
      preview: { icon: "▢", title: "分组", subtitle: "画布容器", body: "落一个空白分组容器（命名 / 背景色 / 布局在右侧面板设置），随后拖元素进框即自动归入该组。" },
      run: () => {
        close();
        void useWorldCanvasStore.getState().addGroup(cursorWorld(creatingAt));
      },
    },
    {
      key: "element:note",
      label: "便签",
      icon: "📝",
      hint: "随手草稿",
      badge: "元素",
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
      badge: "元素",
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
        badge: "元素",
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
      badge: "操作",
      preview: { icon: "＋", title: "新建设定类型", subtitle: "自定义 schema", body: "定义一个属于这个世界的新类型：名称 + 图标，初始字段为「描述」，颜色自动分配，之后可继续添加字段。" },
      run: () => setNewTypeOpen(true),
    },
    {
      key: "action:ai",
      label: "用描述添加设定…",
      icon: "✨",
      hint: "交给 AI",
      badge: "操作",
      preview: { icon: "✨", title: "用描述添加设定", subtitle: "AI 生成候选", body: "用一句自然语言描述，让 AI 生成若干设定候选，确认后再落到画布。" },
      run: () => {
        close();
        useWorldCanvasStore.getState().setAiDialogOpen(true);
      },
    },
  ];

  // 只分三组（不再按 预设/自定义/生产/最近 各起一节）：① 设定 = 所有可落卡的设定类型，
  // 用 badge 角标区分 子类型/最近/预设/生产/自定义；② 画布元素；③ 操作。
  const groups: CreateGroup[] = [
    {
      key: "setting",
      title: "设定",
      items: [
        ...childTypeItems,
        ...recentTypes.map((type) => typeItem(type, "最近")),
        ...presetTypes.map((type) => typeItem(type)),
        ...productionItems,
        ...otherCustomTypes.map((type) => typeItem(type)),
      ],
    },
    { key: "element", title: "画布元素", items: elementItems },
    { key: "action", title: "操作", items: actionItems },
  ].filter((group) => group.items.length > 0);

  return (
    <>
      <CreatePanel anchor={creatingAt} groups={groups} onClose={close} placeholder="搜索设定类型、分组、便签、文本、媒体…" />
      {newTypeOpen && <NewTypeDialog onClose={close} />}
    </>
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
