/*
 * [INPUT]: 依赖 lucide 图标与 scenarios 的 Scenario/字段构造器
 * [OUTPUT]: 场景「起一个自己的栏目」的自包含声明（图标 / 双语标题·说明·提示词 / 表单字段）
 * [POS]: web/lib/scenarios/scenarios 的需求场景之一；对应 GTM 核心承诺「一个栏目，持续出片」；仅被 index.ts 汇总
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { ListVideo } from "lucide-react";

import { assetsField, type Scenario } from "../types";

export const startSeries: Scenario = {
  id: "start-series",
  icon: ListVideo,
  title: { zh: "起一个自己的栏目", en: "Start your own series" },
  description: { zh: "先把栏目的格式、视觉和素材立起来，之后每一期都从它出发。", en: "Set up your series' format, look and assets once, then start every episode from it." },
  prompt: {
    zh: "我想做一个持续更新的视频栏目。请先把栏目定下来：内容主题域、固定格式（开场 / 结构 / 字幕 / 转场 / 配色 / BGM）以及需要的角色或素材，并把这套规范沉淀成可复用的资产。之后每一期都用同一套规范产出。",
    en: "I want to run a video series that updates continuously. First define the series: its topic domain, a fixed format (opening / structure / captions / transitions / palette / BGM) and any characters or assets it needs, and save this spec as a reusable asset. Every episode after this uses the same spec.",
  },
  fields: [
    { key: "topic", type: "textarea", required: true, label: { zh: "栏目主题域", en: "Series topic domain" }, placeholder: { zh: "这个栏目讲什么、给谁看…", en: "What the series covers and for whom…" } },
    { key: "frequency", type: "text", label: { zh: "更新频率", en: "Update cadence" }, placeholder: { zh: "例如：日更、每周两期", en: "e.g. daily, twice a week" } },
    { key: "format", type: "textarea", label: { zh: "想要的固定格式", en: "Desired fixed format" }, placeholder: { zh: "开场、结构、字幕、转场、配色、BGM…", en: "Opening, structure, captions, transitions, palette, BGM…" } },
    assetsField("参考素材", "Reference footage", ["video", "image"]),
  ],
};
