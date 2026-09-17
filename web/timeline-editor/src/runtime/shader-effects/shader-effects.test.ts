/**
 * [INPUT]: shader effect registry、semantic MotionProgram tracks 与实例 adapter。
 * [OUTPUT]: 验证新增 effect 不依赖具体组件，且语义路径能稳定写入实例参数。
 * [POS]: shader-effects 的纯逻辑回归；真实材质与画布由 Playwright E2E 覆盖。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { describe, expect, it } from "vitest";
import { createShaderEffectAdapter, createShaderEffectGraph, createShaderEffectInstances, getShaderEffect, resolveShaderEffectGraph, resolveShaderEffectImplementation, SHADER_EFFECTS } from "./registry";
import { GLITCH_FRAGMENT_SHADER } from "./passes/glitch";

describe("shader effect registry", () => {
	it("注册表只暴露独立 effect definition", () => {
		expect(SHADER_EFFECTS.map((effect) => effect.id)).toEqual(expect.arrayContaining(["glitch", "ripple", "displacement", "crt", "vhs", "glass", "vintage", "retro-dither"]));
		expect(SHADER_EFFECTS.length).toBeGreaterThanOrEqual(27);
		expect(getShaderEffect("glitch")?.implementations.find((item) => item.kind === "material")).toBeUndefined();
		expect(getShaderEffect("glitch")?.implementations.find((item) => item.kind === "texture")?.fragmentShader).toBe(GLITCH_FRAGMENT_SHADER);
	});

	it("迁移后的全局 Effect 与 registry 共享同一份 pass source", () => {
		for (const id of ["glass", "vintage", "retro-dither", "particle-reveal", "text-focus"]) {
			const definition = getShaderEffect(id);
			expect(definition?.implementations.find((item) => item.kind === "texture")?.fragmentShader).toBeTruthy();
		}
	});

	it("没有 source texture 时不会伪造另一套 Effect Shader", () => {
		const definition = getShaderEffect("vintage")!;
		const implementation = resolveShaderEffectImplementation(definition, { kind: "material", hasSourceTexture: false, canPatchMaterial: true });
		expect(implementation).toBeUndefined();
	});

	it("semantic effects.* path 写入实例参数，不依赖 raw uniform 名", () => {
		const instances = createShaderEffectInstances(["glitch"]);
		const adapter = createShaderEffectAdapter(instances);
		const target = adapter.resolveTarget("material:main", "effects.glitch.progress") as { value: number };
		expect(target).toBeTruthy();
		expect(adapter.normalizePath("effects.glitch.progress")).toBe("value");
		expect(adapter.canAnimate("value", 0.5)).toBe(true);
		target.value = 0.75;
		expect(instances[0].uniforms.progress.value).toBe(0.75);
	});

	it("按能力选择已验证的 texture 实现，并保持 graph 组合顺序", () => {
		const definition = getShaderEffect("glitch")!;
		expect(resolveShaderEffectImplementation(definition, { kind: "texture", hasSourceTexture: true, canPatchMaterial: true })?.kind).toBe("texture");
		const graph = createShaderEffectGraph(["glitch", "ripple", "glitch"]);
		expect(graph.nodes.map((node) => node.effectId)).toEqual(["glitch", "ripple"]);
		expect(resolveShaderEffectGraph(graph, { kind: "texture", hasSourceTexture: true, canPatchMaterial: false }).map((item) => item.definition.id)).toEqual(["glitch", "ripple"]);
	});
});
