import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const APP_ROOT = "/Users/chenxuejia/.recut/apps/editor";
const UI_ROOT = path.join(APP_ROOT, "ui");
const BUILD_SCRIPT = path.join(APP_ROOT, "scripts", "component-build.js");
const SDK_DIR = path.join(APP_ROOT, "sdk");
const SRC_DIR = "/var/folders/kj/tprkfgbj3bv0c5rfxccy1b6r0000gn/T/opencode/recut-verify";

const components = [
  {
    versionId: "ai-9x4k5mz8@1",
    name: "FeatureChip · Remotion Native Agent",
    surface: "html",
    inputs: [
      { key: "title", default: "原生集成 Remotion" },
      { key: "sub", default: "本地 Agent 驱动" },
      { key: "accent", default: "#38bdf8" },
    ],
    source: "fc-native.tsx",
  },
  {
    versionId: "ai-cthpybi0@1",
    name: "FeatureChip · 模板供 AI 参考",
    surface: "html",
    inputs: [
      { key: "title", default: "模板直供" },
      { key: "sub", default: "AI 直接参考" },
      { key: "accent", default: "#a78bfa" },
    ],
    source: "fc-template.tsx",
  },
  {
    versionId: "ai-alp80bbv@1",
    name: "FeatureChip · Shader 特效直接选择",
    surface: "html",
    inputs: [
      { key: "title", default: "Shader 特效" },
      { key: "sub", default: "直接选择即用" },
      { key: "accent", default: "#f472b6" },
    ],
    source: "fc-shader.tsx",
  },
  {
    versionId: "ai-cl8jw4or@1",
    name: "FeatureChip · 丰富组件库",
    surface: "html",
    inputs: [
      { key: "title", default: "丰富组件库" },
      { key: "sub", default: "即插即用" },
      { key: "accent", default: "#4ade80" },
    ],
    source: "fc-components.tsx",
  },
];

function build(name, sourceFile) {
  const src = path.join(SRC_DIR, sourceFile);
  const out = path.join(os.tmpdir(), `recut-v-${name}.js`);
  const r = spawnSync("node", [BUILD_SCRIPT, src, out, SDK_DIR], { encoding: "utf8" });
  const parsed = JSON.parse(r.stdout || "{}");
  if (!parsed.ok) throw new Error(`build ${name} failed: ${JSON.stringify(parsed)}`);
  return { bundle: fs.readFileSync(out, "utf8"), bundleHash: parsed.bundleHash };
}

async function main() {
  const server = spawn("./node_modules/.bin/vite", ["preview", "--port", "5199", "--strictPort"], {
    cwd: UI_ROOT,
    stdio: "ignore",
  });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  await wait(2500);

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--enable-features=CanvasDrawElement"],
  });
  const page = await browser.newPage();
  await page.goto("http://localhost:5199/component-harness.html");

  const out = [];
  for (const c of components) {
    const built = build(c.versionId.split("@")[0], c.source);
    const ok = await page.evaluate(
      ([componentId, name, surface, inputs, bundle, bundleHash]) =>
        window.__recutHarness.setComponent({ componentId, name, surface, inputs, bundle, bundleHash }),
      [c.versionId, c.name, c.surface, c.inputs, built.bundle, built.bundleHash],
    );
    await wait(500);
    const status = await page.evaluate(() => window.__recutHarness.render(1.2, 6));
    const hasNode = await page.evaluate(() => window.__recutHarness.hasNodeObject());
    const htmlInCanvas = await page.evaluate(() => window.__recutHarness.supported());
    let nonBg = 0;
    if (htmlInCanvas.htmlInCanvas) {
      await wait(800);
      nonBg = await page.evaluate(() => window.__recutHarness.countNonBackground(180, 100, 280, 160));
    }
    const bounds = await page.evaluate(() => window.__recutHarness.getNodeBounds());
    const report = {
      ok: status.status === "rendered" && hasNode && (htmlInCanvas.htmlInCanvas ? nonBg > 0 : true),
      checks: [
        { name: "render", pass: status.status === "rendered" },
        { name: "mounted", pass: hasNode },
        { name: "content", pass: htmlInCanvas.htmlInCanvas ? nonBg > 0 : true, note: `nonBg=${nonBg}` },
      ],
      frames: [{ t: 1.2, status: status.status, surface: status.surface, nodeBounds: bounds }],
      error: status.error || null,
    };
    out.push({ versionId: c.versionId, report, raw: status, nonBg, htmlInCanvas });
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.kill();
}

await main();
