#!/usr/bin/env node
/**
 * [INPUT]: 全局设计系统 skill 目录（service/skills/recut-design-system/design-systems）
 * [OUTPUT]: 每个设计系统包只保留核心契约文件 DESIGN.md / tokens.css / tailwind-v4.css，
 *           删除其余所有文件与子目录（preview/ source/ system/ assets/ fonts/ components.html
 *           components.manifest.json design-tokens.json USAGE.md manifest.json 等）。
 *          顶层 SKILL.md / README.md 保留。
 * [POS]: 设计系统 skill 的瘦身工具；把 Open Design 的富包裁剪为 agent 可读的最小契约集
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { readdirSync, statSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "service", "skills", "recut-design-system");
const SYSTEMS = join(ROOT, "design-systems");

const KEEP_FILES = new Set(["DESIGN.md", "tokens.css", "tailwind-v4.css"]);

function prune(dir) {
  let removedFiles = 0;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const isDir = statSync(abs).isDirectory();
    if (isDir) {
      rmSync(abs, { recursive: true, force: true });
      removedFiles += 1;
      console.log(`  rm -r ${entry}/`);
    } else if (!KEEP_FILES.has(entry)) {
      rmSync(abs, { force: true });
      removedFiles += 1;
      console.log(`  rm ${entry}`);
    }
  }
  return removedFiles;
}

let total = 0;
for (const entry of readdirSync(SYSTEMS)) {
  const abs = join(SYSTEMS, entry);
  if (!statSync(abs).isDirectory()) continue;
  console.log(`prune design-systems/${entry}/`);
  total += prune(abs);
}
console.log(`done: removed ${total} entries across ${readdirSync(SYSTEMS).filter((e) => statSync(join(SYSTEMS, e)).isDirectory()).length} packages`);
