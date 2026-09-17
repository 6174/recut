/*
 * [INPUT]: 依赖 marketing-site 的 useMarketingLocale 上下文、lib/i18n 的 t() 字典与 GSAP；所有文案走 flow/create/clone/agent/batch/worlds.consistency 命名空间，本文件不硬编码语言；CreationFlowDiagram 另接收真实图片（World 封面/角色图，缺省回退渐变占位）
 * [OUTPUT]: 对外提供官网叙事的六张可循环示意：CreationFlowDiagram（想法 + 真实视频 → 世界观概念关系 → 真实帧时间线）、CloneFlowDiagram（参考→拆解→你的版本）、AgentPipelineDiagram（你→四类 Agent→审阅）、BatchDiagram（一个想法→多平台多版本）、ConsistencyDiagram（世界观→持续一致的多条视频）、OwnershipDiagram（开源/本地/可扩展/你的模型/你的工作流）
 * [POS]: web/components 的官网「先展示结果、再解释技术」视觉层；CreationFlowDiagram 采用 Apple 式「抽象结构 + 真实媒体」表达，去 Mock 窗口化：浮层圆角媒体块 + 极细连线 + 光晕，不画假的 App 边框
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { t } from "@/lib/i18n";
import { useMarketingLocale } from "@/components/marketing-site";

type DiagramRef = RefObject<HTMLDivElement | null>;
type DiagramSelector = ReturnType<typeof gsap.utils.selector>;
type DiagramBuilder = (q: DiagramSelector, motion: boolean) => gsap.core.Timeline;

function useDiagramMotion(ref: DiagramRef, build: DiagramBuilder) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context(() => {
      const timeline = build(gsap.utils.selector(root), !reduceMotion);
      if (reduceMotion) timeline.progress(1);
    }, root);
    return () => ctx.revert();
  }, [ref, build]);
}

function useStableBuild(build: DiagramBuilder): DiagramBuilder {
  const ref = useRef(build);
  ref.current = build;
  const callback = useRef<DiagramBuilder>((q, motion) => ref.current(q, motion));
  return callback.current;
}

// —— 共用外观 ——
function Panel({ children, tone = "plain", ...rest }: { children: React.ReactNode; tone?: "plain" | "accent" } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-xl border p-3.5 ${tone === "accent" ? "border-primary/30 bg-primary/[.07]" : "border-white/12 bg-black/25"}`}>
      {children}
    </div>
  );
}

function PanelLabel({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return <p className={`font-mono text-[10px] font-semibold uppercase tracking-[.18em] ${accent ? "text-primary" : "text-white/45"}`}>{children}</p>;
}

function Check() {
  return (
    <svg aria-hidden="true" className="size-3.5 shrink-0 text-primary" fill="none" viewBox="0 0 16 16">
      <path d="M3 8.5 6.2 12 13 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

// Apple 式媒体块：真实图片优先、无图回退柔和渐变；不使用假窗口边框，只用圆角 + 细描边 + 投影。
const FALLBACK_GRADIENTS = [
  "linear-gradient(140deg,#2f4d42,#0f1a17)",
  "linear-gradient(140deg,#4a3b2e,#191210)",
  "linear-gradient(140deg,#2c3a4d,#101319)",
  "linear-gradient(140deg,#3f2d4a,#171019)",
  "linear-gradient(140deg,#4a2d35,#1a1012)",
  "linear-gradient(140deg,#2d4a47,#0f1919)",
];

function MediaTile({ badge, className = "", duration, label, rounded = "rounded-2xl", showPlay = true, src, gradient }: { badge?: string; className?: string; duration?: string; label?: string; rounded?: string; showPlay?: boolean; src?: string; gradient?: string }) {
  return (
    <span className={`relative block overflow-hidden ${rounded} shadow-[0_22px_50px_-22px_rgba(0,0,0,.85)] ring-1 ring-white/15 ${className}`}>
      {src
        ? <img alt="" className="absolute inset-0 size-full object-cover" draggable={false} loading="lazy" src={src} />
        : <span className="absolute inset-0" style={{ background: gradient ?? FALLBACK_GRADIENTS[0] }} />}
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
      {showPlay && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-7 place-items-center rounded-full bg-black/35 ring-1 ring-white/30 backdrop-blur">
            <svg aria-hidden="true" className="ml-0.5 size-2.5 fill-white/90" viewBox="0 0 12 12"><path d="M2 1.5 10.5 6 2 10.5Z" /></svg>
          </span>
        </span>
      )}
      {badge && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-semibold tracking-[.02em] text-white/90 backdrop-blur">{badge}</span>}
      {label && <span className="absolute left-2 top-2 font-mono text-[8px] uppercase tracking-[.16em] text-white/70">{label}</span>}
      {duration && <span className="absolute bottom-1.5 right-2 font-mono text-[8px] text-white/85">{duration}</span>}
    </span>
  );
}

function FlowLine({ label }: { label?: string }) {
  return (
    <div className="relative flex h-12 w-full items-center justify-center">
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-gradient-to-b from-transparent via-white/22 to-transparent" />
      {label && (
        <span className="relative z-10 inline-flex items-center gap-2 rounded-full bg-[oklch(0.13_0.012_150)]/85 px-3 py-1 text-[10px] font-medium tracking-[.1em] text-white/70 ring-1 ring-white/12 backdrop-blur" data-diagram-agent>
          <span className="relative size-1.5 rounded-full bg-primary">
            <span className="absolute inset-0 rounded-full bg-primary" data-diagram-pulse />
          </span>
          {label}
        </span>
      )}
    </div>
  );
}

type WorldNode = { label: string; src?: string; gradient: string; position: string };

function WorldOrb({ nodes }: { nodes: WorldNode[] }) {
  const points: Array<[number, number]> = [[17, 20], [83, 20], [17, 80], [83, 80]];
  return (
    <div className="relative mx-auto h-64 w-full max-w-md" data-diagram-world>
      <svg aria-hidden="true" className="absolute inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 100 100">
        {points.map(([x, y]) => <path d={`M50 50 L${x} ${y}`} data-diagram-world-link key={`${x}-${y}`} stroke="rgba(255,255,255,.18)" strokeDasharray="2 3" strokeDashoffset="90" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative grid size-24 place-items-center">
          <span aria-hidden="true" className="absolute -inset-6 rounded-full bg-primary/18 blur-2xl" />
          <span aria-hidden="true" className="absolute inset-0 rounded-full ring-1 ring-primary/30" />
          <span aria-hidden="true" className="absolute inset-3 rounded-full bg-[radial-gradient(circle_at_35%_28%,rgba(142,233,166,.55),rgba(142,233,166,.05)_72%)] ring-1 ring-white/10" />
          <span className="relative text-[10px] font-semibold uppercase tracking-[.22em] text-white/90">WORLD</span>
        </div>
      </div>
      {nodes.map((node) => (
        <div className={`absolute flex flex-col items-center gap-1.5 ${node.position}`} data-diagram-facet key={node.label}>
          <span className="relative size-11 overflow-hidden rounded-full shadow-[0_14px_30px_-14px_rgba(0,0,0,.9)] ring-1 ring-white/20">
            {node.src
              ? <img alt="" className="absolute inset-0 size-full object-cover" draggable={false} loading="lazy" src={node.src} />
              : <span className="absolute inset-0" style={{ background: node.gradient }} />}
          </span>
          <span className="text-[10px] font-medium text-white/60">{node.label}</span>
        </div>
      ))}
    </div>
  );
}

function TimelineStrip({ caption, images, label }: { caption: string; images: string[]; label: string }) {
  const clips = [0, 1, 2, 3].map((index) => images[index]);
  return (
    <div className="w-full" data-diagram-output>
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[11px] font-medium text-white/55">{label}</span>
        <span className="font-mono text-[11px] text-white/45">00:45</span>
      </div>
      <div className="relative mt-3 flex gap-1.5" data-diagram-timeline>
        {clips.map((src, index) => (
          <span className="relative h-20 flex-1 origin-center overflow-hidden rounded-xl ring-1 ring-white/12" data-diagram-clip key={index}>
            {src
              ? <img alt="" className="absolute inset-0 size-full object-cover" draggable={false} loading="lazy" src={src} />
              : <span className="absolute inset-0" style={{ background: FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length] }} />}
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
          </span>
        ))}
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -top-1 left-0 w-px bg-primary shadow-[0_0_12px_#8ee9a6]" data-diagram-playhead />
      </div>
      <div className="mt-3 flex items-center gap-3 px-1">
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/12">
          <span className="absolute inset-y-0 left-0 w-[58%] rounded-full bg-primary/70" />
        </span>
        <span aria-hidden="true" className="flex h-4 items-end gap-[3px]">
          {[7, 12, 9, 16, 11, 14, 8].map((height, index) => <span className="w-[2px] rounded-full bg-white/35" key={index} style={{ height }} />)}
        </span>
      </div>
      <span className="mt-3 block truncate rounded-lg bg-white/[.06] px-3 py-2 text-[11px] text-white/65 ring-1 ring-white/10">{caption}</span>
    </div>
  );
}

// —— Hero：一个想法 + 多条真实参考视频 → 世界观概念关系 → 真实帧时间线成片 ——
export function CreationFlowDiagram({ images = [] }: { images?: string[] }) {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const media = images.filter(Boolean);
  const videos = [media[0], media[1], media[2]];
  const platforms = ["TikTok", "Reels", "Shorts"];
  const durations = ["00:12", "00:24", "00:08"];
  const nodes: WorldNode[] = [
    { label: t("marketing", locale, "worlds.consistency.character"), src: media[3] ?? media[0], gradient: FALLBACK_GRADIENTS[0], position: "left-0 top-0" },
    { label: t("marketing", locale, "worlds.consistency.story"), src: media[4] ?? media[1], gradient: FALLBACK_GRADIENTS[2], position: "right-0 top-0" },
    { label: t("marketing", locale, "worlds.consistency.style"), src: media[5] ?? media[2], gradient: FALLBACK_GRADIENTS[3], position: "bottom-0 left-0" },
    { label: t("marketing", locale, "worlds.consistency.scenes"), src: media[0], gradient: FALLBACK_GRADIENTS[4], position: "bottom-0 right-0" },
  ];
  const build = useStableBuild((q, motion) => {
    const trackWidth = () => {
      const track = q("[data-diagram-timeline]")[0] as HTMLElement | undefined;
      return Math.max((track?.clientWidth ?? 300) - 6, 90);
    };
    // 入场只播放一次并保留；光标单独循环，避免整体反复出现/消失。
    const sweep = motion
      ? gsap.to(q("[data-diagram-playhead]"), { x: trackWidth, duration: 3, ease: "none", repeat: -1, repeatDelay: 0.7, paused: true })
      : null;
    return gsap.timeline({ defaults: { ease: "power2.out" }, onComplete: () => { if (motion) sweep?.play(); } })
      .fromTo(q("[data-diagram-input]"), { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.14 })
      .fromTo(q("[data-diagram-agent]"), { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.36, ease: "back.out(2.2)" }, "-=0.1")
      .fromTo(q("[data-diagram-world]"), { autoAlpha: 0, scale: 0.96 }, { autoAlpha: 1, scale: 1, duration: 0.45 }, "-=0.05")
      .fromTo(q("[data-diagram-world-link]"), { strokeDashoffset: 90 }, { strokeDashoffset: 0, duration: 0.6, stagger: 0.1, ease: "power1.out" }, "-=0.35")
      .fromTo(q("[data-diagram-facet]"), { autoAlpha: 0, scale: 0.62 }, { autoAlpha: 1, scale: 1, duration: 0.34, stagger: 0.1, ease: "back.out(1.9)" }, "-=0.45")
      .fromTo(q("[data-diagram-output]"), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.5 }, "-=0.05")
      .fromTo(q("[data-diagram-clip]"), { autoAlpha: 0, scaleX: 0.12 }, { autoAlpha: 1, scaleX: 1, transformOrigin: "left center", duration: 0.4, stagger: 0.09 }, "-=0.28")
      .set(q("[data-diagram-playhead]"), { x: 0 })
      .to(q("[data-diagram-pulse]"), { scale: 2.2, autoAlpha: 0, duration: 0.9, stagger: 0.5, repeat: 1 }, "-=0.1")
      .set(q("[data-diagram-pulse]"), { scale: 0.6, autoAlpha: 0.75 });
  });
  useDiagramMotion(ref, build);
  return (
    <div className="relative" ref={ref}>
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
      {/* 输入：一个想法 + 多条真实参考视频 */}
      <div className="grid gap-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div data-diagram-input>
          <p className="text-[11px] font-medium tracking-[.14em] text-white/45">{t("marketing", locale, "flow.idea")}</p>
          <p className="mt-2 max-w-[12rem] text-lg font-medium leading-6 text-white/90">{t("marketing", locale, "flow.ideaText")}</p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:items-end">
          <p className="text-[11px] font-medium tracking-[.14em] text-white/45 sm:pr-3">{t("marketing", locale, "flow.reference")}</p>
          <div className="flex items-center justify-center gap-2.5 px-3 sm:pr-1">
            {videos.map((src, index) => (
              <span className={`${index === 0 ? "-rotate-3" : index === 2 ? "rotate-3" : ""} ${index === 1 ? "-translate-y-1.5" : "translate-y-1"}`} data-diagram-input key={index}>
                <MediaTile badge={platforms[index]} className="aspect-[9/16] w-[5.5rem]" duration={durations[index]} gradient={FALLBACK_GRADIENTS[index]} rounded="rounded-[1.1rem]" src={src} />
              </span>
            ))}
          </div>
        </div>
      </div>
      <FlowLine label={t("marketing", locale, "flow.agent")} />
      <WorldOrb nodes={nodes} />
      <FlowLine />
      <TimelineStrip caption={t("marketing", locale, "flow.ideaText")} images={media} label={t("marketing", locale, "flow.output")} />
    </div>
  );
}

