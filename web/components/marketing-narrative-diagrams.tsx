/*
 * [INPUT]: 依赖 marketing-site 的 useMarketingLocale 上下文、lib/i18n 的 t() 字典、lucide-react 图标与 GSAP；所有文案走 flow/create/clone/agent/batch/worlds.consistency/ownership 命名空间，本文件不硬编码语言；每张图接收真实图片（World 封面/角色图，缺省回退渐变占位）
 * [OUTPUT]: 对外提供官网叙事的六张「抽象结构 + 真实媒体」示意，入场只播一次：CreationFlowDiagram（想法 + 真实竖屏视频 → 世界观概念关系 → 真实帧时间线，仅播放头循环）、CloneFlowDiagram（参考视频 → 真实帧分镜拆解 → 你的成片）、AgentPipelineDiagram（你 → 研究/编剧/导演/剪辑四节点 → 待审阅）、BatchDiagram（一个想法 → 多平台多格式成片墙）、ConsistencyDiagram（同一角色/风格 → 四条一致成片）、OwnershipDiagram（本机媒体墙 + 开源/本地/可扩展/你的模型/你的工作流）
 * [POS]: web/components 的官网「先展示结果、再解释技术」视觉层；全部用浮层圆角媒体块 + 极细连线 + 光晕，不画 Mock App 边框与假面板，尊重 prefers-reduced-motion 且卸载时完整清理动画
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { Clapperboard, Code, Cpu, HardDrive, PenLine, Puzzle, Scissors, Search, Workflow } from "lucide-react";
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

function MediaFrame({ className = "", gradient, rounded = "rounded-lg", src }: { className?: string; gradient?: string; rounded?: string; src?: string }) {
  return (
    <span className={`relative block overflow-hidden ${rounded} ring-1 ring-white/12 ${className}`}>
      {src
        ? <img alt="" className="absolute inset-0 size-full object-cover" draggable={false} loading="lazy" src={src} />
        : <span className="absolute inset-0" style={{ background: gradient ?? FALLBACK_GRADIENTS[0] }} />}
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
    </span>
  );
}

function FlowArrow({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`items-center gap-0.5 ${className}`}>
      <span className="h-px w-8 bg-gradient-to-r from-primary/45 to-primary/15" />
      <svg className="size-3 text-primary/70" fill="none" viewBox="0 0 12 12"><path d="M4 2.5 8 6l-4 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
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

// —— 复刻爆款：真实参考视频 → 真实帧分镜拆解 → 你的成片 ——
export function CloneFlowDiagram({ images = [] }: { images?: string[] }) {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const media = images.filter(Boolean);
  const at = (index: number) => media[index % Math.max(media.length, 1)];
  const analysis = ["clone.analysis1", "clone.analysis2", "clone.analysis3", "clone.analysis4", "clone.analysis5", "clone.analysis6"];
  const version = ["clone.version1", "clone.version2", "clone.version3", "clone.version4"];
  const build = useStableBuild((q) => gsap.timeline({ defaults: { ease: "power2.out" } })
    .fromTo(q("[data-clone-block]"), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.16 })
    .fromTo(q("[data-clone-frame]"), { autoAlpha: 0, scale: 0.86 }, { autoAlpha: 1, scale: 1, duration: 0.32, stagger: 0.08, ease: "back.out(1.6)" }, "-=0.4")
    .fromTo(q("[data-clone-version]"), { autoAlpha: 0, scale: 0.82 }, { autoAlpha: 1, scale: 1, duration: 0.34, stagger: 0.1, ease: "back.out(1.8)" }, "-=0.2"));
  useDiagramMotion(ref, build);
  return (
    <div className="relative grid items-center gap-8 md:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] md:gap-4" ref={ref}>
      {/* 参考视频 */}
      <div className="flex flex-col items-center gap-3" data-clone-block>
        <p className="text-[11px] font-medium tracking-[.14em] text-white/45">{t("marketing", locale, "clone.referenceLabel")}</p>
        <MediaTile badge="TikTok" className="aspect-[9/16] w-28" duration="00:18" gradient={FALLBACK_GRADIENTS[0]} rounded="rounded-[1.1rem]" src={media[0]} />
        <p className="text-[11px] text-white/45">{t("marketing", locale, "clone.referenceHint")}</p>
      </div>
      <FlowArrow className="hidden md:flex" />
      {/* AI 拆解：一条参考视频被拆成可复用的真实帧分镜 */}
      <div data-clone-block>
        <p className="text-[11px] font-medium tracking-[.14em] text-white/45">{t("marketing", locale, "clone.analysisLabel")}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-2.5">
          {analysis.map((key, index) => (
            <figure data-clone-frame key={key}>
              <MediaFrame className="aspect-video" gradient={FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length]} src={at(index + 1)} />
              <figcaption className="mt-1 text-[10px] text-white/55">{t("marketing", locale, key)}</figcaption>
            </figure>
          ))}
        </div>
      </div>
      <FlowArrow className="hidden md:flex" />
      {/* 你的成片 */}
      <div className="flex flex-col items-center gap-3" data-clone-block>
        <p className="text-[11px] font-medium tracking-[.14em] text-white/45">{t("marketing", locale, "clone.versionLabel")}</p>
        <div className="flex gap-2.5">
          {[at(2), at(3)].map((src, index) => (
            <span data-clone-version key={index}>
              <MediaTile badge={index === 0 ? "Reels" : "Shorts"} className="aspect-[9/16] w-24" gradient={FALLBACK_GRADIENTS[index + 2]} rounded="rounded-[1.1rem]" src={src} />
            </span>
          ))}
        </div>
        <div className="flex max-w-[11rem] flex-wrap justify-center gap-1.5">
          {version.map((key) => <span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-white/55 ring-1 ring-white/10" key={key}>{t("marketing", locale, key)}</span>)}
        </div>
      </div>
      <span aria-hidden="true" className="absolute inset-y-6 left-1/2 -z-10 w-px bg-gradient-to-b from-primary/10 via-primary/35 to-primary/10 md:hidden" />
    </div>
  );
}

