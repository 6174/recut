/*
 * [INPUT]: 依赖 Cloudflare 静态 Assets binding、浏览器 Host、recut_locale cookie 与 Accept-Language 头、项目/App 深链 URL
 * [OUTPUT]: 对外提供 Marketing/App Host 分流：recut.video 服务逐语言官网（en 无前缀、zh 固定 /zh/ 前缀），app.recut.video 服务本地 service 驱动的工作台；
 *           无前缀路径按 recut_locale cookie → Accept-Language 判定语言，中文浏览器 302 到 /zh/<同路径>/；www 收敛、/marketing 别名 404、未知路径 404；
 *           App Host 详情深链（/worlds/<id>、/projects/<id>、/apps/<id>）连同其 RSC 分段缓存子路径一并重写到唯一的静态壳目录（/<base>/app/），
 *           避免分段请求 404 触发 Next 的「整页导航」降级（点开即刷新），浏览器地址栏仍保留真实 id。
 * [POS]: web 的 Cloudflare 边缘入口；语言判定与静态壳重写映射与 server.cjs（本地 Host）及 lib/i18n/url.ts（localizeURL）保持一致；绝不代理或读取用户 localhost 上的 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
// Next 的 tsconfig 同时加载 DOM lib；不要依赖 Cloudflare 的全局 Fetcher
// 声明，使用此绑定真正需要的最小结构即可。
type StaticAssets = { fetch(request: Request): Promise<Response> };

interface Env {
  ASSETS: StaticAssets;
}

type Locale = "zh" | "en";

const appHosts = new Set(["app.recut.video", "www.app.recut.video", "app.localhost"]);
const marketingHosts = new Set(["recut.video", "www.recut.video", "localhost"]);
const topLevelPages = new Set(["docs", "blog", "apps", "worlds"]);

function hostname(url: URL) {
  return url.hostname.toLowerCase();
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

// 语言判定顺序：1) 显式 /zh/ 前缀 → zh；2) recut_locale cookie（语言切换器写入）；3) Accept-Language 首标签。
function resolveLocale(request: Request, hasZhPrefix: boolean): Locale {
  if (hasZhPrefix) return "zh";
  const cookie = cookieValue(request, "recut_locale");
  if (cookie === "zh" || cookie === "en") return cookie;
  const accept = request.headers.get("accept-language");
  if (accept) {
    const first = accept.split(",")[0].split(";")[0].trim().toLowerCase();
    if (first.startsWith("zh")) return "zh";
  }
  return "en";
}

// 已知官网路径（无前缀形态）：/、/docs、/blog、/blog/<slug>、/apps、/apps/<id>、/worlds（可带尾斜杠）。
function isKnownMarketingPath(rest: string): boolean {
  if (rest === "/") return true;
  const segments = rest.split("/").filter(Boolean);
  if (segments.length === 1) return topLevelPages.has(segments[0]);
  if (segments.length === 2) return (segments[0] === "blog" || segments[0] === "apps" || segments[0] === "worlds") && Boolean(segments[1]);
  return false;
}

function normalizePath(rest: string): string {
  if (rest === "/") return "/";
  return rest.endsWith("/") ? rest.slice(0, -1) : rest;
}

// 静态壳映射：en 无前缀 / docs / blog / apps 与 zh 的 /zh 前缀 + 同路径，统一补尾斜杠。
function marketingShell(locale: Locale, rest: string): string {
  const normalized = normalizePath(rest);
  return normalized === "/" ? `/marketing/${locale}/` : `/marketing/${locale}${normalized}/`;
}

// 302 跳转目标：无前缀 zh 判定路径 → /zh/<同路径>/。
function localizedRedirectTarget(rest: string): string {
  const normalized = normalizePath(rest);
  return normalized === "/" ? "/zh/" : `/zh${normalized}/`;
}

function handleMarketing(request: Request, url: URL, env: Env): Promise<Response> {
  const { pathname } = url;

  // 内部静态壳不可达：/marketing 别名 404（不再 301 到 /）。
  if (pathname === "/marketing" || pathname === "/marketing/") {
    return Promise.resolve(new Response("Not Found", { status: 404 }));
  }
  // 前缀收敛：/zh → /zh/（301）；/en、/en/ → /（en 是 default，前缀收敛到无前缀）。
  if (pathname === "/zh") {
    return Promise.resolve(Response.redirect(new URL("/zh/", url).toString(), 301));
  }
  if (pathname === "/en" || pathname === "/en/") {
    return Promise.resolve(Response.redirect(new URL("/", url).toString(), 301));
  }

  const hasZhPrefix = pathname.startsWith("/zh/");
  const rest = hasZhPrefix ? pathname.slice("/zh".length) : pathname;
  const locale = resolveLocale(request, hasZhPrefix);

  // 判定为 zh 但路径无 /zh/ 前缀：302 到 /zh/<同路径>/，避免改变爬虫对 canonical 的理解。
  if (!hasZhPrefix && locale === "zh" && isKnownMarketingPath(rest)) {
    return Promise.resolve(Response.redirect(new URL(localizedRedirectTarget(rest), url).toString(), 302));
  }

  // 已知路径：服务逐语言静态壳（尾斜杠，静态导出生成 index.html）。
  if (isKnownMarketingPath(rest)) {
    const shell = new URL(marketingShell(locale, rest), url);
    return env.ASSETS.fetch(new Request(shell, request));
  }

  // 云端 API：市场数据等静态 JSON，允许跨域（app.recut.video 工作台经 /api/appstore.json 消费）。
  if (pathname.startsWith("/api/")) {
    return env.ASSETS.fetch(request).then((response) => {
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    });
  }

  // 其余未知路径：交给静态 Assets 404 兜底。
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = hostname(url);

    // 域名收敛（SEO canonical）：www.recut.video 永久重定向到裸域，保留路径与查询串。
    if (host === "www.recut.video") {
      const target = new URL(url);
      target.hostname = "recut.video";
      return Response.redirect(target.toString(), 301);
    }

    // Marketing Host：官网公开面；无前缀/zh 前缀路径做语言判定与静态壳重写，未知路径交由 404-page 兜底。
    if (marketingHosts.has(host)) {
      return handleMarketing(request, url, env);
    }

    // App Host：工作台；官网语义路径显式 404，Deep-link 映射到唯一静态壳后仍保留真实 URL。
    if (appHosts.has(host)) {
      if (url.pathname === "/docs" || url.pathname.startsWith("/docs/") || url.pathname === "/blog" || url.pathname.startsWith("/blog/") || url.pathname === "/marketing" || url.pathname.startsWith("/marketing/")) return new Response("Not Found", { status: 404 });
      // Next 16 segment cache fetches RSC payloads as real files like
      // /worlds/__next.worlds.txt; they must reach ASSETS untouched, or the
      // router receives HTML and falls back to full page navigations.
      const isRSCSegment = (segment: string) => segment.startsWith("__next.") || segment.endsWith(".txt");
      // 静态导出只为详情路由生成一个壳（/worlds/app/、/projects/app/、/apps/app/），
      // 连同壳目录下的 RSC 分段缓存文件（__next.*.txt）。真实 id 下的客户端导航会请求
      // /worlds/<id>/__next._tree.txt 这类分段文件；只映射裸路径会让它们 404，
      // 路由随即降级为整页导航（表现为「点开就刷新」）。故把详情壳目录下的任意子路径
      // 一并重写，浏览器地址栏仍保留真实 id。
      const detailShell = (base: string): string | null => {
        const match = url.pathname.match(new RegExp(`^${base}/([^/]+)(/.*)?$`));
        if (!match) return null;
        const [, first, rest = "/"] = match;
        // /worlds/__next.worlds.txt 等列表路由的 RSC 文件必须原样送出；
        // /<base>/app 本身已是生成好的壳目录，无需重写。
        if (first === "app" || isRSCSegment(first)) return null;
        return `${base}/app${rest}`;
      };
      for (const base of ["/worlds", "/projects", "/apps"]) {
        const shellPath = detailShell(base);
        if (!shellPath) continue;
        // 保留查询串：画布深链 (?ctx=…) 与分段缓存请求都带上它。
        const shell = new URL(shellPath, url);
        shell.search = url.search;
        return env.ASSETS.fetch(new Request(shell, request));
      }
      return env.ASSETS.fetch(request);
    }

    // workers.dev 等其他 Host：直接回退静态资源。
    return env.ASSETS.fetch(request);
  },
};
