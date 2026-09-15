/*
 * [INPUT]: 依赖 node:test/assert 与被测的 buildGenerationRequest
 * [OUTPUT]: 覆盖 UI→/v1/media/jobs 请求体契约：参数按 catalog name 透传、语音走 voiceId、
 *          本地 provider 省略 credentialId、空值省略
 * [POS]: web 前后端对接契约的前端门禁
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGenerationRequest } from "./generation-request";

test("image/video params pass through under their catalog names", () => {
  const body = buildGenerationRequest({
    capability: "video.generate",
    modelId: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video",
    credentialId: "cred-1",
    prompt: "  cars move  ",
    referenceIds: ["asset-1"],
    output: { durationSeconds: 4, generateAudio: false },
  });
  assert.deepEqual(body, {
    capability: "video.generate",
    modelId: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video",
    credentialId: "cred-1",
    prompt: "cars move",
    referenceIds: ["asset-1"],
    output: { durationSeconds: 4, generateAudio: false },
  });
});

test("upstream provider keys pass through unchanged", () => {
  const body = buildGenerationRequest({
    capability: "image.generate",
    modelId: "atlas-cloud/alibaba/qwen-image/edit",
    credentialId: "cred-1",
    prompt: "make it night",
    output: { negative_prompt: "blurry", seed: 7 },
  });
  assert.deepEqual(body.output, { negative_prompt: "blurry", seed: 7 });
});

test("speech carries voiceId and no references", () => {
  const body = buildGenerationRequest({
    capability: "speech.generate",
    modelId: "local-audio/cosyvoice2",
    credentialId: undefined,
    prompt: "你好",
    output: { voiceId: "preset:neutral-female" },
  });
  assert.deepEqual(body, {
    capability: "speech.generate",
    modelId: "local-audio/cosyvoice2",
    prompt: "你好",
    output: { voiceId: "preset:neutral-female" },
  });
  assert.equal("credentialId" in body, false);
  assert.equal("referenceIds" in body, false);
});

test("empty output and references are omitted", () => {
  const body = buildGenerationRequest({
    capability: "image.generate",
    modelId: "openai/gpt-image-2",
    credentialId: "cred-1",
    prompt: "a fox",
    referenceIds: [],
    output: {},
  });
  assert.equal("output" in body, false);
  assert.equal("referenceIds" in body, false);
});
