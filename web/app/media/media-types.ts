/*
 * [INPUT]: 无运行时依赖；定义素材库 API 的 JSON 契约
 * [OUTPUT]: 对外提供素材、任务、Provider、Credential、能力与筛选类型
 * [POS]: web/app/media 的共享类型边界；由页面、详情和创建流程共同使用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type AssetKind = "image" | "video" | "audio";
export type ModelInputMode = "text" | AssetKind;
export type Capability = "image.generate" | "video.generate" | "speech.generate";
export type Asset = {
  id: string;
  kind: AssetKind;
  name: string;
  origin: string;
  createdAt: string;
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
