/**
 * [INPUT]: 依赖 Depth Anything App operation 与素材库 HTTP 返回的稳定 JSON
 * [OUTPUT]: 对外提供运行状态、素材和深度输出的 UI 类型
 * [POS]: ui/src 的领域契约；组件不重复解释后端记录字段
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export type Model = "small" | "base" | "large";
export type SourceKind = "image" | "video";
export type OutputStyle = "color" | "grayscale";
export type RuntimeStatus = { ready: boolean; installedModels: Model[]; modelsRoot: string; error?: string };
export type MediaAsset = { id: string; name: string; kind: SourceKind; mimeType: string; status: string };
export type DepthOutput = { id: string; assetId: string; kind: SourceKind; model: Model; style: OutputStyle; previewURL: string; savedAssetId: string; createdAt: string };
