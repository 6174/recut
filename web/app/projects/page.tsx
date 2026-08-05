/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 Projects 独立工作台入口
 * [POS]: web/app/projects 的目录路由壳；项目列表与创建入口独立于 Studio，项目详情 [id] 仍保持原路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function ProjectsPage() {
  return <Workspace initialTab="projects" />;
}
