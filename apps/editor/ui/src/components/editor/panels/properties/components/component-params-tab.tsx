/**
 * [INPUT]: 依赖组件注册表、动画路径解析和属性字段渲染器。
 * [OUTPUT]: 对外提供带 Parameters 分组标题的 ComponentParamsTab。
 * [POS]: properties/components 的组件参数容器，复用全局单行表单标准。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { resolveAnimationPathValueAtTime } from "@/animation";
import {
	Section,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { useElementPlayhead } from "@/components/editor/panels/properties/hooks/use-element-playhead";
import { useKeyframedParamProperty } from "@/components/editor/panels/properties/hooks/use-keyframed-param-property";
import { PropertyParamField } from "@/components/editor/panels/properties/components/property-param-field";
import { ParamGroups } from "@/components/editor/panels/properties/components/param-groups";
import type { ParamDefinition, ParamValue } from "@/params";
import { componentsRegistry, getComponentName } from "@/runtime";
import type { TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";
import { useRecutLocale } from "@/i18n";

const CAPTURE_PADDING_PARAM: ParamDefinition = {
	key: "render.capturePadding",
	label: "Capture padding",
	labelKey: "prop.capturePadding",
	type: "number",
	default: 48,
	min: 0,
	max: 512,
	step: 1,
	keyframable: false,
};

/**
 * 组件参数标签页：渲染组件定义（ComponentDefinition.inputs）的可关键帧参数。
 * 全画布特效（glass / magnify 等）的 centerX/centerY、强度、颜色等在这里调整与打关键帧。
 */
export function ComponentParamsTab({
	element,
	trackId,
}: {
	element: TimelineElement;
	trackId: string;
}) {
	const definition =
		element.type === "component" && componentsRegistry.has(element.componentId)
			? componentsRegistry.get(element.componentId)
			: null;
	const locale = useRecutLocale();
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: element.startTime,
		duration: element.duration,
	});

	if (!definition) {
		return null;
	}
	const params = supportsCapturePadding(definition)
		? withCapturePadding(definition.inputs)
		: definition.inputs;
	if (params.length === 0) return null;

	return (
		<Section collapsible sectionKey={`${element.id}:component`}>
			<SectionHeader>
				<SectionTitle>{getComponentName({ definition, locale })}</SectionTitle>
			</SectionHeader>
			<ParamGroups
				params={params}
				sectionKey={`${element.id}:component`}
				renderParam={(param) => (
					<ComponentParamField
						key={param.key}
						element={element}
						trackId={trackId}
						param={param}
						localTime={localTime}
						isPlayheadWithinElementRange={isPlayheadWithinElementRange}
					/>
				)}
			/>
		</Section>
	);
}

function supportsCapturePadding(definition: import("@/runtime/types").ComponentDefinition): boolean {
	return definition.surface === "html" || definition.surface === "react";
}

function withCapturePadding(inputs: ParamDefinition[]): ParamDefinition[] {
	return inputs.some((param) => param.key === CAPTURE_PADDING_PARAM.key)
		? inputs
		: [...inputs, CAPTURE_PADDING_PARAM];
}

function ComponentParamField({
	element,
	trackId,
	param,
	localTime,
	isPlayheadWithinElementRange,
}: {
	element: TimelineElement;
	trackId: string;
	param: ParamDefinition;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
}) {
	const baseValue: ParamValue = element.params[param.key] ?? param.default;
	const resolvedValue = resolveAnimationPathValueAtTime({
		animations: element.animations,
		propertyPath: param.key,
		localTime,
		fallbackValue: baseValue,
	});
	const animatedParam = useKeyframedParamProperty({
		param,
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath: param.key,
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue,
		buildBaseUpdates: ({ value }) => ({
			params: {
				...element.params,
				[param.key]: value,
			},
		}),
	});

	return (
		<PropertyParamField
			param={param}
			value={resolvedValue}
			onPreview={animatedParam.onPreview}
			onCommit={animatedParam.onCommit}
			keyframe={{
				isActive: animatedParam.isKeyframedAtTime,
				isDisabled: !isPlayheadWithinElementRange,
				onToggle: animatedParam.toggleKeyframe,
			}}
		/>
	);
}
