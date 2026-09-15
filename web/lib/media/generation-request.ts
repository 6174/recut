/*
 * [INPUT]: 无运行时依赖；定义媒体生成请求的输入/输出契约
 * [OUTPUT]: buildGenerationRequest —— 把画布/素材库的 UI 选择（模型 + catalog 参数 + 声音 +
 *          参考）组装成 /v1/media/jobs 的请求体；output 的 key 与 catalog parameters[].name 一一对应
 * [POS]: web/lib/media 的前后端契约边界；UI 与单测共用，闭包内不做任何 I/O
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type GenerationCapability = "image.generate" | "video.generate" | "speech.generate";

export type GenerationRequestInput = {
  capability: GenerationCapability;
  modelId: string;
  // 云端 provider 的凭据；本地 provider（Audio Studio）无凭据，按直连 modelId 提交。
  credentialId?: string | null;
  prompt: string;
  referenceIds?: string[];
  // 已按 catalog parameter.name 命名的参数（音频为 { voiceId }）。
  output?: Record<string, unknown>;
};

const EMPTY_OUTPUT: Record<string, unknown> = {};

// 组装生成请求：省略空值（credentialId/referenceIds/output），避免服务端把空数组/空对象当成显式输入。
export function buildGenerationRequest(input: GenerationRequestInput): Record<string, unknown> {
  const prompt = input.prompt.trim();
  const referenceIds = input.referenceIds ?? [];
  const output = input.output ?? EMPTY_OUTPUT;
  return {
    capability: input.capability,
    modelId: input.modelId,
    ...(input.credentialId ? { credentialId: input.credentialId } : {}),
    prompt,
    ...(referenceIds.length ? { referenceIds } : {}),
    ...(Object.keys(output).length ? { output } : {}),
  };
}
