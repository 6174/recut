#!/usr/bin/env node
/**
 * Fetch a curated set of Google Fonts into cdn/buckets/fonts/google and generate
 * {id}.css + {id}/{subset}-{weight}[i].woff2 + catalog.json.
 *
 * Google Fonts CSS2 API returns per-subset @font-face blocks with unicode-range
 * when served a modern Chromium UA; each block's woff2 is downloaded and stored
 * under its unicode-range subset. The generated CSS rewrites src urls to Recut's
 * own CDN (cdn.recut.video) so runtime never touches fonts.googleapis.com /
 * fonts.gstatic.com.
 *
 * Usage: node scripts/fetch-fonts.mjs
 * Requires network access to fonts.googleapis.com (build-time only).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const FONT_DIR = join(ROOT, "buckets", "fonts", "google");

const CDN_BASE =
  process.env.CDN_BASE_URL ?? "https://cdn.recut.video/fonts/google";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Curated families: id (url-slug), family name, category, scripts marker.
 * CJK families are the core value: they render Chinese/Japanese glyphs and are
 * normally unavailable to restricted networks when loaded from Google.
 */
const FONTS = [
  // Latin workhorses
  { id: "inter", family: "Inter", category: "sans-serif", scripts: ["latin"] },
  { id: "roboto", family: "Roboto", category: "sans-serif", scripts: ["latin"] },
  { id: "open-sans", family: "Open Sans", category: "sans-serif", scripts: ["latin"] },
  { id: "montserrat", family: "Montserrat", category: "sans-serif", scripts: ["latin"] },
  { id: "lato", family: "Lato", category: "sans-serif", scripts: ["latin"] },
  { id: "poppins", family: "Poppins", category: "sans-serif", scripts: ["latin"] },
  { id: "oswald", family: "Oswald", category: "sans-serif", scripts: ["latin"] },
  { id: "bebas-neue", family: "Bebas Neue", category: "sans-serif", scripts: ["latin"] },
  { id: "space-grotesk", family: "Space Grotesk", category: "sans-serif", scripts: ["latin"] },
  { id: "playfair-display", family: "Playfair Display", category: "serif", scripts: ["latin"] },
  { id: "merriweather", family: "Merriweather", category: "serif", scripts: ["latin"] },
  { id: "roboto-mono", family: "Roboto Mono", category: "monospace", scripts: ["latin"] },
  { id: "great-vibes", family: "Great Vibes", category: "handwriting", scripts: ["latin"] },
  // 字幕主题引用家族（remotion-studio captions themes）：补齐 curator 覆盖，避免预览/导出回退
  { id: "outfit", family: "Outfit", category: "sans-serif", scripts: ["latin"] },
  { id: "rajdhani", family: "Rajdhani", category: "sans-serif", scripts: ["latin"] },
  { id: "dancing-script", family: "Dancing Script", category: "handwriting", scripts: ["latin"] },
  // CJK — Simplified Chinese (SC) / Hong Kong (HK)
  { id: "noto-sans-sc", family: "Noto Sans SC", category: "sans-serif", scripts: ["zh"] },
  { id: "noto-serif-sc", family: "Noto Serif SC", category: "serif", scripts: ["zh"] },
  { id: "noto-sans-hk", family: "Noto Sans HK", category: "sans-serif", scripts: ["zh"] },
  { id: "zcool-qingke-huangyou", family: "ZCOOL QingKe HuangYou", category: "sans-serif", scripts: ["zh"] },
  { id: "zcool-kuailes", family: "ZCOOL KuaiLe", category: "display", scripts: ["zh"] },
  { id: "zcool-xiaowei", family: "ZCOOL XiaoWei", category: "serif", scripts: ["zh"] },
  { id: "ma-shan-zheng", family: "Ma Shan Zheng", category: "handwriting", scripts: ["zh"] },
  { id: "liu-jian-mao-cao", family: "Liu Jian Mao Cao", category: "handwriting", scripts: ["zh"] },
  { id: "long-cang", family: "Long Cang", category: "handwriting", scripts: ["zh"] },
  { id: "zhi-mang-xing", family: "Zhi Mang Xing", category: "handwriting", scripts: ["zh"] },
  // CJK — Traditional Chinese (TC)
  { id: "noto-sans-tc", family: "Noto Sans TC", category: "sans-serif", scripts: ["zh"] },
  { id: "noto-serif-tc", family: "Noto Serif TC", category: "serif", scripts: ["zh"] },
  // CJK — Japanese
  { id: "noto-sans-jp", family: "Noto Sans JP", category: "sans-serif", scripts: ["ja"] },
  { id: "noto-serif-jp", family: "Noto Serif JP", category: "serif", scripts: ["ja"] },
  { id: "zen-maru-gothic", family: "Zen Maru Gothic", category: "sans-serif", scripts: ["ja"] },
  { id: "zen-kaku-gothic-new", family: "Zen Kaku Gothic New", category: "sans-serif", scripts: ["ja"] },
  { id: "m-plus-1p", family: "M PLUS 1p", category: "sans-serif", scripts: ["ja"] },
  { id: "m-plus-rounded-1c", family: "M PLUS Rounded 1c", category: "sans-serif", scripts: ["ja"] },
  { id: "klee-one", family: "Klee One", category: "handwriting", scripts: ["ja"] },
  { id: "dotgothic16", family: "DotGothic16", category: "display", scripts: ["ja"] },
  { id: "yuji-syuku", family: "Yuji Syuku", category: "serif", scripts: ["ja"] },
];

