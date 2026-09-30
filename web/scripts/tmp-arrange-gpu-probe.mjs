/* 临时探针：找出能让 headless chromium 拿到 WebGPU adapter 的启动参数（用完即删） */
import { chromium } from "playwright";

const URL = "http://app.localhost:3000/";
const SETS = [
  { name: "bare", args: [] },
  { name: "swiftshader-angle", args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--use-gl=angle", "--disable-vulkan-surface"] },
  { name: "vulkan-swiftshader", args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-angle=vulkan", "--disable-vulkan-surface"] },
  { name: "unsafe-apis", args: ["--enable-unsafe-webgpu", "--enable-dawn-features=allow_unsafe_apis", "--enable-features=Vulkan,VulkanFromANGLE", "--use-angle=swiftshader"] },
];

for (const set of SETS) {
  let verdict = "launch-failed";
  try {
    const browser = await chromium.launch({ args: set.args });
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    verdict = await page.evaluate(async () => {
      if (!navigator.gpu) return "no navigator.gpu";
      const adapter = await navigator.gpu.requestAdapter().catch((error) => `throw:${error}`);
      if (!adapter) return "no adapter";
      const device = await adapter.requestDevice().catch((error) => `throw:${error}`);
      return `OK adapter device=${Boolean(device)}`;
    });
    await browser.close();
  } catch (error) {
    verdict = `launch error: ${String(error).slice(0, 120)}`;
  }
  console.log(`${set.name}: ${verdict}`);
}
