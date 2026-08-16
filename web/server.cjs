/**
 * [INPUT]: 依赖 Node HTTP、Next 自定义服务器与请求 Host 头
 * [OUTPUT]: 对外提供本地开发/standalone 的 Host 路由入口：localhost 输出官网，app.localhost 输出工作台
 * [POS]: web 的本地请求边界；在 Next 匹配 App Router 页面以前完成与 Cloudflare Worker 一致的路径映射，不参与静态导出
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
const http = require("node:http");
const next = require("next");

const dev = process.argv.includes("--dev");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

function hostName(request) {
  return (request.headers.host ?? "").split(":", 1)[0].toLowerCase();
}

function marketingPath(pathname) {
  if (pathname === "/") return "/marketing";
  if (pathname === "/apps" || pathname === "/apps/") return "/marketing/apps";
  if (pathname.startsWith("/apps/")) return `/marketing${pathname}`;
  return pathname;
}

function routeByHost(request) {
  if (hostName(request) !== "localhost") return;
  const url = new URL(request.url ?? "/", "http://localhost");
  const destination = marketingPath(url.pathname);
  if (destination === url.pathname) return;
  request.url = `${destination}${url.search}`;
}

app.prepare().then(() => {
  http.createServer((request, response) => {
    routeByHost(request);
    void handle(request, response);
  }).listen(port, () => {
    console.log(`Recut ${dev ? "development" : "server"} listening on http://localhost:${port}`);
  });
});
