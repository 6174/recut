/**
 * R2 资源管理核心库（S3 兼容 API）。
 *
 * 对象级操作（上传/列表/删除/HEAD）统一走 S3 兼容 API
 * （https://<ACCOUNT_ID>.r2.cloudflarestorage.com，region=auto），因为
 * wrangler r2 命令走 Cloudflare REST API，账号级限流 ~4 req/s，上传大量小
 * 对象慢且并发会 429。S3 API 无 1200/5min 限制，可真正并发。
 *
 * 仅 purge（Cloudflare Cache Purge）保留在 Cloudflare API（CLOUDFLARE_API_TOKEN）。
 *
 * 所有资源统一进 recut-assets bucket，对象 key = {prefix}/{relPath}，
 * 访问 URL = {baseUrl}/{prefix}/{relPath}。
 *
 * 用法：import { uploadPrefix, listObjects, ... } from "./r2.mjs";
 */

import { readdirSync, readFileSync, statSync, existsSync, createReadStream } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHmac, createHash } from "node:crypto";
import { CDN, bucketDir } from "../config.mjs";

const REGION = "auto";
const SERVICE = "s3";

function s3Credentials() {
  return {
    accountId: CDN.accountId,
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  };
}

function requireS3Credentials() {
  const cred = s3Credentials();
  if (!cred.accountId || !cred.accessKeyId || !cred.secretAccessKey) {
    throw new Error(
      "R2 S3 凭据缺失。请在 Cloudflare R2 → Manage API Tokens 创建 token，并导出：\n" +
        "  export R2_ACCESS_KEY_ID=<access key id>\n" +
        "  export R2_SECRET_ACCESS_KEY=<secret access key>\n" +
        "（R2_ACCOUNT_ID 可用 CLOUDFLARE_ACCOUNT_ID 或 config.mjs 默认值）",
    );
  }
  return cred;
}

function s3Endpoint(accountId) {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/* --- AWS Signature V4（零依赖实现） ------------------------------------ */

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}
function sha256hex(data) {
  return createHash("sha256").update(data).digest("hex");
}
function amzDate(now) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
function shortDate(long) {
  return long.slice(0, 8);
}
function signingKey(cred, dateLong) {
  const kDate = hmac(`AWS4${cred.secretAccessKey}`, shortDate(dateLong));
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}
/** RFC3986 编码（保留 A-Za-z0-9-._~）。 */
function uriEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function canonicalHeaders(headers) {
  return Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
}
function signedHeaderNames(headers) {
  return Object.keys(headers).sort().join(";");
}

