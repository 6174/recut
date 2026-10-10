/*
 * [INPUT]: 依赖 lucide 图标与 scenarios 的 Scenario/字段构造器
 * [OUTPUT]: 场景「做一期栏目内容」的自包含声明（图标 / 双语标题·说明·工作流提示词 / 表单字段，含可选已有世界）
 * [POS]: web/lib/scenarios/scenarios 的需求场景之一；对应 GTM 人群 A「主题 → 成片」，复用已有作品的规范与资产做新一期；仅被 index.ts 汇总
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
    zh: `在我的作品（栏目）下做一期新的内容。

按平台 Skill 的「复用优先」纪律执行：
1. 复用优先：先读这个作品已有的规范与资产（world.md、世界 identity 的 style / constraints、已有 script 与素材），能沿用就沿用；只补这一期缺的部分。
2. 先读 recut-director 走 story → shot → editing；Plan-first，先给我一份可审阅的一期计划。
3. 落地：生成用 recut.image / video / speech.generate，参考按 role 锚定（character / prop / environment / style-ref / voice）；时间线用 recut.editor.timeline.command，字幕用 subtitle.*，BGM 用 library.browse 或已连接的音乐能力；拿到 assetId 立即落位、不空等。

产物：该 work 下新增一个 script + 分段视频节点 + 一条可编辑时间线；视频由我确认。`,
    en: `Produce a new episode under my series work.

Follow the platform skill's "reuse first" discipline:
1. Reuse first: read the work's existing spec and assets (world.md, the world identity's style / constraints, existing scripts and assets) and carry them over; only add what this episode is missing.
2. Read recut-director for story → shot → editing, and go Plan-first: give me a reviewable episode plan.
3. Build: generate with recut.image / video / speech.generate, anchoring references by role (character / prop / environment / style-ref / voice); assemble the timeline with recut.editor.timeline.command, captions with subtitle.*, BGM via library.browse or a connected music capability; place each assetId the moment it exists.

Products: a new \`script\` under the work + segmented video nodes + an editable timeline; I confirm the video.`,
  },
  fields: [
    { key: "topic", type: "textarea", required: true, label: { zh: "这期的主题", en: "Episode topic" }, placeholder: { zh: "这期讲什么、要传达哪些要点…", en: "What this episode covers and the points to convey…" } },
    worldField(),
    platformField(),
    durationField(),
    assetsField("参考素材", "Source material", ["video", "image"]),
  ],
};
