/**
 * [INPUT]: Three Material、MotionProgram shader track 的语义路径。
 * [OUTPUT]: ShaderEffectDefinition、ShaderEffectInstance 与 Host 注入契约。
 * [POS]: 元素 Shader Motion 的稳定协议；具体 GLSL 只存在于 effects/* 实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type * as THREE from "three";

export type ShaderEffectId =
	| "glitch" | "ripple" | "displacement" | "crt" | "vhs"
	| "article-highlight" | "asciify" | "bend" | "blaze" | "bubble" | "cloth" | "clouds"
	| "decrypt-reveal" | "droplets" | "frost" | "glass" | "glyph-rain" | "grid" | "laser"
	| "liquid" | "magnify" | "particle-reveal" | "particle-scroll" | "retro-dither"
	| "store-peel" | "text-focus" | "vintage";
export type ShaderEffectImplementationKind = "texture" | "material" | "geometry" | "composite";
/** @deprecated Use ShaderEffectImplementationKind; retained for runtime API compatibility. */
export type ShaderEffectStage = "color";
export type ShaderUniforms = Record<string, THREE.IUniform<number>>;

export interface ShaderEffectInstance {
	id: ShaderEffectId;
	uniforms: ShaderUniforms;
}

export interface ShaderEffectDefinition {
	id: ShaderEffectId;
	parameters: readonly string[];
	create(): ShaderEffectInstance;
	implementations: readonly ShaderEffectImplementation[];
}

export interface ShaderEffectContext {
	kind: ShaderEffectImplementationKind;
	hasSourceTexture: boolean;
	canPatchMaterial: boolean;
}

export interface ShaderEffectImplementation {
	kind: ShaderEffectImplementationKind;
	priority: number;
	supports(context: ShaderEffectContext): boolean;
	/** Existing ShaderMaterial uniforms that can be aliased into this implementation. */
	uniformAliases?: Readonly<Record<string, string>>;
	/** Material/geometry path: inject declarations and transform a color expression. */
	declarations?: string;
	apply?: (colorExpression: string) => string;
	/** Texture/composite path: full pass source, shared with global Effects. */
	fragmentShader?: string;
	vertexShader?: string;
	/** Element texture backend: maps semantic instance uniforms to the canonical pass uniforms. */
	createTextureUniforms?: (args: { instance: ShaderEffectInstance; texture: THREE.Texture; aspect: number }) => Record<string, THREE.IUniform>;
	updateTextureUniforms?: (args: { instance: ShaderEffectInstance; uniforms: Record<string, THREE.IUniform> }) => void;
}

export interface ShaderEffectMaterialContext {
	material: THREE.Material;
	shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string };
	instances: readonly ShaderEffectInstance[];
}