// —— AI 全自动：你 → 研究/编剧/导演/剪辑四个真实画面节点 → 待审阅 ——
export function AgentPipelineDiagram({ images = [] }: { images?: string[] }) {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const media = images.filter(Boolean);
  const steps = [
    { title: "agent.researchTitle", body: "agent.researchBody", Icon: Search },
    { title: "agent.writerTitle", body: "agent.writerBody", Icon: PenLine },
    { title: "agent.directorTitle", body: "agent.directorBody", Icon: Clapperboard },
    { title: "agent.editorTitle", body: "agent.editorBody", Icon: Scissors },
  ] as const;
  const build = useStableBuild((q) => gsap.timeline({ defaults: { ease: "power2.out" } })
    .fromTo(q("[data-agent-you]"), { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 0.45 })
    .fromTo(q("[data-agent-step]"), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.14 }, "-=0.15")
    .fromTo(q("[data-agent-ready]"), { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: "back.out(1.8)" }, "-=0.15"));
  useDiagramMotion(ref, build);
  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-3" data-agent-you>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[.06] font-mono text-[10px] font-semibold text-white/70 ring-1 ring-white/12">{t("marketing", locale, "agent.youLabel")}</span>
        <p className="rounded-2xl bg-white/[.05] px-4 py-2.5 text-sm leading-6 text-white/85 ring-1 ring-white/10">{t("marketing", locale, "agent.prompt")}</p>
      </div>
      <div className="relative mt-9 grid grid-cols-4 gap-3">
        <span aria-hidden="true" className="absolute left-[12%] right-[12%] top-7 h-px bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10" />
        {steps.map(({ title, body, Icon }, index) => (
          <div className="relative flex flex-col items-center gap-2 text-center" data-agent-step key={title}>
            <span className="relative size-14 overflow-hidden rounded-2xl shadow-[0_16px_34px_-16px_rgba(0,0,0,.9)] ring-1 ring-white/15">
              {media[index]
                ? <img alt="" className="absolute inset-0 size-full object-cover" draggable={false} loading="lazy" src={media[index]} />
                : <span className="absolute inset-0" style={{ background: FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length] }} />}
              <span className="absolute inset-0 grid place-items-center bg-black/40"><Icon className="size-5 text-white/90" /></span>
            </span>
            <span className="text-xs font-semibold text-white/85">{t("marketing", locale, title)}</span>
            <span className="text-[10px] leading-4 text-white/45">{t("marketing", locale, body)}</span>
          </div>
        ))}
      </div>
      <div className="mt-8 flex items-center justify-center" data-agent-ready>
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/12 px-4 py-2 ring-1 ring-primary/30">
          <Check />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[.16em] text-primary">{t("marketing", locale, "agent.ready")}</span>
        </span>
      </div>
    </div>
  );
}