/** Default weights fetched per family (weight list passed to CSS2 API). */
const DEFAULT_WEIGHTS = [400, 700];

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** One @font-face block plus its optional preceding comment subset name. */
function parseFaces(css, familyId) {
  const faces = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/g;
  const commentRe = /\/\*\s*([\w-]+)\s*\*\/\s*(?:@font-face\s*\{)?/g;
  let block;
  let index = 0;
  const comments = [];
  let comment;
  while ((comment = commentRe.exec(css)) !== null) {
    comments.push({ index: comment.index, subset: comment[1] });
  }
  while ((block = blockRe.exec(css)) !== null) {
    // Nearest preceding comment (subset label), e.g. /* latin */.
    let subset = "";
    for (const c of comments) {
      if (c.index < block.index) subset = c.subset;
    }
    const body = block[1];
    const weight = /font-weight:\s*(\d+)/.exec(body)?.[1] ?? "400";
    const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? "normal";
    const urlMatch = /url\(([^)]+)\)/.exec(body);
    if (!urlMatch) continue;
    const srcUrl = urlMatch[1];
    const range = /unicode-range:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? "";
    const italic = style === "italic" ? "i" : "";
    // CJK fonts emit hundreds of unicode-range slices whose @font-face blocks
    // carry no comment label; the gstatic URL identifies each by a numeric
    // suffix (…/abc.NNN.woff2). Derive the subset id from it.
    if (!subset) {
      const numeric = /\.(\d{2,3})\.woff2$/.exec(srcUrl)?.[1];
      subset = numeric ? `slice-${numeric}` : `slice-${faces.length}`;
    }
    const file = `${subset}-${weight}${italic}.woff2`;
    faces.push({ subset, weight, style, range, srcUrl, file });
  }
  if (faces.length === 0) {
    throw new Error(`no @font-face blocks parsed for ${familyId}`);
  }
  return faces;
}

/** Rewrite a parsed face's src url to the Recut CDN path. */
function cdnUrl(familyId, file) {
  return `${CDN_BASE}/${familyId}/${file}`;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`empty download for ${url}`);
  writeFileSync(dest, buf);
}

/** Download a list of {url,dest} with bounded concurrency, skipping existing files. */
async function downloadMany(items, concurrency = 8) {
  let next = 0;
  let ok = 0;
  let failed = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const { url, dest } = items[index];
      try {
        if (!existsSync(dest) || readFileSync(dest).length === 0) {
          await download(url, dest);
        }
        ok += 1;
      } catch (e) {
        failed += 1;
        console.warn(`  ✗ ${url.split("/").pop()}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { ok, failed };
}

function buildCss(familyId, family, faces) {
  const lines = [];
  for (const face of faces) {
    lines.push(`/* ${face.subset} */`);
    lines.push("@font-face {");
    lines.push(`  font-family: '${family.replace(/'/g, "\\'")}';`);
    lines.push(`  font-style: ${face.style};`);
    lines.push(`  font-weight: ${face.weight};`);
    lines.push("  font-display: swap;");
    lines.push(`  src: url(${cdnUrl(familyId, face.file)}) format('woff2');`);
    if (face.range) lines.push(`  unicode-range: ${face.range};`);
    lines.push("}");
  }
  return lines.join("\n") + "\n";
}

