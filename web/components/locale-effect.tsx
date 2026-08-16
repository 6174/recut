/*
 * [INPUT]: 依赖 locale-store 的首启探测与 zustand 订阅
 * [OUTPUT]: 客户端挂载时按 navigator.language 初始化工作台语言偏好，并随偏好变化更新 <html lang>；对官网路由无害（官网 [locale] layout 会覆盖自身 lang）
 * [POS]: web/components 的工作台语言副作用；由根布局挂载，工作台单 URL 偏好驱动的 html lang 动态化依赖它
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect } from "react";
import { resolveInitialLocale, useLocaleStore } from "@/lib/i18n/locale-store";

export function LocaleEffect() {
  useEffect(() => {
    useLocaleStore.getState().setLocale(resolveInitialLocale(navigator.language));
    const apply = () => {
      document.documentElement.lang = useLocaleStore.getState().locale;
    };
    apply();
    return useLocaleStore.subscribe(apply);
  }, []);
  return null;
}
