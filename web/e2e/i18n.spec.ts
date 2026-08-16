/*
 * [INPUT]: 依赖 web 的本地 dev server（server.cjs 完成 Host 路由与语言跳转）、官网 [locale] 多路由与 MarketingHostRoute 客户端 hydration
 * [OUTPUT]: 官网 i18n 的浏览器端到端验收：默认英文、中文浏览器 302 自动跳转、/zh/ 前缀与逐语言正文、
 *           <html lang> 动态化、语言切换写 recut_locale cookie 并覆盖自动跳转、hydration 后不落入 404、header <a> 导航全页跳转
 * [POS]: web/e2e 的官网 i18n 验收面；覆盖 worker.ts/server.cjs 之外的真实浏览器行为（worker 纯路由逻辑由 scripts/worker-e2e.mjs 覆盖）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// 每个用例独立 context，互不污染 cookie；浏览器 locale 决定 Accept-Language。
async function openIn(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(path);
  // 等待 hydration 完成：脚本把 MarketingHostRoute 渲染出来（页面已含服务端内容，等 React 绑定）
  await page.waitForLoadState("networkidle");
  // hydration mismatch 会在 console 报 React 错误，属于回归（分享 URL 等服务端/客户端不一致）。
  expect(consoleErrors.filter((text) => /hydrat/i.test(text)), `hydration 报错：${consoleErrors.join(" | ")}`).toEqual([]);
  expect(errors, `pageerror：${errors.join(" | ")}`).toEqual([]);
  return page;
}

test("en 默认：/ 无跳转、英文正文、html lang=en", async ({ context }) => {
  const page = await openIn(context, "/");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.locator("h1")).toContainText("Keep AI video editing and creation");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
});

test("zh 浏览器 / 自动 302 到 /zh/ 且正文为中文、html lang=zh", async ({ context, browser }) => {
  const ctx = await browser.newContext({ locale: "zh-CN" });
  const page = await openIn(ctx, "/");
  expect(new URL(page.url()).pathname).toBe("/zh/");
  await expect(page.locator("h1")).toContainText("让 AI 视频剪辑与创作");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("zh");
});

test("显式 /zh/ 前缀：en 浏览器也渲染中文", async ({ context, browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await openIn(ctx, "/zh/");
  await expect(page.locator("h1")).toContainText("让 AI 视频剪辑与创作");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("zh");
});

test("/docs 与 /zh/docs 逐语言正文", async ({ context, browser }) => {
  const en = await openIn(context, "/docs/");
  await expect(en.locator("h1")).toContainText("Start with your first video.");
  const zh = await openIn(await browser.newContext({ locale: "zh-CN" }), "/zh/docs/");
  await expect(zh.locator("h1")).toContainText("从第一支视频开始。");
});

test("文章深链 hydration 不落入 404，分享 URL 逐语言正确（zh 正文 + en 正文）", async ({ context, browser }) => {
  const zh = await openIn(await browser.newContext({ locale: "zh-CN" }), "/zh/blog/local-first-creative-workspace/");
  await expect(zh.locator("h1")).toContainText("为什么 AI 视频创作应该本地优先");
  const zhLinkedIn = await zh.getByRole("link", { name: "LinkedIn" }).getAttribute("href");
  expect(zhLinkedIn).toContain("https%3A%2F%2Frecut.video%2Fzh%2Fblog%2F");
  const en = await openIn(context, "/blog/local-first-creative-workspace/");
  await expect(en.locator("h1")).toContainText("Why AI video creation should be local-first");
  const enLinkedIn = await en.getByRole("link", { name: "LinkedIn" }).getAttribute("href");
  expect(enLinkedIn).toContain("https%3A%2F%2Frecut.video%2Fblog%2F");
});

test("App 详情页双语言渲染", async ({ context, browser }) => {
  const en = await openIn(context, "/apps/recut.vox-broll/");
  await expect(en.locator("h1").first()).toContainText("AI Short Films");
  const zh = await openIn(await browser.newContext({ locale: "zh-CN" }), "/zh/apps/recut.vox-broll/");
  await expect(zh.locator("h1").first()).toContainText("AI 短片");
});

test("zh 页面点 English 切换：写 recut_locale=en cookie 并落在英文 /", async ({ context, browser }) => {
  const ctx = await browser.newContext({ locale: "zh-CN" });
  const page = await openIn(ctx, "/zh/");
  await expect(page.locator("h1")).toContainText("让 AI 视频剪辑与创作");
  await page.locator("nav").getByRole("link", { name: "English" }).click();
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.locator("h1")).toContainText("Keep AI video editing and creation");
  const cookies = await ctx.cookies();
  expect(cookies.find((c) => c.name === "recut_locale")?.value).toBe("en");
});

test("cookie recut_locale=zh 覆盖英文浏览器：/ 被 302 到 /zh/", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await ctx.addCookies([{ name: "recut_locale", value: "zh", url: "http://localhost:3457" }]);
  const page = await openIn(ctx, "/");
  expect(new URL(page.url()).pathname).toBe("/zh/");
  await expect(page.locator("h1")).toContainText("让 AI 视频剪辑与创作");
});

test("header 导航 <a> 全页跳转（/docs 出英文 Docs，不落入客户端 404）", async ({ context }) => {
  const page = await openIn(context, "/");
  await page.getByRole("navigation").getByRole("link", { name: "Docs" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h1")).toContainText("Start with your first video.");
});

test("footer 语言切换：en 页点 中文 落到 /zh/ 并写 cookie", async ({ context }) => {
  const page = await openIn(context, "/");
  await expect(page.locator("h1")).toContainText("Keep AI video editing and creation");
  await page.locator("footer").getByRole("link", { name: "中文" }).click();
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname).toBe("/zh/");
  await expect(page.locator("h1")).toContainText("让 AI 视频剪辑与创作");
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "recut_locale")?.value).toBe("zh");
});

test("blog 列表页 /blog 与 /zh/blog 双语言渲染（不 500）", async ({ context, browser }) => {
  const en = await openIn(context, "/blog");
  await expect(en.locator("h1")).toContainText("Thoughts on creative tools.");
  expect(await en.locator("article").count()).toBeGreaterThan(0);
  const zh = await openIn(await browser.newContext({ locale: "zh-CN" }), "/zh/blog");
  await expect(zh.locator("h1")).toContainText("关于创作工具的想法");
  expect(await zh.locator("article").count()).toBeGreaterThan(0);
});

test("marketing 页面不挂载工作台 Agent 面板", async ({ context }) => {
  const page = await openIn(context, "/");
  await expect(page.locator("aside")).toHaveCount(0);
});