async function main() {
  mkdirSync(FONT_DIR, { recursive: true });
  // 保留既有 catalog（离线/上游失败时回退），新运行只增改；避免网络故障清空目录。
  const catalogPath = join(FONT_DIR, "catalog.json");
  let previous = [];
  let previousVersion = 0;
  try {
    const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    previous = Array.isArray(raw.google) ? raw.google : [];
    previousVersion = Number(raw.version || 0) || 0;
  } catch (_) { /* 首次运行无既有目录 */ }
  const byId = new Map(previous.map((entry) => [entry.id, entry]));
  const catalog = { version: previousVersion + 1, generatedAt: new Date().toISOString(), google: [] };

  for (const spec of FONTS) {
    const familyId = spec.id;
    const weights = [...(spec.weights ?? DEFAULT_WEIGHTS)];
    // it=1 covers italic; regular + italic for each weight.
    const axis = `ital,wght@0,${weights.join(";0,")};1,${weights.join(";1,")}`;
    const apiUrl = `https://fonts.googleapis.com/css2?family=${spec.family.replace(
      / /g,
      "+",
    )}:${axis}&display=swap`;
    console.log(`=== ${spec.family} (${familyId}) ===`);

    let css;
    try {
      const res = await fetch(apiUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      css = await res.text();
    } catch (e) {
      css = null;
      const existing = byId.get(familyId);
      if (existing) {
        catalog.google.push({ ...existing, family: spec.family, category: spec.category, scripts: spec.scripts });
        console.warn(`  ↻ ${familyId}: css fetch failed (${e.message}); keeping existing catalog entry`);
        continue;
      }
      console.warn(`  ✗ ${familyId}: fetch css failed: ${e.message}`);
      continue;
    }

    let faces;
    try {
      faces = parseFaces(css, familyId);
    } catch (e) {
      const existing = byId.get(familyId);
      if (existing) {
        catalog.google.push({ ...existing, family: spec.family, category: spec.category, scripts: spec.scripts });
        console.warn(`  ↻ ${familyId}: ${e.message}; keeping existing catalog entry`);
        continue;
      }
      console.warn(`  ✗ ${familyId}: ${e.message}`);
      continue;
    }

    const dir = join(FONT_DIR, familyId);
    mkdirSync(dir, { recursive: true });
    const toDownload = faces
      .filter((face) => !existsSync(join(dir, face.file)) || readFileSync(join(dir, face.file)).length === 0)
      .map((face) => ({ url: face.srcUrl, dest: join(dir, face.file) }));
    const { ok, failed } = toDownload.length
      ? await downloadMany(toDownload)
      : { ok: faces.length, failed: 0 };
    const downloaded = faces.filter((face) => existsSync(join(dir, face.file))).length;

    writeFileSync(join(FONT_DIR, `${familyId}.css`), buildCss(familyId, spec.family, faces));

    catalog.google.push({
      id: familyId,
      family: spec.family,
      category: spec.category,
      scripts: spec.scripts,
      weights,
      faces: faces
        .filter((face) => existsSync(join(dir, face.file)))
        .map((face) => ({
          subset: face.subset,
          weight: face.weight,
          style: face.style,
          unicodeRange: face.range,
          file: face.file,
        })),
    });
    console.log(`  ✓ ${downloaded}/${faces.length} woff2 (${failed} new failed), ${faces.length} faces`);
  }

  writeFileSync(
    join(FONT_DIR, "catalog.json"),
    JSON.stringify(catalog, null, 2),
  );
  console.log(`\nDone. families=${catalog.google.length}`);
  console.log(`Catalog: ${join(FONT_DIR, "catalog.json")}`);
  console.log(`Upload with: make upload PREFIX=fonts`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