// 无限画布：真实实体卡（角色/场景/风格/故事）铺在点阵画布上，用语义关系虚线相连。
function WorldCanvasDiagram({ images }: { images: string[] }) {
  const locale = useMarketingLocale();
  const at = (index: number) => images[index % Math.max(images.length, 1)];
  const cards = [
    { label: "worlds.consistency.character", position: "left-[4%] top-[12%]", width: "w-[24%]" },
    { label: "worlds.consistency.scenes", position: "right-[4%] top-[6%]", width: "w-[27%]" },
    { label: "worlds.consistency.style", position: "left-[10%] bottom-[12%]", width: "w-[21%]" },
    { label: "worlds.consistency.story", position: "right-[10%] bottom-[8%]", width: "w-[24%]" },
  ];
  const links: Array<[number, number]> = [[0, 1], [0, 2], [1, 3], [2, 3]];
  const centers: Array<[number, number]> = [[16, 27], [82, 22], [22, 74], [78, 78]];
  return (
    <div className="relative overflow-hidden rounded-3xl bg-[oklch(0.115_0.012_150)] ring-1 ring-white/10">
      <div aria-hidden="true" className="absolute inset-0 opacity-50" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.14) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_38%,rgba(0,0,0,.5))]" />
      <div className="relative h-[330px]">
        <svg aria-hidden="true" className="absolute inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 100 100">
          {links.map(([from, to]) => <path d={`M${centers[from][0]} ${centers[from][1]} L${centers[to][0]} ${centers[to][1]}`} data-canvas-link key={`${from}-${to}`} stroke="rgba(255,255,255,.2)" strokeDasharray="2 3" strokeDashoffset="60" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />)}
        </svg>
        {cards.map(({ label, position, width }, index) => (
          <span className={`absolute ${position} ${width}`} data-canvas-card key={label}>
            <span className="block overflow-hidden rounded-xl bg-card shadow-[0_18px_40px_-20px_rgba(0,0,0,.9)] ring-1 ring-white/12">
              <span className="relative block aspect-video">
                {at(index)
                  ? <img alt="" className="absolute inset-0 size-full object-cover" draggable={false} loading="lazy" src={at(index)} />
                  : <span className="absolute inset-0" style={{ background: FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length] }} />}
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              </span>
              <span className="flex items-center gap-1.5 px-2 py-1.5">
                <span className="size-1.5 rounded-full bg-primary" />
                <span className="truncate text-[10px] font-medium text-white/75">{t("marketing", locale, label)}</span>
              </span>
            </span>
          </span>
        ))}
      </div>
      <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.16em] text-white/60 ring-1 ring-white/10 backdrop-blur">{t("marketing", locale, "worlds.canvas.eyebrow")}</span>
      <span className="absolute bottom-3 right-3 rounded-full bg-black/40 px-2.5 py-1 font-mono text-[9px] text-white/55 ring-1 ring-white/10 backdrop-blur">{t("marketing", locale, "worlds.canvas.hint")}</span>
    </div>
  );
}

