import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const APP_ROOT = "/Users/chenxuejia/.recut/apps/editor";
const UI_ROOT = path.join(APP_ROOT, "ui");
const BUILD_SCRIPT = path.join(APP_ROOT, "scripts", "component-build.js");
const SDK_DIR = path.join(APP_ROOT, "sdk");

// [source, name, surface, inputs] per component to verify
const components = [
  {
    versionId: "ai-od7l7a32@1",
    name: "Hello World",
    surface: "html",
    inputs: [
      { key: "text", default: "Hello World" },
      { key: "color", default: "#ff5c39" },
      { key: "fontSize", default: 150 },
    ],
    source: null,
  },
  {
    versionId: "ai-u9c1q4qi@1",
    name: "Recut Card",
    surface: "react",
    inputs: [
      { key: "title", default: "Recut" },
      { key: "subtitle", default: "视频创作平台" },
      { key: "accent", default: "#ff5c39" },
    ],
    source: null,
  },
];

function build(name, source) {
  const src = path.join(os.tmpdir(), `recut-v-${name}.tsx`);
  const out = path.join(os.tmpdir(), `recut-v-${name}.js`);
  fs.writeFileSync(src, source);
  const r = spawnSync("node", [BUILD_SCRIPT, src, out, SDK_DIR], { encoding: "utf8" });
  const parsed = JSON.parse(r.stdout || "{}");
  if (!parsed.ok) throw new Error(`build ${name} failed: ${JSON.stringify(parsed)}`);
  return { bundle: fs.readFileSync(out, "utf8"), bundleHash: parsed.bundleHash };
}

async function main() {
  // serve dist
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
    const status = await page.evaluate(() => window.__recutHarness.render(1.2, 6));
    const hasNode = await page.evaluate(() => window.__recutHarness.hasNodeObject());
    const htmlInCanvas = await page.evaluate(() => window.__recutHarness.supported());
    let nonBg = 0;
    if (htmlInCanvas.htmlInCanvas) {
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

// fill sources before main
const srcDir = path.dirname(new URL(import.meta.url).pathname);
components[0].source = fs.readFileSync(path.join(srcDir, "hello-world.tsx"), "utf8");
components[1].source = fs.readFileSync(path.join(srcDir, "recut-card.tsx"), "utf8");
await main();
