/*
 * [INPUT]: 依赖 Next.js 浏览器路由与客户端导航
 * [OUTPUT]: 对外提供 /projects 旧深链到首页 Home 的客户端重定向
 * [POS]: web/app/projects 的兼容路由壳；项目桌面已并入 Home Tab，项目详情 [id] 仍保持原路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ProjectsPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return null;
}
