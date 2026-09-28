/*
 * [INPUT]: 依赖 lib/i18n 逐语言文案与输入标签、marketing-site 的 locale 上下文、marketing-world-stage 的 3D 舞台、GSAP 入场
 * [OUTPUT]: 对外提供 MarketingWorldHero——首页第一区块「世界观驱动生成」：超大 flat 标题 + 中心世界观模型 3D 舞台（输入 → 世界观 → 成片）
 * [POS]: web/components 的官网首页首屏；只讲「世界观 + 无限画布驱动生成」这一个核心故事，不读取工作台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { t } from "@/lib/i18n";
import { useMarketingLocale } from "@/components/marketing-site";
import { MarketingWorldStage } from "@/components/marketing-world-stage";

const INPUT_KEYS = ["story.input.document", "story.input.video", "story.input.article", "story.input.account"];
const PLATFORM_KEYS = ["story.platform.youtube", "story.platform.tiktok", "story.platform.xiaohongshu"];

export function MarketingWorldHero({ posters = [] }: { posters?: string[] }) {
  const locale = useMarketingLocale();
  const rootRef = useRef<HTMLElement>(null);
  const labels = INPUT_KEYS.map((key) => t("marketing", locale, key));
  const platforms = PLATFORM_KEYS.map((key) => t("marketing", locale, key));

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      const q = gsap.utils.selector(root);
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .fromTo(q("[data-story-line]"), { autoAlpha: 0, y: 36, filter: "blur(14px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.74, stagger: 0.1 })
        .fromTo(q("[data-story-body]"), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.52 }, "-=0.24")
        .fromTo(q("[data-story-stage]"), { autoAlpha: 0, scale: 0.97 }, { autoAlpha: 1, scale: 1, duration: 1, ease: "power2.out" }, "-=0.26");
    }, root);
    return () => context.revert();
  }, []);

  return (
    <section className="marketing-story relative isolate overflow-hidden border-b border-white/10 bg-[oklch(0.07_0.01_150)] text-white" id="world" ref={rootRef}>
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-24 size-[34rem] rounded-full bg-primary/[.08] blur-[130px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 top-40 size-[30rem] rounded-full bg-[oklch(0.7_0.12_268)]/[.07] blur-[130px]" />

      <div className="relative z-10 mx-auto max-w-6xl px-5 pt-36 text-center sm:px-8 sm:pt-52">
        <h1 className="marketing-display text-[clamp(2.75rem,7.4vw,6.25rem)] font-semibold leading-[1.02]">
          <span className="block" data-story-line>{t("marketing", locale, "story.title1")}</span>
          <span className="marketing-story-accent block" data-story-line>{t("marketing", locale, "story.title2")}</span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-white/60 sm:text-lg" data-story-body>{t("marketing", locale, "story.tagline")}</p>
      </div>

      <div className="relative mt-12 h-[clamp(18rem,44vw,32rem)] w-full" data-story-stage>
        <MarketingWorldStage labels={labels} platforms={platforms} posters={posters} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[oklch(0.07_0.01_150)] to-transparent" />
      </div>
    </section>
  );
}
