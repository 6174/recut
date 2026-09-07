/*
 * [INPUT]: 依赖 canvas-store（会话配置 open）、canvas-toolbar、canvas-tldraw（dynamic ssr:false 挂载）、
 * canvas-detail-panel 与 canvas-dialogs
 * [OUTPUT]: 对外提供 Recursive World Canvas 全屏模式根组件：挂载时 open(store) 加载数据，组合顶部工具栏、
 * tldraw 画布底座、右侧详情面板与对话框；onClose 返回设定视图（左上角模式切换）
 * [POS]: worlds/[worldID]/canvas 的组合根；WorldCanvas 的唯一出口（world-detail-client 仅引用本文件）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useWorldCanvasStore } from "./canvas-store";
import { CanvasDetailPanel } from "./canvas-detail-panel";
import { CanvasDialogs } from "./canvas-dialogs";

// tldraw 依赖浏览器 API，仅客户端挂载。
const CanvasTldrawHost = dynamic(() => import("./canvas-tldraw").then((mod) => mod.CanvasTldrawHost), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted-foreground">画布加载中…</div>,
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

  useEffect(() => {
    open({ apiBase, worldId, worldName, readOnly, revisionId });
    // 仅在会话标识变化时重新 open；worldName 变化由订阅方各自响应。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, worldId, readOnly]);

  if (!host) return null;
  return createPortal(
    // 与内容区的 md:pl-[--side-panel-width] 避让一致：md 以上从 Chat 面板右侧起排，Chat 保持可见。
    <div className="absolute bottom-0 right-0 top-0 z-30 flex flex-col bg-background md:left-[var(--side-panel-width)]">
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <CanvasTldrawHost onClose={onClose} />
        </div>
        <CanvasDetailPanel />
      </div>
      <CanvasDialogs />
    </div>,
    host,
  );
}
