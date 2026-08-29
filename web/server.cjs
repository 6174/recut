/**
 * [INPUT]: 依赖 Node HTTP、Next 自定义服务器与请求 Host 头 / recut_locale cookie / Accept-Language 头
 * [OUTPUT]: 对外提供本地开发/standalone 的 Host 路由入口：localhost 输出逐语言官网（en 无前缀、zh /zh/ 前缀，含与 Worker 一致的 cookie/浏览器语言判定），app.localhost 输出工作台
 * [POS]: web 的本地请求边界；在 Next 匹配 App Router 页面以前完成与 Cloudflare Worker 一致的路径映射与语言跳转，不参与静态导出；
 *        语言判定与壳映射以 web/worker.ts 为准，此处是本地镜像（302 跳转直接在 Node 层完成）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
const http = require("node:http");
const next = require("next");

const dev = process.argv.includes("--dev");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

const topLevelPages = new Set(["docs", "blog", "apps", "worlds"]);

function hostName(request) {
  return (request.headers.host ?? "").split(":", 1)[0].toLowerCase();
}

function parseCookie(raw, name) {
  if (!raw) return null;
  for (const part of String(raw).split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

// 与 worker.ts 同口径：recut_locale cookie 优先，其次 Accept-Language 首标签；无前缀 `/` 恒为 default(en)。
function resolveLocale(request) {
  const cookie = parseCookie(request.headers.cookie, "recut_locale");
  if (cookie === "zh" || cookie === "en") return cookie;
  const accept = request.headers["accept-language"];
  if (accept) {
    const first = String(accept).split(",")[0].split(";")[0].trim().toLowerCase();
    if (first.startsWith("zh")) return "zh";
  }
  return "en";
}

// 已知官网路径（无前缀形态）：/、/docs、/blog、/blog/<slug>、/apps、/apps/<id>、/worlds（可带尾斜杠）。
function isKnownPath(pathname) {
  if (pathname === "/") return true;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1) return topLevelPages.has(segments[0]);
  if (segments.length === 2) return (segments[0] === "blog" || segments[0] === "apps" || segments[0] === "worlds") && Boolean(segments[1]);
  return false;
}

// 静态壳映射：/marketing/<locale><rest>；Next 非静态导出模式无需尾斜杠。
function marketingPathFor(locale, rest) {
  const base = locale === "zh" ? "/marketing/zh" : "/marketing/en";
  const normalized = rest === "/" ? "/" : rest.replace(/\/$/, "");
  return normalized === "/" ? base : `${base}${normalized}`;
}

function redirect(response, location, status) {
  response.writeHead(status, { Location: location });
  response.end();
}

// 返回 true 表示已直接写出响应（重定向），否则由 Next 继续处理（可能已改写 request.url）。
function routeByHost(request, response) {
  if (hostName(request) !== "localhost") return false;
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // 内部静态壳路径交 Next 404，不做映射。
  if (pathname === "/marketing" || pathname.startsWith("/marketing/")) return false;

  // 前缀收敛（与 worker 一致）：/zh → /zh/；/en、/en/ → /。
  if (pathname === "/zh") {
    redirect(response, "/zh/", 301);
    return true;
  }
  if (pathname === "/en" || pathname === "/en/") {
    redirect(response, "/", 301);
    return true;
  }

  let destination;
  if (pathname.startsWith("/zh/")) {
    destination = marketingPathFor("zh", pathname.slice("/zh".length));
  } else if (isKnownPath(pathname)) {
    const locale = resolveLocale(request);
    if (locale === "zh") {
      // 判定为中文浏览器且路径无 /zh/ 前缀：302 到 /zh/<同路径>/（与 worker 一致）。
      const normalized = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
      redirect(response, normalized === "/" ? "/zh/" : `/zh${normalized}/`, 302);
      return true;
    }
    destination = marketingPathFor("en", pathname);
  } else {
    return false;
  }

  request.url = `${destination}${url.search}`;
  return false;
}

app.prepare().then(() => {
  http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    // 本地市场 API：从 public/api 直接服务 appstore.json 并允许跨域，供 app.localhost 工作台消费。
    if (url.pathname === "/api/appstore.json") {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      const file = require("node:path").join(__dirname, "public", "api", "appstore.json");
      require("node:fs").readFile(file, (error, body) => {
        if (error) { response.writeHead(404); response.end(); return; }
        response.setHeader("Content-Type", "application/json");
        response.writeHead(200);
        response.end(body);
      });
      return;
    }
    const handled = routeByHost(request, response);
    if (handled) return;
    void handle(request, response);
  }).listen(port, () => {
    console.log(`Recut ${dev ? "development" : "server"} listening on http://localhost:${port}`);
  });
});
