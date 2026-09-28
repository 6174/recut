/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /community/worlds 社区世界分区深链（平台精选 PGC Worlds）
 * [POS]: web/app/community 的世界分区壳；只展示平台目录，世界详情 /worlds/[worldID] 保持原路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../../page";

export default function CommunityWorldsPage() {
  return <Workspace communitySection="worlds" initialTab="community" />;
}
