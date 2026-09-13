/*
 * [INPUT]: 依赖 lib/pomelo/pomelo-vello/tile-demo（mountTileDemo，异步选择 vello/Canvas2D 光栅器）
 * [OUTPUT]: 对外提供 /dev/vello-tiles 路由：自包含瓦片渲染演示；暴露 window.__velloTilesDebug 供 Playwright e2e 驱动。
 *           可用 ?rasterizer=canvas 强制软件光栅器。
 * [POS]: pomelo-tiles 的 dev 验证入口；正式画布仍走 worlds/[worldID]/canvas。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef } from "react";
import { mountTileDemo, type TileDemo, type VelloTilesDebug } from "@/lib/pomelo/pomelo-vello/tile-demo";

declare global {
  interface Window {
    __velloTilesDebug?: VelloTilesDebug;
  }
}

export default function VelloTilesDemoPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let demo: TileDemo | null = null;
    let cancelled = false;
    void (async () => {
      const mounted = await mountTileDemo(canvas);
      if (cancelled) {
        mounted.destroy();
        return;
      }
      demo = mounted;
      window.__velloTilesDebug = mounted.debug;
    })();
    return () => {
      cancelled = true;
      delete window.__velloTilesDebug;
      demo?.destroy();
    };
  }, []);

  return (
    <div className="h-dvh w-full overflow-hidden bg-[#0b0f19]">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
    </div>
  );
}
