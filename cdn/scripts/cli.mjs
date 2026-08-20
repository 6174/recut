#!/usr/bin/env node
/**
 * Recut CDN 资源管理 CLI。
 *
 * 用法：
 *   node cdn/scripts/cli.mjs upload <prefix>     # 上传 cdn/buckets/{prefix}/ 到 R2
 *     --skip-existing                          # MD5/ETag 一致则跳过（只补缺和变更）
 *     --only <子目录或文件路径>（可多次）        # 只上传该子集，如 release 只推新版本与 latest
 *   node cdn/scripts/cli.mjs list <prefix>       # 列出 R2 中的 {prefix}/ 对象
 *   node cdn/scripts/cli.mjs delete <prefix>     # 删除 R2 中的 {prefix}/ 对象
 *   node cdn/scripts/cli.mjs sync <prefix>       # 上传缺失/变更文件（按 size 简比）
 *   node cdn/scripts/cli.mjs url <prefix> <key>  # 打印对象公开 URL
 *   node cdn/scripts/cli.mjs purge <prefix>      # 清理 {prefix}/ 全部对象的 CDN 缓存
 *   node cdn/scripts/cli.mjs purge <prefix> <key># 清理单个对象（key 可带或不带 {prefix}/）
 *   node cdn/scripts/cli.mjs whoami              # 打印 CDN 配置
 *
 * 前缀（prefix）与 cdn/buckets/ 下的子目录名一致，如 audio。
 */

import {
  uploadPrefix,
  listObjects,
  deletePrefix,
  objectUrl,
  listLocalFiles,
  purgeUrls,
  prefixUrls,
} from "./r2.mjs";
import { CDN, bucketDir } from "../config.mjs";

const [cmd, prefix, arg] = process.argv.slice(2);

function requirePrefix() {
  if (!prefix) {
    console.error("usage: cli.mjs <upload|list|delete|sync|url|purge> <prefix> [key]");
    process.exit(1);
  }
  return prefix;
}

async function run() {
  switch (cmd) {
    case "upload": {
      const p = requirePrefix();
      let skipExisting = false;
      const only = [];
      for (let i = 3; i < process.argv.length; i++) {
        const a = process.argv[i];
        if (a === "--skip-existing") skipExisting = true;
        else if (a === "--only") only.push(process.argv[++i]);
      }
      // --skip-existing：HEAD 比对 MD5/ETag 只补缺失/变更对象；--only 把更新限定到本版本与 latest。
      await uploadPrefix(p, { skipExisting, only });
      break;
    }
    case "list": {
      const p = requirePrefix();
      const keys = await listObjects(p);
      console.log(`[s3] ${CDN.bucket}/${p}/ -> ${keys.length} objects`);
      for (const k of keys) console.log(`  ${k}  ${objectUrl(p, k)}`);
      break;
    }
    case "delete": {
      const p = requirePrefix();
      await deletePrefix(p);
      break;
    }
    case "sync": {
      const p = requirePrefix();
      const remote = new Set(await listObjects(p));
      const local = new Set(listLocalFiles(bucketDir(p)).map((f) => `${p}/${f}`));
      const missing = [...local].filter((k) => !remote.has(k));
      console.log(`[s3] sync ${p}: local=${local.size} remote=${remote.size} missing=${missing.length}`);
      if (missing.length > 0) {
        await uploadPrefix(p);
      }
      break;
    }
    case "url": {
      const p = requirePrefix();
      if (!arg) {
        console.error("usage: cli.mjs url <prefix> <key>");
        process.exit(1);
      }
      console.log(objectUrl(p, arg));
      break;
    }
    case "purge": {
      const p = requirePrefix();
      if (arg) {
        const key = arg.startsWith(`${p}/`) ? arg : `${p}/${arg}`;
        await purgeUrls([objectUrl(p, key)]);
      } else {
        await purgeUrls(prefixUrls(p));
      }
      break;
    }
    case "purge-all": {
      if (!CDN.apiToken) {
        throw new Error(
          "CLOUDFLARE_API_TOKEN 未配置。请在 https://dash.cloudflare.com/profile/api-tokens 生成带 Zone > Cache Purge 权限的 API Token 并导出。",
        );
      }
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${CDN.zoneId}/purge_cache`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${CDN.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ purge_everything: true }),
        },
      );
      const json = await res.json().catch(() => null);
      if (!json || !json.success) {
        throw new Error(
          `purge_cache failed: ${JSON.stringify(json?.errors ?? json)}`,
        );
      }
      console.log("[purge] zone cache purged");
      break;
    }
    case "whoami": {
      console.log(JSON.stringify(CDN, null, 2));
      break;
    }
    default: {
      console.log(
        `Recut CDN CLI\n  bucket: ${CDN.bucket}\n  baseUrl: ${CDN.baseUrl}\n\n` +
          `Usage: cli.mjs <upload|list|delete|sync|url|purge> <prefix> [key]`,
      );
    }
  }
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
