/*
 * [INPUT]: 依赖 Cloudflare 静态 Assets binding、浏览器 Host 与项目/App 深链 URL
 * [OUTPUT]: 对外提供 Marketing/App Host 分流：recut.video 服务公开 Landing、Docs 与 Blog，app.recut.video 服务本地 service 驱动的工作台，并处理 www 收敛、/marketing 别名与未知路径 404
 * [POS]: web 的 Cloudflare 边缘入口；绝不代理或读取用户 localhost 上的 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
// Next 的 tsconfig 同时加载 DOM lib；不要依赖 Cloudflare 的全局 Fetcher
// 声明，使用此绑定真正需要的最小结构即可。
type StaticAssets = { fetch(request: Request): Promise<Response> };

interface Env {
  ASSETS: StaticAssets;
}

const appHosts = new Set(["app.recut.video", "www.app.recut.video", "app.localhost"]);
const marketingHosts = new Set(["recut.video", "www.recut.video", "localhost"]);

function hostname(url: URL) {
  return url.hostname.toLowerCase();
}

function marketingShell(request: Request, url: URL) {
  const shell = new URL("/marketing/", url);
  return new Request(shell, request);
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

    // Marketing Host：官网公开面；未知路径交由 404-page 兜底（不再 SPA 回退 200）。
    if (marketingHosts.has(host)) {
      if (url.pathname === "/marketing" || url.pathname === "/marketing/") {
        return Response.redirect(new URL("/", url).toString(), 301);
      }
      if (url.pathname === "/") return env.ASSETS.fetch(marketingShell(request, url));
      // 公开应用市场：/apps 与 /apps/:appID 是 SEO 落地页，映射到 marketing 静态壳，
      // 与 app host 的 `/apps` 工作台目录语义分离。
      if (url.pathname === "/apps" || url.pathname === "/apps/") {
        const shell = new URL("/marketing/apps/", url);
        return env.ASSETS.fetch(new Request(shell, request));
      }
      const marketingAppMatch = url.pathname.match(/^\/apps\/([^/]+)\/?$/);
      if (marketingAppMatch) {
        const shell = new URL(`/marketing/apps/${encodeURIComponent(marketingAppMatch[1])}/`, url);
        return env.ASSETS.fetch(new Request(shell, request));
      }
      return env.ASSETS.fetch(request);
    }

    // App Host：工作台；官网语义路径显式 404，Deep-link 映射到唯一静态壳后仍保留真实 URL。
    if (appHosts.has(host)) {
      if (url.pathname === "/docs" || url.pathname.startsWith("/docs/") || url.pathname === "/blog" || url.pathname.startsWith("/blog/") || url.pathname === "/marketing" || url.pathname.startsWith("/marketing/")) return new Response("Not Found", { status: 404 });
      const worldMatch = url.pathname.match(/^\/worlds\/([^/]+)\/?$/);
      if (worldMatch && worldMatch[1] !== "app") {
        // Static export only materializes /worlds/app/. Preserve the real World
        // id in the visible URL while serving the one generated route shell.
        const shell = new URL("/worlds/app/", url);
        return env.ASSETS.fetch(new Request(shell, request));
      }
      const projectMatch = url.pathname.match(/^\/projects\/([^/]+)\/?$/);
      if (projectMatch && projectMatch[1] !== "app") {
        // Static export only materializes /projects/app/. Serve that asset
        // internally while leaving the real project URL in the browser bar.
        const shell = new URL("/projects/app/", url);
        return env.ASSETS.fetch(new Request(shell, request));
      }
      const appMatch = url.pathname.match(/^\/apps\/([^/]+)\/?$/);
      if (appMatch && appMatch[1] !== "app") {
        // Static export only materializes /apps/app/. Preserve the semantic App
        // id in the visible URL while serving the one generated route shell.
        const shell = new URL("/apps/app/", url);
        return env.ASSETS.fetch(new Request(shell, request));
      }
      return env.ASSETS.fetch(request);
    }

    // workers.dev 等其他 Host：直接回退静态资源。
    return env.ASSETS.fetch(request);
  },
};
