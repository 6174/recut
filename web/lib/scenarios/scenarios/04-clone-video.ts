/*
 * [INPUT]: 依赖 lucide 图标与 scenarios 的 Scenario/字段构造器
 * [OUTPUT]: 场景「复刻一条参考视频」的自包含声明（图标 / 双语标题·说明·工作流提示词 / 表单字段，含可选已有世界）
 * [POS]: web/lib/scenarios/scenarios 的需求场景之一；对应 GTM 辅助钩子——读懂参考再换主体重拍一条；仅被 index.ts 汇总
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
    zh: `请复刻这条参考视频，产出我自己的版本。

按 recut-clone 与平台 Skill 的「复用优先」纪律执行：
1. 先读懂参考：用 recut.media.import 引入，probe / contactSheet / frames / boundaries 读它，把它的钩子、节奏、镜头与上屏文案系统写成项目内 reference.md（recut-reference）。
2. 再导演：读 recut-director 的 remix（platform → editing → qc），Plan-first，先给我一份可审阅的计划。
3. 换我的主体生成：以「段 / 场景」为单位连续生成，参考按 role 锚定；用 recut.editor 组装成一条可编辑时间线。
4. 按门槛来：写 Canon 需授权，视频由我确认，导出我在编辑器里点。

产物：一份 reference.md 读法 + 一条换成我主体的可编辑新片。`,
    en: `Remix this reference video into my own version.

Follow the recut-clone workflow and the platform skill's "reuse first" discipline:
1. Understand the reference first: import it with recut.media.import, read it with probe / contactSheet / frames / boundaries, and write its hook, rhythm, shots and on-screen text system into a project \`reference.md\` (recut-reference).
2. Then direct: read recut-director's remix (platform → editing → qc) and go Plan-first with a reviewable plan.
3. Generate with my subject swapped in: generate continuously in "segment / scene" units with role-anchored references, and assemble an editable timeline in recut.editor.
4. Honor the gates: Canon writes need my confirmation, the video is mine to confirm, and export is triggered by me in the editor.

Products: a reference.md reading + an editable new cut with my subject swapped in.`,
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