/** 生成 S3 请求的 Authorization 头。params 为 query 参数对象。 */
function authorize({ method, path, params, headers, payload, dateLong, cred }) {
  const query = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join("&");
  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders(headers),
    signedHeaderNames(headers),
    sha256hex(payload),
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateLong,
    `${shortDate(dateLong)}/${REGION}/${SERVICE}/aws4_request`,
    sha256hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(signingKey(cred, dateLong), stringToSign).toString(
    "hex",
  );
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${shortDate(dateLong)}/${REGION}/${SERVICE}/aws4_request, SignedHeaders=${signedHeaderNames(headers)}, Signature=${signature}`,
    query,
  };
}

/**
 * 发送一个已签名的 S3 请求。key 为对象 key（不含 bucket）。
 * 返回 fetch Response。
 */
async function s3Request({ method, key, query = {}, body, contentType }) {
  const cred = requireS3Credentials();
  const dateLong = amzDate(new Date());
  // 签名与请求都包含 bucket 段：/{bucket}/{key}
  const path = `/${CDN.bucket}/${key.split("/").map(uriEncode).join("/")}`;
  const headers = {
    host: new URL(s3Endpoint(cred.accountId)).host,
    "x-amz-content-sha256": sha256hex(body ?? ""),
    "x-amz-date": dateLong,
  };
  if (contentType) headers["content-type"] = contentType;
  const { authorization, query: signedQuery } = authorize({
    method,
    path,
    params: query,
    headers,
    payload: body ?? "",
    dateLong,
    cred,
  });
  headers.authorization = authorization;
  const qs = signedQuery ? `?${signedQuery}` : "";
  return fetch(`${s3Endpoint(cred.accountId)}${path}${qs}`, {
    method,
    headers,
    body: body ?? undefined,
  });
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

/** 列出 R2 bucket 中某个前缀下的对象 key（S3 ListObjectsV2，自动分页）。 */
export async function listObjects(prefix) {
  const keys = [];
  let token = "";
  for (;;) {
    const query = { "list-type": "2", prefix: `${prefix}/`, "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const res = await s3Request({
      method: "GET",
      key: "",
      query,
    });
    const xml = await res.text();
    if (!res.ok) {
      throw new Error(`list ${prefix} failed: HTTP ${res.status} ${xml.slice(0, 200)}`);
    }
    keys.push(...[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((x) => x[1]));
    token = (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1];
    if (!token) break;
  }
  return keys.sort();
}

/** HEAD 探测远端对象；返回 { size, etag }（etag 为 R2 单段 PUT 的 MD5 十六进制，无 ETag 时为空串，不存在/失败时 size=-1）。 */
async function headObject(key) {
  try {
    const res = await s3Request({ method: "HEAD", key });
    if (res.status === 200) {
      const etag = (res.headers.get("etag") ?? "")
        .replace(/^W\//, "")
        .replace(/^"|"$/g, "")
        .toLowerCase();
      const size = Number(res.headers.get("content-length") ?? -1);
      return { size, etag };
    }
    return { size: -1, etag: "" };
  } catch {
    return { size: -1, etag: "" };
  }
}

/** 流式计算本地文件 MD5（十六进制，与 R2 单段 PUT 的 ETag 对齐）。 */
function md5File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    const rs = createReadStream(path);
    rs.on("data", (chunk) => hash.update(chunk));
    rs.on("end", () => resolve(hash.digest("hex")));
    rs.on("error", reject);
  });
}

/**
 * 上传 cdn/buckets/{prefix}/ 下指定文件到 R2（对象 key = {prefix}/{rel}）。S3 并发上传。
 * options.only 限定上传子集：目录或文件相对路径，如 ["0.1.33", "latest/manifest.json"]；
 * 为空则上传整个目录树。历史版本目录不可变，发布时应只传新版本 + latest 指针。
 */
export async function uploadPrefix(prefix, { concurrency = 16, retries = 3, skipExisting = false, only = [] } = {}) {
  const dir = bucketDir(prefix);
  let files = listLocalFiles(dir);
  if (only.length > 0) {
    files = files.filter((f) => only.some((o) => f === o || f.startsWith(`${o}/`)));
  }
  if (files.length === 0) {
    console.log(`[s3] ${prefix}: nothing to upload`);
    return [];
  }

  console.log(
    `[s3] uploading ${files.length} files → ${CDN.bucket}/${prefix}/ (concurrency=${concurrency}, skip-existing=${skipExisting})`,
  );
  const started = Date.now();
  let cursor = 0;
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const failures = [];

  const putOne = async (rel) => {
    const key = `${prefix}/${rel}`;
    const localPath = join(dir, rel);
    const localSize = statSync(localPath).size;
    // skip-existing：HEAD 远端对象，MD5 与 ETag 一致才跳过（size 不可靠：如
    // latest/manifest.json 每个版本都是 1152 字节、内容却不同，且 gzip 响应无
    // content-length 头）；同名不同内容必须覆盖。
    if (skipExisting) {
      const remote = await headObject(key);
      if (remote.etag && (await md5File(localPath)) === remote.etag) {
        skipCount += 1;
        return;
      }
      // 远端对象存在但无 ETag（代理/异常对象）时退化为大小比较。
      if (!remote.etag && remote.size === localSize) {
        skipCount += 1;
        return;
      }
    }
const contentType = guessContentType(rel);
    const body = readFileSync(localPath);
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await s3Request({
          method: "PUT",
          key,
          body,
          contentType,
        });
        if (res.ok) {
          okCount += 1;
          return;
        }
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
          const delay = Math.min(500 * 2 ** (attempt - 1), 4000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        lastErr = new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
        break; // 其它 4xx 不重试
      } catch (e) {
        lastErr = e;
        const delay = Math.min(500 * 2 ** (attempt - 1), 4000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    failCount += 1;
    failures.push(`${key}: ${lastErr.message.split("\n")[0]}`);
  };

  // 有界并发：固定 worker 数从队列取任务；进度按"完成数"上报（小批次逐文件、大批次每 250 个一批）
  const logProgress = (completed, rel) => {
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (files.length <= 100) {
      console.log(`[s3] ${prefix}: ${completed}/${files.length} ${rel} (ok=${okCount} skip=${skipCount} fail=${failCount}) elapsed=${elapsed}s`);
    } else if (completed % 250 === 0 || completed === files.length) {
      console.log(`[s3] ${prefix}: ${completed}/${files.length} (ok=${okCount} skip=${skipCount} fail=${failCount}) elapsed=${elapsed}s`);
    }
  };
  let completed = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= files.length) return;
      const rel = files[index];
      await putOne(rel);
      completed += 1;
      logProgress(completed, rel);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  if (failures.length > 0) {
    console.warn(`[s3] ${prefix}: ${failures.length} uploads failed after ${retries} retries`);
    for (const f of failures.slice(0, 20)) console.warn(`  ✗ ${f}`);
    if (failures.length > 20) console.warn(`  … and ${failures.length - 20} more`);
    process.exitCode = 1;
  } else {
    console.log(`[s3] ${prefix}: done ok=${okCount} skip=${skipCount} in ${Math.round((Date.now() - started) / 1000)}s`);
  }
  return files.map((rel) => `${prefix}/${rel}`);
}

/** 删除 R2 bucket 中的单个对象。 */
export async function deleteObject(key) {
  const res = await s3Request({ method: "DELETE", key });
  if (!res.ok && res.status !== 204) {
    throw new Error(`delete ${key} failed: HTTP ${res.status}`);
  }
  console.log(`  ✗ ${key}`);
}

/** 删除 R2 bucket 中某个前缀下的全部对象（S3 DeleteObjects 批量，最多 1000/批）。 */
export async function deletePrefix(prefix) {
  const keys = await listObjects(prefix);
  if (keys.length === 0) {
    console.log(`[s3] ${prefix}: nothing to delete`);
    return;
  }
  console.log(`[s3] deleting ${keys.length} objects under ${prefix}/`);
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Delete><Quiet>true</Quiet>` +
      batch.map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`).join("") +
      `</Delete>`;
    const res = await s3Request({
      method: "POST",
      key: "",
      query: { delete: "" },
      body,
      contentType: "application/xml",
    });
    const xml = await res.text();
    if (!res.ok || /<Error>/.test(xml)) {
      throw new Error(`delete batch failed: HTTP ${res.status} ${xml.slice(0, 200)}`);
    }
  }
  console.log(`[s3] ${prefix}: deleted ${keys.length} objects`);
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[c]);
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
 * 需要 CDN.apiToken（Zone > Cache Purge 权限）。这是 Cloudflare API，不是 S3。
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
export async function prefixUrls(prefix) {
  return (await listObjects(prefix)).map((key) => objectUrl(prefix, key));
}
