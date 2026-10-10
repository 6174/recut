/*
 * [INPUT]: 依赖 lib/i18n 逐语言文案（story.beatN.* / 输入标签 / 平台标签）、marketing-site 的 locale 上下文、marketing-world-stage 的 3D 舞台、GSAP 入场
 * [OUTPUT]: 对外提供 MarketingWorldHero——首页第一区块「栏目/生产线」：超大 flat 标题 + 解释按 beat 轮播（首条为 SSR/SEO 默认），中心 3D 舞台（输入 → 沉淀 → 成片）保持不变
 * [POS]: web/components 的官网首页首屏；只讲「把一个栏目做成一条持续产出的生产线」这一个核心故事，不读取工作台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { t } from "@/lib/i18n";
import { useMarketingLocale } from "@/components/marketing-site";
import { MarketingWorldStage } from "@/components/marketing-world-stage";

const INPUT_KEYS = ["story.input.document", "story.input.video", "story.input.article", "story.input.account"];
const PLATFORM_KEYS = ["story.platform.youtube", "story.platform.tiktok", "story.platform.xiaohongshu"];
/** 首屏轮播：每条 beat = 标题两行 + 一句解释；首条即默认（SSR / SEO 用第一条）。 */
const BEAT_KEYS = [
  { title1: "story.beat1.title1", title2: "story.beat1.title2", tagline: "story.beat1.tagline" },
  { title1: "story.beat2.title1", title2: "story.beat2.title2", tagline: "story.beat2.tagline" },
  { title1: "story.beat3.title1", title2: "story.beat3.title2", tagline: "story.beat3.tagline" },
  { title1: "story.beat4.title1", title2: "story.beat4.title2", tagline: "story.beat4.tagline" },
];
const ROTATE_MS = 6500;

export function MarketingWorldHero({ posters = [] }: { posters?: string[] }) {
  const locale = useMarketingLocale();
  const rootRef = useRef<HTMLElement>(null);
  const [beatIndex, setBeatIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const labels = INPUT_KEYS.map((key) => t("marketing", locale, key));
  const platforms = PLATFORM_KEYS.map((key) => t("marketing", locale, key));
  const beats = BEAT_KEYS.map((keys) => ({
    title1: t("marketing", locale, keys.title1),
    title2: t("marketing", locale, keys.title2),
    tagline: t("marketing", locale, keys.tagline),
  }));
  const beat = beats[beatIndex] ?? beats[0];

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // 自动轮播；hover 暂停，减少动态效果时停在首条。
  useEffect(() => {
    if (reducedMotion || paused || beats.length < 2) return;
    const timer = window.setInterval(() => setBeatIndex((index) => (index + 1) % beats.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [reducedMotion, paused, beats.length]);

  // 舞台只在挂载时入场一次；文案随 beat 轮播每次都重放。
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        gsap.utils.selector(root)("[data-story-stage]"),
        { autoAlpha: 0, scale: 0.97 },
        { autoAlpha: 1, scale: 1, duration: 1, delay: 0.22, ease: "power2.out" },
      );
    }, root);
    return () => context.revert();
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      const q = gsap.utils.selector(root);
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .fromTo(q("[data-story-line]"), { autoAlpha: 0, y: 36, filter: "blur(14px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.74, stagger: 0.1 })
        .fromTo(q("[data-story-body]"), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.52 }, "-=0.24");
    }, root);
    return () => context.revert();
  }, [beatIndex]);

  return (
    <section
      className="marketing-story relative isolate overflow-hidden border-b border-white/10 bg-[oklch(0.07_0.01_150)] text-white"
      id="world"
      ref={rootRef}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-24 size-[34rem] rounded-full bg-primary/[.08] blur-[130px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 top-40 size-[30rem] rounded-full bg-[oklch(0.7_0.12_268)]/[.07] blur-[130px]" />

      <div className="relative z-10 mx-auto max-w-6xl px-5 pt-36 text-center sm:px-8 sm:pt-52">
        <h1 className="marketing-display text-[clamp(2.75rem,7.4vw,6.25rem)] font-semibold leading-[1.02]">
          <span className="block" data-story-line>{beat.title1}</span>
          <span className="marketing-story-accent block" data-story-line>{beat.title2}</span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-white/60 sm:text-lg" data-story-body aria-live={paused ? "polite" : "off"}>{beat.tagline}</p>
      </div>

      <div className="relative mt-12 h-[clamp(18rem,44vw,32rem)] w-full" data-story-stage>
        <MarketingWorldStage labels={labels} platforms={platforms} posters={posters} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[oklch(0.07_0.01_150)] to-transparent" />
      </div>
    </section>
  );
}
