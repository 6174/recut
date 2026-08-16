/*
 * [INPUT]: 依赖 Cloudflare 静态 Assets binding、浏览器 Host 与项目/App 深链 URL
 * [OUTPUT]: 对外提供 Marketing/App Host 分流：recut.video 服务公开 Landing、Docs 与 Blog，app.recut.video 服务本地 service 驱动的工作台，并处理项目/App 深链静态壳映射
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
    if (marketingHosts.has(host) && url.pathname === "/") return env.ASSETS.fetch(marketingShell(request, url));
    if (appHosts.has(host) && (url.pathname === "/docs" || url.pathname.startsWith("/docs/") || url.pathname === "/blog" || url.pathname.startsWith("/blog/") || url.pathname === "/marketing" || url.pathname.startsWith("/marketing/"))) return new Response("Not Found", { status: 404 });
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
  },
};
