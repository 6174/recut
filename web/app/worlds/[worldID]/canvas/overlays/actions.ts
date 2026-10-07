/*
 * [INPUT]: 依赖 lucide-react（图标）、canvas-store（画布写动作：预览/换素材/删除/进入容器/重命名/删除设定）、
 *          overlays/types（NodeOverlayContext/OverlaySubject）
 * [OUTPUT]: 对外提供 NodeAction 契约与 nodeActionsFor(ctx)：按 subject（媒体元素/实体卡）给出的基础常用
 *   直接操作（预览/下载/换素材/删除/进入容器/重命名/删除设定）。无适用项返回空数组（工具栏据此隐藏）
 * [POS]: worlds/[worldID]/canvas/overlays 的节点工具栏动作目录（RFC 2026-10-07 §3.2/§5）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Download, FolderOpen, ImagePlus, Pencil, Play, Trash2, type LucideIcon } from "lucide-react";
import { useWorldCanvasStore } from "../canvas-store";
import type { MediaGenerationSubject, NodeOverlayContext, OverlaySubject } from "./types";

export type NodeAction = {
  id: string;
  subject: "media" | "entity";
  icon: LucideIcon;
  label: string;
  // 适用性（缺省 = subject 命中即可）
  match?: (subject: OverlaySubject) => boolean;
  // 可执行性（false 时置灰）
  enabled?: (subject: OverlaySubject) => boolean;
  run: (ctx: NodeOverlayContext) => void | Promise<void>;
};

// 独立媒体元素/属性媒体卡上的基础操作
const MEDIA_ACTIONS: NodeAction[] = [
  {
    id: "media.preview",
    subject: "media",
    icon: Play,
    label: "预览",
    run: (ctx) => {
      const subject = ctx.subject as MediaGenerationSubject;
      const store = useWorldCanvasStore.getState();
      if (subject.assetId) store.setAssetDetail({ assetId: subject.assetId, name: subject.asset?.name });
      else store.setMediaPicker({ elementId: subject.elementId });
    },
  },
  {
    id: "media.download",
    subject: "media",
    icon: Download,
    label: "下载",
    enabled: (subject) => Boolean((subject as MediaGenerationSubject).assetId),
    run: (ctx) => {
      const subject = ctx.subject as MediaGenerationSubject;
      const apiBase = useWorldCanvasStore.getState().apiBase;
      if (subject.assetId) window.open(`${apiBase}/v1/media/assets/${encodeURIComponent(subject.assetId)}/content`, "_blank", "noopener");
    },
  },
  {
    id: "media.replace",
    subject: "media",
    icon: ImagePlus,
    label: "换素材",
    run: (ctx) => {
      const subject = ctx.subject as MediaGenerationSubject;
      useWorldCanvasStore.getState().setMediaPicker({ elementId: subject.elementId });
    },
  },
  {
    id: "media.delete",
    subject: "media",
    icon: Trash2,
    label: "删除",
    run: (ctx) => {
      const subject = ctx.subject as MediaGenerationSubject;
      void useWorldCanvasStore.getState().removeElement(subject.elementId);
    },
  },
];

// 实体卡上的基础操作
const ENTITY_ACTIONS: NodeAction[] = [
  {
    id: "entity.cover",
    subject: "entity",
    icon: ImagePlus,
    label: "设置封面",
    run: (ctx) => {
      if (ctx.subject.kind !== "entity") return;
      useWorldCanvasStore.getState().setCoverPicker({ entityId: ctx.subject.entityId });
    },
  },
  {
    id: "entity.open",
    subject: "entity",
    icon: FolderOpen,
    label: "进入",
    run: (ctx) => {
      if (ctx.subject.kind !== "entity") return;
      useWorldCanvasStore.getState().setContext({ entityId: ctx.subject.entityId, title: ctx.subject.entity.name });
    },
  },
  {
    id: "entity.rename",
    subject: "entity",
    icon: Pencil,
    label: "重命名",
    run: (ctx) => {
      if (ctx.subject.kind !== "entity") return;
      useWorldCanvasStore.getState().startEntityRename(ctx.subject.entityId);
    },
  },
  {
    id: "entity.delete",
    subject: "entity",
    icon: Trash2,
    label: "删除",
    run: (ctx) => {
      if (ctx.subject.kind !== "entity") return;
      useWorldCanvasStore.getState().setDeleteTarget(ctx.subject.entity);
    },
  },
];

export function nodeActionsFor(ctx: NodeOverlayContext): NodeAction[] {
  const all = ctx.subject.kind === "entity" ? ENTITY_ACTIONS : MEDIA_ACTIONS;
  return all.filter((action) => !action.match || action.match(ctx.subject));
}

export function isActionEnabled(action: NodeAction, ctx: NodeOverlayContext): boolean {
  return action.enabled ? action.enabled(ctx.subject) : true;
}

export { MEDIA_ACTIONS, ENTITY_ACTIONS };
