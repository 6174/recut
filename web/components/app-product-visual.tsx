/*
 * [INPUT]: 依赖 React 生命周期、GSAP 与 App id；不连接 service、不读取用户项目或素材
 * [OUTPUT]: 对外提供 AppProductVisual——为 Editor、声音、封面、深度、Remotion 与 AI 短片渲染可循环的产品工作流切片，可在应用市场与详情页复用
 * [POS]: web/components 的 App 营销视觉原子；用各 App 的真实输入、处理与输出结构取代通用假骨架，详情页与应用目录共享同一个产品心智模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { MarketingFeatureIllustration } from "@/components/marketing-feature-illustrations";

type VisualSize = "card" | "hero";
type Selector = (selector: string) => Element[];

function useProductMotion(rootRef: RefObject<HTMLDivElement | null>, appId: string) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root) as Selector;
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.8, defaults: { ease: "power2.inOut" } });
      if (appId === "recut.audio-studio") motionAudio(tl, q);
      if (appId === "recut.cover-studio") motionCover(tl, q);
      if (appId === "recut.depth-anything") motionDepth(tl, q);
      if (appId === "recut.remotion-studio") motionRemotion(tl, q);
      if (appId === "recut.vox-broll") motionBroll(tl, q);
    }, root);
    return () => ctx.revert();
  }, [appId, rootRef]);
}

function motionAudio(tl: gsap.core.Timeline, q: Selector) {
  tl.to(q("[data-audio-head]"), { x: 252, duration: 3.2, ease: "none" }).to(q("[data-audio-bar]"), { scaleY: (i: number) => [0.45, 1.3, 0.7, 1.45, 0.55][i % 5], duration: 0.24, stagger: 0.055, yoyo: true, repeat: 4 }, 0).to(q("[data-audio-word]"), { color: "#8ee9a6", duration: 0.16, stagger: 0.35 }, 0.3).to(q("[data-audio-word]"), { color: "rgba(255,255,255,.42)", duration: 0.16, stagger: 0.35 }, 0.48);
}

function motionCover(tl: gsap.core.Timeline, q: Selector) {
  tl.fromTo(q("[data-cover]"), { y: 12, autoAlpha: 0.35, scale: 0.92 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.35, stagger: 0.12, ease: "back.out(1.4)" }).to(q("[data-cover-selected]"), { scale: 1.06, borderColor: "#8ee9a6", boxShadow: "0 0 0 2px rgba(142,233,166,.38)", duration: 0.32 }, 0.9).to(q("[data-cover-selected]"), { scale: 1, borderColor: "rgba(255,255,255,.15)", boxShadow: "0 0 0 0 rgba(142,233,166,0)", duration: 0.35 }, 2.1);
}

function motionDepth(tl: gsap.core.Timeline, q: Selector) {
  tl.fromTo(q("[data-depth-layer]"), { x: -20, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.42, stagger: 0.16, ease: "power2.out" }).to(q("[data-depth-scan]"), { x: 260, duration: 1.45, ease: "none" }, 0.55).fromTo(q("[data-depth-result]"), { autoAlpha: 0.2, scale: 0.88 }, { autoAlpha: 1, scale: 1, duration: 0.48, ease: "back.out(1.5)" }, 1.5).to(q("[data-depth-result]"), { scale: 0.96, duration: 0.42 }, 2.65);
}

function motionRemotion(tl: gsap.core.Timeline, q: Selector) {
  tl.fromTo(q("[data-code-line]"), { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, transformOrigin: "left center", duration: 0.25, stagger: 0.12 }, 0).to(q("[data-render-frame]"), { autoAlpha: 1, scale: 1, duration: 0.32, stagger: 0.13, ease: "back.out(1.4)" }, 0.75).to(q("[data-render-head]"), { x: 130, duration: 1.65, ease: "none" }, 1.4);
}

function motionBroll(tl: gsap.core.Timeline, q: Selector) {
  tl.fromTo(q("[data-shot]"), { x: -24, autoAlpha: 0, rotation: -2 }, { x: 0, autoAlpha: 1, rotation: 0, duration: 0.38, stagger: 0.18, ease: "power2.out" }).to(q("[data-shot-active]"), { y: -5, scale: 1.04, duration: 0.3, ease: "back.out(1.4)" }, 0.9).to(q("[data-broll-head]"), { x: 238, duration: 2.5, ease: "none" }, 1.15).to(q("[data-shot-active]"), { y: 0, scale: 1, duration: 0.28 }, 2.7);
}

export function AppProductVisual({ appId, size = "card" }: { appId: string; size?: VisualSize }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useProductMotion(rootRef, appId);
  if (appId === "recut.editor") return <MarketingFeatureIllustration kind="timeline" />;
  return <div aria-hidden="true" className={`app-product-visual app-product-visual-${size} relative h-44 overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,.055),rgba(255,255,255,.01))]`} ref={rootRef}>{visualFor(appId)}</div>;
}

function visualFor(appId: string) {
  if (appId === "recut.audio-studio") return <AudioVisual />;
  if (appId === "recut.cover-studio") return <CoverVisual />;
  if (appId === "recut.depth-anything") return <DepthVisual />;
  if (appId === "recut.remotion-studio") return <RemotionVisual />;
  if (appId === "recut.vox-broll") return <BrollVisual />;
  return <GenericVisual />;
}

function VisualHeader({ children }: { children: React.ReactNode }) { return <div className="absolute left-4 right-4 top-3 flex items-center justify-between font-mono text-[8px] uppercase tracking-[.16em] text-white/35"><span>{children}</span><span className="text-primary">local</span></div>; }

function AudioVisual() { const bars = [26, 48, 35, 62, 31, 44, 58, 39, 52, 28, 46, 36, 57, 30, 48, 38, 54, 25]; return <div className="absolute inset-0"><VisualHeader>transcribe / dub</VisualHeader><div className="absolute left-4 right-4 top-9 flex h-16 items-center gap-1">{bars.map((height, i) => <span data-audio-bar className="w-1.5 origin-center rounded-full bg-primary/65" key={i} style={{ height }} />)}</div><span data-audio-head className="absolute bottom-10 top-8 left-4 w-px bg-primary shadow-[0_0_10px_#8ee9a6]" /><p className="absolute bottom-4 left-4 right-4 whitespace-nowrap text-[9px] text-white/42"><span data-audio-word>speech</span>{" "}<span data-audio-word>becomes</span>{" "}<span data-audio-word>editable</span>{" "}<span data-audio-word>timing.</span></p></div>; }

function CoverVisual() { const covers = ["bg-[linear-gradient(135deg,#d36c53,#232d46)]", "bg-[linear-gradient(135deg,#15615e,#d3a152)]", "bg-[linear-gradient(135deg,#503e70,#cf6f4c)]"]; return <div className="absolute inset-0"><VisualHeader>cover / batch</VisualHeader><div className="absolute inset-x-4 bottom-4 top-9 grid grid-cols-3 gap-2">{covers.map((bg, i) => <div data-cover data-cover-selected={i === 1 ? "true" : undefined} className={`relative overflow-hidden rounded-lg border border-white/15 ${bg}`} key={bg}><span className="absolute left-2 top-2 rounded bg-black/35 px-1.5 py-1 font-mono text-[7px] text-white/75">16:9</span><span className="absolute bottom-2 left-2 h-1.5 w-2/3 rounded bg-white/65" /><span className="absolute bottom-5 left-2 h-1 w-1/2 rounded bg-white/35" /></div>)}</div></div>; }

function DepthVisual() { return <div className="absolute inset-0"><VisualHeader>depth / estimate</VisualHeader><div className="absolute left-5 top-10 size-[5.7rem] overflow-hidden rounded-xl border border-white/15 bg-[linear-gradient(135deg,#d3a472,#2e655e)]"><span data-depth-layer className="absolute bottom-0 left-[16%] h-[55%] w-[43%] rounded-t-full bg-[#152928]/75" /><span data-depth-layer className="absolute right-[12%] top-[18%] size-[42%] rounded-full bg-[#171b20]/70" /><span data-depth-scan className="absolute -left-16 top-0 h-full w-12 bg-primary/35 blur-md" /></div><div data-depth-result className="absolute right-5 top-10 size-[5.7rem] overflow-hidden rounded-xl border border-primary/35 bg-[linear-gradient(135deg,#f4f2e6,#434b67_47%,#111524)]"><span className="absolute inset-y-0 left-[29%] w-5 bg-white/25 blur-sm" /><span className="absolute inset-y-0 left-[56%] w-4 bg-black/25 blur-sm" /></div><div className="absolute bottom-5 left-5 right-5 flex items-center gap-2"><span className="h-px flex-1 bg-primary/50" /><span className="font-mono text-[8px] text-primary">MAP</span></div></div>; }

function RemotionVisual() { return <div className="absolute inset-0"><VisualHeader>code / render</VisualHeader><div className="absolute bottom-5 left-4 top-10 w-[42%] rounded-lg border border-white/10 bg-black/20 p-3"><span data-code-line className="block h-1.5 w-3/5 rounded bg-primary/75" /><span data-code-line className="mt-2 block h-1.5 w-4/5 rounded bg-white/25" /><span data-code-line className="mt-2 block h-1.5 w-2/3 rounded bg-white/25" /><span data-code-line className="mt-2 block h-1.5 w-full rounded bg-white/15" /></div><div className="absolute bottom-5 right-4 top-10 w-[43%] rounded-lg border border-white/10 bg-white/[.03] p-2"><div className="grid grid-cols-2 gap-1.5">{["#d27554", "#658d7c", "#3e6475", "#9d7659"].map((color, i) => <span data-render-frame className="aspect-video rounded-sm opacity-0" key={color} style={{ backgroundColor: color }} />)}</div><span className="absolute bottom-2 left-2 right-2 h-1 rounded bg-white/10" /><span data-render-head className="absolute bottom-[.28rem] left-2 h-2.5 w-px bg-primary" /></div></div>; }

function BrollVisual() { const shots = ["bg-[linear-gradient(135deg,#d07756,#344c42)]", "bg-[linear-gradient(135deg,#254a5a,#c6ab73)]", "bg-[linear-gradient(135deg,#44394e,#b97151)]"]; return <div className="absolute inset-0"><VisualHeader>script / b-roll</VisualHeader><div className="absolute left-4 right-4 top-10 grid grid-cols-3 gap-2">{shots.map((bg, i) => <div data-shot data-shot-active={i === 1 ? "true" : undefined} className={`aspect-video rounded-lg border border-white/15 ${bg}`} key={bg}><span className="m-2 block h-1.5 w-2/3 rounded bg-white/45" /><span className="m-2 mt-8 block h-1 w-1/2 rounded bg-white/25" /></div>)}</div><div className="absolute bottom-5 left-4 right-4 h-6 rounded border border-white/10 bg-white/[.035]"><span className="absolute left-2 top-2 h-2 w-[31%] rounded bg-[#b66c4e]" /><span className="absolute left-[35%] top-2 h-2 w-[28%] rounded bg-primary/40" /><span className="absolute right-2 top-2 h-2 w-[32%] rounded bg-[#658d7c]" /><span data-broll-head className="absolute -top-1 left-2 h-8 w-px bg-primary shadow-[0_0_9px_#8ee9a6]" /></div></div>; }

function GenericVisual() { return <div className="absolute inset-0"><VisualHeader>recut / app</VisualHeader><span className="absolute left-5 right-5 top-12 h-16 rounded-lg border border-white/10 bg-primary/[.08]" /><span className="absolute bottom-5 left-5 h-2 w-2/3 rounded bg-white/15" /><span className="absolute bottom-9 left-5 h-2 w-1/2 rounded bg-primary/45" /></div>; }
