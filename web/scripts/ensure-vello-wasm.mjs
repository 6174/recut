/*
 * [INPUT]: 依赖本地 Rust/wasm-pack（构建 wasm）、scripts/fetch-cjk-font.mjs（字体兜底下载）
 * [OUTPUT]: 幂等确保 public/vello-wasm/ 的世界画布渲染器就绪——wasm 产物缺失则自动构建（需 wasm-pack），
 *           完整中文字体缺失则兜底下载；工具链/网络不可用时打印可执行指引且不阻塞进程。
 * [POS]: 世界画布（vello/WebGPU）开发与构建前置检查（package.json predev / prebuild 调用）；
 *        避免开发者克隆后直接撞上误导性的「浏览器不支持 WebGPU」或中文大量缺字。
 * [PROTOCOL]: 变更时更新此头部
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ensureCjkFont } from "./fetch-cjk-font.mjs";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "public", "vello-wasm");
const WASM_ARTIFACTS = ["pomelo_vello_wasm.js", "pomelo_vello_wasm_bg.wasm"];
const CJK_FONT = "noto-sans-sc.otf";

const log = (message) => console.log(`[vello] ${message}`);

function hasCommand(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function runPnpmScript(script) {
  const pnpmCli = process.env.npm_execpath;
  return pnpmCli
    ? spawnSync(process.execPath, [pnpmCli, "run", script], { cwd: ROOT, stdio: "inherit" })
    : spawnSync("pnpm", ["run", script], { cwd: ROOT, stdio: "inherit" });
}

// 1) wasm 产物：缺失即自动构建（wasm-pack 可重生成，故不入库）
const missingWasm = WASM_ARTIFACTS.filter((name) => !existsSync(join(OUT_DIR, name)));
if (missingWasm.length > 0) {
  log(`缺少渲染器产物：${missingWasm.join(", ")}`);
  if (!hasCommand("wasm-pack")) {
    console.warn(
      [
        "[vello] 未检测到 wasm-pack，无法自动构建世界画布渲染器产物。",
        "  1) 安装 Rust：https://rustup.rs",
        "  2) 安装 wasm-pack：curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh",
        "  3) 重新运行：pnpm vello:setup",
        "  在此之前世界画布会提示「渲染器资源未就绪」（而非「浏览器不支持 WebGPU」）。",
      ].join("\n"),
    );
  } else {
    log("正在构建 wasm 产物（首次约 1-2 分钟）…");
    const build = runPnpmScript("wasm:build:vello");
    if (build.status !== 0) console.warn("[vello] 自动构建失败，请手动运行 pnpm wasm:build:vello");
    else log("wasm 产物构建完成");
  }
}

// 2) 完整中文字体：随仓库入库（见 git），缺失时兜底下载
if (!existsSync(join(OUT_DIR, CJK_FONT))) {
  log(`缺少完整中文字体 ${CJK_FONT}，尝试兜底下载（建议直接从 git 检出该文件）…`);
  const font = await ensureCjkFont();
  if (!font.ok) {
    console.warn(
      [
        "[vello] 完整中文字体不可用，世界画布将回退到内置子集，真实中文内容会大量缺字。",
        "  可设置镜像后重试：CJK_FONT_URL=<url> pnpm vello:setup",
      ].join("\n"),
    );
  }
}
