/*
 * [INPUT]: 依赖 motion-graphic 平台工具事件字段（input/output 中的组件信息）
 * [OUTPUT]: 对外提供 isMotionGraphicCall / extractMotionGraphic：把 motion-graphic.* 工具归一化为可渲染的组件卡片数据
 * [POS]: lib/agent 的纯逻辑层；不依赖 React 与组件，供工具卡片与其单测消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type MotionGraphicInput = {
  key?: string;
  label?: string;
  type?: string;
};

export type MotionGraphic = {
  name?: string;
  componentId: string;
  versionId?: string;
  version?: number | string;
  status?: string;
  mode?: string;
  surface?: string;
  coverUrl?: string;
  assetId?: string;
  brief?: string;
  keywords?: string[];
  inputs?: MotionGraphicInput[];
  source?: string;
};

export type MotionGraphicPayload = {
  tool?: string;
  toolName?: string;
};

export type MotionGraphicCall = {
  input?: string;
  output?: string;
  payload: MotionGraphicPayload;
};

// 只对「产出/变更一个组件」的操作渲染卡片；list/source 这类读取操作仍走通用工具行。
const PRODUCING_OPS = new Set([
  "commit",
  "define",
  "create",
  "revise",
  "update",
  "verify",
  "resolve",
  "archive",
]);

export function isMotionGraphicCall(payload: MotionGraphicPayload | null | undefined): boolean {
  if (!payload) return false;
  return [payload.tool, payload.toolName].some((value) =>
    normalizeToolName(value).includes("motion_graphic"),
  );
}

// extractMotionGraphic 深度解析 input/output（含嵌套 JSON 字符串），找到组件信息；
// 找不到 componentId 时返回 null，让调用方回退通用工具行。
export function extractMotionGraphic(call: MotionGraphicCall): MotionGraphic | null {
  if (!isMotionGraphicCall(call.payload)) return null;
  const op = motionGraphicOp(call.payload);
  if (op && !PRODUCING_OPS.has(op)) return null;
  const inputObjects = collectObjects(safeJson(call.input));
  const outputObjects = collectObjects(safeJson(call.output));
  const objects = [...outputObjects, ...inputObjects];
  const component = findComponent(objects);
  if (!component) return null;
  const componentId = str(component.componentId);
  if (!componentId) return null;
  // 输入常被包一层 { input: {...} }；优先取带业务字段的那一层。
  const input =
    inputObjects.find(
      (object) =>
        object.items !== undefined ||
        object.name !== undefined ||
        object.source !== undefined ||
        object.keywords !== undefined,
    ) ??
    inputObjects[0] ??
    {};
  const firstItem = firstRecord(input.items);
  return {
    componentId,
    name:
      str(component.name) ??
      str(firstObjectWith(objects, "name")?.name) ??
      str(firstItem?.nameHint) ??
      str(firstItem?.name),
    versionId: str(component.versionId),
    version: numberOrString(component.version),
    status: str(component.status),
    mode: str(component.mode),
    surface: str(component.surface) ?? str(firstItem?.surface),
    coverUrl: str(component.coverUrl) ?? str(firstObjectWith(objects, "coverUrl")?.coverUrl),
    assetId: str(component.assetId),
    brief: str(firstItem?.brief) ?? str(input.brief),
    keywords: stringArray(input.keywords) ?? stringArray(firstItem?.keywords),
    inputs: inputArray(input.inputs) ?? inputArray(firstItem?.inputs),
    source: str(input.source) ?? str(firstItem?.source),
  };
}

// motionGraphicOp 取工具名最后一段作为操作名（如 recut.motion-graphic.commit → commit）。
function motionGraphicOp(payload: MotionGraphicPayload): string | undefined {
  for (const value of [payload.toolName, payload.tool]) {
    const normalized = normalizeToolName(value);
    const index = normalized.lastIndexOf("motion_graphic_");
    if (index >= 0) {
      const op = normalized.slice(index + "motion_graphic_".length);
      if (op) return op;
    }
  }
  return undefined;
}

function normalizeToolName(value?: string): string {
  return (value ?? "").replaceAll(".", "_").replaceAll("-", "_").toLowerCase();
}

function findComponent(objects: Record<string, unknown>[]): Record<string, unknown> | null {
  for (const object of objects) {
    if (str(object.componentId)) return object;
  }
  for (const object of objects) {
    const list = Array.isArray(object.components) ? object.components : null;
    const first = firstRecord(list);
    if (first && str(first.componentId)) return first;
  }
  return null;
}

function firstObjectWith(
  objects: Record<string, unknown>[],
  key: string,
): Record<string, unknown> | undefined {
  return objects.find((object) => object[key] !== undefined && object[key] !== null);
}

function collectObjects(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return collectObjects(safeJson(trimmed), depth + 1);
    }
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectObjects(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record, ...Object.values(record).flatMap((item) => collectObjects(item, depth + 1))];
  }
  return [];
}

function safeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  const list = Array.isArray(value) ? value : null;
  if (!list || list.length === 0) return undefined;
  const first = list[0];
  return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOrString(value: unknown): number | string | undefined {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length ? items : undefined;
}

function inputArray(value: unknown): MotionGraphicInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [{ key: str(record.key), label: str(record.label), type: str(record.type) }];
  });
  return items.length ? items : undefined;
}
