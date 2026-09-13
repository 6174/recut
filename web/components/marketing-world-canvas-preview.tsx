/*
 * [INPUT]: 依赖 next/dynamic、lib/i18n 与 lib/marketing-worlds 的画布投影；动态加载 marketing-world-canvas-vello
 *          （真实 pomelo-vello 画布宿主）；locale 由 marketing-worlds 注入，不回引 marketing-site 以避开循环依赖
 * [OUTPUT]: 对外提供 MarketingWorldCanvasPreview：/worlds/:id 详情的世界画布区块——固定高度框内优先加载真实
 *          vello 画布（实体卡 + 语义关系连线，拖拽平移 / ⌘滚轮缩放），WebGPU 不可用时回退到 DOM 静态投影（含关系连线），滚动进入视口才懒加载
 * [POS]: web/components 的官网画布预览壳；数据仍由服务端页面经 props 注入，本文件不发请求
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { MarketingWorld, MarketingWorldCanvas } from "@/lib/marketing-worlds";

// 关系连线颜色：与工作台 vello relation-arrow block 的默认色保持一致
const RELATION_STROKE = "#8b93a7";

// 真实画布依赖 WebGPU/DOM，仅客户端挂载；模块独立按需下载，避免污染官网主包。
const MarketingWorldCanvasVello = dynamic(() => import("./marketing-world-canvas-vello"), { ssr: false });

export function MarketingWorldCanvasPreview({ world, locale }: { world: MarketingWorld; locale: Locale }) {
  const canvas = world.canvas;
  if (!canvas || !canvas.elements.length) return null;
  return (
    <section className="mt-12">
      <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "worlds.canvas.eyebrow")}</p>
      <div className="relative mt-4 h-[360px] w-full overflow-hidden rounded-2xl border bg-background sm:h-[460px] lg:h-[540px]">
        <MarketingWorldCanvasBox canvas={canvas} locale={locale} />
      </div>
    </section>
  );
}

function MarketingWorldCanvasBox({ canvas, locale }: { canvas: MarketingWorldCanvas; locale: Locale }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [shouldMount, setShouldMount] = useState(false);
  const [velloReady, setVelloReady] = useState(false);
  const [supported, setSupported] = useState(true);

  // 滚动进入视口前只渲染 DOM 静态投影，避免每个世界详情页都下载 wasm + 字体。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldMount(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldMount(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="absolute inset-0">
      <MarketingWorldCanvasDom canvas={canvas} />
      {shouldMount && supported && (
        <div className={velloReady ? "absolute inset-0" : "pointer-events-none absolute inset-0 opacity-0"}>
          <MarketingWorldCanvasVello canvas={canvas} locale={locale} onReady={() => setVelloReady(true)} onUnsupported={() => setSupported(false)} />
        </div>
      )}
      {velloReady && (
        <span className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur">
          {t("marketing", locale, "worlds.canvas.hint")}
        </span>
      )}
      {!supported && (
        <span className="pointer-events-none absolute bottom-3 left-3 max-w-[80%] rounded-lg border border-border/60 bg-background/80 px-2.5 py-1.5 text-[10px] leading-4 text-muted-foreground backdrop-blur">
          {t("marketing", locale, "worlds.canvas.fallback")}
        </span>
      )}
    </div>
  );
}

/** WebGPU 不可用时的静态投影：与 vello 初始视口一致的按宽度自适应（贴顶，超出部分裁剪）。 */
function MarketingWorldCanvasDom({ canvas }: { canvas: MarketingWorldCanvas }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || canvas.width <= 0 || canvas.height <= 0) return;
    const update = () => {
      const { width } = el.getBoundingClientRect();
      if (width > 0) setScale(Math.min(width / canvas.width, 1));
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [canvas]);

  return (
    <div ref={boxRef} className="absolute inset-0">
      <div className="absolute left-1/2 top-0" style={{ width: canvas.width, height: canvas.height, transform: `translateX(-50%) scale(${scale})`, transformOrigin: "top center" }}>
        <svg aria-hidden="true" className="absolute inset-0" height={canvas.height} viewBox={`0 0 ${canvas.width} ${canvas.height}`} width={canvas.width}>
          {canvas.relations.map((relation) => {
            const from = canvas.elements.find((element) => element.kind === "entity" && element.entityId === relation.from);
            const to = canvas.elements.find((element) => element.kind === "entity" && element.entityId === relation.to);
            if (!from || !to || from.kind !== "entity" || to.kind !== "entity") return null;
            return (
              <line
                key={relation.id}
                stroke={RELATION_STROKE}
                strokeLinecap="round"
                strokeWidth={2}
                x1={from.x + from.width / 2}
                x2={to.x + to.width / 2}
                y1={from.y + from.height / 2}
                y2={to.y + to.height / 2}
              />
            );
          })}
        </svg>
        {canvas.elements.map((element) => {
          const style = {
            left: `${(element.x / canvas.width) * 100}%`,
            top: `${(element.y / canvas.height) * 100}%`,
            width: `${(element.width / canvas.width) * 100}%`,
            height: `${(element.height / canvas.height) * 100}%`,
          };
          if (element.kind === "entity") {
            return (
              <div className="absolute flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm" key={element.key} style={style}>
                {element.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img alt={element.name} className="h-1/2 w-full object-cover" loading="lazy" src={element.imageUrl} />
                  : <div className="h-1/2 w-full bg-muted" />}
                <div className="min-h-0 flex-1 p-1.5">
                  <p className="truncate text-[9px] font-semibold leading-tight sm:text-[11px]">{element.name}</p>
                </div>
              </div>
            );
          }
          if (element.kind === "media") {
            // eslint-disable-next-line @next/next/no-img-element
            return <img alt={element.name} className="absolute rounded-lg object-cover" key={element.key} loading="lazy" src={element.url} style={style} />;
          }
          return (
            <div className="absolute overflow-hidden rounded-lg border border-amber-300/60 bg-amber-100/90 p-1.5 text-[8px] leading-tight text-amber-950 sm:text-[10px]" key={element.key} style={style}>
              {element.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
