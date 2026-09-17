/**
 * [INPUT]: 依赖运行中的 Recut service 与 web 工作台（LAN 模式）、@playwright/test 浏览器。
 * [OUTPUT]: 端到端验证迁移后的 realtime 通信层：外部 Agent 经 service API 修改时间线 →
 *           WS project.document.changed → web 内 timeline-editor（无 iframe）无需刷新即应用。
 *           自建 / 自删项目，可重复运行；失败以非零退出码结束。
 * [POS]: Editor 迁移（native-migration RFC）的浏览器侧实时同步验收；与 service 层
 *        editor_native_test.go 的「op 归属 + 事件信封」契约互补。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 *
 * usage: node scripts/verify-editor-realtime.mjs
 *   env: WEB_URL (default http://app.localhost:3000)
 *        SERVICE_URL (default http://127.0.0.1:17373)
 */
import { chromium } from "@playwright/test";

const WEB_URL = process.env.WEB_URL ?? "http://app.localhost:3000";
const SERVICE_URL = process.env.SERVICE_URL ?? "http://127.0.0.1:17373";
const APP_ID = "recut.editor";

async function api(path, init) {
  const res = await fetch(`${SERVICE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "Accept-Language": "zh", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function invoke(projectId, op, input) {
  return api(`/v1/projects/${projectId}/apps/${APP_ID}/api/${op}`, {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const browser = await chromium.launch();
try {
  // 1) 自建项目并初始化编辑器文档（空时间线）。
  const created = await api("/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: `Realtime Verify ${new Date().toISOString()}`, appId: APP_ID }),
  });
  if ((created.status !== 200 && created.status !== 201) || !created.body?.id) fail(`create project: ${JSON.stringify(created)}`);
  const projectId = created.body.id;
  const init = await invoke(projectId, "project.create", {});
  if (!init.body?.projectId) fail(`project.create: ${JSON.stringify(init)}`);

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const wsDocChanged = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const payload = frame.payload;
      if (typeof payload === "string" && payload.includes("project.document.changed")) wsDocChanged.push(true);
    });
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // 2) 打开原生编辑器（无 iframe），等项目加载完成。
  await page.goto(`${WEB_URL}/projects/${projectId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll("iframe").length === 0, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(6000);

  // 3) 外部 Agent 修改时间线（Go 原生 timeline.command）。
  const name = `realtime-verify-${Date.now().toString(36)}`;
  const inserted = await invoke(projectId, "timeline.command", {
    op: { type: "insert", payload: { element: { type: "image", name, mediaId: "verify-media", startSec: 0, durationSec: 2 } } },
  });
  if (inserted.status !== 200 || !inserted.body?.ok) fail(`timeline.command: ${JSON.stringify(inserted)}`);

  // 4) 断言：WS 收到事件，且编辑器 DOM 无需刷新即出现该片段。
  let appliedInDom = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes(name)) { appliedInDom = true; break; }
    await page.waitForTimeout(400);
  }

  const ok = appliedInDom && wsDocChanged.length > 0;
  console.log(`project=${projectId}`);
  console.log(`ws_project_document_changed=${wsDocChanged.length > 0}`);
  console.log(`client_applied_without_reload=${appliedInDom}`);
  if (pageErrors.length) console.log(`page_errors=${JSON.stringify(pageErrors.slice(0, 5))}`);

  // 5) 清理：撤销插入并删除项目。
  await invoke(projectId, "history.undo", {});
  await api(`/v1/projects/${projectId}`, { method: "DELETE" });

  await browser.close();
  if (!ok) process.exit(2);
  console.log("PASS: realtime sync verified");
} catch (error) {
  await browser.close().catch(() => {});
  fail(error instanceof Error ? error.message : String(error));
}
