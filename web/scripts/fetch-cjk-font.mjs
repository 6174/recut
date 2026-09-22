/*
 * [INPUT]: 网络（GitHub / jsDelivr 镜像）
 * [OUTPUT]: 确保 public/vello-wasm/noto-sans-sc.otf（完整 Noto Sans CJK SC）存在，缺失则按镜像列表下载；
 *           导出 ensureCjkFont() 供 ensure-vello-wasm.mjs 复用；直接执行等价于 `node scripts/fetch-cjk-font.mjs`。
 * [POS]: 世界画布 vello 文本渲染的字体供给脚本——缺失时 vello 回退到内置 noto-cjk-subset.otf（仅 demo 字符），
 *        真实中文内容会大量丢字。字体较大（~16MB），不入库，由 predev/prebuild 自动确保。
 * [PROTOCOL]: 变更时更新此头部
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEST = join(process.cwd(), "public/vello-wasm/noto-sans-sc.otf");

const SOURCES = [
  process.env.CJK_FONT_URL,
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
].filter(Boolean);

/**
 * 幂等确保完整中文字体就绪。
 * @param {{ log?: (message: string) => void }} [options]
 * @returns {Promise<{ ok: true; path: string; skipped?: boolean } | { ok: false; error: unknown }>}
 */
export async function ensureCjkFont({ log = console.log } = {}) {
  if (existsSync(DEST)) return { ok: true, path: DEST, skipped: true };

  let lastError = null;
  for (const url of SOURCES) {
    try {
      log(`[cjk-font] 下载完整中文字体：${url}`);
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 1_000_000) throw new Error(`文件过小（${bytes.length} bytes），疑似错误页`);
      mkdirSync(join(process.cwd(), "public/vello-wasm"), { recursive: true });
      writeFileSync(DEST, bytes);
      log(`[cjk-font] 已保存 ${DEST}（${(bytes.length / 1024 / 1024).toFixed(1)} MB）`);
      return { ok: true, path: DEST };
    } catch (error) {
      lastError = error;
      log(`[cjk-font] 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: false, error: lastError };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const result = await ensureCjkFont();
  if (!result.ok) {
    console.error("[cjk-font] 全部来源失败，可设置 CJK_FONT_URL 指定镜像后重试。");
    process.exit(1);
  }
}
