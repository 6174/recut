/*
 * [INPUT]: 依赖 Next.js 浏览器路由与客户端导航
 * [OUTPUT]: 对外提供 /apps 旧深链到 /appstore 的客户端重定向
 * [POS]: web/app/apps 的兼容路由壳；应用市场已迁移到 /appstore，详情页 [appID] 仍保持原路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AppsPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/appstore"); }, [router]);
  return null;
}
