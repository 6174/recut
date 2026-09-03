/**
 * [INPUT]: 依赖元素、图形、组件与效果的参数定义及动画通道工具。
 * [OUTPUT]: 对外提供 resolveAnimationTarget，将关键帧路径映射为可读写的动画目标。
 * [POS]: timeline 的关键帧权限边界；所有新增、删除和编辑命令经此确认路径合法。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type {
	AnimationInterpolation,
	AnimationPath,
	NumericSpec,
} from "@/animation/types";
import {
	parseEffectParamPath,
} from "@/animation/effect-param-channel";
import {
	parseGraphicParamPath,
} from "@/animation/graphic-param-channel";
import { effectsRegistry, registerDefaultEffects } from "@/effects";
import { getGraphicDefinition } from "@/graphics";
import {
	coerceParamValue,
	getParamDefaultInterpolation,
	getParamChannelLayout,
	getParamNumericRange,
	isParamKeyframable,
	type ParamChannelLayout,
	type ParamDefinition,
	type ParamValue,
	type ParamValues,
} from "@/params";
import {
	getElementParam,
} from "@/params/registry";
import { componentsRegistry } from "@/runtime/component-registry";
import type { TimelineElement } from "@/timeline";
import { isVisualElement } from "@/timeline/element-utils";

export interface AnimationPathDescriptor {
	channelLayout: ParamChannelLayout;
	defaultInterpolation: AnimationInterpolation;
	numericRanges?: Partial<Record<string, NumericSpec>>;
	coerceValue: ({ value }: { value: ParamValue }) => ParamValue | null;
	getBaseValue: () => ParamValue | null;
	setBaseValue: ({ value }: { value: ParamValue }) => TimelineElement;
}

// Leaf params expose a single component named "value". Composite params don't
// carry numeric ranges yet — revisit when one does.
function paramNumericRanges({
	param,
}: {
	param: ParamDefinition;
}): Partial<Record<string, NumericSpec>> | undefined {
	const range = getParamNumericRange({ param });
	return range ? { value: range } : undefined;
}

function buildParamDescriptor({
	param,
	baseParams,
	setParams,
}: {
	param: ParamDefinition;
	baseParams: ParamValues;
	setParams: (params: ParamValues) => TimelineElement;
}): AnimationPathDescriptor | null {
	if (!isParamKeyframable({ param })) {
		return null;
	}

	return {
		channelLayout: getParamChannelLayout({ param }),
		defaultInterpolation: getParamDefaultInterpolation({ param }),
		numericRanges: paramNumericRanges({ param }),
		coerceValue: ({ value }) => coerceParamValue({ param, value }),
		getBaseValue: () => baseParams[param.key] ?? param.default,
		setBaseValue: ({ value }) => {
			const coercedValue = coerceParamValue({ param, value });
			if (coercedValue === null) {
				return setParams(baseParams);
			}

			return setParams({
				...baseParams,
				[param.key]: coercedValue,
			});
		},
	};
}

function buildElementParamDescriptor({
	element,
	paramKey,
}: {
	element: TimelineElement;
	paramKey: string;
}): AnimationPathDescriptor | null {
	const param = getElementParam({ element, key: paramKey });
	if (!param) {
		return null;
	}

	return buildParamDescriptor({
		param,
		baseParams: element.params,
		setParams: (params) => ({
			...element,
			params,
		}),
	});
}

function buildGraphicParamDescriptor({
	element,
	paramKey,
}: {
	element: TimelineElement;
	paramKey: string;
}): AnimationPathDescriptor | null {
	if (element.type !== "graphic") {
		return null;
	}

	const definition = getGraphicDefinition({
		definitionId: element.definitionId,
	});
	const param = definition.params.find((candidate) => candidate.key === paramKey);
	if (!param) {
		return null;
	}

	return buildParamDescriptor({
		param,
		baseParams: element.params,
		setParams: (params) => ({
			...element,
			params,
		}),
	});
}

function buildComponentParamDescriptor({
	element,
	paramKey,
}: {
	element: TimelineElement;
	paramKey: string;
}): AnimationPathDescriptor | null {
	if (element.type !== "component" || !componentsRegistry.has(element.componentId)) {
		return null;
	}

	const param = componentsRegistry
		.get(element.componentId)
		.inputs.find((candidate) => candidate.key === paramKey);
	if (!param) {
		return null;
	}

	return buildParamDescriptor({
		param,
		baseParams: element.params,
		setParams: (params) => ({
			...element,
			params,
		}),
	});
}

function buildEffectParamDescriptor({
	element,
	effectId,
	paramKey,
}: {
	element: TimelineElement;
	effectId: string;
	paramKey: string;
}): AnimationPathDescriptor | null {
	if (!isVisualElement(element)) {
		return null;
	}

	const effect = element.effects?.find((candidate) => candidate.id === effectId);
	if (!effect) {
		return null;
	}

	registerDefaultEffects();
	const definition = effectsRegistry.get(effect.type);
	const param = definition.params.find((candidate) => candidate.key === paramKey);
	if (!param) {
		return null;
	}

	return buildParamDescriptor({
		param,
		baseParams: effect.params,
		setParams: (params) => ({
			...element,
			effects:
				element.effects?.map((candidate) =>
					candidate.id !== effectId
						? candidate
						: {
								...candidate,
								params,
							},
				) ?? element.effects,
		}),
	});
}

export function resolveAnimationTarget({
	element,
	path,
}: {
	element: TimelineElement;
	path: AnimationPath;
}): AnimationPathDescriptor | null {
	const elementParamTarget = buildElementParamDescriptor({
		element,
		paramKey: path,
	});
	if (elementParamTarget) {
		return elementParamTarget;
	}

	const componentParamTarget = buildComponentParamDescriptor({
		element,
		paramKey: path,
	});
	if (componentParamTarget) {
		return componentParamTarget;
	}

	const graphicParamTarget = parseGraphicParamPath({ propertyPath: path });
	if (graphicParamTarget) {
		return buildGraphicParamDescriptor({
			element,
			paramKey: graphicParamTarget.paramKey,
		});
	}

	const effectParamTarget = parseEffectParamPath({ propertyPath: path });
	if (effectParamTarget) {
		return buildEffectParamDescriptor({
			element,
			effectId: effectParamTarget.effectId,
			paramKey: effectParamTarget.paramKey,
		});
	}

	return null;
}
