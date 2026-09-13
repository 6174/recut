/*
 * [INPUT]: 依赖 canvas-store（会话配置 open）、canvas-toolbar、canvas-pomelo（dynamic ssr:false 挂载）、
 * canvas-detail-panel、canvas-dialogs 与 ui/use-media-asset-events（MediaAssetEventsProvider）
 * 并订阅 "world" 实时 channel（写事件 world.changed 去抖重载、world.canvas.lock/unlock 暂停保存并提示）、
 * 把画布选中/所在容器上报为 Agent WorkFocus
 * [OUTPUT]: 对外提供 Recursive World Canvas 全屏模式根组件：挂载时 open(store) 加载数据并向全局 Header
 * 注册顶层工具栏（canvas-top-bar），组合 pomelo 画布底座、右侧详情面板与对话框；onClose 返回设定视图
 * [POS]: worlds/[worldID]/canvas 的组合根；WorldCanvas 的唯一出口（world-detail-client 仅引用本文件）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MediaAssetEventsProvider } from "@/components/use-media-asset-events";
import type { ContextRef, WorkFocusContext } from "@/components/agent-panel-types";
import { useAgentPanelContext } from "@/lib/agent-panel-context";
import { getRealtimeChannel } from "@/lib/realtime-channel";
import { scheduleWorldReload, setCanvasAiLocked, useWorldCanvasStore } from "./canvas-store";
import { useWorldCanvasTopBarStore } from "./canvas-top-bar";
import { CanvasDetailPanel } from "./canvas-detail-panel";
import { CanvasDialogs } from "./canvas-dialogs";

// pomelo 底座依赖浏览器 API，仅客户端挂载。
const CanvasPomeloHost = dynamic(() => import("./canvas-pomelo").then((mod) => mod.CanvasPomeloHost), {
  ssr: false,
  // 画布骨架：与真实画布同构（点阵底 + 居中卡片占位），刷新时默认视图即画布 skeleton
  loading: () => (
    <div
      aria-hidden
      className="h-full w-full"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
        backgroundSize: "26px 26px",
      }}
    >
      <div className="grid h-full place-items-center">
        <div className="flex w-64 animate-pulse flex-col gap-3 rounded-xl border border-border/60 bg-card/60 p-4">
          <div className="h-16 w-16 rounded-lg bg-muted" />
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-3 w-1/2 rounded bg-muted" />
        </div>
      </div>
    </div>
  ),
});

export type WorldCanvasProps = {
  apiBase: string;
  worldId: string;
  worldName: string;
  readOnly: boolean;
  revisionId: string;
  onClose?: () => void;
};

export default function WorldCanvas({ apiBase, worldId, worldName, readOnly, revisionId, onClose }: WorldCanvasProps) {
  const open = useWorldCanvasStore((state) => state.open);
  // 画布不覆盖全局 Header 与左侧 Chat：portal 到工作台内容区（#workspace-content-region）。
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById("workspace-content-region"));
  }, []);

  // 世界工具栏上提到全局 Header（canvas-top-bar.tsx）：激活时由 Workspace 渲染，卸载时归还全局导航空间。
  const setActive = useWorldCanvasTopBarStore((state) => state.setActive);
  useEffect(() => {
    setActive(true, onClose);
    return () => setActive(false, null);
  }, [onClose, setActive]);

  useEffect(() => {
    open({ apiBase, worldId, worldName, readOnly, revisionId });
    // 仅在会话标识变化时重新 open；worldName 变化由订阅方各自响应。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, worldId, readOnly]);

  // 画布选中/所在容器上报为 Agent 面板的 WorkFocus：AI 据此知道"用户此刻在看哪个元素、哪一层画布"。
  // 只有画布视图挂载本组件时才上报，避免覆盖表单视图的选中焦点。
  const selection = useWorldCanvasStore((state) => state.selection);
  const context = useWorldCanvasStore((state) => state.context);
  const contextTrail = useWorldCanvasStore((state) => state.contextTrail);
  const storeWorldId = useWorldCanvasStore((state) => state.worldId);
  const storeReadOnly = useWorldCanvasStore((state) => state.readOnly);
  const aiLocked = useWorldCanvasStore((state) => state.aiLocked);
  useEffect(() => {
    if (!storeWorldId) return;
    const refs: ContextRef[] = [];
    let primaryRef: ContextRef | undefined;
    let selectionState: Record<string, unknown> = {};
    let summary = `画布 · ${context?.title ?? "全局"}`;
    if (selection?.type === "entity") {
      primaryRef = { kind: "world_entity", id: selection.entity.id };
      refs.push(primaryRef);
      selectionState = { entity: selection.entity };
      summary = `画布中查看「${selection.entity.name}」`;
    } else if (selection?.type === "relation") {
      primaryRef = { kind: "world_relation", id: selection.relation.id };
      refs.push(primaryRef);
      selectionState = { relation: selection.relation };
      summary = `画布中选中关系「${selection.relation.type}」`;
    } else if (selection?.type === "canvas") {
      primaryRef = { kind: "world_canvas_element", id: selection.element.id };
      refs.push(primaryRef);
      selectionState = { element: selection.element };
      summary = `画布中选中「${selection.element.name || selection.element.kind}」`;
    } else if (selection?.type === "world") {
      selectionState = { element: "world" };
      summary = "画布 · World 概览";
    }
    // 无选中但在内层容器时，至少把"当前容器"作为 ref 上报，避免 AI 丢失所在画布层。
    if (refs.length === 0 && context?.entityId) {
      primaryRef = { kind: "world_entity", id: context.entityId };
      refs.push(primaryRef);
    }
    const focus: WorkFocusContext = {
      version: 1,
      view: "world_canvas",
      selection: { refs, ...(primaryRef ? { primaryRef } : {}), state: selectionState },
      state: {
        worldId: storeWorldId,
        contextId: context?.entityId ?? "",
        contextTitle: context?.title ?? "",
        contextTrail,
        readOnly: storeReadOnly,
      },
      summary,
    };
    useAgentPanelContext.getState().setWorkFocus(focus);
  }, [selection, context, contextTrail, storeWorldId, storeReadOnly]);

  // AI/Agent 经 MCP 写世界（canvas.doc.update / entities.upsert / relations.* 等）后，
  // daemon 在 "world" channel（key=worldId）广播 world.changed；此处去抖重载当前文档。
  useEffect(() => {
    if (!apiBase || !worldId) return;
    const unsubscribe = getRealtimeChannel(apiBase).subscribe("world", worldId, (frame) => {
      const data = (frame.data && typeof frame.data === "object" ? frame.data : {}) as Record<string, unknown>;
      if (typeof data.worldId === "string" && data.worldId !== worldId) return;
      if (data.event === "world.canvas.lock") {
        // AI 进入多步画布会话：落盘本地改动并暂停保存，避免与 AI 写并发覆盖。
        setCanvasAiLocked(true);
        return;
      }
      if (data.event === "world.canvas.unlock") {
        setCanvasAiLocked(false);
        scheduleWorldReload();
        return;
      }
      if (data.event === "world.changed") {
        // 锁期内不回拉：本地脏集尚未落盘，reload 会覆盖用户改动；解锁后再统一合并。
        // 但用一次 setCanvasAiLocked(true) 续期本地看门狗，避免长会话被误判为超时。
        if (useWorldCanvasStore.getState().aiLocked) {
          setCanvasAiLocked(true);
          return;
        }
        scheduleWorldReload();
      }
    });
    return unsubscribe;
  }, [apiBase, worldId]);

  // 子世界深链（?ctx=<entityId>）：挂载时从 URL 恢复进入的容器；context 变化时
  // replaceState 回写（不触发路由重渲）。放在 open effect 之后，保证 store 已就绪。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ctx = params.get("ctx");
    if (ctx) void useWorldCanvasStore.getState().restoreContext(ctx);
    let prev = useWorldCanvasStore.getState().context;
    return useWorldCanvasStore.subscribe((state) => {
      if (state.context === prev) return;
      prev = state.context;
      const url = new URL(window.location.href);
      if (state.context) url.searchParams.set("ctx", state.context.entityId);
      else url.searchParams.delete("ctx");
      window.history.replaceState(null, "", url.toString());
    });
  }, []);

  if (!host) return null;
  return createPortal(
    // MediaAssetEventsProvider：素材选择器/预览共享同一条 asset 实时缓存
    // （SSE 首屏 REST + WS 增量）；画布页面原来不在任何 Provider 内，AssetReferenceDialog
    // 会永远停在"正在读取资源…"。
    <MediaAssetEventsProvider apiBase={apiBase}>
      {/* 与内容区的 md:pl-[--side-panel-width] 避让一致：md 以上从 Chat 面板右侧起排，Chat 保持可见。 */}
      <div className="absolute bottom-0 right-0 top-0 z-30 flex flex-col bg-background md:left-[var(--side-panel-width)]">
        <div className="relative min-h-0 min-w-0 flex-1">
          <CanvasPomeloHost />
          {aiLocked && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center pt-3">
              <div className="flex items-center gap-2 rounded-full border border-primary/40 bg-card/95 px-4 py-1.5 text-xs font-medium text-primary shadow-lg backdrop-blur">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                AI 正在编辑画布（画布布局保存已暂停）
              </div>
            </div>
          )}
          {/* 详情面板是绝对浮层：开合不改变画布宽度，画布容器不做 resize（否则每次闪一帧） */}
          <CanvasDetailPanel />
        </div>
        <CanvasDialogs />
      </div>
    </MediaAssetEventsProvider>,
    host,
  );
}
