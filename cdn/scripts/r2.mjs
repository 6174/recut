/**
 * R2 资源管理核心库。
 *
 * 封装 wrangler r2 命令，提供「本地暂存区 ↔ R2 bucket 前缀」的同步、
 * 列出、删除与 URL 生成。所有资源统一进 recut-assets bucket，
 * 对象 key = {prefix}/{relPath}，访问 URL = {baseUrl}/{prefix}/{relPath}。
 *
 * 用法：import { uploadPrefix, listObjects, ... } from "./r2.mjs";
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CDN, wranglerPath, bucketDir } from "../config.mjs";

function runWrangler(args) {
  const res = spawnSync(wranglerPath(), args, {
    cwd: new URL("../../web/", import.meta.url).pathname,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(
      `wrangler ${args.join(" ")} failed (${res.status}):\n${res.stderr || res.stdout}`,
    );
  }
  return res.stdout;
}

/** 对象 key -> 公开 URL。 */
export function objectUrl(prefix, key) {
  const rel = key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : key;
  return `${CDN.baseUrl}/${prefix}/${rel}`;
}

/** 递归收集本地暂存目录中的文件（相对路径列表）。 */
export function listLocalFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** 上传 cdn/buckets/{prefix}/ 全部文件到 R2（对象 key = {prefix}/{rel}）。 */
export function uploadPrefix(prefix) {
  const dir = bucketDir(prefix);
  const files = listLocalFiles(dir);
  if (files.length === 0) {
    console.log(`[r2] ${prefix}: nothing to upload`);
    return [];
  }
  console.log(`[r2] uploading ${files.length} files to ${CDN.bucket}/${prefix}/`);
  for (const rel of files) {
    const localPath = join(dir, rel);
    const key = `${prefix}/${rel}`;
    const contentType = guessContentType(rel);
    const args = [
      "r2",
      "object",
      "put",
      `${CDN.bucket}/${key}`,
      "--file",
      localPath,
    ];
    if (contentType) args.push("--content-type", contentType);
    try {
      runWrangler(args);
      console.log(`  ↑ ${key}`);
    } catch (e) {
      console.warn(`  ✗ ${key}: ${e.message.split("\n")[0]}`);
    }
  }
  return files.map((rel) => `${prefix}/${rel}`);
}

/** 列出 R2 bucket 中某个前缀下的对象 key（按前缀过滤）。 */
export function listObjects(prefix) {
  const out = runWrangler(["r2", "object", "list", CDN.bucket, "--prefix", `${prefix}/`]);
  // wrangler list 输出形如 "name  size  modified"；解析 name 字段
  const keys = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*([^\s]+)\s+\d+\s+.*$/);
    if (m && m[1] !== "name") keys.push(m[1]);
  }
  return keys.sort();
}

/** 删除 R2 bucket 中的单个对象。 */
export function deleteObject(key) {
  runWrangler(["r2", "object", "delete", `${CDN.bucket}/${key}`]);
  console.log(`  ✗ ${key}`);
}

/** 删除 R2 bucket 中某个前缀下的全部对象。 */
export function deletePrefix(prefix) {
  const keys = listObjects(prefix);
  if (keys.length === 0) {
    console.log(`[r2] ${prefix}: nothing to delete`);
    return;
  }
  for (const key of keys) deleteObject(key);
}

function guessContentType(rel) {
  const ext = rel.split(".").pop().toLowerCase();
  const map = {
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    ttf: "font/ttf",
    woff2: "font/woff2",
  };
  return map[ext];
}

/** 读取本地暂存 catalog 的 JSON。 */
export function readCatalog(prefix, name = "catalog.json") {
  const p = join(bucketDir(prefix), name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/**
 * 通过 Cloudflare Cache Purge API 精确清理边缘缓存中的 URL。
 * 需要 CDN.apiToken（Zone > Cache Purge 权限）。
 */
export async function purgeUrls(urls) {
  if (urls.length === 0) {
    console.log("[purge] nothing to purge");
    return;
  }
  if (!CDN.apiToken) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN 未配置。请在 Cloudflare 面板生成带 Zone > Cache Purge 权限的 API Token 并导出，如：\n" +
        "  export CLOUDFLARE_API_TOKEN=your_token\n" +
        "生成路径：https://dash.cloudflare.com/profile/api-tokens -> Create Token -> Cache Purge",
    );
  }
  // Cloudflare API 单次最多 30 个 URL，按批清理。
  const CHUNK = 30;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${CDN.zoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CDN.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: chunk }),
      },
    );
    const json = await res.json().catch(() => null);
    if (!json || !json.success) {
      throw new Error(
        `purge_cache failed: ${JSON.stringify(json?.errors ?? json)}`,
      );
    }
    console.log(`[purge] ${chunk.length} urls purged`);
  }
}

/** 某个前缀下的全部对象对应的 CDN URL。 */
export function prefixUrls(prefix) {
  return listObjects(prefix).map((key) => objectUrl(prefix, key));
}
