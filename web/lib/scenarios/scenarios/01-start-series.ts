/*
 * [INPUT]: 依赖 lucide 图标与 scenarios 的 Scenario/字段构造器
 * [OUTPUT]: 场景「起一个自己的栏目」的自包含声明（图标 / 双语标题·说明·工作流提示词 / 表单字段）
 * [POS]: web/lib/scenarios/scenarios 的需求场景之一；对应 GTM 核心承诺「一个栏目，持续出片」——把栏目立成一个可复用的「作品（work）」；仅被 index.ts 汇总
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { ListVideo } from "lucide-react";

import { assetsField, type Scenario } from "../types";

export const startSeries: Scenario = {
  id: "start-series",
  icon: ListVideo,
  title: { zh: "起一个自己的栏目", en: "Start your own series" },
  description: { zh: "先把栏目的格式、视觉和素材立成一个可复用的作品，之后每一期都从它出发。", en: "Set your series' format, look and assets up as a reusable work, then start every episode from it." },
  prompt: {
    zh: `我想做一个持续更新的栏目 / 账号，请把它立成一个可复用的「作品（work）」，而不是单独一条视频。

按平台 Skill 的「复用优先」纪律执行：
1. 先查有没有可复用的世界、作品与素材；有就从它继续，没有才新建。
2. 先读 recut-director 定链（story → plan），Plan-first：先给我一份可审阅的栏目方案，确认后再动手。
3. 在该 World 里建一个 work：写清栏目定位与固定格式（开场 / 结构 / 字幕 / 转场 / 配色 / BGM），并把可复用的参考资产备好（片头、字体、配色、BGM、角色与声线）——能复用全局素材就用 assetId 引用，不重复生成。
4. 写 World Canon 前先经我确认。

产物：一个 work 作品 + 一套可复用的栏目规范与参考资产。`,
    en: `I want to run a video series / account that updates continuously — set it up as a reusable "work", not a single video.

Follow the platform skill's "reuse first" discipline:
1. First check for an existing world, work and assets to reuse; continue from them and only create when there is none.
2. Read recut-director to fix the chain (story → plan), and go Plan-first: give me a reviewable series plan before acting.
3. Create one \`work\` in that World: write its positioning and fixed format (opening / structure / captions / transitions / palette / BGM), and prepare the reusable reference assets (intro, fonts, palette, BGM, character and voice) — reference shared assets by assetId instead of regenerating them.
4. Get my confirmation before writing World Canon.

Products: one \`work\` plus a reusable series spec and reference assets.`,
  },
  fields: [
    { key: "topic", type: "textarea", required: true, label: { zh: "栏目主题域", en: "Series topic domain" }, placeholder: { zh: "这个栏目讲什么、给谁看…", en: "What the series covers and for whom…" } },
    { key: "frequency", type: "text", label: { zh: "更新频率", en: "Update cadence" }, placeholder: { zh: "例如：日更、每周两期", en: "e.g. daily, twice a week" } },
    { key: "format", type: "textarea", label: { zh: "想要的固定格式", en: "Desired fixed format" }, placeholder: { zh: "开场、结构、字幕、转场、配色、BGM…", en: "Opening, structure, captions, transitions, palette, BGM…" } },
    assetsField("参考素材", "Reference footage", ["video", "image"]),
  ],
};
