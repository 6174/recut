/*
 * [INPUT]: 依赖 media-types（Asset/AssetStatus）与 fetch；无其它运行时依赖
 * [OUTPUT]: 对外提供生成提案的共享纯函数与资产映射：GenerationProposal/ProposalReference/ProposalStatus、
 *           PROPOSAL_ROLES/role 选项/自检（fail closed）/proposalReferenceIds、proposalRequiredFor、
 *           generationCapabilityOf、readProposal（props 防御式解析）、proposalFromAsset（proposed 资产 → 提案视图），
 *           以及 HTTP 客户端 createProposal/listProposals/updateProposalAsset/confirmProposalAsset/rejectProposalAsset
 * [POS]: web/lib/media 的提案契约边界；素材库 / World Canvas / Editor 共用同一份 role 词表、自检与确认流程
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Asset } from "@/app/media/media-types";

// 提案引用：id 为稳定 assetId；kind/role/label 语义见 generation-reference-protocol RFC。
export type ProposalReference = { id: string; kind?: string; role?: string; label?: string; name?: string };

// 提案状态视图：pending(待确认) → generating(生成中) → done(已就绪) / failed(失败)；
// draft 仅用于画布配方草稿，rejected 由删除表达。资产侧真相是 media_assets.status。
export type ProposalStatus = "draft" | "pending" | "generating" | "done" | "failed" | "rejected";

export type GenerationProposal = {
  status: ProposalStatus;
  prompt: string;
  references: ProposalReference[];
  modelId?: string;
  credentialId?: string;
  params?: Record<string, unknown>;
  aspectRatio?: string;
  durationSec?: number;
  note?: string;
  proposedBy?: "agent" | "user";
  proposedAt?: string;
  batchId?: string;
  jobId?: string;
  error?: string;
};

// 需要「先提案、后确认」的模态：视频生成成本高，默认强制；图片成本低，不强制。
export const PROPOSAL_REQUIRED_MODALITIES = ["video"];

export function proposalRequiredFor(modality: string): boolean {
  return PROPOSAL_REQUIRED_MODALITIES.includes(modality);
}

// 生成链路 role 受控词表（与 recut-director（references/generation-prompt） / generation-reference-protocol 对齐）。
export const PROPOSAL_ROLES: Array<{ id: string; label: string; kinds: string[] }> = [
  { id: "pov", label: "视角", kinds: ["image", "video"] },
  { id: "color-card", label: "色卡", kinds: ["image"] },
  { id: "environment", label: "环境", kinds: ["image", "video"] },
  { id: "character", label: "人物", kinds: ["image"] },
  { id: "prop", label: "道具", kinds: ["image"] },
  { id: "style-ref", label: "风格", kinds: ["image"] },
  { id: "motion-ref", label: "运动", kinds: ["video"] },
  { id: "voice", label: "音色", kinds: ["audio"] },
  { id: "sfx", label: "音效", kinds: ["audio"] },
  { id: "music", label: "音乐", kinds: ["audio"] },
];

export function proposalRoleOptions(kind?: string): Array<{ id: string; label: string }> {
  return PROPOSAL_ROLES.filter((role) => !kind || role.kinds.includes(kind)).map(({ id, label }) => ({ id, label }));
}

export function proposalRoleLabel(role?: string): string {
  return PROPOSAL_ROLES.find((item) => item.id === role)?.label ?? role ?? "";
}

const PROPOSAL_STATUSES: ProposalStatus[] = ["draft", "pending", "generating", "done", "failed", "rejected"];

// 「提案态」= 需要用户确认/关注的已提交提案（draft 只是配方草稿，done/rejected 已结束）。
export function isProposalGate(status?: string): boolean {
  return status === "pending" || status === "generating" || status === "failed";
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function referencesOf(value: unknown): ProposalReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: stringOf(item.id),
      ...(stringOf(item.kind) ? { kind: stringOf(item.kind) } : {}),
      ...(stringOf(item.role) ? { role: stringOf(item.role) } : {}),
      ...(stringOf(item.label) ? { label: stringOf(item.label) } : {}),
      ...(stringOf(item.name) ? { name: stringOf(item.name) } : {}),
    }))
    .filter((item) => item.id);
}

// props.proposal 防御式解析：非法/缺失一律返回 null（老画布元素没有该字段）。
export function readProposal(props?: Record<string, unknown> | null): GenerationProposal | null {
  const raw = props?.proposal;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const status = PROPOSAL_STATUSES.includes(value.status as ProposalStatus) ? (value.status as ProposalStatus) : "pending";
  return {
    status,
    prompt: stringOf(value.prompt),
    references: referencesOf(value.references),
    ...(stringOf(value.modelId) ? { modelId: stringOf(value.modelId) } : {}),
    ...(stringOf(value.credentialId) ? { credentialId: stringOf(value.credentialId) } : {}),
    ...(value.params && typeof value.params === "object" ? { params: value.params as Record<string, unknown> } : {}),
    ...(stringOf(value.aspectRatio) ? { aspectRatio: stringOf(value.aspectRatio) } : {}),
    ...(typeof value.durationSec === "number" ? { durationSec: value.durationSec } : {}),
    ...(stringOf(value.note) ? { note: stringOf(value.note) } : {}),
    ...(value.proposedBy === "agent" || value.proposedBy === "user" ? { proposedBy: value.proposedBy } : {}),
    ...(stringOf(value.proposedAt) ? { proposedAt: stringOf(value.proposedAt) } : {}),
    ...(stringOf(value.batchId) ? { batchId: stringOf(value.batchId) } : {}),
    ...(stringOf(value.jobId) ? { jobId: stringOf(value.jobId) } : {}),
    ...(stringOf(value.error) ? { error: stringOf(value.error) } : {}),
  };
}

// 资产侧提案视图：proposed/queued/running/failed/completed 映射为提案状态机。
// 素材是唯一真相（metadata.proposal + metadata.prompt/modelId/output），画布/素材库据此渲染。
export function proposalFromAsset(asset: Pick<Asset, "status" | "jobId" | "metadata">): GenerationProposal | null {
  const raw = asset.metadata?.proposal;
  if (!raw || typeof raw !== "object") return null;
  const status: ProposalStatus =
    asset.status === "proposed" ? "pending"
    : asset.status === "queued" || asset.status === "running" ? "generating"
    : asset.status === "failed" ? "failed"
    : asset.status === "completed" ? "done"
    : "pending";
  return readProposal({
    proposal: {
      ...(raw as Record<string, unknown>),
      status,
      prompt: asset.metadata.prompt,
      modelId: asset.metadata.modelId,
      params: asset.metadata.output,
      jobId: asset.jobId,
    },
  });
}

// 同属服务端 proposed，但语义分两种：
// - 提案 / proposal：已带生成配方（metadata.proposal），用户可「确认生成」；
// - 计划 / plan：只有 content/attributes，没有配方，用户应「复制计划给 AI」去生成。
export function isConfirmableProposal(asset: Pick<Asset, "status" | "jobId" | "metadata">): boolean {
  return asset.status === "proposed" && Boolean(proposalFromAsset(asset));
}

export function isPlanAsset(asset: Pick<Asset, "status" | "jobId" | "metadata">): boolean {
  return asset.status === "proposed" && !proposalFromAsset(asset);
}

// 提交前自检（映射 recut-director（references/generation-prompt） 的产出自检）：error 阻断确认，warn 仅提示。
export function proposalIssues(proposal: GenerationProposal): Array<{ level: "error" | "warn"; message: string }> {
  const issues: Array<{ level: "error" | "warn"; message: string }> = [];
  if (!proposal.prompt.trim()) issues.push({ level: "error", message: "提示词为空" });
  if (!proposal.modelId) issues.push({ level: "error", message: "未选择生成模型" });
  for (const reference of proposal.references) {
    // role 是 Agent 侧的锚定语义（非模型接口字段），用户可不声明；仅在已声明时校验 role↔kind
    if (!reference.role) continue;
    const spec = PROPOSAL_ROLES.find((item) => item.id === reference.role);
    if (spec && reference.kind && !spec.kinds.includes(reference.kind)) {
      issues.push({ level: "error", message: `参考「${reference.label || reference.id}」的 role（${spec.label}）与类型 ${reference.kind} 不匹配` });
    }
  }
  if (!proposal.references.length) issues.push({ level: "warn", message: "没有参考素材" });
  return issues;
}

// 按引用出现顺序导出 referenceIds（提交串顺序的绑定证据）。
export function proposalReferenceIds(proposal: GenerationProposal): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const reference of proposal.references) {
    if (!reference.id || seen.has(reference.id)) continue;
    seen.add(reference.id);
    ids.push(reference.id);
  }
  return ids;
}

export function generationCapabilityOf(modality: string): "image.generate" | "video.generate" | "speech.generate" {
  if (modality === "audio") return "speech.generate";
  if (modality === "image") return "image.generate";
  return "video.generate";
}

// --- HTTP 客户端（素材库 / 画布 / 编辑器共用同一端点契约） ---

export type ProposeRequest = {
  capability: "image.generate" | "video.generate" | "speech.generate";
  prompt: string;
  modelId?: string;
  credentialId?: string;
  route?: string;
  output?: Record<string, unknown>;
  referenceIds?: string[];
  references?: ProposalReference[];
  aspectRatio?: string;
  durationSec?: number;
  note?: string;
  batchId?: string;
  proposedBy?: "agent" | "user";
  projectId?: string;
};

export type ProposalPatch = {
  prompt?: string;
  modelId?: string;
  credentialId?: string;
  output?: Record<string, unknown>;
  references?: ProposalReference[];
  referenceIds?: string[];
  aspectRatio?: string;
  durationSec?: number;
  note?: string;
};

async function readError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

export async function createProposal(apiBase: string, input: ProposeRequest): Promise<Asset> {
  const response = await fetch(`${apiBase}/v1/media/proposals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await readError(response, "创建提案失败，请检查 Provider 配置。");
  return (await response.json()) as Asset;
}

export async function listProposals(apiBase: string, projectId?: string): Promise<Asset[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(`${apiBase}/v1/media/proposals${query}`, { cache: "no-store" });
  if (!response.ok) throw await readError(response, "读取提案失败。");
  const page = (await response.json()) as { items?: Asset[] };
  return page.items ?? [];
}

export async function updateProposalAsset(apiBase: string, assetId: string, patch: ProposalPatch): Promise<Asset> {
  const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}/proposal`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await readError(response, "修改提案失败。");
  return (await response.json()) as Asset;
}

export async function confirmProposalAsset(apiBase: string, assetId: string, patch?: ProposalPatch): Promise<{ id: string; assetIds: string[] }> {
  const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch ?? {}),
  });
  if (!response.ok) throw await readError(response, "确认生成失败，请检查 Provider 配置。");
  return (await response.json()) as { id: string; assetIds: string[] };
}

export async function rejectProposalAsset(apiBase: string, assetId: string): Promise<void> {
  const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}/reject`, { method: "POST" });
  if (!response.ok && response.status !== 204) throw await readError(response, "放弃提案失败。");
}