// —— 复刻爆款：参考 → 拆解 → 你的版本 ——
export function CloneFlowDiagram() {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const analysis = ["clone.analysis1", "clone.analysis2", "clone.analysis3", "clone.analysis4", "clone.analysis5", "clone.analysis6", "clone.analysis7"];
  const version = ["clone.version1", "clone.version2", "clone.version3", "clone.version4", "clone.version5"];
  const build = useStableBuild((q) => gsap.timeline({ repeat: -1, repeatDelay: 3, defaults: { ease: "power2.out" } })
    .fromTo(q("[data-clone-reference]"), { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: 0.5 })
    .fromTo(q("[data-clone-analysis]"), { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.34, stagger: 0.09 }, "-=0.15")
    .fromTo(q("[data-clone-version]"), { autoAlpha: 0, x: 14 }, { autoAlpha: 1, x: 0, duration: 0.34, stagger: 0.1 }, "-=0.45")
    .fromTo(q("[data-clone-arrow]"), { scaleX: 0 }, { scaleX: 1, duration: 0.35, stagger: 0.15, transformOrigin: "left center" }, 0.1));
  useDiagramMotion(ref, build);
  return (
    <div className="relative grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center" ref={ref}>
      <Panel data-clone-reference>
        <PanelLabel>{t("marketing", locale, "clone.referenceLabel")}</PanelLabel>
        <div className="mt-3"><MediaTile className="h-20 w-28" duration="00:18" gradient={FALLBACK_GRADIENTS[0]} label="REF" /></div>
        <p className="mt-3 text-xs leading-5 text-white/55">{t("marketing", locale, "clone.referenceHint")}</p>
      </Panel>
      <span aria-hidden="true" className="marketing-clone-arrow hidden h-px w-8 bg-gradient-to-r from-primary/60 to-primary/10 md:block" data-clone-arrow />
      <Panel tone="accent">
        <PanelLabel accent>{t("marketing", locale, "clone.analysisLabel")}</PanelLabel>
        <ul className="mt-3 grid gap-1.5">
          {analysis.map((key) => <li className="inline-flex items-center gap-2 text-xs text-white/75" data-clone-analysis key={key}><Check />{t("marketing", locale, key)}</li>)}
        </ul>
      </Panel>
      <span aria-hidden="true" className="marketing-clone-arrow hidden h-px w-8 bg-gradient-to-r from-primary/60 to-primary/10 md:block" data-clone-arrow />
      <Panel>
        <PanelLabel>{t("marketing", locale, "clone.versionLabel")}</PanelLabel>
        <ul className="mt-3 grid gap-1.5">
          {version.map((key) => <li className="inline-flex items-center gap-2 text-xs text-white/75" data-clone-version key={key}><span className="size-1.5 rounded-full bg-primary" />{t("marketing", locale, key)}</li>)}
        </ul>
      </Panel>
      {/* 移动端竖向连接线 */}
      <span aria-hidden="true" className="absolute inset-y-4 left-1/2 -z-10 w-px bg-gradient-to-b from-primary/10 via-primary/40 to-primary/10 md:hidden" />
    </div>
  );
}

