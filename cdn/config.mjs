/**
 * Recut CDN 配置。
 *
 * 资源统一托管在 Cloudflare R2 bucket（recut-assets），通过
 * cdn.recut.video 自定义域分发。cdn/buckets/{name}/ 是每个 bucket 前缀的
 * 本地暂存区（先编排、再上传、后可删除），上传后对象 key 形如
 * {name}/...，访问 URL 为 {baseUrl}/{name}/...
 *
 * 配置优先级：环境变量 > cdn/.env（本地凭据，gitignored）> 本文件默认值。
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** 加载 cdn/.env（若有），仅填充尚未设置的环境变量。 */
function loadLocalEnv() {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), ".env");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadLocalEnv();

export const CDN = {
  /** R2 bucket 名（单个 bucket，前缀区分资源类型） */
  bucket: process.env.R2_BUCKET ?? "recut-assets",
  /** Cloudflare Account ID（wrangler r2 操作需要） */
  accountId:
    process.env.CLOUDFLARE_ACCOUNT_ID ?? "eb5cc0bf8660b4e3d90734214c193ff5",
  /** CDN 公开访问域名（bucket 自定义域） */
  baseUrl: process.env.CDN_BASE_URL ?? "https://cdn.recut.video",
  /** recut.video zone（cdn.recut.video 自定义域所属），cache purge 需要 */
  zoneId: process.env.CDN_ZONE_ID ?? "274e2ed9725461e2f0db6271b9618edb",
  /** Cloudflare API Token（Zone > Cache Purge 权限），purge 缓存需要 */
  apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
};

/** wrangler 可执行路径（web workspace 已安装 wrangler）。 */
export function wranglerPath() {
  return (
    process.env.WRANGLER_BIN ??
    new URL("../web/node_modules/.bin/wrangler", import.meta.url).pathname
  );
}

/** 本地暂存区根目录 cdn/buckets/。 */
export function bucketsRoot() {
  return new URL("./buckets/", import.meta.url).pathname;
}

/** 某个前缀的本地暂存目录 cdn/buckets/{name}/。 */
export function bucketDir(name) {
  return new URL(`./buckets/${name}/`, import.meta.url).pathname;
}
