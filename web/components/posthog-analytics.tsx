/*
 * [INPUT]: 依赖 next/navigation 路由状态、浏览器 location/referrer、History API 与 posthog-js SDK；PostHog project token
 * [OUTPUT]: 对外提供 Recut 全站 PostHog 埋点骨架：统一初始化（autocapture general 点击 + capture_exceptions 报错）、
 *           `recut_page_viewed` 页面访问（官网/工作台、页面分组、脱敏路由、实体 id、来源/UTM、super properties）、
 *           工作台 History pushState 标签切换的补采，以及供语义事件复用的 trackEvent 工具
 * [POS]: web/components 的全站观测探针；由根布局挂载一次，覆盖 recut.video 官网与 app.recut.video 工作台；iframe App 内部交互不在顶层捕获范围
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import posthog from "posthog-js";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// phc_ 开头是 PostHog 公开客户端 token（可安全嵌入前端）；可用构建环境变量覆盖。
const POSTHOG_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim() || "phc_y5rhSJ4kXL7MoQ5rcn5dd5Wb7WRuaLwwv26rbq9uv99J";
const POSTHOG_DEBUG = process.env.NEXT_PUBLIC_POSTHOG_DEBUG === "true";
const POSTHOG_API_HOST = "https://us.i.posthog.com";
const POSTHOG_DEFAULTS = "2026-05-30";

type PageAnalyticsPayload = {
  site: "marketing" | "app" | "other";
  page_group: string;
  page_path: string;
  page_kind: string;
  entity_id: string;
  entry_source: string;
  entry_source_kind: "source_param" | "utm" | "ref_param" | "referrer" | "direct";
  source_param: string;
  ref_param: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  referrer_host: string;
};

const PATH_PATTERNS: Array<[RegExp, string]> = [
  [/^\/projects\/[^/]+$/, "/projects/[id]"],
  [/^\/worlds\/[^/]+$/, "/worlds/[id]"],
  [/^\/workspace-app\/[^/]+$/, "/workspace-app/[appID]"],
  [/^\/blog\/[^/]+$/, "/blog/[slug]"],
  [/^\/apps\/[^/]+$/, "/apps/[appID]"],
];

export function resolveAnalyticsSite(host: string | undefined): PageAnalyticsPayload["site"] {
  const h = host?.toLowerCase() ?? "";
  if (h === "app.recut.video" || h === "www.app.recut.video" || h === "app.localhost") return "app";
  if (h === "recut.video" || h === "www.recut.video" || h === "localhost") return "marketing";
  return "other";
}

export function sanitizeAnalyticsPath(pathname: string): string {
  for (const [pattern, replacement] of PATH_PATTERNS) {
    if (pattern.test(pathname)) return replacement;
  }
  return pathname || "/";
}

function resolveEntityId(pathname: string, searchParams: URLSearchParams): string {
  const dynamic = [/^\/projects\/([^/]+)$/, /^\/worlds\/([^/]+)$/, /^\/apps\/([^/]+)$/];
  for (const pattern of dynamic) {
    const match = pathname.match(pattern);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }
  if (pathname.startsWith("/workspace-app/")) return readTrimmed(searchParams.get("id"));
  return "";
}

export function resolveAnalyticsPageGroup(pathname: string, site: PageAnalyticsPayload["site"]): string {
  if (site === "app") {
    if (pathname === "/") return "app_studio";
    if (pathname.startsWith("/worlds/")) return "app_world_detail";
    if (pathname.startsWith("/worlds")) return "app_worlds";
    if (pathname.startsWith("/projects/")) return "app_project_detail";
    if (pathname.startsWith("/projects")) return "app_projects";
    if (pathname.startsWith("/media")) return "app_media";
    if (pathname.startsWith("/workspace-app")) return "app_standalone";
    if (pathname.startsWith("/apps/")) return "app_app_detail";
    if (pathname.startsWith("/apps") || pathname.startsWith("/appstore")) return "app_apps";
    return "app";
  }
  if (pathname === "/") return "marketing_home";
  if (pathname.startsWith("/docs")) return "marketing_docs";
  if (pathname.startsWith("/blog")) return "marketing_blog";
  if (pathname.startsWith("/apps")) return "marketing_apps";
  return "other";
}

function resolvePageKind(pathname: string, site: PageAnalyticsPayload["site"]): string {
  if (site === "app") {
    if (pathname === "/") return "studio";
    if (pathname.startsWith("/worlds/")) return "world_detail";
    if (pathname.startsWith("/worlds")) return "worlds_index";
    if (pathname.startsWith("/projects/")) return "project_detail";
    if (pathname.startsWith("/projects")) return "projects_index";
    if (pathname.startsWith("/media")) return "media";
    if (pathname.startsWith("/workspace-app")) return "standalone_app";
    if (pathname.startsWith("/apps/")) return "app_detail";
    if (pathname.startsWith("/apps") || pathname.startsWith("/appstore")) return "apps_index";
    return "page";
  }
  if (pathname === "/") return "marketing_home";
  if (pathname.startsWith("/blog/")) return "blog_detail";
  if (pathname.startsWith("/blog")) return "blog_index";
  if (pathname.startsWith("/apps/")) return "app_detail";
  if (pathname.startsWith("/apps")) return "apps_index";
  if (pathname.startsWith("/docs")) return "docs";
  return "page";
}

function readTrimmed(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function resolveReferrerHost(referrer: string | undefined, currentHost: string | undefined): string {
  if (!referrer) return "";
  try {
    const referrerUrl = new URL(referrer);
    if (currentHost && referrerUrl.host === currentHost) return "";
    return referrerUrl.host.toLowerCase();
  } catch {
    return "";
  }
}

export function buildPageAnalyticsPayload(input: { pathname: string; searchParams: URLSearchParams; referrer?: string; currentHost?: string }): PageAnalyticsPayload {
  const site = resolveAnalyticsSite(input.currentHost);
  const sourceParam = readTrimmed(input.searchParams.get("s"));
  const refParam = readTrimmed(input.searchParams.get("ref"));
  const utmSource = readTrimmed(input.searchParams.get("utm_source"));
  const utmMedium = readTrimmed(input.searchParams.get("utm_medium"));
  const utmCampaign = readTrimmed(input.searchParams.get("utm_campaign"));
  const utmContent = readTrimmed(input.searchParams.get("utm_content"));
  const utmTerm = readTrimmed(input.searchParams.get("utm_term"));
  const referrerHost = resolveReferrerHost(input.referrer, input.currentHost);

  let entrySource = "direct";
  let entrySourceKind: PageAnalyticsPayload["entry_source_kind"] = "direct";
  if (sourceParam) {
    entrySource = sourceParam;
    entrySourceKind = "source_param";
  } else if (utmSource) {
    entrySource = utmSource;
    entrySourceKind = "utm";
  } else if (refParam) {
    entrySource = refParam;
    entrySourceKind = "ref_param";
  } else if (referrerHost) {
    entrySource = referrerHost;
    entrySourceKind = "referrer";
  }

  return {
    site,
    page_group: resolveAnalyticsPageGroup(input.pathname, site),
    page_path: sanitizeAnalyticsPath(input.pathname),
    page_kind: resolvePageKind(input.pathname, site),
    entity_id: resolveEntityId(input.pathname, input.searchParams),
    entry_source: entrySource,
    entry_source_kind: entrySourceKind,
    source_param: sourceParam,
    ref_param: refParam,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_content: utmContent,
    utm_term: utmTerm,
    referrer_host: referrerHost,
  };
}

// 语义事件工具：任何组件可在交互回调中上报高价值动作（安装、打开工作台、分享等）。
// 初始化前的调用会被 posthog-js 丢弃，因此无需在组件内再次判断 ready。
export function trackEvent(name: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  posthog.capture(name, props);
}

export function PosthogAnalytics() {
  const pathname = usePathname() ?? "/";
  const lastCaptureKeyRef = useRef("");
  const captureRef = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);

  // 初始化：全站（官网 + 工作台）统一初始化；autocapture 提供 general 点击/输入，
  // capture_exceptions 提供未捕获错误与 Promise rejection 上报。
  useEffect(() => {
    if (!POSTHOG_TOKEN) return;
    posthog.init(POSTHOG_TOKEN, {
      api_host: POSTHOG_API_HOST,
      ui_host: "https://us.posthog.com",
      defaults: POSTHOG_DEFAULTS,
      autocapture: true,
      capture_exceptions: true,
      debug: POSTHOG_DEBUG,
    });
    setReady(true);
  }, []);

  // 捕获函数：页面访问事件（去重、脱敏、实体 id、来源 super properties）。
  useEffect(() => {
    if (!ready) return;
    captureRef.current = () => {
      const currentPathname = window.location.pathname;
      const search = window.location.search;
      const dedupeKey = `${currentPathname}${search}`;
      if (lastCaptureKeyRef.current === dedupeKey) return;
      lastCaptureKeyRef.current = dedupeKey;

      const payload = buildPageAnalyticsPayload({
        pathname: currentPathname,
        searchParams: new URLSearchParams(search),
        referrer: document.referrer,
        currentHost: window.location.host,
      });

      posthog.register({
        current_site: payload.site,
        current_page_group: payload.page_group,
        current_page_path: payload.page_path,
        current_page_kind: payload.page_kind,
        current_entity_id: payload.entity_id,
        current_entry_source: payload.entry_source,
        current_entry_source_kind: payload.entry_source_kind,
        current_source_param: payload.source_param,
        current_ref_param: payload.ref_param,
        current_utm_source: payload.utm_source,
        current_utm_medium: payload.utm_medium,
        current_utm_campaign: payload.utm_campaign,
        current_referrer_host: payload.referrer_host,
      });

      posthog.register_once({
        initial_site: payload.site,
        initial_entry_source: payload.entry_source,
        initial_entry_source_kind: payload.entry_source_kind,
        initial_source_param: payload.source_param,
        initial_ref_param: payload.ref_param,
        initial_utm_source: payload.utm_source,
        initial_utm_medium: payload.utm_medium,
        initial_utm_campaign: payload.utm_campaign,
        initial_referrer_host: payload.referrer_host,
      });

      posthog.capture("recut_page_viewed", payload);
    };
    captureRef.current();

    // 工作台的 Tab 切换用原生 pushState（Next usePathname 不感知），这里拦截补采；
    // 官网 next/link 导航走 pathname 依赖，二者去重键一致，不会重复上报。
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const onChange = () => captureRef.current();
    window.history.pushState = function (...args) {
      originalPushState.apply(this, args);
      onChange();
    };
    window.history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      onChange();
    };
    window.addEventListener("popstate", onChange);
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", onChange);
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    captureRef.current();
  }, [pathname, ready]);

  return null;
}
