/*
 * [INPUT]: 依赖服务端 /v1/motion-graphics/{versionId} 解析出的组件 bundle 与 timeline-editor 的 ComponentPreview
 * [OUTPUT]: 对外提供 MotionGraphicPreview：在聊天卡片内按需实时渲染一个 Motion Graphic 组件，带错误边界与可见性懒挂载
 * [POS]: components 的组件预览适配层；与编辑器共用同一渲染运行时，组件错误被限制在预览框内，绝不冒泡到页面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n/index";

// 深路径动态导入：只拉组件预览模块，避免把整个编辑器 EditorShell 带进聊天包；ssr:false 因为依赖 WebGL/DOM。
const ComponentPreview = dynamic(
  () => import("@/timeline-editor/src/components/editor/panels/assets/views/component-preview").then((module) => ({ default: module.ComponentPreview })),
  { ssr: false },
);

type ResolvedComponent = {
  componentId: string;
  name: string;
  surface: "html" | "react" | "r3f";
  inputs: unknown[];
  bundle: string;
  bundleHash: string;
  coverUrl?: string | null;
};

export type MotionGraphicPreviewProps = {
  apiBase: string;
  versionId?: string;
  componentId: string;
  name?: string;
  surface?: string;
};

export function MotionGraphicPreview({ apiBase, versionId, componentId, name, surface }: MotionGraphicPreviewProps) {
  const { t: text } = useI18n();
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [resolved, setResolved] = useState<ResolvedComponent | null>(null);
  const [error, setError] = useState(false);
  const height = width > 0 ? Math.round((width * 9) / 16) : 0;

  // 只渲染进入视口的卡片：避免会话里大量组件同时占用 WebGL 上下文。
  useEffect(() => {
    const node = frameRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 跟随容器宽度：组件世界按像素尺寸构建，预览需要真实宽高。
  useEffect(() => {
    const node = frameRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(Math.round(next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 可见时按需取回精确版本的 bundle；失败只降级为占位，不影响会话。
  useEffect(() => {
    if (!visible || !versionId || resolved || error) return;
    let cancelled = false;
    fetch(`${apiBase}/v1/motion-graphics/${encodeURIComponent(versionId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: { components?: unknown[] } | null) => {
        if (cancelled) return;
        const component = readComponent(payload?.components?.[0]);
        if (component) setResolved(component);
        else setError(true);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, versionId, visible, resolved, error]);

  const fallback = (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-zinc-900 to-zinc-800 px-4 text-center text-zinc-400">
      <span className="text-[10px]">{error ? text("agent.mg.previewFailed") : text("agent.mg.previewLoading")}</span>
    </div>
  );

  // 外层容器始终是同一个节点（frameRef 稳定），保证 Intersection/ResizeObserver 不会观察到已被替换的旧节点。
  return (
    <div className="border-t bg-[#101014]" ref={frameRef} style={{ height: height || 160 }}>
      {!visible ? null : error || !versionId ? (
        fallback
      ) : !resolved || width === 0 ? (
        <div className="grid h-full place-items-center text-[10px] text-zinc-400">{text("agent.mg.previewLoading")}</div>
      ) : (
        <PreviewErrorBoundary fallback={fallback}>
          <ComponentPreview
            componentId={resolved.componentId}
            inputs={resolved.inputs as never}
            name={resolved.name || name || resolved.componentId}
            resolver={async () => resolved as never}
            surface={(resolved.surface || surface || "r3f") as never}
            width={width}
            height={height}
          />
        </PreviewErrorBoundary>
      )}
    </div>
  );
}

// PreviewErrorBoundary 把组件渲染错误限制在预览框内：任何组件抛错只显示降级占位，不冒泡到聊天页面。
class PreviewErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[recut] motion graphic preview failed", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function readComponent(value: unknown): ResolvedComponent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const componentId = typeof record.componentId === "string" ? record.componentId : "";
  const bundle = typeof record.bundle === "string" ? record.bundle : "";
  if (!componentId || !bundle) return null;
  return {
    componentId,
    name: typeof record.name === "string" ? record.name : componentId,
    surface: (record.surface === "html" || record.surface === "react" ? record.surface : "r3f") as ResolvedComponent["surface"],
    inputs: Array.isArray(record.inputs) ? record.inputs : [],
    bundle,
    bundleHash: typeof record.bundleHash === "string" ? record.bundleHash : "",
    coverUrl: typeof record.coverUrl === "string" ? record.coverUrl : null,
  };
}
