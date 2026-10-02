#!/usr/bin/env node
/*
 * [INPUT]: 一个 liblib.tv 作品 detail URL 或 32 位 uuid；网络访问 api.liblib.tv
 * [OUTPUT]: 在输出目录写 template.json（接口原始返回）、snapshot.json（解析后的节点图）、meta.json（作者/成品/计数），
 *   并在 stdout 打印摘要
 * [POS]: docs/analyze-libtv 的第一步——把某个作品的制作图从接口完整取下来（不需要浏览器）
 * [PROTOCOL]: 变更时更新此头部，然后检查 docs/analyze-libtv/README.md
 *
 * 用法:
 *   node docs/analyze-libtv/scripts/fetch-project.mjs <detailUrl|uuid> [--out <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, extractUuid, apiUrl, detailUrl, outDirFor, UA, writeJson } from "./lib/env.mjs";

const USAGE = `用法: node fetch-project.mjs <detailUrl|uuid> [--out <dir>]
示例: node fetch-project.mjs https://www.liblib.tv/detail/d6e06a451e9642efa7f92b2af7896f8f`;

const args = parseArgs();
const input = args.url || args.uuid || args._[0];
if (!input) {
  console.error(USAGE);
  process.exit(1);
}

const uuid = extractUuid(input);
const out = outDirFor(uuid, args.out);
console.log(`[fetch] uuid=${uuid}\n[fetch] out=${out}`);

const res = await fetch(apiUrl(uuid), {
  headers: { accept: "application/json", "user-agent": UA, referer: detailUrl(uuid) },
});
console.log(`[fetch] HTTP ${res.status}`);
if (!res.ok) {
  console.error(`接口返回非 200，退出。`);
  process.exit(1);
}

const json = await res.json();
writeJson(path.join(out, "template.json"), json);

const detail = json?.data?.detail;
if (!detail) {
  console.error("[fetch] 返回里没有 data.detail（可能不是作品模板）。已保存 template.json 供排查。");
  process.exit(2);
}

let snapshot = null;
if (typeof detail.snapshotData === "string" && detail.snapshotData.trim()) {
  try {
    snapshot = JSON.parse(detail.snapshotData);
    writeJson(path.join(out, "snapshot.json"), snapshot);
  } catch (e) {
    console.error(`[fetch] snapshotData 不是合法 JSON: ${e.message}`);
  }
}

const meta = {
  templateUuid: detail.templateUuid,
  projectUuid: detail.projectUuid,
  name: detail.name,
  description: detail.description,
  nickname: detail.nickname,
  ownerUuid: detail.ownerUuid,
  coverUrl: detail.coverUrl,
  finalOutput: detail.finalOutput,
  tags: (detail.tags ?? []).map((t) => t.tagLabel),
  createAt: detail.createAt,
  updateAt: detail.updateAt,
  playCount: detail.playCount,
  viewCreationProcessCount: detail.viewCreationProcessCount,
  copyCanvasCount: detail.copyCanvasCount,
  nodeCount: snapshot?.nodes?.length ?? 0,
  edgeCount: snapshot?.edges?.length ?? 0,
};
writeJson(path.join(out, "meta.json"), meta);

console.log(`\n=== ${meta.name} · ${meta.nickname} ===`);
console.log(`成品: ${meta.finalOutput}`);
console.log(`图: ${meta.nodeCount} 节点 / ${meta.edgeCount} 边`);
console.log(`标签: ${meta.tags.join(", ")}`);
console.log(`\n下一步: node docs/analyze-libtv/scripts/analyze-snapshot.mjs --in "${out}"`);
