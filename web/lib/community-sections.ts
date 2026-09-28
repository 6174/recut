/*
 * [INPUT]: 依赖 lucide-react 图标与工作台 i18n 字典 key
 * [OUTPUT]: 对外提供社区 section 注册表：每个 section 声明 id / 标题与描述 i18n key / 图标 / 路由 / 是否上首页
 * [POS]: web/lib 的社区信息架构单一事实源；社区首页、子导航与后续新增板块都从这里渲染，新增板块只加一条
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Blocks, Globe2, type LucideIcon } from "lucide-react";

export type CommunitySectionId = "apps" | "worlds";

export type CommunitySection = {
  id: CommunitySectionId;
  href: string;
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
  /** 是否在社区首页展示预览分区。 */
  onHome: boolean;
};

export const COMMUNITY_SECTIONS: CommunitySection[] = [
  {
    id: "apps",
    href: "/community/apps",
    icon: Blocks,
    titleKey: "community.section.apps.title",
    descKey: "community.section.apps.desc",
    onHome: true,
  },
  {
    id: "worlds",
    href: "/community/worlds",
    icon: Globe2,
    titleKey: "community.section.worlds.title",
    descKey: "community.section.worlds.desc",
    onHome: true,
  },
];

export function communitySection(id: CommunitySectionId): CommunitySection {
  return COMMUNITY_SECTIONS.find((section) => section.id === id)!;
}
