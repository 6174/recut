/*
 * [INPUT]: 依赖 lucide 图标与 scenarios 的 Scenario/字段构造器
 * [OUTPUT]: 场景「复刻一条参考视频」的自包含声明（图标 / 双语标题·说明·提示词 / 表单字段）
 * [POS]: web/lib/scenarios/scenarios 的需求场景之一；对应 GTM 辅助钩子（复刻一条参考视频，拉量）；仅被 index.ts 汇总
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Copy } from "lucide-react";

import { assetsField, durationField, platformField, worldField, type Scenario } from "../types";

export const cloneVideo: Scenario = {
  id: "clone-video",
  icon: Copy,
  title: { zh: "复刻一条参考视频", en: "Remix a reference video" },
  description: { zh: "看懂爆款的结构，换成你的主体再跑一条。", en: "Decode what makes a hit work, then rerun it with your own subject." },
  prompt: {
    zh: "请按 recut-clone 的流程复刻参考视频。先理解它的钩子、节奏、镜头和字幕系统，把可迁移的公式写成计划，再用 AI 剪辑器换成我的主体做成一条新的可编辑视频。",
    en: "Remix the reference video using the recut-clone workflow. First understand its hook, rhythm, shots and caption system, turn the transferable formula into a plan, then use the AI editor to swap in my subject and produce a new editable video.",
  },
  fields: [
    { key: "reference", type: "textarea", required: true, label: { zh: "参考视频链接或素材", en: "Reference video or link" }, placeholder: { zh: "粘贴抖音 / YouTube 链接或本地素材…", en: "Paste a Douyin / YouTube link or local footage…" } },
    { key: "subject", type: "text", required: true, label: { zh: "要替换的主体", en: "Subject to swap in" }, placeholder: { zh: "换成我的…", en: "Swap in my…" } },
    worldField(),
    assetsField("参考素材", "Reference footage", ["video", "image"]),
    platformField(),
    durationField(),
  ],
};
