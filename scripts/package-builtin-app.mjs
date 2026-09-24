/*
 * [INPUT]: 依赖单一清单 service/builtin_apps/apps.json（package/source/appId/include/exclude/prep）与系统 tar
 * [OUTPUT]: 为清单里的每个内置 App 生成可嵌入 Go binary 的 gzip tar 归档（service/builtin_apps/<package>.tar.gz）
 * [POS]: 发布构建的唯一内置 App 打包器；App 集合与打包规则只在 apps.json 一处维护，Makefile 只调用本脚本
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appsJsonPath = resolve(repoRoot, "service/builtin_apps/apps.json");
const outputDir = resolve(repoRoot, "service/builtin_apps");

const entries = JSON.parse(readFileSync(appsJsonPath, "utf8"));
if (!Array.isArray(entries) || entries.length === 0) {
  throw new Error(`${appsJsonPath}: expected a non-empty list of built-in App entries`);
}

mkdirSync(outputDir, { recursive: true });
for (const entry of entries) {
  packageBuiltinApp(entry);
}

function packageBuiltinApp(entry) {
  const { package: packageName, source, appId, include, exclude = [], prep } = entry ?? {};
  if (typeof packageName !== "string" || packageName === "" || basename(packageName) !== packageName) {
    throw new Error(`${appsJsonPath}: invalid built-in App package name ${JSON.stringify(packageName)}`);
  }
  if (typeof appId !== "string" || appId === "") {
    throw new Error(`${appsJsonPath}: ${packageName} requires an appId`);
  }
  if (typeof source !== "string" || source === "" || isAbsolute(source)) {
    throw new Error(`${appsJsonPath}: ${packageName} requires a repo-relative source directory`);
  }
  if (!isPathList(include) || include.length === 0 || !isPathList(exclude)) {
    throw new Error(`${appsJsonPath}: ${packageName} include must be a non-empty list and exclude a list of package-relative paths`);
  }

  const sourceDir = resolve(repoRoot, source);
  if (!isInside(repoRoot, sourceDir) || !existsSync(sourceDir)) {
    throw new Error(`${appsJsonPath}: ${packageName} source ${JSON.stringify(source)} does not exist`);
  }
  for (const relativePath of include) {
    const candidate = resolve(sourceDir, relativePath);
    if (!isInside(sourceDir, candidate) || !existsSync(candidate)) {
      throw new Error(`${appsJsonPath}: ${packageName} include ${JSON.stringify(relativePath)} does not exist inside the App package`);
    }
  }

  if (Array.isArray(prep) && prep.length > 0) {
    const [command, ...args] = prep;
    if (typeof command !== "string" || command === "") {
      throw new Error(`${appsJsonPath}: ${packageName} prep must start with a command`);
    }
    const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${appsJsonPath}: ${packageName} prep command failed with status ${result.status}`);
  }

  const output = resolve(outputDir, `${packageName}.tar.gz`);
  const mandatoryExcludes = [".git", "**/.git", "node_modules", "**/node_modules", ".vite", "**/.vite", ".remotion", "**/.remotion", ".DS_Store", "**/.DS_Store", "._*", "**/._*"];
  const result = spawnSync("tar", [
    "-C", dirname(sourceDir),
    ...[...mandatoryExcludes, ...exclude].map((path) => `--exclude=${packageName}/${path}`),
    "-czf", output,
    ...include.map((path) => `${packageName}/${path}`),
  ], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${appsJsonPath}: tar failed for ${packageName} with status ${result.status}`);
}

function isPathList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && isSafePackagePath(item));
}

function isSafePackagePath(value) {
  const clean = normalize(value);
  return value !== "" && !isAbsolute(value) && clean !== ".." && !clean.startsWith(`..${sep}`);
}

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}
