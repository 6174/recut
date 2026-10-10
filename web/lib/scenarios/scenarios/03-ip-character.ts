/*
 * [INPUT]: 依赖 lucide 图标与 scenarios 的 Scenario/字段构造器
 * [OUTPUT]: 场景「创建一个长期的 IP 角色」的自包含声明（图标 / 双语标题·说明·工作流提示词 / 表单字段）
 * [POS]: web/lib/scenarios/scenarios 的需求场景之一；对应 GTM 人群 B（原创 IP / 固定角色）——把角色立成可复用的 character 实体；仅被 index.ts 汇总
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Sparkles } from "lucide-react";

import { assetsField, type Scenario } from "../types";

export const ipCharacter: Scenario = {
  id: "ip-character",
  icon: Sparkles,
  title: { zh: "创建一个长期的 IP 角色", en: "Create a long-term IP character" },
  description: { zh: "在 World 里立一个可复用的角色，之后每期都用同一个它出演。", en: "Set up a reusable character in a World, and cast the same one in every episode." },
  prompt: {
    zh: `请帮我创建一个可以长期复用的 IP 角色，并让之后每一期都用同一个角色出演。

按平台 Skill 的「复用优先」纪律执行：
1. 先读 recut-director（story → assets），确定这个角色需要哪些锚点（外貌、性格、声音、世界观、参考图、声线）。
2. 在 World 里建一个 character 实体：把设定写进 detail，并挂上 character_reference（定妆图，可多视角）与 voice_reference（声线）。
3. 参考图用 recut.image.generate，以角色设定锚定生成；声线用 recut.media.list_voices 选，或用本机 TTS 生成。
4. 写 World Canon 前先经我确认。

产物：一个可复用的 character 实体（含参考图与声线），供后续每一期锚定。`,
    en: `Help me create a long-term IP character and cast the same character in every episode after this.

Follow the platform skill's "reuse first" discipline:
1. Read recut-director (story → assets) to decide which anchors the character needs (appearance, personality, voice, world, reference images, voice line).
2. Create a \`character\` entity in the World: write the bible into its detail, and attach character_reference (key art, multi-view allowed) and voice_reference.
3. Generate reference images with recut.image.generate anchored on the character brief; pick a voice with recut.media.list_voices or generate one with local TTS.
4. Get my confirmation before writing World Canon.

Products: one reusable \`character\` entity (with reference images and voice) that later episodes anchor on.`,
  },
  fields: [
    { key: "character", type: "textarea", required: true, label: { zh: "角色设定", en: "Character brief" }, placeholder: { zh: "外貌、性格、声音、世界观…", en: "Appearance, personality, voice, world…" } },
    { key: "audience", type: "text", label: { zh: "目标受众", en: "Target audience" }, placeholder: { zh: "例如：年轻职场人", en: "e.g. young professionals" } },
    { key: "usage", type: "text", label: { zh: "使用场景", en: "Use cases" }, placeholder: { zh: "例如：口播、短剧、直播", en: "e.g. talking head, short drama, livestream" } },
    assetsField("角色参考图", "Character reference images", ["image"]),
  ],
};
