import type { ParamDefinition, ParamValues } from "@/params";
import type { I18nKey } from "@/i18n";

export interface Effect {
	id: string;
	type: string;
	params: ParamValues;
	enabled: boolean;
}

export type EffectUniformValue = number | number[];

export interface EffectPass {
	shader: string;
	uniforms: Record<string, EffectUniformValue>;
}

export interface EffectPassTemplate {
	shader: string;
	uniforms(params: {
		effectParams: ParamValues;
		width: number;
		height: number;
	}): Record<string, EffectUniformValue>;
}

export interface EffectRendererConfig {
	passes: EffectPassTemplate[];
	buildPasses?: (params: {
		effectParams: ParamValues;
		width: number;
		height: number;
	}) => EffectPass[];
}

export interface EffectDefinition {
	type: string;
	name: string;
	/** 当设置时，渲染端优先用 nameKey 通过 i18n 翻译，name 作为兜底。 */
	nameKey?: I18nKey;
	keywords: string[];
	params: ParamDefinition[];
	renderer: EffectRendererConfig;
}
