/*
 * [INPUT]: 依赖 React ref、effect 与浏览器 Pointer Event、localStorage API
 * [OUTPUT]: 对外提供 useResizableSidePanel hook，生成无重渲染拖动、iframe 蒙层状态和持久化侧栏宽度的能力
 * [POS]: components 的工作台布局交互原语，被根布局全局挂载的 Agent 面板宿主消费，不承载任何业务 UI
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

type Options = { storageKey: string; defaultWidth?: number; minWidth?: number; minMainWidth?: number };

export function useResizableSidePanel({ storageKey, defaultWidth = 400, minWidth = 320, minMainWidth = 560 }: Options) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(defaultWidth);
  const frameRef = useRef<number | null>(null);
  const [panelWidth, setPanelWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);

  const clamp = (width: number) => Math.min(Math.max(minWidth, window.innerWidth - minMainWidth), Math.max(minWidth, width));
  const paint = (width: number) => { layoutRef.current?.style.setProperty("--side-panel-width", `${width}px`); };

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(storageKey));
    const width = Number.isFinite(savedWidth) && savedWidth >= minWidth ? clamp(savedWidth) : defaultWidth;
    widthRef.current = width;
    paint(width);
    setPanelWidth(width);
    const resize = () => { const nextWidth = clamp(widthRef.current); if (nextWidth !== widthRef.current) { widthRef.current = nextWidth; paint(nextWidth); setPanelWidth(nextWidth); } };
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current); };
  }, [defaultWidth, minMainWidth, minWidth, storageKey]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    setIsDragging(true);
    const move = (moveEvent: PointerEvent) => {
      const nextWidth = clamp(startWidth - (moveEvent.clientX - startX));
      widthRef.current = nextWidth;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => { frameRef.current = null; paint(widthRef.current); });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.userSelect = previousUserSelect;
      setIsDragging(false);
      if (frameRef.current !== null) { window.cancelAnimationFrame(frameRef.current); frameRef.current = null; paint(widthRef.current); }
      setPanelWidth(widthRef.current);
      window.localStorage.setItem(storageKey, String(widthRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  return { handlePointerDown, isDragging, layoutRef, panelWidth };
}
