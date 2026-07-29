/*
 * [INPUT]: 依赖 Cloudflare 静态 Assets binding 与浏览器项目 URL
 * [OUTPUT]: 对外提供 recut.video 静态工作台及项目/App 深链的内部静态壳映射
 * [POS]: web 的 Cloudflare 边缘入口；绝不代理或读取用户 localhost 上的 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
// Next 的 tsconfig 同时加载 DOM lib；不要依赖 Cloudflare 的全局 Fetcher
// 声明，使用此绑定真正需要的最小结构即可。
type StaticAssets = { fetch(request: Request): Promise<Response> };

interface Env {
  ASSETS: StaticAssets;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
