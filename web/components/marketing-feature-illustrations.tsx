/*
 * [INPUT]: 依赖 React 生命周期与 GSAP；由首页 FeaturedApplications 传入 kind 决定要表达的产品能力
 * [OUTPUT]: 对外提供 MarketingFeatureIllustration——时间线、世界观、语音与扩展四种可循环 SVG/DOM 产品切片，尊重 prefers-reduced-motion 且卸载时完整清理动画
 * [POS]: web/components 的官网轻量动效层；每个画面用产品结构而非装饰性插画表达能力，可被任意营销卡片复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";

export type MarketingFeatureKind = "timeline" | "context" | "voice" | "extend";

function useFeatureMotion(ref: RefObject<HTMLDivElement | null>, kind: MarketingFeatureKind) {
  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);
      const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.8, defaults: { ease: "power2.inOut" } });

      if (kind === "timeline") {
        timeline
          .set(q("[data-feature-playhead]"), { x: 0 })
          .to(q("[data-feature-playhead]"), { x: 232, duration: 3.8, ease: "none" })
          .to(q("[data-feature-clip]"), { scaleY: 1.08, duration: 0.16, stagger: 0.25, yoyo: true, repeat: 1 }, 0.3)
          .to(q("[data-feature-caption]"), { opacity: 1, duration: 0.2 }, 1.35)
          .to(q("[data-feature-caption]"), { opacity: 0.35, duration: 0.35 }, 3.2);
      }

      if (kind === "context") {
        timeline
          .fromTo(q("[data-feature-link]"), { strokeDashoffset: 72 }, { strokeDashoffset: 0, duration: 0.75, stagger: 0.1, ease: "power1.out" })
          .fromTo(q("[data-feature-node]"), { scale: 0.72, autoAlpha: 0.3 }, { scale: 1, autoAlpha: 1, duration: 0.38, stagger: 0.12, ease: "back.out(1.8)" }, 0.15)
          .to(q("[data-feature-pulse]"), { scale: 1.35, autoAlpha: 0, duration: 0.7, stagger: 0.18 }, 1.6)
          .set(q("[data-feature-pulse]"), { scale: 0.65, autoAlpha: 0.75 });
      }

      if (kind === "voice") {
        timeline
          .to(q("[data-feature-wave]"), { scaleY: (index: number) => [0.45, 1.35, 0.7, 1.15, 0.55, 1.45][index % 6], duration: 0.28, stagger: { each: 0.07, from: "center" }, yoyo: true, repeat: 3 }, 0)
          .to(q("[data-feature-voicehead]"), { x: 238, duration: 2.7, ease: "none" }, 0)
          .to(q("[data-feature-word]"), { color: "#8ee9a6", duration: 0.18, stagger: 0.38 }, 0.25)
          .to(q("[data-feature-word]"), { color: "rgba(255,255,255,.42)", duration: 0.18, stagger: 0.38 }, 0.43);
      }

      if (kind === "extend") {
        timeline
          .fromTo(q("[data-feature-piece]"), { x: -22, autoAlpha: 0, scale: 0.86 }, { x: 0, autoAlpha: 1, scale: 1, duration: 0.42, stagger: 0.18, ease: "back.out(1.5)" })
          .fromTo(q("[data-feature-build-path]"), { strokeDashoffset: 170 }, { strokeDashoffset: 0, duration: 0.85, ease: "power1.inOut" }, 0.5)
          .fromTo(q("[data-feature-output]"), { scale: 0.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, ease: "back.out(1.9)" }, 1.35)
          .to(q("[data-feature-output]"), { boxShadow: "0 0 0 8px rgba(142,233,166,0)", duration: 0.65 }, 1.75);
      }
    }, root);
    return () => ctx.revert();
  }, [kind, ref]);
}

export function MarketingFeatureIllustration({ kind }: { kind: MarketingFeatureKind }) {
  const ref = useRef<HTMLDivElement>(null);
  useFeatureMotion(ref, kind);
  return (
    <div aria-hidden="true" className="relative h-32 overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,.045),rgba(255,255,255,.012))]" ref={ref}>
      {kind === "timeline" && <TimelineIllustration />}
      {kind === "context" && <ContextIllustration />}
      {kind === "voice" && <VoiceIllustration />}
      {kind === "extend" && <ExtendIllustration />}
    </div>
  );
}

function TimelineIllustration() {
  return <div className="absolute inset-0 p-4">
    <div className="flex items-center justify-between font-mono text-[8px] uppercase tracking-[.16em] text-white/35"><span>edit / sequence</span><span>00:45</span></div>
    <div className="absolute inset-x-4 top-10 space-y-2">
      <div className="flex h-7 items-center gap-1"><span className="w-6 font-mono text-[8px] text-white/30">V1</span><span data-feature-clip className="h-full w-[31%] origin-center rounded bg-[#b66c4e]" /><span data-feature-clip className="h-full w-[25%] origin-center rounded bg-[#658d7c]" /><span data-feature-clip className="h-full flex-1 origin-center rounded bg-[#3d6373]" /></div>
      <div className="flex h-4 items-center gap-1"><span className="w-6 font-mono text-[8px] text-white/30">T1</span><span data-feature-caption className="h-full w-[44%] rounded bg-primary/35 opacity-35" /><span data-feature-caption className="h-full flex-1 rounded bg-primary/20 opacity-35" /></div>
      <div className="flex h-4 items-center gap-1"><span className="w-6 font-mono text-[8px] text-white/30">A1</span><span className="h-full flex-1 rounded bg-white/[.1] [background-image:linear-gradient(90deg,transparent_0_7%,rgba(255,255,255,.3)_7%_10%,transparent_10%_15%)] [background-size:14px_100%]" /></div>
    </div>
    <span data-feature-playhead className="absolute bottom-3 top-8 left-[3.2rem] w-px bg-primary shadow-[0_0_10px_#8ee9a6]" />
  </div>;
}

function ContextIllustration() {
  return <div className="absolute inset-0 grid place-items-center">
    <svg className="absolute inset-0 size-full" viewBox="0 0 320 128" fill="none">
      {[[160, 64, 76, 32], [160, 64, 242, 32], [160, 64, 76, 100], [160, 64, 242, 100]].map(([x1, y1, x2, y2]) => <path data-feature-link d={`M${x1} ${y1} L${x2} ${y2}`} key={`${x2}-${y2}`} stroke="rgba(142,233,166,.38)" strokeDasharray="4 5" strokeDashoffset="72" strokeWidth="1" />)}
    </svg>
    <span data-feature-node className="relative z-10 grid size-14 place-items-center rounded-full border border-primary/45 bg-primary/[.14] text-[9px] font-semibold text-primary">WORLD<span data-feature-pulse className="absolute inset-0 rounded-full border border-primary" /></span>
    <span data-feature-node className="absolute left-[16%] top-[17%] rounded-lg border border-white/15 bg-[#1d2826] px-2 py-1.5 text-[8px] text-white/70">Canon</span>
    <span data-feature-node className="absolute right-[15%] top-[17%] rounded-lg border border-white/15 bg-[#1d2826] px-2 py-1.5 text-[8px] text-white/70">Character</span>
    <span data-feature-node className="absolute bottom-[15%] left-[16%] rounded-lg border border-white/15 bg-[#1d2826] px-2 py-1.5 text-[8px] text-white/70">Reference</span>
    <span data-feature-node className="absolute bottom-[15%] right-[16%] rounded-lg border border-white/15 bg-[#1d2826] px-2 py-1.5 text-[8px] text-white/70">Scene</span>
  </div>;
}

function VoiceIllustration() {
  const bars = [18, 30, 46, 26, 55, 38, 64, 30, 49, 60, 32, 45, 24, 52, 38, 58, 30, 42];
  return <div className="absolute inset-0 p-4">
    <div className="font-mono text-[8px] uppercase tracking-[.16em] text-white/35">voice / transcript</div>
    <div className="absolute left-4 right-4 top-8 flex h-12 items-center gap-1">{bars.map((height, index) => <span data-feature-wave className="w-1.5 origin-center rounded-full bg-primary/65" key={index} style={{ height }} />)}</div>
    <span data-feature-voicehead className="absolute bottom-11 top-7 left-4 w-px bg-primary shadow-[0_0_10px_#8ee9a6]" />
    <p className="absolute bottom-4 left-4 right-4 whitespace-nowrap text-[9px] text-white/42"><span data-feature-word>Make</span>{" "}<span data-feature-word>every</span>{" "}<span data-feature-word>cut</span>{" "}<span data-feature-word>your</span>{" "}<span data-feature-word>own.</span></p>
  </div>;
}

function ExtendIllustration() {
  return <div className="absolute inset-0 p-4">
    <div className="font-mono text-[8px] uppercase tracking-[.16em] text-white/35">app / compose</div>
    <div className="absolute left-5 top-10 grid gap-1.5"><span data-feature-piece className="rounded-md border border-white/15 bg-white/[.05] px-2 py-1 text-[8px] text-white/65">media</span><span data-feature-piece className="rounded-md border border-white/15 bg-white/[.05] px-2 py-1 text-[8px] text-white/65">prompt</span><span data-feature-piece className="rounded-md border border-white/15 bg-white/[.05] px-2 py-1 text-[8px] text-white/65">layout</span></div>
    <svg className="absolute left-[36%] top-8 h-20 w-[34%]" viewBox="0 0 108 80" fill="none"><path data-feature-build-path d="M1 12H42C60 12 48 40 65 40H106M1 68H42C60 68 48 40 65 40" stroke="#8ee9a6" strokeDasharray="170" strokeDashoffset="170" strokeWidth="1.4" /></svg>
    <span data-feature-output className="absolute right-5 top-[3.35rem] grid size-12 place-items-center rounded-xl border border-primary/50 bg-primary/[.14] text-[8px] font-semibold text-primary">BUILD</span>
  </div>;
}
