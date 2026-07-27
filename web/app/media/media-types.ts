/*
 * [INPUT]: 无运行时依赖；定义素材库 API 的 JSON 契约
 * [OUTPUT]: 对外提供素材、任务、Provider、Credential、能力与筛选类型，以及历史 Asset 的展示归一化
 * [POS]: web/app/media 的共享类型边界；由页面、详情和创建流程共同使用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type AssetKind = "image" | "video" | "audio";
export type AssetStatus = "queued" | "running" | "completed" | "failed";
export type ModelInputMode = "text" | AssetKind;
export type Capability = "image.generate" | "video.generate" | "speech.generate";
export type Asset = {
  id: string;
  kind: AssetKind;
  name: string;
  origin: string;
  status: AssetStatus;
  jobId?: string;
  remoteId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata: {
    prompt?: string;
    capability?: unknown;
    modelId?: unknown;
    referenceIds?: unknown;
  };
};
export type MediaJob = {
  id: string;
  capability: Capability;
  status: "queued" | "running" | "completed" | "failed";
  prompt: string;
  assetIds: string[];
  remoteId?: string;
  createdAt: string;
  error?: string;
};
export type Model = {
  id: string;
  provider: string;
  name: string;
  capability: Capability;
  available: boolean;
  inputModes: ModelInputMode[];
};
export type Provider = { id: string; name: string; models: Model[] };
export type Credential = { id: string; name: string; provider: string };
export type Voice = { id: string; name: string; description?: string; provider: string; category?: string };
export type Filter = "all" | AssetKind;

const assetStatuses: AssetStatus[] = ["queued", "running", "completed", "failed"];

// Asset lifecycle fields were added after early workspaces already contained
// imported and generated files. Missing or malformed historical status must
// mean "completed", never a false running task.
export function normalizeAsset(value: Partial<Asset> & { id?: string }): Asset {
  const reportedStatus = assetStatuses.includes(value.status as AssetStatus)
    ? (value.status as AssetStatus)
    : "completed";
  const hasRemoteTask = Boolean(value.jobId && value.remoteId);
  const status = (reportedStatus === "queued" || reportedStatus === "running") && !hasRemoteTask
    ? "completed"
    : reportedStatus;
  return {
    id: typeof value.id === "string" ? value.id : "",
    kind: value.kind ?? "image",
    name: value.name || "未命名素材",
    origin: value.origin || "user-upload",
    status,
    jobId: value.jobId,
    remoteId: value.remoteId,
    error: value.error,
    createdAt: value.createdAt || "",
    updatedAt: value.updatedAt || value.createdAt || "",
    metadata: value.metadata || {},
  };
}
