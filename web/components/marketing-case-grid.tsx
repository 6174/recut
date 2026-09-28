/*
 * [INPUT]: 依赖 lib/i18n 逐语言文案、marketing-site 的 locale 上下文、marketing-world-canvas-preview 的只读画布舞台、
 *          lib/marketing-cases 的案例数据、React portal 与 GSAP 无关的原生全屏 API
 * [OUTPUT]: 对外提供 MarketingCaseGrid——首页第二区块「案例」网格；点开任一案例进入全屏播放器（视频占位可换成真实成片），
 *           播放器底部可在「视频 / 世界观画布」间切换，并可进入 / 退出浏览器全屏
 * [POS]: web/components 的官网首页案例层；案例一律来自真实 World（封面为成片封面、画布为其世界观画布），不读取工作台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Maximize2, Minimize2, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, type Locale } from "@/lib/i18n";
import { trackEvent } from "@/components/posthog-analytics";
import { useMarketingLocale } from "@/components/marketing-site";
import { MarketingWorldCanvasStage } from "@/components/marketing-world-canvas-preview";
import type { MarketingCase, MarketingCaseTone } from "@/lib/marketing-cases";

const TONES: MarketingCaseTone[] = ["sunset", "teal", "violet", "sand", "night", "forest"];

const TONE_GRADIENTS: Record<MarketingCaseTone, string> = {
  sunset: "linear-gradient(135deg,#3a2330,#6b3b46,#c97a5a)",
  teal: "linear-gradient(135deg,#0f2e2c,#1d5852,#4fb79c)",
  violet: "linear-gradient(135deg,#211c39,#3a2f66,#7d6ad6)",
  sand: "linear-gradient(135deg,#332a1c,#6a5334,#c9a468)",
  night: "linear-gradient(135deg,#12161c,#232b36,#4a5f78)",
  forest: "linear-gradient(135deg,#12241a,#1f4630,#4f9b62)",
};

function worldTypeLabel(type: string, locale: Locale): string {
  const key = `worlds.type.${type}`;
  const label = t("marketing", locale, key);
  return label === key ? type : label;
}

export function MarketingCaseGrid({ cases }: { cases: MarketingCase[] }) {
  const locale = useMarketingLocale();
  const [active, setActive] = useState<MarketingCase | null>(null);
  return (
    <section className="border-b bg-background" id="cases">
      <div className="mx-auto max-w-6xl px-5 py-20 text-center sm:px-8 sm:py-28">
        <h2 className="marketing-display text-[clamp(2.4rem,6vw,5.25rem)] font-semibold leading-[1]">
          <span className="block">{t("marketing", locale, "cases.title1")}</span>
          <span className="block text-primary">{t("marketing", locale, "cases.title2")}</span>
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{t("marketing", locale, "cases.tagline")}</p>

        <div className="mt-12 grid gap-x-4 gap-y-8 text-left sm:grid-cols-2 lg:grid-cols-3">
          {cases.length === 0
            ? Array.from({ length: 6 }, (_, index) => (
                <span aria-hidden="true" className="block aspect-video rounded-xl border bg-card" key={index} style={{ backgroundImage: TONE_GRADIENTS[TONES[index % TONES.length]] }} />
              ))
            : cases.map((item) => <CaseTile item={item} key={item.id} locale={locale} onOpen={() => { trackEvent("recut_case_opened", { world_id: item.worldId }); setActive(item); }} />)}
        </div>
      </div>
      {active && <CasePlayer item={active} locale={locale} onClose={() => setActive(null)} />}
    </section>
  );
}

function CaseTile({ item, locale, onOpen }: { item: MarketingCase; locale: Locale; onOpen: () => void }) {
  const initial = Array.from(item.title)[0] ?? "•";
  return (
    <button className="group block w-full text-left" onClick={onOpen} type="button">
      <span className="relative block aspect-video w-full overflow-hidden rounded-xl border bg-card">
        {item.poster
          // eslint-disable-next-line @next/next/no-img-element
          ? <img alt={item.title} className="size-full object-cover transition duration-700 group-hover:scale-[1.04]" crossOrigin="anonymous" height={720} loading="lazy" src={item.poster} width={1280} />
          : <span aria-hidden="true" className="block size-full" style={{ backgroundImage: TONE_GRADIENTS[item.tone] }} />}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur transition duration-300 group-hover:scale-105 group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground"><Play className="size-5" /></span>
        </span>
      </span>
      <span className="mt-3 block">
        <span className="marketing-display block truncate text-[15px] font-semibold leading-snug">{item.title}</span>
        <span className="mt-2 flex items-center gap-2">
          <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-semibold text-black/80" style={{ backgroundImage: TONE_GRADIENTS[item.tone] }}>{initial}</span>
          <span className="truncate text-xs text-muted-foreground">{item.author || t("marketing", locale, "cases.anonymous")}</span>
          <span className="ml-auto shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{worldTypeLabel(item.typeLabel, locale)}</span>
        </span>
      </span>
    </button>
  );
}

function CasePlayer({ item, locale, onClose }: { item: MarketingCase; locale: Locale; onClose: () => void }) {
  const [mode, setMode] = useState<"video" | "canvas">("video");
  const [fullscreen, setFullscreen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 浏览器全屏时 Esc 归浏览器处理（先退全屏），再次 Esc 才关闭播放器。
      if (event.key === "Escape" && !document.fullscreenElement) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (typeof document === "undefined") return null;
  const canvas = item.world.canvas;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void Promise.resolve(shellRef.current?.requestFullscreen()).catch(() => undefined);
  };

  return createPortal(
    <div aria-label={item.title} aria-modal="true" className="fixed inset-0 z-[130] flex flex-col bg-[oklch(0.06_0.008_150)] text-white" ref={shellRef} role="dialog">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><Play className="size-3.5" /></span>
          <div className="min-w-0">
            <p className="marketing-display truncate text-sm font-semibold">{item.title}</p>
            <p className="truncate font-mono text-[10px] text-white/45">{worldTypeLabel(item.typeLabel, locale)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button aria-label={fullscreen ? t("marketing", locale, "player.exitFullscreen") : t("marketing", locale, "player.fullscreen")} className="grid size-9 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white" onClick={toggleFullscreen} type="button">{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
          <button aria-label={t("marketing", locale, "player.exit")} className="grid size-9 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white" onClick={onClose} type="button"><X className="size-4" /></button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {mode === "video"
          ? (
            <div className="flex size-full flex-col items-center justify-center gap-4 p-4 sm:p-8">
              {item.videoUrl
                ? <video autoPlay className="max-h-full max-w-full rounded-xl border border-white/10 shadow-[var(--shadow-overlay)]" controls playsInline src={item.videoUrl} />
                : (
                  <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 shadow-[var(--shadow-overlay)]">
                    <div className="relative aspect-video w-full">
                      {item.poster
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img alt={item.title} className="size-full object-cover" crossOrigin="anonymous" src={item.poster} />
                        : <span aria-hidden="true" className="block size-full" style={{ backgroundImage: TONE_GRADIENTS[item.tone] }} />}
                      <span aria-hidden="true" className="absolute inset-0 bg-black/35" />
                      <span aria-hidden="true" className="absolute inset-0 grid place-items-center"><span className="grid size-16 place-items-center rounded-full border border-white/30 bg-black/45 backdrop-blur"><Play className="size-6" /></span></span>
                    </div>
                  </div>
                )}
              {!item.videoUrl && <p className="font-mono text-[11px] tracking-wide text-white/45">{t("marketing", locale, "player.placeholder")}</p>}
            </div>
          )
          : (
            <div className="absolute inset-0">
              {canvas
                ? <MarketingWorldCanvasStage canvas={canvas} locale={locale} />
                : <div className="grid h-full place-items-center p-8 text-center text-sm text-white/55">{t("marketing", locale, "player.canvasMissing")}</div>}
            </div>
          )}
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div aria-label={t("marketing", locale, "player.tabsAria")} className="inline-flex shrink-0 self-start rounded-full border border-white/12 bg-white/[0.04] p-1" role="tablist">
          {(["video", "canvas"] as const).map((option) => (
            <button
              aria-selected={mode === option}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${mode === option ? "bg-primary text-primary-foreground" : "text-white/65 hover:text-white"}`}
              key={option}
              onClick={() => setMode(option)}
              role="tab"
              type="button"
            >
              {t("marketing", locale, option === "video" ? "player.tab.video" : "player.tab.canvas")}
            </button>
          ))}
        </div>
        <p className="line-clamp-2 max-w-2xl text-xs leading-5 text-white/55">{item.world.description}</p>
      </div>
    </div>,
    document.body,
  );
}
