/*
 * [INPUT]: 依赖 React 生命周期、GSAP 与 lucide-react 图标；纯展示，不连接 service、不读取用户项目
 * [OUTPUT]: 对外提供 editor 的各功能模块的局部 UI 演示：资源模块（素材库）、自定义组件、字体与排版、AI 导演；素材与组件以 GSAP + SVG 循环表达「进入时间线」「参数→校验→成片」，供 AppShowcase 的 feature section 复用
 * [POS]: web/components/app-demo 的 editor 专属 feature 演示；与 EditorAppFull / EditorAppPanel 共享视觉语言，未来其他 App 在各自 showcase 内提供自己的 feature demo
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { Box, Check, Component, Folder, ImageIcon, Mic2, Sparkles, Type, WandSparkles } from "lucide-react";
import type { Locale } from "@/lib/i18n";

const SHELL = "rounded-2xl border border-white/15 bg-[oklch(0.13_0.01_150)] text-white";

function Frame({ title, icon: Icon, children, locale }: { title: string; icon: typeof Box; children: React.ReactNode; locale: Locale }) {
  const zh = locale === "zh";
  return (
    <div className={`${SHELL} flex h-full min-h-[15rem] flex-col overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-[10px] text-white/45">
        <span className="flex items-center gap-1.5 font-medium text-white/75"><Icon size={13} className="text-primary" />{title}</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] text-primary">{zh ? "实时预览" : "live"}</span>
      </div>
      <div className="flex-1 overflow-hidden p-3">{children}</div>
    </div>
  );
}

export function EditorAssetModuleDemo({ locale }: { locale: Locale }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const zh = locale === "zh";
  const tabs = [
    { icon: ImageIcon, label: zh ? "媒体" : "Media" },
    { icon: Type, label: zh ? "文本" : "Text" },
    { icon: Mic2, label: zh ? "音频" : "Audio" },
    { icon: Component, label: zh ? "组件" : "Component" },
  ];
  const assets = [
    { name: "sunset_01", bg: "bg-[linear-gradient(140deg,#d35d42,#1d342f_64%)]" },
    { name: "studio_02", bg: "bg-[linear-gradient(135deg,#224a64,#b5d4cf)]" },
    { name: "notes_03", bg: "bg-[linear-gradient(135deg,#242126,#766747)]" },
    { name: "wave_04", bg: "bg-[linear-gradient(135deg,#3a2d4f,#7c5c9e)]" },
    { name: "city_05", bg: "bg-[linear-gradient(135deg,#2d4a3a,#9ec0a5)]" },
    { name: "product_06", bg: "bg-[linear-gradient(135deg,#4a3a2d,#c0a58e)]" },
  ];
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);
      const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.9, defaults: { ease: "power2.inOut" } });
      timeline
        .fromTo(q("[data-editor-asset]"), { autoAlpha: 0.35, y: 5 }, { autoAlpha: 1, y: 0, duration: 0.32, stagger: 0.08 }, 0)
        .to(q("[data-editor-selected-asset]"), { y: -7, scale: 1.03, duration: 0.45, ease: "power2.out" }, 0.8)
        .fromTo(q("[data-editor-drop-path]"), { strokeDashoffset: 126 }, { strokeDashoffset: 0, duration: 0.75, ease: "power1.inOut" }, 1.1)
        .fromTo(q("[data-editor-timeline-clip]"), { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.42, transformOrigin: "left center", ease: "power2.out" }, 1.66)
        .to(q("[data-editor-selected-asset]"), { y: 0, scale: 1, duration: 0.36 }, 2.35)
        .set(q("[data-editor-drop-path]"), { strokeDashoffset: 126 }, 3.1)
        .set(q("[data-editor-timeline-clip]"), { scaleX: 0, autoAlpha: 0 }, 3.1);
    }, root);
    return () => ctx.revert();
  }, []);
  return (
    <Frame title={zh ? "资源模块 · 素材库" : "Asset module · Library"} icon={Folder} locale={locale}>
      <div className="relative h-full" ref={rootRef}>
      <div className="flex items-center gap-1 text-[9px] text-white/45">
        {tabs.map((tab, index) => <span className={`flex items-center gap-1 rounded px-1.5 py-1 ${index === 0 ? "bg-primary/15 text-primary" : ""}`} key={tab.label}><tab.icon size={10} />{tab.label}</span>)}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {assets.map((asset, index) => <div className="rounded border border-white/10 p-1 will-change-transform" data-editor-asset data-editor-selected-asset={index === 1 ? "true" : undefined} key={asset.name}><div className={`aspect-video rounded-sm ${asset.bg}`} /><span className="mt-1 block truncate text-[8px] text-white/50">{asset.name}</span></div>)}
      </div>
      <svg className="pointer-events-none absolute right-2 top-[4.7rem] h-24 w-24" fill="none" viewBox="0 0 96 96"><path data-editor-drop-path d="M10 8 C78 8, 20 55, 82 82" stroke="#8ee9a6" strokeDasharray="126" strokeDashoffset="126" strokeWidth="1.25" /></svg>
      <div className="mt-3 rounded-lg border border-dashed border-white/15 px-3 py-2 text-[9px] text-white/40"><div className="flex items-center gap-2"><Component size={11} className="text-primary" />{zh ? "素材进入时间线" : "Asset lands on timeline"}</div><span data-editor-timeline-clip className="mt-1.5 block h-1.5 w-2/3 rounded bg-primary/65" /></div>
      </div>
    </Frame>
  );
}

export function EditorComponentDemo({ locale }: { locale: Locale }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const zh = locale === "zh";
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);
      const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.9, defaults: { ease: "power2.inOut" } });
      timeline
        .to(q("[data-editor-param]"), { backgroundColor: "rgba(142,233,166,.16)", color: "#8ee9a6", duration: 0.25, stagger: 0.25 }, 0)
        .fromTo(q("[data-editor-build-path]"), { strokeDashoffset: 142 }, { strokeDashoffset: 0, duration: 0.72, ease: "power1.inOut" }, 0.6)
        .to(q("[data-editor-build-button]"), { scale: 0.92, duration: 0.12, yoyo: true, repeat: 1 }, 1.14)
        .fromTo(q("[data-editor-verified]"), { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.42, ease: "back.out(1.7)" }, 1.32)
        .fromTo(q("[data-editor-component-clip]"), { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.42, transformOrigin: "left center" }, 1.68)
        .to(q("[data-editor-param]"), { backgroundColor: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.5)", duration: 0.25, stagger: 0.12 }, 2.65)
        .set(q("[data-editor-build-path]"), { strokeDashoffset: 142 }, 3.1)
        .set(q("[data-editor-verified], [data-editor-component-clip]"), { autoAlpha: 0 }, 3.1);
    }, root);
    return () => ctx.revert();
  }, []);
  return (
    <Frame title={zh ? "自定义组件" : "Custom components"} icon={Component} locale={locale}>
      <div className="relative h-full" ref={rootRef}>
      <div className="grid grid-cols-[1fr_5.5rem] gap-2">
        <div className="space-y-2">
          <div className="rounded-lg border border-primary/25 bg-primary/[0.07] p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-primary"><Check size={11} />AccentBar <span data-editor-verified className="opacity-0">· {zh ? "已验证" : "verified"}</span></div>
            <div className="mt-2 h-2 w-2/3 rounded bg-gradient-to-r from-primary to-[#d18454]" />
            <div className="mt-1.5 h-1.5 w-1/2 rounded bg-white/20" />
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
            <div className="text-[9px] uppercase tracking-[0.12em] text-white/30">{zh ? "可编辑参数" : "Editable params"}</div>
            <div className="mt-1.5 space-y-1 text-[8px] text-white/50">
              <div data-editor-param className="flex items-center justify-between rounded bg-white/[0.04] px-1.5 py-1"><span>color</span><span className="size-3 rounded-full bg-primary" /></div>
              <div data-editor-param className="flex items-center justify-between rounded bg-white/[0.04] px-1.5 py-1"><span>text</span><span className="text-white/30">{zh ? "副标题" : "caption"}</span></div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <button data-editor-build-button className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary text-[9px] font-medium text-primary-foreground" type="button"><WandSparkles size={11} />{zh ? "生成" : "Build"}</button>
          <button className="flex flex-1 items-center justify-center rounded-lg border border-white/10 text-[9px] text-white/50" type="button">{zh ? "编辑" : "Edit"}</button>
        </div>
      </div>
      <svg className="pointer-events-none absolute right-[3.4rem] top-[2.15rem] h-16 w-20" fill="none" viewBox="0 0 80 64"><path data-editor-build-path d="M2 4 C76 4, 8 48, 74 58" stroke="#8ee9a6" strokeDasharray="142" strokeDashoffset="142" strokeWidth="1.25" /></svg>
      <p className="mt-3 text-[9px] leading-4 text-white/40">{zh ? "参数 → 校验 → 时间线。每个组件仍由你编辑。" : "Params → verify → timeline. Every component stays editable."}</p>
      <span data-editor-component-clip className="mt-2 block h-1.5 w-3/4 rounded bg-primary/55 opacity-0" />
      </div>
    </Frame>
  );
}

export function EditorFontDemo({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  const fonts = [
    { label: "Sans", className: "font-sans" },
    { label: "Serif", className: "font-serif" },
    { label: "Mono", className: "font-mono" },
  ];
  return (
    <Frame title={zh ? "字体与排版" : "Fonts & typography"} icon={Type} locale={locale}>
      <div className="flex items-center gap-1 text-[9px] text-white/45">
        {fonts.map((font, index) => <span className={`rounded px-2 py-1 ${index === 1 ? "bg-primary/15 text-primary" : "text-white/50"}`} key={font.label}>{font.label}</span>)}
      </div>
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <p className={`text-lg font-semibold leading-tight text-white ${fonts[1].className}`}>{zh ? "让作品开口说话" : "Make the work speak"}</p>
        <p className={`mt-1.5 text-[10px] leading-4 text-white/55 ${fonts[0].className}`}>{zh ? "标题、字幕与组件文字共享同一套排版系统，阅读层次清晰。" : "Titles, captions and component text share one typographic system."}</p>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[9px] text-white/45">
        <span>{zh ? "字重" : "Weight"}</span>
        <span className="flex gap-1"><span className="rounded bg-white/[0.06] px-1.5 py-0.5">Regular</span><span className="rounded bg-primary/20 px-1.5 py-0.5 text-primary">Semibold</span></span>
      </div>
    </Frame>
  );
}

export function EditorDirectorDemo({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return (
    <Frame title={zh ? "AI 导演" : "AI director"} icon={Sparkles} locale={locale}>
      <div className="space-y-2.5 text-[10px] leading-5">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-2.5 text-white/65">{zh ? "把这组素材剪成 45 秒产品故事，节奏和镜头由我最终决定。" : "Cut this footage into a 45-second product story; I keep final say on pacing and shots."}</div>
        <div className="ml-auto rounded-lg bg-primary p-2.5 text-primary-foreground">{zh ? "我先整理素材和剪辑建议，每个结果都在时间线上，可编辑或撤销。" : "I stage the footage and propose edits; every result lands on your timeline to edit or undo."}</div>
        <div className="rounded-lg border border-primary/25 bg-primary/[0.07] p-2.5">
          <div className="flex items-center gap-1.5 font-medium text-primary"><Sparkles size={11} /> {zh ? "可审阅的操作" : "Reviewable operations"}</div>
          <div className="mt-1.5 space-y-1 text-[9px] text-white/50"><span className="flex items-center gap-1.5"><Check size={10} className="text-primary" />{zh ? "素材与项目留在本机" : "Media and projects stay local"}</span><span className="flex items-center gap-1.5"><Check size={10} className="text-primary" />{zh ? "每一步可回退" : "Every step is reversible"}</span></div>
        </div>
      </div>
    </Frame>
  );
}
