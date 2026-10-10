/*
 * [INPUT]: 依赖 lucide 图标与 scenarios 的 Scenario/字段构造器
 * [OUTPUT]: 场景「做一期栏目内容」的自包含声明（图标 / 双语标题·说明·提示词 / 表单字段，含可选栏目 World）
 * [POS]: web/lib/scenarios/scenarios 的需求场景之一；对应 GTM 人群 A「主题 → 成片」并可选沿用已有栏目 World；仅被 index.ts 汇总
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Clapperboard } from "lucide-react";

import { assetsField, durationField, platformField, worldField, type Scenario } from "../types";

export const seriesEpisode: Scenario = {
  id: "series-episode",
  icon: Clapperboard,
  title: { zh: "做一期栏目内容", en: "Make an episode of your series" },
  description: { zh: "沿用你栏目的格式与素材，做一期新的内容。", en: "Reuse your series' format and assets to produce a new episode." },
  prompt: {
    zh: "请根据我提供的主题做一期栏目内容：先梳理脚本与要点，再输出分镜、旁白和画面生成，最终产出一条可编辑的成片。如果我指定了栏目 World，请沿用它的格式、角色与素材。",
    en: "Produce one episode of my series from the topic I provide: first map the script and key points, then produce the storyboard, narration and visuals, ending in an editable cut. If I selected a series World, reuse its format, characters and assets.",
  },
  fields: [
    { key: "topic", type: "textarea", required: true, label: { zh: "这期的主题", en: "Episode topic" }, placeholder: { zh: "这期讲什么、要传达哪些要点…", en: "What this episode covers and the points to convey…" } },
    worldField(),
    platformField(),
    durationField(),
    assetsField("参考素材", "Source material", ["video", "image"]),
  ],
};