// —— AI 全自动：你 → 四类 Agent → 等你审阅 ——
export function AgentPipelineDiagram() {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const steps = [
    ["agent.researchTitle", "agent.researchBody"],
    ["agent.writerTitle", "agent.writerBody"],
    ["agent.directorTitle", "agent.directorBody"],
    ["agent.editorTitle", "agent.editorBody"],
  ] as const;
  const build = useStableBuild((q) => gsap.timeline({ repeat: -1, repeatDelay: 3.2, defaults: { ease: "power2.out" } })
    .fromTo(q("[data-agent-you]"), { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 0.45 })
    .fromTo(q("[data-agent-step]"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.34, stagger: 0.16 }, "-=0.1")
    .fromTo(q("[data-agent-check]"), { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.28, stagger: 0.16, ease: "back.out(2.4)" }, "-=0.55")
    .fromTo(q("[data-agent-ready]"), { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: "back.out(1.8)" }, "-=0.2"));
  useDiagramMotion(ref, build);
  return (
    <div className="rounded-2xl border border-white/12 bg-[linear-gradient(160deg,rgba(255,255,255,.05),rgba(255,255,255,.012))] p-4 backdrop-blur sm:p-5" ref={ref}>
      <div className="flex items-center gap-3 rounded-xl border border-white/12 bg-black/25 p-3" data-agent-you>
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/20 bg-white/[.06] font-mono text-[9px] font-semibold text-white/70">{t("marketing", locale, "agent.youLabel")}</span>
        <p className="text-sm leading-6 text-white/80">{t("marketing", locale, "agent.prompt")}</p>
      </div>
      <div className="relative mt-3 grid gap-2 pl-4">
        <span aria-hidden="true" className="absolute bottom-4 left-0 top-0 w-px bg-gradient-to-b from-primary/55 via-primary/30 to-transparent" />
        {steps.map(([titleKey, bodyKey]) => (
          <div className="relative flex items-center justify-between gap-3 rounded-xl border border-white/12 bg-black/25 p-3" data-agent-step key={titleKey}>
            <span aria-hidden="true" className="absolute -left-4 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary/70" />
            <div>
              <p className="text-sm font-semibold text-white/85">{t("marketing", locale, titleKey)}</p>
              <p className="mt-0.5 text-xs text-white/50">{t("marketing", locale, bodyKey)}</p>
            </div>
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-primary/35 bg-primary/10" data-agent-check><Check /></span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/[.08] px-4 py-3" data-agent-ready>
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[.16em] text-primary">{t("marketing", locale, "agent.ready")}</span>
      </div>
    </div>
  );
}

// —— 一个想法，多条视频 ——
export function BatchDiagram() {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const platforms = ["batch.platform1", "batch.platform2", "batch.platform3"];
  const stats = ["batch.stat1", "batch.stat2", "batch.stat3", "batch.stat4"];
  const build = useStableBuild((q) => gsap.timeline({ repeat: -1, repeatDelay: 3.4, defaults: { ease: "power2.out" } })
    .fromTo(q("[data-batch-idea]"), { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1, duration: 0.45 })
    .fromTo(q("[data-batch-platform]"), { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.12 }, "-=0.1")
    .fromTo(q("[data-batch-stat]"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.32, stagger: 0.12 }, "-=0.05"));
  useDiagramMotion(ref, build);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[linear-gradient(160deg,rgba(255,255,255,.05),rgba(255,255,255,.012))] p-4 backdrop-blur sm:p-6" ref={ref}>
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-40 w-40 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative mx-auto flex w-fit items-center gap-3 rounded-xl border border-primary/30 bg-primary/[.08] px-4 py-2.5" data-batch-idea>
        <span className="grid size-6 place-items-center rounded-full border border-primary/40 bg-primary/15 text-[10px] text-primary">1</span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[.16em] text-primary">{t("marketing", locale, "batch.ideaLabel")}</span>
      </div>
      <div aria-hidden="true" className="relative mx-auto h-9 w-px bg-gradient-to-b from-primary/55 to-primary/10" />
      <div className="grid grid-cols-3 gap-2.5">
        {platforms.map((key) => <div className="rounded-xl border border-white/12 bg-black/25 px-3 py-3 text-center" data-batch-platform key={key}><span className="text-xs font-medium text-white/75">{t("marketing", locale, key)}</span></div>)}
      </div>
      <div aria-hidden="true" className="relative mx-auto h-9 w-px bg-gradient-to-b from-primary/55 to-primary/10" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {stats.map((key) => <div className="rounded-xl border border-primary/20 bg-primary/[.06] px-3 py-3 text-center" data-batch-stat key={key}><span className="font-mono text-[11px] font-semibold text-primary">{t("marketing", locale, key)}</span></div>)}
      </div>
    </div>
  );
}

// —— 世界观：一次定义，持续一致 ——
export function ConsistencyDiagram() {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const facets = ["worlds.consistency.character", "worlds.consistency.story", "worlds.consistency.style", "worlds.consistency.scenes", "worlds.consistency.voice", "worlds.consistency.rules"];
  const build = useStableBuild((q) => gsap.timeline({ repeat: -1, repeatDelay: 3.4, defaults: { ease: "power2.out" } })
    .fromTo(q("[data-world-facet]"), { autoAlpha: 0, scale: 0.82 }, { autoAlpha: 1, scale: 1, duration: 0.3, stagger: 0.09, ease: "back.out(1.7)" })
    .fromTo(q("[data-world-arrow]"), { scaleY: 0 }, { scaleY: 1, duration: 0.35, transformOrigin: "top center" }, "-=0.1")
    .fromTo(q("[data-world-output]"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.34, stagger: 0.12 }, "-=0.05"));
  useDiagramMotion(ref, build);
  return (
    <div className="rounded-2xl border border-white/12 bg-[linear-gradient(160deg,rgba(255,255,255,.05),rgba(255,255,255,.012))] p-4 backdrop-blur sm:p-5" ref={ref}>
      <div className="rounded-xl border border-primary/30 bg-primary/[.07] p-4">
        <PanelLabel accent>WORLD</PanelLabel>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {facets.map((key) => <span className="rounded-lg border border-white/12 bg-black/25 px-2.5 py-2 text-center text-[11px] font-medium text-white/75" data-world-facet key={key}>{t("marketing", locale, key)}</span>)}
        </div>
      </div>
      <div className="relative mx-auto my-3 h-8 w-px bg-gradient-to-b from-primary/55 to-primary/15" data-world-arrow />
      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((index) => (
          <div className="overflow-hidden rounded-lg border border-white/12 bg-black/25" data-world-output key={index}>
            <div className="h-14 bg-[linear-gradient(135deg,#22322c,#0f1917)]" />
            <p className="border-t border-white/10 px-2 py-1.5 font-mono text-[9px] text-white/50">{t("marketing", locale, "worlds.consistency.output")} {String(index).padStart(2, "0")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// —— 为你所有：开源 + 本地 + 可扩展 + 你的模型 + 你的工作流 ——
export function OwnershipDiagram() {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const facets = ["ownership.openSource", "ownership.local", "ownership.extensible", "ownership.models", "ownership.workflows"];
  const build = useStableBuild((q) => gsap.timeline({ repeat: -1, repeatDelay: 3.6, defaults: { ease: "power2.out" } })
    .fromTo(q("[data-ownership-facet]"), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.32, stagger: 0.1 })
    .fromTo(q("[data-ownership-core]"), { autoAlpha: 0, scale: 0.85 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: "back.out(1.8)" }, "-=0.25"));
  useDiagramMotion(ref, build);
  return (
    <div className="grid gap-3 sm:grid-cols-2" ref={ref}>
      <div className="grid content-start gap-2">
        {facets.map((key) => (
          <div className="flex items-center gap-2 rounded-xl border border-white/12 bg-black/25 px-3 py-2.5" data-ownership-facet key={key}>
            <Check />
            <span className="text-xs font-medium text-white/75">{t("marketing", locale, key)}</span>
          </div>
        ))}
      </div>
      <div className="grid place-items-center rounded-xl border border-primary/30 bg-primary/[.07] p-5 text-center" data-ownership-core>
        <div>
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">R</span>
          <p className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-[.16em] text-primary">{t("marketing", locale, "product.title1")}</p>
        </div>
      </div>
    </div>
  );
}
