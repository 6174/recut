/*
 * [INPUT]: 依赖 App manifest.json 的 distribution.builtin.include 白名单与系统 tar
 * [OUTPUT]: 对外提供内置 App 的 gzip tar 归档；只收录 App 声明的运行时路径
 * [POS]: 发布构建的通用 App 打包器；Makefile 只传入源和目标，不认识任何 App 私有目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) {
  throw new Error("usage: node scripts/package-builtin-app.mjs <app-dir> <archive.tar.gz>");
}

const source = resolve(sourceArg);
const output = resolve(outputArg);
const packageName = basename(source);
const manifestPath = resolve(source, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const include = manifest.distribution?.builtin?.include;
if (!Array.isArray(include) || include.length === 0 || include.some((entry) => typeof entry !== "string" || !isSafePackagePath(entry))) {
  throw new Error(`${manifestPath}: distribution.builtin.include must be a non-empty list of package-relative paths`);
}

for (const entry of include) {
  const candidate = resolve(source, entry);
  if (!isInside(source, candidate) || !existsSync(candidate)) {
    throw new Error(`${manifestPath}: builtin include ${JSON.stringify(entry)} does not exist inside the App package`);
  }
}

mkdirSync(dirname(output), { recursive: true });
const result = spawnSync("tar", [
  "-C", dirname(source),
  `--exclude=${packageName}/.git`,
  `--exclude=${packageName}/**/.git`,
  `--exclude=${packageName}/node_modules`,
  `--exclude=${packageName}/**/node_modules`,
  `--exclude=${packageName}/.vite`,
  `--exclude=${packageName}/**/.vite`,
  `--exclude=${packageName}/.remotion`,
  `--exclude=${packageName}/**/.remotion`,
  `--exclude=${packageName}/.DS_Store`,
  `--exclude=${packageName}/**/.DS_Store`,
  `--exclude=${packageName}/._*`,
  `--exclude=${packageName}/**/._*`,
  "-czf", output,
  ...include.map((entry) => `${packageName}/${entry}`),
], {
  env: { ...process.env, COPYFILE_DISABLE: "1" },
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

function isSafePackagePath(value) {
  const clean = normalize(value);
  return value !== "" && !isAbsolute(value) && clean !== "." && clean !== ".." && !clean.startsWith(`..${sep}`);
}

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}
