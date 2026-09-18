/*
 * [INPUT]: 无运行时依赖；定义素材库 API 的 JSON 契约
 * [OUTPUT]: 对外提供素材、任务、含输入/输出参数能力与 per-model parameters/referenceFields schema 的 Provider 模型、能力级声音分组（CapabilityVoiceGroup）、Credential、筛选类型（含 ASR 转写 bundle），以及按 durable jobId 保留异步生成状态的历史 Asset 展示归一化
 * [POS]: web/app/media 的共享类型边界；由页面、详情和创建流程共同使用，Provider 专属 remoteId 不是生命周期依据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type AssetKind = "image" | "video" | "audio" | "transcript" | "reference";
export type AssetStatus = "proposed" | "queued" | "running" | "completed" | "failed";
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
    content?: unknown;
    contentMeta?: unknown;
    attributes?: Array<{
      key: string;
      label?: string;
      type?: string;
      value?: unknown;
      source?: string;
    }>;
    generationCompletedAt?: unknown;
    generationDurationMs?: unknown;
    generationStartedAt?: unknown;
    modelId?: unknown;
    output?: Record<string, unknown>;
    referenceIds?: unknown;
    proposal?: {
      references?: Array<{ id: string; kind?: string; role?: string; label?: string }>;
      aspectRatio?: string;
      durationSec?: number;
      note?: string;
      proposedBy?: "agent" | "user";
      proposedAt?: string;
      batchId?: string;
      origin?: { appId?: string; projectId?: string; worldId?: string; entityId?: string };
      confirmedAt?: string;
    };
    transcript?: {
      sourceAssetId?: string;
      model?: string;
      language?: string;
      duration?: number;
      segmentCount?: number;
    };
    reference?: {
      url?: string;
      sourceKind?: string;
      title?: string;
      summary?: string;
      description?: string;
      excerpt?: string;
      author?: string;
      publishedAt?: string;
      siteName?: string;
      language?: string;
      thumbnailUrl?: string;
      contentMimeType?: string;
      contentLength?: number;
      contentWordCount?: number;
      media?: {
        channelName?: string;
        channelUrl?: string;
        durationSeconds?: number;
        viewCount?: number;
        likeCount?: number;
        language?: string;
      };
      parts?: Record<string, { name?: string; contentHash?: string; mimeType?: string; sizeBytes?: number }>;
    };
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
export type ModelParameter = {
  name: string;
  providerKey?: string;
  label?: string;
  type: "string" | "integer" | "number" | "boolean" | "array";
  enum?: string[];
  default?: unknown;
  required?: boolean;
  minimum?: number;
  maximum?: number;
  description?: string;
};
export type Model = {
  id: string;
  provider: string;
  name: string;
  capability: Capability;
  available: boolean;
  inputModes: ModelInputMode[];
  outputModes?: string[];
  parameters?: ModelParameter[];
  referenceFields?: Record<string, string>;
  status?: "stable" | "new" | "deprecated" | "retired";
  meta?: { docsUrl?: string; summary?: string; pricing?: string; tags?: string[] };
  referenceBudgets?: {
    requirements?: string[];
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
    image?: { maxBytes?: number; mimes?: string[] };
    video?: { maxBytes?: number; mimes?: string[] };
    audio?: { maxBytes?: number; mimes?: string[] };
  }[];
};
export type Provider = { id: string; name: string; models: Model[] };
export type Credential = { id: string; name: string; provider: string };
export type Voice = { id: string; name: string; description?: string; provider: string; category?: string };
// Capability voice group: the local provider (no credential) plus one group per
// cloud credential, each carrying its TTS models and selectable voices.
export type CapabilityVoiceGroup = {
  provider: string;
  protocol: string;
  credentialId?: string;
  credentialName?: string;
  isDefaultRoute: boolean;
  models: Model[];
  voices: Voice[];
  error?: string;
};
export type Filter = "all" | AssetKind;

const assetStatuses: AssetStatus[] = ["proposed", "queued", "running", "completed", "failed"];

// Asset lifecycle fields were added after early workspaces already contained
// imported and generated files. A durable jobId is the platform-wide async
// binding; remoteId is optional because generic providers such as speech omit it.
// A proposed asset is intentionally job-less: it carries a recipe until the user
// confirms generation.
export function normalizeAsset(value: Partial<Asset> & { id?: string }): Asset {
  const reportedStatus = assetStatuses.includes(value.status as AssetStatus)
    ? (value.status as AssetStatus)
    : "completed";
  const hasJob = typeof value.jobId === "string" && value.jobId.trim() !== "";
  const status = reportedStatus !== "proposed" && (reportedStatus === "queued" || reportedStatus === "running") && !hasJob
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
