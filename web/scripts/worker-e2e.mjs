/*
 * [INPUT]: 依赖 web/worker.ts（Cloudflare 边缘入口）与 `make web-build-cloudflare`/静态导出的 web/out 产物
 * [OUTPUT]: Worker 路由的端到端验收：捆绑真实 worker.ts、以真实 out/ 静态导出作为 ASSETS binding，
 *           模拟 recut.video / app.recut.video Host 与 Accept-Language/cookie 组合，断言状态码、Location 与正文语言内容。
 *           浏览器 hydration 层由 playwright（web/e2e/i18n.spec.ts）覆盖，此处只验纯路由逻辑。
 * [POS]: web/scripts 的 Worker 路由验收；纯 Node，无需浏览器；先跑静态导出再运行
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(scriptDir, "..");
const outDir = join(webDir, "out");
const tmpOut = join(scriptDir, ".worker-e2e-bundle.cjs");

// 1. 用 esbuild 把 TS worker 打成 CommonJS，可在 Node 直接运行。
execFileSync(join(webDir, "node_modules", ".bin", "esbuild"), ["worker.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${tmpOut}`], { cwd: webDir, stdio: "pipe" });

const workerModule = (await import(tmpOut)).default;
const worker = workerModule.default ?? workerModule;

// 2. 最小 ASSETS binding：目录补 index.html，缺失回退 404.html（not_found_handling="404-page"）。
const mime = { ".html": "text/html", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json", ".js": "text/javascript" };
function assetFetch(request) {
  return Promise.resolve().then(() => {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.endsWith("/")) path += "index.html";
  if (!path.startsWith("/")) path = `/${path}`;
  let file = join(outDir, decodeURIComponent(path));
  if (!existsSync(file)) {
    const notFound = join(outDir, "404.html");
    return new Response(existsSync(notFound) ? readFileSync(notFound, "utf8") : "Not Found", { status: 404 });
  }
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return new Response(readFileSync(file, "utf8"), { status: 200, headers: { "Content-Type": mime[ext] ?? "application/octet-stream" } });
  });
}
const env = { ASSETS: { fetch: assetFetch } };

// 3. 场景：name, host, path, headers, expect{status, location?, bodyContains?}
const cases = [
  ["en 首页（Accept-Language en）", "recut.video", "/", { "accept-language": "en-US,en;q=0.9" }, { status: 200, bodyContains: "Keep AI video editing and creation" }],
  ["zh 浏览器无前缀 / → 302 /zh/", "recut.video", "/", { "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" }, { status: 302, location: "/zh/" }],
  ["zh 浏览器 /docs → 302 /zh/docs/", "recut.video", "/docs", { "accept-language": "zh-CN,zh;q=0.9" }, { status: 302, location: "/zh/docs/" }],
  ["显式 /zh/ 前缀优先（en 浏览器也出中文）", "recut.video", "/zh/", { "accept-language": "en-US,en;q=0.9" }, { status: 200, bodyContains: "让 AI 视频剪辑与创作" }],
  ["cookie recut_locale=en 覆盖中文浏览器", "recut.video", "/", { "accept-language": "zh-CN", cookie: "recut_locale=en" }, { status: 200, bodyContains: "Keep AI video editing" }],
  ["cookie recut_locale=zh 无前缀 → 302 /zh/", "recut.video", "/", { cookie: "recut_locale=zh" }, { status: 302, location: "/zh/" }],
  ["/zh 无尾斜杠 → 301 /zh/", "recut.video", "/zh", {}, { status: 301, location: "/zh/" }],
  ["/en、/en/ → 301 /（en 是 default）", "recut.video", "/en/", {}, { status: 301, location: "/" }],
  ["/marketing 内部壳 → 404", "recut.video", "/marketing", {}, { status: 404 }],
  ["/marketing/ 内部壳 → 404", "recut.video", "/marketing/", {}, { status: 404 }],
  ["zh 浏览器文章深链 → 302 /zh/blog/…", "recut.video", "/blog/local-first-creative-workspace", { "accept-language": "zh-CN" }, { status: 302, location: "/zh/blog/local-first-creative-workspace/" }],
  ["/zh/blog/… 出中文正文", "recut.video", "/zh/blog/local-first-creative-workspace/", {}, { status: 200, bodyContains: "为什么 AI 视频创作应该本地优先" }],
  ["/blog/… 出英文正文", "recut.video", "/blog/local-first-creative-workspace/", {}, { status: 200, bodyContains: "Why AI video creation should be local-first" }],
  ["/apps/:id 英文 App 详情", "recut.video", "/apps/recut.vox-broll/", {}, { status: 200, bodyContains: "AI Short Films" }],
  ["/zh/apps/:id 中文 App 详情", "recut.video", "/zh/apps/recut.vox-broll/", {}, { status: 200, bodyContains: "AI 短片" }],
  ["/zh/docs 出中文 Docs", "recut.video", "/zh/docs/", {}, { status: 200, bodyContains: "从第一支视频开始。" }],
  ["/docs 出英文 Docs", "recut.video", "/docs/", {}, { status: 200, bodyContains: "Start with your first video." }],
  ["App Host /docs → 404（官网语义不进入工作台）", "app.recut.video", "/docs", {}, { status: 404 }],
  ["App Host 深链 /projects/abc → 工作台壳", "app.recut.video", "/projects/abc", {}, { status: 200 }],
  ["www.recut.video → 301 裸域", "www.recut.video", "/docs", {}, { status: 301, location: "/docs" }],
  ["未知路径 /foo → 404", "recut.video", "/foo", {}, { status: 404 }],
  ["/zh/ 下未知 /zh/foo → 404", "recut.video", "/zh/foo", {}, { status: 404 }],
  ["市场 API /api/appstore.json → 200 且带 CORS", "recut.video", "/api/appstore.json", { "accept-language": "en-US" }, { status: 200, bodyContains: "\"recut.vox-broll\"", header: { "Access-Control-Allow-Origin": "*" } }],
];

let pass = 0;
for (const [name, host, path, headers, expect] of cases) {
  const url = new URL(`https://${host}${path}`);
  const req = new Request(url, { headers });
  const res = await worker.fetch(req, env);
  const text = res.status === 200 ? await res.clone().text() : "";
  const rawLocation = res.headers.get("location") ?? "";
  // Response.redirect 产生绝对 Location；统一取 pathname 比较。
  const location = rawLocation.startsWith("http") ? new URL(rawLocation).pathname : rawLocation;
  const problems = [];
  if (res.status !== expect.status) problems.push(`status=${res.status} expected=${expect.status}`);
  if (expect.location !== undefined && location !== expect.location) problems.push(`location="${location}" expected="${expect.location}"`);
  if (expect.bodyContains !== undefined && !text.includes(expect.bodyContains)) problems.push(`body 缺 "${expect.bodyContains}"`);
  if (expect.header) {
    for (const [name, value] of Object.entries(expect.header)) {
      if (res.headers.get(name) !== value) problems.push(`header ${name}=${res.headers.get(name)} expected=${value}`);
    }
  }
  if (problems.length) {
    console.log(`✗ ${name}\n    ${problems.join(" | ")}`);
  } else {
    pass++;
    console.log(`✓ ${name}`);
  }
}
try {
  readFileSync(tmpOut);
} finally {
  // 清理临时 bundle。
  await import("node:fs/promises").then(({ rm }) => rm(tmpOut, { force: true }));
}
console.log(`\n${pass}/${cases.length} 通过`);
if (pass !== cases.length) process.exit(1);
