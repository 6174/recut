/*
 * [INPUT]: 依赖 React 生命周期与 GSAP 时间线，读取 locale 决定示例文案；复用 marketing-editor-demo 的视觉语言（深色工作台、CapCut 风格时间线、AI director 对话）
 * [OUTPUT]: 对外提供 editorAppDemoModule：Full 为可暂停循环的整体工作台演示（homepage hero 与详情页复用）、Panel 为聚焦的局部 UI（AI director 对话面板）、Skeleton 复用通用骨架；不连接 service、不读取用户项目，只呈现产品心智模型
 * [POS]: web/components/app-demo 的 editor 专属演示；未来其他 App 在 registry 注册自己的 module，editor 是第一个完整实现的 App
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { gsap } from "gsap";
import { Check, ChevronDown, CirclePlay, Film, Layers3, MousePointer2, Pause, Play, Plus, Send, Sparkles, Type, WandSparkles } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AppDemoModule } from "./types";

const CLIP_BLOCKS = ["clip-a", "clip-b", "clip-c", "clip-d", "clip-e"];

function DirectorChat({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return (
    <div className="flex-1 space-y-3 text-[11px] leading-5">
      <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3 text-white/65">{zh ? "用 Codex 帮我把这组素材做成 45 秒产品故事，我保留对节奏和镜头的最终控制。" : "Use Codex to turn this footage into a 45-second product story. Keep final control of pacing and shots with me."}</div>
      <div className="ml-auto rounded-lg bg-primary p-3 text-primary-foreground">{zh ? "我会先整理素材和剪辑建议；每个结果都在时间线上，随时可以编辑或撤销。" : "I will stage the footage and edit proposals. Every result lands on your timeline to edit or undo."}</div>
      <div className="rounded-lg border border-primary/25 bg-primary/[0.07] p-3">
        <div className="flex items-center gap-1.5 font-medium text-primary"><Sparkles size={12} /> {zh ? "可审阅的操作" : "Reviewable operations"}</div>
        <div className="mt-2 space-y-1.5 text-[10px] text-white/50">
          <span className="flex items-center gap-1.5"><Check size={11} className="text-primary" />{zh ? "素材与项目留在本机" : "Media and projects stay local"}</span>
          <span className="flex items-center gap-1.5"><Check size={11} className="text-primary" />{zh ? "每一步可回退" : "Every step is reversible"}</span>
        </div>
      </div>
    </div>
  );
}

function DemoScene({ caption, kind }: { caption: string; kind: "sunset" | "studio" | "notes" }) {
  const background = kind === "sunset" ? "bg-[linear-gradient(130deg,#17312d,#0c1514_49%,#b96d40)]" : kind === "studio" ? "bg-[linear-gradient(115deg,#162d3b,#0e171f_44%,#366c76)]" : "bg-[linear-gradient(130deg,#211d25,#101015_54%,#4f4437)]";
  return <div className={`absolute inset-0 overflow-hidden ${background}`} data-demo-scene><div className="absolute -inset-[7%] will-change-transform" data-demo-scene-media><SceneArtwork kind={kind} /></div><div className="absolute inset-x-0 bottom-0 h-[35%] bg-gradient-to-t from-black/70 via-black/20 to-transparent" /><p className="absolute inset-x-5 bottom-5 text-center text-[10px] font-medium leading-4 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.9)] sm:text-xs" data-demo-copy>{caption}</p></div>;
}

function SceneArtwork({ kind }: { kind: "sunset" | "studio" | "notes" }) {
  if (kind === "sunset") return <><div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_23%,#f5c16c_0_4%,transparent_15%),linear-gradient(105deg,transparent_0_42%,rgba(0,0,0,.14)_43%_100%)]" /><div className="absolute -right-[4%] top-[8%] h-[63%] w-[44%] rounded-[45%_45%_10%_10%] bg-[#191d1c]/75 shadow-2xl" /><div className="absolute right-[10%] top-[15%] h-[42%] w-[25%] rounded-[55%_55%_16%_16%] bg-[linear-gradient(145deg,#d8a578,#4a2d2b)]" /><div className="absolute left-[11%] top-[17%] h-[54%] w-[48%] rotate-[-4deg] rounded-xl border border-white/15 bg-[#101817]/65 p-2 shadow-2xl" data-demo-broll-subject><div className="flex h-full flex-col rounded-lg bg-[linear-gradient(135deg,#d18454,#29584f_56%,#142422)] p-2"><span className="h-1.5 w-10 rounded bg-white/55" /><span className="mt-auto h-1.5 w-2/3 rounded bg-white/35" /><span className="mt-1 h-1.5 w-1/2 rounded bg-white/20" /></div></div><div className="absolute bottom-[17%] left-[9%] h-[15%] w-[55%] rounded-t-[100%] bg-black/30" /></>;
  if (kind === "studio") return <><div className="absolute inset-y-0 left-[8%] w-[79%] rounded-2xl border border-white/15 bg-[#0d171b]/75 p-3 shadow-2xl" data-demo-broll-subject><div className="flex items-center justify-between text-[7px] text-white/45"><span>RECUT / EDIT REVIEW</span><span>00:18:12</span></div><div className="mt-2 grid h-[72%] grid-cols-[1.25fr_.75fr] gap-2"><div className="overflow-hidden rounded-lg bg-[linear-gradient(135deg,#d7a374,#2c6c78_59%,#132329)]"><div className="ml-[47%] mt-[17%] size-[28%] rounded-full border-[8px] border-white/25" /><div className="ml-[57%] mt-2 size-[10%] rounded-full bg-white/65" /></div><div className="rounded-lg border border-white/10 bg-white/[.045] p-2"><span className="block h-1.5 w-2/3 rounded bg-white/40" /><span className="mt-2 block h-1.5 w-full rounded bg-white/15" /><span className="mt-1 block h-1.5 w-[78%] rounded bg-white/15" /><span className="mt-5 block h-5 rounded bg-primary/80" /></div></div><div className="mt-2 flex gap-1"><span className="h-2 flex-1 rounded bg-[#c47e5c]" /><span className="h-2 w-[28%] rounded bg-primary/70" /><span className="h-2 flex-1 rounded bg-[#739588]" /></div></div><div className="absolute right-[11%] top-[24%] size-4 rounded-full border-2 border-primary bg-[#152d30] shadow-[0_0_18px_#8ee9a6]" /></>;
  return <><div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(222,190,117,.38),transparent_19%)]" /><div className="absolute left-[8%] top-[17%] w-[84%] rounded-xl border border-white/15 bg-[#171419]/85 p-3 shadow-2xl" data-demo-broll-subject><div className="flex items-center justify-between text-[7px] text-white/45"><span>PRODUCT STORY / TIMELINE</span><span>45 SEC</span></div><div className="mt-3 space-y-2"><div className="flex items-center gap-2"><span className="w-7 text-[7px] text-white/35">V1</span><span className="h-7 flex-1 rounded bg-[linear-gradient(90deg,#bb7454,#98644d)]" /><span className="h-7 w-[26%] rounded bg-[#6e9687]" /></div><div className="flex items-center gap-2"><span className="w-7 text-[7px] text-white/35">T1</span><span className="h-4 w-[54%] rounded bg-primary/40" /></div><div className="flex items-center gap-2"><span className="w-7 text-[7px] text-white/35">A1</span><span className="h-4 flex-1 rounded bg-white/15 [background-image:linear-gradient(90deg,transparent_0_5%,rgba(255,255,255,.35)_5%_7%,transparent_7%_10%)] [background-size:12px_100%]" /></div></div></div></>;
}

function TimelineRow({ blocks, icon, label, text, audio }: { blocks: string[]; icon: ReactNode; label: string; text?: boolean; audio?: boolean }) {
  return <div className="grid grid-cols-[3.2rem_1fr] items-center gap-2"><span className="flex items-center gap-1 text-[8px] text-white/40">{icon}{label}</span><div className="flex h-6 gap-1">{blocks.map((block, index) => <span className={`flex min-w-0 flex-1 items-center overflow-hidden rounded px-1.5 text-[7px] ${audio ? "bg-white/[0.12] text-white/35 [background-image:linear-gradient(90deg,transparent_0_3%,rgba(255,255,255,.28)_3%_5%,transparent_5%_7%)] [background-size:10px_100%]" : text ? "bg-primary/25 text-primary" : index % 2 ? "bg-[#6a8f7d] text-white/80" : "bg-[#a3694d] text-white/80"}`} key={block}>{block}</span>)}</div></div>;
}

export function EditorAppFull({ locale, animated, className = "" }: { locale: Locale; animated: boolean; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(true);
  const zh = locale === "zh";

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scenes = gsap.utils.toArray<HTMLElement>("[data-demo-scene]", root);
    const sceneCopy = scenes.map((scene) => gsap.utils.toArray<HTMLElement>("[data-demo-copy]", scene));
    const sceneMedia = scenes.map((scene) => scene.querySelector<HTMLElement>("[data-demo-scene-media]"));
    const sceneSubject = scenes.map((scene) => scene.querySelector<HTMLElement>("[data-demo-broll-subject]"));
    const playhead = root.querySelector<HTMLElement>("[data-demo-playhead]");
    if (!playhead || scenes.length !== 3 || sceneMedia.some((media) => !media) || sceneSubject.some((subject) => !subject)) return;

    gsap.set(scenes, { autoAlpha: 0 });
    gsap.set(scenes[0], { autoAlpha: 1 });
    gsap.set(sceneCopy.flat(), { autoAlpha: 0, y: 16 });
    if (!animated || reduceMotion) {
      setPlaying(false);
      return;
    }
    const updateTime = () => {
      if (!timeRef.current || !timelineRef.current) return;
      const seconds = Math.floor((timelineRef.current.time() / 9) * 45);
      timeRef.current.textContent = `00:00:${String(Math.min(seconds, 44)).padStart(2, "0")}:00`;
    };
    const timeline = gsap.timeline({ paused: reduceMotion, repeat: -1, defaults: { ease: "none" }, onUpdate: updateTime });
    timeline
      .set(sceneMedia[0], { scale: 1, xPercent: 0 }, 0)
      .set(sceneSubject[0], { xPercent: -5 }, 0)
      .to(playhead, { xPercent: 100, duration: 9 }, 0)
      .to(sceneMedia[0], { duration: 3, ease: "sine.inOut", scale: 1.13, xPercent: -3 }, 0)
      .to(sceneSubject[0], { duration: 3, ease: "sine.inOut", xPercent: 5 }, 0)
      .to(sceneCopy[0], { autoAlpha: 1, duration: 0.45, stagger: 0.08, y: 0 }, 0.18)
      .to(scenes[0], { autoAlpha: 0, duration: 0.3 }, 2.7)
      .set(sceneMedia[1], { scale: 1.12, xPercent: 4 }, 2.7)
      .set(sceneSubject[1], { xPercent: 6 }, 2.7)
      .to(scenes[1], { autoAlpha: 1, duration: 0.3 }, 2.7)
      .to(sceneMedia[1], { duration: 3, ease: "sine.inOut", scale: 1.12, xPercent: -4 }, 2.7)
      .to(sceneSubject[1], { duration: 3, ease: "sine.inOut", xPercent: -5 }, 2.7)
      .to(sceneCopy[1], { autoAlpha: 1, duration: 0.45, stagger: 0.08, y: 0 }, 2.88)
      .to(scenes[1], { autoAlpha: 0, duration: 0.3 }, 5.7)
      .set(sceneMedia[2], { scale: 1.14, yPercent: -2 }, 5.7)
      .set(sceneSubject[2], { yPercent: 5 }, 5.7)
      .to(scenes[2], { autoAlpha: 1, duration: 0.3 }, 5.7)
      .to(sceneMedia[2], { duration: 3, ease: "sine.inOut", scale: 1, yPercent: 0 }, 5.7)
      .to(sceneSubject[2], { duration: 3, ease: "sine.inOut", yPercent: -3 }, 5.7)
      .to(sceneCopy[2], { autoAlpha: 1, duration: 0.45, stagger: 0.08, y: 0 }, 5.88)
      .to(scenes[2], { autoAlpha: 0, duration: 0.3 }, 8.7)
      .to(scenes[0], { autoAlpha: 1, duration: 0.3 }, 8.7);
    timelineRef.current = timeline;
    setPlaying(true);
    return () => {
      timeline.kill();
    };
  }, [animated]);

  function togglePlayback() {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const nextPlaying = timeline.paused();
    timeline.paused(!nextPlaying);
    setPlaying(nextPlaying);
  }

  return (
    <div className={`app-demo app-demo-editor w-full ${className}`}>
      <div className="marketing-editor-demo-canvas mx-auto w-full max-w-[960px] overflow-hidden rounded-2xl border border-white/15 bg-[oklch(0.145_0.012_150)] shadow-[0_28px_110px_oklch(0_0_0_/_0.55)]" ref={rootRef}>
        <div className="flex h-12 items-center justify-between border-b border-white/10 px-4 text-[10px] text-white/45 sm:px-5">
          <div className="flex items-center gap-2.5"><span className="grid size-6 place-items-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">R</span><span className="font-semibold text-white/85">Recut</span><span className="hidden text-white/25 sm:inline">/</span><span className="hidden sm:inline">{zh ? "本地创作工作台" : "Local creative workspace"}</span></div>
          <div className="flex items-center gap-2"><span className="hidden text-primary sm:inline">● {zh ? "本地项目" : "local project"}</span><button aria-label="More options" className="grid size-7 place-items-center rounded hover:bg-white/10" type="button">•••</button></div>
        </div>
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] sm:grid-cols-[15.5rem_minmax(0,1fr)]">
          <aside className="flex min-h-[18rem] flex-col border-b-0 border-r border-white/10 bg-[oklch(0.13_0.01_150)] p-4">
            <div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">AI director</span><span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-medium text-primary">{zh ? "已连接" : "connected"}</span></div>
            <DirectorChat locale={locale} />
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-[10px] text-white/35"><span className="flex-1">{zh ? "继续描述你的创作…" : "Describe the next change…"}</span><Send size={13} /></div>
          </aside>
          <section className="min-w-0 bg-[oklch(0.175_0.012_150)] p-2.5 sm:p-3" aria-label={zh ? "Recut Editor 演示" : "Recut Editor demo"}>
            <div className="flex h-8 items-center justify-between rounded-t border border-white/10 bg-black/15 px-3 text-[9px] text-white/45"><div className="flex items-center gap-2"><span className="font-medium text-white/75">{zh ? "Recut 剪辑器" : "Recut Editor"}</span><span className="text-white/25">/</span><span>{zh ? "产品故事" : "Product story"}</span></div><div className="flex items-center gap-1"><button className="rounded border border-white/10 px-2 py-1 hover:bg-white/10" type="button">{zh ? "导出" : "Export"}</button><ChevronDown size={12} /></div></div>
            <div className="grid min-h-[21rem] grid-cols-[6.5rem_minmax(0,1fr)_6.8rem] sm:grid-cols-[7.6rem_minmax(0,1fr)_7.8rem] border-x border-white/10">
              <aside className="block border-r border-white/10 bg-black/15 p-2"><div className="flex items-center justify-between text-[8px] text-white/45"><span>{zh ? "素材" : "Assets"}</span><Plus size={11} /></div><div className="mt-2 flex gap-1 text-[8px] text-white/40"><span className="rounded bg-primary/15 px-1.5 py-1 text-primary">{zh ? "素材" : "Media"}</span><span className="rounded px-1.5 py-1">{zh ? "文本" : "Text"}</span></div><div className="mt-3 space-y-2">{["sunset", "studio", "notes"].map((asset, index) => <div className="rounded border border-white/10 p-1" key={asset}><div className={`aspect-video rounded-sm ${index === 0 ? "bg-[linear-gradient(140deg,#d35d42,#1d342f_64%)]" : index === 1 ? "bg-[linear-gradient(135deg,#224a64,#b5d4cf)]" : "bg-[linear-gradient(135deg,#242126,#766747)]"}`} /><span className="mt-1 block truncate text-[8px] text-white/50">{asset}_{String(index + 1).padStart(2, "0")}</span></div>)}</div></aside>
              <div className="relative flex min-w-0 flex-col bg-[oklch(0.205_0.013_150)] p-3"><div className="flex items-center justify-between text-[8px] text-white/40"><span>{zh ? "预览画布" : "Preview canvas"}</span><span>60 fps · {zh ? "适应" : "Fit"}</span></div><div className="relative mt-2 flex flex-1 items-center justify-center overflow-hidden rounded border border-black/30 bg-[oklch(0.1_0.012_150)]"><DemoScene caption={zh ? "素材与项目，不离开你的机器。" : "Your media and project stay on your machine."} kind="sunset" /><DemoScene caption={zh ? "AI 给出剪辑建议；接受、修改或撤销，由你决定。" : "AI proposes the edit. You accept, adjust, or undo."} kind="studio" /><DemoScene caption={zh ? "每个镜头和结果，都回到同一条可编辑的时间线。" : "Every shot and result returns to one editable timeline."} kind="notes" /><button aria-label={playing ? (zh ? "暂停演示" : "Pause demo") : (zh ? "播放演示" : "Play demo")} className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full bg-white text-black shadow-lg transition hover:scale-105" onClick={togglePlayback} type="button">{playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button></div><div className="mt-2 flex items-center justify-between text-[9px] text-white/40"><span ref={timeRef}>00:00:00:00</span><span>00:00:45:00</span></div></div>
              <aside className="block border-l border-white/10 bg-black/15 p-2"><div className="flex items-center justify-between text-[8px] text-white/45"><span>{zh ? "属性" : "Properties"}</span><MousePointer2 size={11} /></div><div className="mt-4 rounded border border-white/10 p-2"><span className="text-[8px] uppercase tracking-[0.12em] text-white/30">{zh ? "变换" : "Transform"}</span><div className="mt-2 grid grid-cols-2 gap-1 text-[8px] text-white/50"><span className="rounded bg-white/[0.04] p-1">X 0</span><span className="rounded bg-white/[0.04] p-1">Y 0</span><span className="rounded bg-white/[0.04] p-1">100%</span><span className="rounded bg-white/[0.04] p-1">0°</span></div></div><div className="mt-3 rounded border border-white/10 p-2"><span className="text-[8px] uppercase tracking-[0.12em] text-white/30">{zh ? "动效" : "Animation"}</span><div className="mt-2 flex items-center gap-1 text-[8px] text-primary"><WandSparkles size={10} /> {zh ? "淡入 + 上移" : "Fade + rise"}</div></div></aside>
            </div>
            <div className="relative overflow-hidden rounded-b border border-white/10 bg-[oklch(0.13_0.01_150)] p-2.5"><div className="flex items-center justify-between border-b border-white/10 pb-2 text-[8px] text-white/45"><span className="flex items-center gap-1.5"><Layers3 size={11} />{zh ? "时间线" : "Timeline"}</span><span>{zh ? "吸附已开启" : "Snapping on"}</span></div><div className="ml-[3.7rem] mt-2 grid grid-cols-6 text-[7px] text-white/30"><span>00:00</span><span>00:08</span><span>00:16</span><span>00:24</span><span>00:32</span><span>00:40</span></div><div className="relative mt-1.5 space-y-1.5"><TimelineRow icon={<Film size={10} />} label="V1" blocks={CLIP_BLOCKS} /><TimelineRow icon={<Type size={10} />} label="T1" blocks={["caption", "caption-2"]} text /><TimelineRow icon={<CirclePlay size={10} />} label="A1" blocks={["audio-waveform"]} audio /><div className="pointer-events-none absolute inset-y-0 left-[3.7rem] right-0 overflow-hidden"><div className="absolute inset-y-0 left-0 w-full will-change-transform" data-demo-playhead><span className="absolute inset-y-0 left-0 w-px bg-primary shadow-[0_0_12px_oklch(0.68_0.18_151_/_0.9)]" /></div></div></div></div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function EditorAppPanel({ locale, className = "" }: { locale: Locale; className?: string }) {
  const zh = locale === "zh";
  return (
    <div className={`app-demo app-demo-editor-panel flex h-full min-h-[16rem] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[oklch(0.13_0.01_150)] ${className}`}>
      <div className="flex h-11 items-center justify-between border-b border-white/10 px-4 text-[10px] text-white/45">
        <div className="flex items-center gap-2"><Sparkles size={13} className="text-primary" /><span className="font-semibold uppercase tracking-[0.16em] text-white/70">AI director</span></div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-medium text-primary">{zh ? "已连接" : "connected"}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
        <DirectorChat locale={locale} />
        <div className="mt-auto flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-[10px] text-white/35"><span className="flex-1">{zh ? "继续描述你的创作…" : "Describe the next change…"}</span><Send size={13} /></div>
      </div>
    </div>
  );
}

export const editorAppDemoModule: AppDemoModule = {
  Full: EditorAppFull,
  Panel: EditorAppPanel,
  Skeleton: undefined,
};