// —— World 的长期价值：左侧无限画布承载可长期复用的 World 资产，右侧持续叠出多平台竖屏成片 ——
export function WorldEngineDiagram({ images = [] }: { images?: string[] }) {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const media = images.filter(Boolean);
  const at = (index: number) => media[index % Math.max(media.length, 1)];
  const platforms = [t("marketing", locale, "batch.platform1"), t("marketing", locale, "batch.platform2"), t("marketing", locale, "batch.platform3")];
  const stack = [0, 1, 2, 3, 4, 5];
  const build = useStableBuild((q) => gsap.timeline({ defaults: { ease: "power2.out" } })
    .fromTo(q("[data-world-core]"), { autoAlpha: 0, scale: 0.96 }, { autoAlpha: 1, scale: 1, duration: 0.5 })
    .fromTo(q("[data-canvas-link]"), { strokeDashoffset: 60 }, { strokeDashoffset: 0, duration: 0.5, stagger: 0.08, ease: "power1.out" }, "-=0.3")
    .fromTo(q("[data-canvas-card]"), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.12, ease: "back.out(1.5)" }, "-=0.45")
    .fromTo(q("[data-world-loop]"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, "-=0.1")
    .fromTo(q("[data-world-output]"), { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.42, stagger: 0.08, ease: "back.out(1.4)" }, "-=0.25"));
  useDiagramMotion(ref, build);
  return (
    <div className="grid items-center gap-12 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]" ref={ref}>
      {/* 左：一个概念固化成画布式的可复用 World 资产 */}
      <div>
        <div data-world-core><WorldCanvasDiagram images={media} /></div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.18em] text-white/45" data-world-loop>{t("marketing", locale, "worlds.engine.loop")}</p>
          <span className="rounded-full bg-primary/12 px-2.5 py-1 text-[10px] font-semibold text-primary ring-1 ring-primary/25">{t("marketing", locale, "worlds.engine.asset")}</span>
        </div>
      </div>
      {/* 右：持续叠出的多平台竖屏成片 */}
      <div className="relative mx-auto h-[360px] w-full max-w-lg">
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 size-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
        {stack.map((index) => (
          <span className="absolute w-[27%]" data-world-output key={index} style={{ left: `${index * 11.5}%`, top: index % 2 === 0 ? "16%" : "30%", transform: `rotate(${(index - 2.5) * 4}deg)`, zIndex: index }}>
            <MediaTile badge={platforms[index % platforms.length]} className="aspect-[9/16]" duration={`00:${String(12 + index * 4).padStart(2, "0")}`} gradient={FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length]} rounded="rounded-[1.1rem]" src={at(index)} />
          </span>
        ))}
      </div>
    </div>
  );
}

// —— 为你所有：本机媒体墙 + 开源/本地/可扩展/你的模型/你的工作流 ——
export function OwnershipDiagram({ images = [] }: { images?: string[] }) {
  const locale = useMarketingLocale();
  const ref = useRef<HTMLDivElement>(null);
  const media = images.filter(Boolean);
  const facets = [
    { key: "ownership.openSource", Icon: Code },
    { key: "ownership.local", Icon: HardDrive },
    { key: "ownership.extensible", Icon: Puzzle },
    { key: "ownership.models", Icon: Cpu },
    { key: "ownership.workflows", Icon: Workflow },
  ] as const;
  const build = useStableBuild((q) => gsap.timeline({ defaults: { ease: "power2.out" } })
    .fromTo(q("[data-ownership-core]"), { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: 0.5 })
    .fromTo(q("[data-ownership-facet]"), { autoAlpha: 0, x: 12 }, { autoAlpha: 1, x: 0, duration: 0.34, stagger: 0.1 }, "-=0.3"));
  useDiagramMotion(ref, build);
  return (
    <div className="grid items-center gap-8 md:grid-cols-[1.05fr_0.95fr]" ref={ref}>
      <div className="relative rounded-[1.8rem] p-3 shadow-[0_30px_70px_-30px_rgba(0,0,0,.9)] ring-1 ring-white/12" data-ownership-core style={{ background: "linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.015))" }}>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <MediaFrame className="aspect-video" gradient={FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length]} key={index} src={media[index]} />
          ))}
        </div>
        <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[oklch(0.13_0.012_150)] px-3 py-1 font-mono text-[9px] font-semibold uppercase tracking-[.18em] text-primary ring-1 ring-primary/25">{t("marketing", locale, "ownership.local")}</span>
      </div>
      <div className="grid gap-2.5">
        {facets.map(({ key, Icon }) => (
          <div className="flex items-center gap-3" data-ownership-facet key={key}>
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[.06] text-primary ring-1 ring-white/10"><Icon className="size-4" /></span>
            <span className="text-sm text-white/80">{t("marketing", locale, key)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
