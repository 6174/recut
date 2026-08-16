/*
 * [INPUT]: 依赖 @playwright/test 与 web/server.cjs（本地 Host 路由 + 语言跳转）
 * [OUTPUT]: web 的浏览器端到端测试入口：自动拉起本地 dev server，跑 e2e/i18n.spec.ts
 * [POS]: web 的 E2E 边界；覆盖官网 hydration、逐语言渲染、浏览器语言自动跳转与 recut_locale cookie 切换
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3457",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "PORT=3457 node server.cjs --dev",
    url: "http://localhost:3457/",
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
