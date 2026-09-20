/*
 * [INPUT]: 依赖 node:test/assert 与被测的 canvas 生成提案纯函数
 * [OUTPUT]: 覆盖提案门禁契约：role 受控词表按模态过滤、提交前自检 fail-closed（prompt/model 必填、
 *          role↔kind 校验）、referenceIds 去重保序、视频强制提案
 * [POS]: web 画布媒体生成的纯逻辑门禁（与 recut-director（references/generation-prompt） / generation-reference-protocol 对齐）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PROPOSAL_ROLES, proposalIssues, proposalReferenceIds, proposalRequiredFor, proposalRoleOptions, type GenerationProposal } from "../../app/worlds/[worldID]/canvas/canvas-proposal";

function proposal(overrides: Partial<GenerationProposal> = {}): GenerationProposal {
  return { status: "pending", prompt: "p", references: [], modelId: "m", ...overrides };
}

test("role options are filtered by kind", () => {
  const imageRoles = proposalRoleOptions("image").map((role) => role.id);
  const audioRoles = proposalRoleOptions("audio").map((role) => role.id);
  assert.ok(imageRoles.includes("character") && imageRoles.includes("color-card"));
  assert.ok(!imageRoles.includes("voice"));
  assert.deepEqual(audioRoles.sort(), ["music", "sfx", "voice"]);
  assert.equal(PROPOSAL_ROLES.length, 11);
});

test("issues fail closed on missing prompt or model and role/kind mismatch", () => {
  assert.equal(proposalIssues(proposal({ prompt: "  " })).some((issue) => issue.level === "error"), true);
  assert.equal(proposalIssues(proposal({ modelId: "" })).some((issue) => issue.level === "error"), true);
  const mismatched = proposalIssues(proposal({ references: [{ id: "a", kind: "image", role: "voice" }] }));
  assert.equal(mismatched.some((issue) => issue.level === "error"), true);
  // 未声明 role / 无参考只是 warn。
  assert.equal(proposalIssues(proposal({ references: [{ id: "a", kind: "image" }] })).every((issue) => issue.level === "warn"), true);
  assert.equal(proposalIssues(proposal()).every((issue) => issue.level === "warn"), true);
  // 完整合法提案无 issue。
  assert.deepEqual(proposalIssues(proposal({ references: [{ id: "a", kind: "image", role: "character" }] })), []);
});

test("referenceIds dedupe and preserve appearance order", () => {
  const ids = proposalReferenceIds(proposal({ references: [
    { id: "a1", role: "character" }, { id: "a2", role: "style-ref" }, { id: "a1", role: "character" },
  ] }));
  assert.deepEqual(ids, ["a1", "a2"]);
});

test("video requires a proposal, image does not", () => {
  assert.equal(proposalRequiredFor("video"), true);
  assert.equal(proposalRequiredFor("image"), false);
  assert.equal(proposalRequiredFor("audio"), false);
});
