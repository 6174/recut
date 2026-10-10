/*
 * [INPUT]: 依赖 lucide 图标与 scenarios 的 Scenario/字段构造器
 * [OUTPUT]: 场景「创建一个长期的 IP 角色」的自包含声明（图标 / 双语标题·说明·提示词 / 表单字段）
 * [POS]: web/lib/scenarios/scenarios 的需求场景之一；对应 GTM 人群 B（原创 IP / 固定角色）；仅被 index.ts 汇总
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Sparkles } from "lucide-react";

import { assetsField, type Scenario } from "../types";

export const ipCharacter: Scenario = {
  id: "ip-character",
  icon: Sparkles,
  title: { zh: "创建一个长期的 IP 角色", en: "Create a long-term IP character" },
  description: { zh: "定下形象、声音和性格，之后每条片子都用它。", en: "Lock in the look, voice and personality, and use it in every video." },
  prompt: {
    zh: "请帮我创建一个可以长期使用的 IP 角色。梳理角色设定（外貌、性格、声音、世界观），在 World Canvas 里建成实体，生成定妆图与参考音，之后每条视频都用这个角色出演。",
    en: "Help me create an IP character I can use long term. Work out the character bible (appearance, personality, voice, world), build the entity in World Canvas, generate the key art and a reference voice, then cast this character in every video.",
  },
  fields: [
    { key: "character", type: "textarea", required: true, label: { zh: "角色设定", en: "Character brief" }, placeholder: { zh: "外貌、性格、声音、世界观…", en: "Appearance, personality, voice, world…" } },
    { key: "audience", type: "text", label: { zh: "目标受众", en: "Target audience" }, placeholder: { zh: "例如：年轻职场人", en: "e.g. young professionals" } },
    { key: "usage", type: "text", label: { zh: "使用场景", en: "Use cases" }, placeholder: { zh: "例如：口播、短剧、直播", en: "e.g. talking head, short drama, livestream" } },
    assetsField("角色参考图", "Character reference images", ["image"]),
  ],
};
