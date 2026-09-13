/*
 * [INPUT]: 依赖 canvas-store（会话配置 open）、canvas-toolbar、canvas-pomelo（dynamic ssr:false 挂载）、
 * canvas-detail-panel、canvas-dialogs 与 ui/use-media-asset-events（MediaAssetEventsProvider）
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
import { useWorldCanvasStore } from "./canvas-store";
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
          {/* 详情面板是绝对浮层：开合不改变画布宽度，画布容器不做 resize（否则每次闪一帧） */}
          <CanvasDetailPanel />
        </div>
        <CanvasDialogs />
      </div>
    </MediaAssetEventsProvider>,
    host,
  );
}
