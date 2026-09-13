/*
 * [INPUT]: 依赖 lib/pomelo/pomelo-vello/tile-demo（mountTileDemo）
 * [OUTPUT]: 对外提供 /dev/vello-tiles 路由：自包含瓦片渲染演示（Canvas2D 光栅器），
 *           暴露 window.__velloTilesDebug 供 Playwright e2e 驱动。
 * [POS]: pomelo-tiles 的 dev 验证入口；正式画布仍走 worlds/[worldID]/canvas。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef } from "react";
import { mountTileDemo, type VelloTilesDebug } from "@/lib/pomelo/pomelo-vello/tile-demo";

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
    const demo = mountTileDemo(canvas);
    window.__velloTilesDebug = demo.debug;
    return () => {
      delete window.__velloTilesDebug;
      demo.destroy();
    };
  }, []);

  return (
    <div className="h-dvh w-full overflow-hidden bg-[#0b0f19]">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
    </div>
  );
}
