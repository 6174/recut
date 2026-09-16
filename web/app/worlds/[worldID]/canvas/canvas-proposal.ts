/*
 * [INPUT]: 依赖 @/lib/media/proposal（共享提案契约与纯函数）
 * [OUTPUT]: 兼容再导出：画布历史导入路径 ./canvas-proposal 继续可用；真源已上移到 lib/media/proposal
 * [POS]: worlds/[worldID]/canvas 的薄适配层，避免破坏既有 import；新代码直接引 @/lib/media/proposal
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export {
  PROPOSAL_REQUIRED_MODALITIES,
  PROPOSAL_ROLES,
  generationCapabilityOf,
  isProposalGate,
  proposalFromAsset,
  proposalReferenceIds,
  proposalRequiredFor,
  proposalRoleLabel,
  proposalRoleOptions,
  proposalIssues,
  readProposal,
  createProposal,
  listProposals,
  updateProposalAsset,
  confirmProposalAsset,
  rejectProposalAsset,
} from "@/lib/media/proposal";
export type { GenerationProposal, ProposalPatch, ProposalReference, ProposalStatus, ProposeRequest } from "@/lib/media/proposal";
