/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /projects 项目桌面深链
 * [POS]: web/app/projects 的目录路由壳；项目详情 [id] 的上级入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function ProjectsPage() {
  return <Workspace initialTab="projects" />;
}
