/**
 * [INPUT]: 独立 ShaderEffectDefinition 实现。
 * [OUTPUT]: effect registry、能力查询和 MotionProgram 语义路径解析。
 * [POS]: shader-effects 的唯一注册入口；Host 与动画 catalog 不依赖具体 GLSL 文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { displacementEffect } from "./effects/displacement";
import { glitchEffect } from "./effects/glitch";
import { rippleEffect } from "./effects/ripple";
import { crtEffect } from "./effects/crt";
import { vhsEffect } from "./effects/vhs";
import { LEGACY_SHADER_EFFECTS } from "./effects/legacy";
import type { MotionValue, MotionTargetAdapter } from "../motion-runtime";
import type { ShaderEffectContext, ShaderEffectDefinition, ShaderEffectId, ShaderEffectImplementation, ShaderEffectInstance } from "./types";

export const SHADER_EFFECTS: readonly ShaderEffectDefinition[] = [
	glitchEffect,
	rippleEffect,
	displacementEffect,
	crtEffect,
	vhsEffect,
	...LEGACY_SHADER_EFFECTS,
];
const BY_ID = new Map(SHADER_EFFECTS.map((effect) => [effect.id, effect]));

export interface ShaderEffectNode {
	effectId: ShaderEffectId;
	order?: number;
	enabled?: boolean;
}

export interface ShaderEffectGraph {
	schemaVersion: 1;
	nodes: readonly ShaderEffectNode[];
}

export function getShaderEffect(id: string): ShaderEffectDefinition | undefined {
	return BY_ID.get(id as ShaderEffectId);
}

/** Global Effect 组件的唯一复用入口：从逻辑 Definition 解析已验证的 Texture pass。 */
export function getShaderTexturePass(id: ShaderEffectId): string | undefined {
	return getShaderEffect(id)?.implementations.find((implementation) => implementation.kind === "texture")?.fragmentShader;
}

/** 需要同时使用 vertex/fragment 的组件也必须从同一 Definition 读取实现。 */
export function getShaderTextureImplementation(id: ShaderEffectId): ShaderEffectImplementation | undefined {
	return getShaderEffect(id)?.implementations.find((implementation) => implementation.kind === "texture");
}

export function createShaderEffectInstances(ids: readonly string[]): ShaderEffectInstance[] {
	return ids.flatMap((id) => {
		const effect = getShaderEffect(id);
		return effect ? [effect.create()] : [];
	});
}

/** 选择同一个逻辑 Effect 在当前渲染能力下的最佳实现。 */
export function resolveShaderEffectImplementation(
	effect: ShaderEffectDefinition,
	context: ShaderEffectContext,
): ShaderEffectImplementation | undefined {
	return [...effect.implementations]
		.filter((implementation) => implementation.supports(context))
		.sort((a, b) => b.priority - a.priority)[0];
}

/** 将可组合 graph 解析成稳定、有序的 effect implementation chain。 */
export function resolveShaderEffectGraph(
	graph: ShaderEffectGraph,
	context: ShaderEffectContext,
): Array<{ node: ShaderEffectNode; definition: ShaderEffectDefinition; implementation: ShaderEffectImplementation }> {
	return [...graph.nodes]
		.filter((node) => node.enabled !== false)
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
		.flatMap((node) => {
			const definition = getShaderEffect(node.effectId);
			const implementation = definition && resolveShaderEffectImplementation(definition, context);
			return definition && implementation ? [{ node, definition, implementation }] : [];
		});
}

export function createShaderEffectGraph(ids: readonly string[]): ShaderEffectGraph {
	return {
		schemaVersion: 1,
		nodes: [...new Set(ids)].flatMap((effectId, order) => {
			const definition = getShaderEffect(effectId);
			return definition ? [{ effectId: definition.id, order }] : [];
		}),
	};
}

export function createShaderEffectAdapter(instances: readonly ShaderEffectInstance[]): MotionTargetAdapter {
	const targets = new Map(instances.map((instance) => [instance.id, instance]));
	return {
		kind: "shader",
		resolveTarget: (ref, rawPath) => {
			const match = rawPath?.match(/^effects\.([\w-]+)\.([\w-]+)$/);
			if (!match) return null;
			const instance = targets.get(match[1] as ShaderEffectId);
			return instance?.uniforms[match[2]] ?? null;
		},
		normalizePath: () => "value",
		canAnimate: (path, value: MotionValue) => path === "value" && typeof value === "number" && Number.isFinite(value),
	};
}
