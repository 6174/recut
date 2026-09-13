/*
 * [INPUT]: 依赖 lib/pomelo/pomelo-vello/tile-demo（mountTileDemo，vello/WebGPU 光栅器）
 * [OUTPUT]: 对外提供 /dev/vello-tiles 路由：自包含瓦片渲染演示；暴露 window.__velloTilesDebug 供 Playwright e2e 驱动。
 *           WebGPU 不可用时直接提示升级浏览器（不再回退软件光栅器）。
 * [POS]: pomelo-tiles 的 dev 验证入口；正式画布仍走 worlds/[worldID]/canvas。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { mountTileDemo, type TileDemo, type VelloTilesDebug } from "@/lib/pomelo/pomelo-vello/tile-demo";

declare global {
  interface Window {
    __velloTilesDebug?: VelloTilesDebug;
  }
}

export default function VelloTilesDemoPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let demo: TileDemo | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const mounted = await mountTileDemo(canvas);
        if (cancelled) {
          mounted.destroy();
          return;
        }
        demo = mounted;
        window.__velloTilesDebug = mounted.debug;
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "vello 光栅器不可用");
      }
    })();
    return () => {
      cancelled = true;
      delete window.__velloTilesDebug;
      demo?.destroy();
    };
  }, []);

  return (
    <div className="grid h-dvh w-full place-items-center overflow-hidden bg-[#0b0f19]">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      {error && (
        <div className="absolute max-w-md rounded-xl border border-border bg-card p-6 text-center text-sm text-foreground shadow-xl">
          <p className="font-semibold">无法渲染 vello 瓦片演示</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{error}</p>
        </div>
      )}
    </div>
  );
}
