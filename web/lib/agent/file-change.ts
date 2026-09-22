/*
 * [INPUT]: 依赖不同 Agent runtime 的文件工具事件字段（tool/toolName/input/output/diff）
 * [OUTPUT]: 对外提供 isFileChangeCall / extractFileChanges：把 write/edit/patch/file_change 归一化为可渲染的文件变更
 * [POS]: lib/agent 的纯逻辑层；不依赖 React 与组件，供工具卡片与其单测消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type FileChangeKind = "add" | "modify" | "delete";

export type FileChange = {
  path: string;
  kind: FileChangeKind;
  content?: string;
  diff?: string;
};

// FileToolPayload 是后端工具事件中与文件变更相关的结构化字段；只声明归一化所需子集，
// 让除 Agent 面板以外的调用方也能复用而不依赖完整 ToolPayload 类型。
export type FileToolPayload = {
  tool?: string;
  toolName?: string;
  diff?: string;
  filePath?: string;
  fileExists?: boolean;
};

export type FileToolCall = {
  state: "running" | "success" | "error";
  input?: string;
  output?: string;
  error?: string;
  payload: FileToolPayload;
};

const FILE_TOOL_NAMES = new Set(["write", "edit", "patch", "file_change"]);

// isFileChangeCall 判断一次工具调用是否属于文件写入/编辑；只认工具名，不猜参数。
// tool 是 runtime 的工具类别（Codex 用 file_change、OpenCode 用 write/edit/patch），
// toolName 是规范工具名；两者任一命中即可，避免某一 runtime 只填其中一个。
export function isFileChangeCall(payload: FileToolPayload | null | undefined): boolean {
  if (!payload) return false;
  const name = (payload.toolName ?? "").trim().toLowerCase();
  const kind = (payload.tool ?? "").trim().toLowerCase();
  return FILE_TOOL_NAMES.has(name) || FILE_TOOL_NAMES.has(kind);
}

// extractFileChanges 把不同 runtime 的文件工具输入归一化成 {path, kind, content?, diff?}：
// OpenCode 的 write 带全文、edit/patch 带 diff（服务端已注入）；Codex 的 file_change 只有变更清单。
export function extractFileChanges(call: FileToolCall): FileChange[] {
  if (!isFileChangeCall(call.payload)) return [];
  const values = recordFrom(call.input);
  const name = (call.payload.toolName ?? "").trim().toLowerCase();
  const kindName = (call.payload.tool ?? "").trim().toLowerCase();
  const tool = FILE_TOOL_NAMES.has(name) ? name : kindName;
  const path = firstString(values.filePath, values.path, call.payload.filePath);
  const content = typeof values.content === "string" ? values.content : undefined;
  let diff = call.payload.diff;
  if (!diff) {
    const oldText = firstString(values.oldString, values.old_string);
    const newText = firstString(values.newString, values.new_string);
    if (oldText !== undefined && newText !== undefined) {
      diff = synthesizeEditDiff(path ?? "", oldText, newText);
    }
  }
  if (path) {
    const kind: FileChangeKind =
      tool === "write" && call.payload.fileExists !== true ? "add" : "modify";
    return [{ path, kind, content, diff }];
  }
  return changesFromOutput(call.output);
}

// changeDiff 返回可展示的 unified diff：优先真实 diff；新建文件（add）没有 diff 时，
// 用全文合成一份「全部新增」的 diff，让预览窗口的「变更」页对新建文件同样可用。
export function changeDiff(change: FileChange): string | undefined {
  if (change.diff) return change.diff;
  if (change.kind === "add" && typeof change.content === "string") {
    return synthesizeDiff(change.path, [], change.content.replace(/\n$/, "").split("\n"));
  }
  return undefined;
}

export function diffStats(diff?: string) {
  let additions = 0;
  let deletions = 0;
  if (!diff) return { additions, deletions };
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

export function lineCount(value?: string) {
  if (!value) return 0;
  return value.replace(/\n$/, "").split("\n").length;
}

function recordFrom(input?: string): Record<string, unknown> {
  if (!input) return {};
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  for (const key of ["arguments", "input"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return record;
}

function changesFromOutput(output?: string): FileChange[] {
  if (!output) return [];
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return [];
  }
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const list = record && Array.isArray(record.changes) ? record.changes : null;
  if (!list) return [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const path = firstString(item.path, item.filePath);
    if (!path) return [];
    const raw = typeof item.kind === "string" ? item.kind.toLowerCase() : "";
    const kind: FileChangeKind =
      raw === "add" || raw === "create" ? "add" : raw === "delete" || raw === "remove" ? "delete" : "modify";
    return [{ path, kind }];
  });
}

function synthesizeEditDiff(path: string, oldText: string, newText: string) {
  return synthesizeDiff(path, oldText.split("\n"), newText.split("\n"));
}

function synthesizeDiff(path: string, oldLines: string[], newLines: string[]) {
  const header = path ? [`--- ${path}`, `+++ ${path}`] : ["--- a", "+++ b"];
  return [
    ...header,
    "@@ -1 +1 @@",
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}
