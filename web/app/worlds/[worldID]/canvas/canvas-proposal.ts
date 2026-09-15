/*
 * [INPUT]: 无运行时依赖；定义画布媒体节点的「生成提案」（AI 先交 Prompt、用户确认后才消耗生成）
 * [OUTPUT]: 对外提供 GenerationProposal/ProposalReference/ProposalStatus 类型、readProposal（props 防御式解析）、
 *           proposalRequiredFor（按模态决定是否强制提案，默认仅 video）、PROPOSAL_ROLES（生成链路 role 受控词表）、
 *           proposalRoleOptions/proposalIssues（提交前自检，fail closed）/proposalReferenceIds
 *           （按出现顺序导出 referenceIds）与 generationCapabilityOf（模态 → 生成 capability）
 * [POS]: worlds/[worldID]/canvas 的生成提案纯函数层（store/面板/pomelo 映射共用；不涉及 I/O）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// 提案引用：id 为稳定 assetId；kind/role/label 语义见 generation-reference-protocol RFC。
export type ProposalReference = { id: string; kind?: string; role?: string; label?: string; name?: string };

// 提案状态：draft(编辑中的配方草稿，未提交) → pending(待确认) → generating(生成中) → done(已就绪) / failed(失败)；
// rejected 由删除表达。draft 不触发确认门禁、不进画布「提案」态，只用于持久化用户输入。
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

// 生成链路 role 受控词表（与 recut-directing-generation-prompt / generation-reference-protocol 对齐）。
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

// 提交前自检（映射 recut-directing-generation-prompt 的产出自检）：error 阻断确认，warn 仅提示。
export function proposalIssues(proposal: GenerationProposal): Array<{ level: "error" | "warn"; message: string }> {
  const issues: Array<{ level: "error" | "warn"; message: string }> = [];
  if (!proposal.prompt.trim()) issues.push({ level: "error", message: "提示词为空" });
  if (!proposal.modelId) issues.push({ level: "error", message: "未选择生成模型" });
  for (const reference of proposal.references) {
    const kind = reference.kind;
    if (!reference.role) {
      issues.push({ level: "warn", message: `参考 ${reference.label || reference.id} 未声明 role` });
      continue;
    }
    const spec = PROPOSAL_ROLES.find((item) => item.id === reference.role);
    if (spec && kind && !spec.kinds.includes(kind)) {
      issues.push({ level: "error", message: `参考「${reference.label || reference.id}」的 role（${spec.label}）与类型 ${kind} 不匹配` });
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
