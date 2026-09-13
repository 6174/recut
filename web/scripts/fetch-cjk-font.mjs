/*
 * 下载完整 CJK 字体（Noto Sans CJK SC OTF）到 public/vello-wasm/noto-sans-sc.otf，供 vello 文本回退使用。
 * 用法：node scripts/fetch-cjk-font.mjs
 * 说明：字体较大（~16MB），不入库（public/vello-wasm 已 gitignore）；缺失时 vello 回退到内置子集（仅 demo 字符）。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const DEST = join(process.cwd(), "public/vello-wasm/noto-sans-sc.otf");
if (existsSync(DEST)) { console.log("already exists:", DEST); process.exit(0); }
const URL = process.env.CJK_FONT_URL || "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";
console.log("downloading", URL);
const res = await fetch(URL);
if (!res.ok) { console.error("download failed", res.status); process.exit(1); }
const bytes = new Uint8Array(await res.arrayBuffer());
mkdirSync(join(process.cwd(), "public/vello-wasm"), { recursive: true });
writeFileSync(DEST, bytes);
console.log("saved", DEST, bytes.length, "bytes");
