/*
 * [INPUT]: 依赖 Cloudflare 静态 Assets binding 与浏览器项目 URL
 * [OUTPUT]: 对外提供 recut.video 静态工作台和旧项目深链的无状态重定向
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
    const match = url.pathname.match(/^\/projects\/([^/]+)\/?$/);
    if (match) {
      const target = new URL("/projects/app/", url);
      target.searchParams.set("id", decodeURIComponent(match[1]));
      return Response.redirect(target, 302);
    }
    return env.ASSETS.fetch(request);
  },
};
