/*
 * [INPUT]: 依赖 next/dynamic 与 lib/pomelo/world-canvas（PomeloWorldCanvasDemo，dynamic ssr:false）
 * [OUTPUT]: 对外提供 /dev/pomelo-canvas demo 路由页面：跑通 pomelo core + pixi renderer + plugins
 * 机制的无限画布前端逻辑（无后端依赖，数据在 demo-store 内存中）
 * [POS]: demo 路由组合根；tldraw 替代方案的验证入口（正式画布仍走 worlds/[worldID]/canvas）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import dynamic from "next/dynamic";

const PomeloWorldCanvasDemo = dynamic(() => import("@/lib/pomelo/world-canvas").then((mod) => mod.default), {
  ssr: false,
  loading: () => <div className="grid h-dvh place-items-center text-sm text-muted-foreground">画布加载中…</div>,
});

export default function PomeloCanvasDemoPage() {
  return <PomeloWorldCanvasDemo />;
}