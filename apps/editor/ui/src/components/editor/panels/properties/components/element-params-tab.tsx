/**
 * [INPUT]: 依赖参数注册表、动画路径解析与属性编辑字段。
 * [OUTPUT]: 对外提供按分组标题渲染元素内建参数的 ElementParamsTab。
 * [POS]: properties/components 的元素参数容器，将单一属性模型落到统一表单布局。
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
import type { ParamValue, ParamValues } from "@/params";
import {
	getElementParams,
	readElementParamValue,
	writeElementParamValue,
	type ElementParamDefinition,
} from "@/params/registry";
import type { TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";
import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";
import { useEditor } from "@/editor/use-editor";

export function ElementParamsTab({
	element,
	trackId,
	paramKeys,
	sectionKey,
	title,
}: {
	element: TimelineElement;
	trackId: string;
	paramKeys?: readonly string[];
	sectionKey: string;
	title: string;
}) {
	const editor = useEditor();
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: element.startTime,
		duration: element.duration,
	});
	const params = getElementParams({ element }).filter(
		(param) => !paramKeys || paramKeys.includes(param.key),
	);
	const baseValues = buildValues({ element, params });
	const visibleParams = params.filter((param) =>
		isVisible({ param, values: baseValues }),
	);

	const canvasSize =
		editor.project.getActiveOrNull()?.settings.canvasSize ?? null;

	return (
		<Section collapsible sectionKey={`${element.id}:${sectionKey}`}>
			<SectionHeader>
				<SectionTitle>{title}</SectionTitle>
			</SectionHeader>
			<ParamGroups
				params={visibleParams}
				sectionKey={`${element.id}:${sectionKey}`}
				renderParam={(param) => (
					<ElementParamField
						key={param.key}
						element={element}
						trackId={trackId}
						param={withDisplayScale({ param, canvasSize })}
						baseValue={baseValues[param.key] ?? param.default}
						localTime={localTime}
						isPlayheadWithinElementRange={isPlayheadWithinElementRange}
					/>
				)}
			/>
		</Section>
	);
}

function ElementParamField({
	element,
	trackId,
	param,
	baseValue,
	localTime,
	isPlayheadWithinElementRange,
}: {
	element: TimelineElement;
	trackId: string;
	param: ElementParamDefinition;
	baseValue: ParamValue;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
}) {
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
		buildBaseUpdates: ({ value }) =>
			writeElementParamValue({ element, param, value }),
	});

	return (
		<PropertyParamField
			param={param}
			value={resolvedValue}
			onPreview={animatedParam.onPreview}
			onCommit={animatedParam.onCommit}
			keyframe={
				param.keyframable === false
					? undefined
					: {
							isActive: animatedParam.isKeyframedAtTime,
							isDisabled: !isPlayheadWithinElementRange,
							onToggle: animatedParam.toggleKeyframe,
						}
			}
		/>
	);
}

function buildValues({
	element,
	params,
}: {
	element: TimelineElement;
	params: readonly ElementParamDefinition[];
}): ParamValues {
	const values: ParamValues = {};
	for (const param of params) {
		const value = readElementParamValue({ element, param });
		if (value !== null) {
			values[param.key] = value;
		}
	}
	return values;
}

function isVisible({
	param,
	values,
}: {
	param: ElementParamDefinition;
	values: ParamValues;
}): boolean {
	return (param.dependencies ?? []).every((dependency) =>
		areParamValuesEqual({
			left: values[dependency.param],
			right: dependency.equals,
		}),
	);
}

/**
 * fontSize 内部按 fontSize × canvasHeight / 90 缩放存储；
 * 面板按手机等效字号显示/编辑（画布像素 × 手机短边 390 / 画布短边），
 * 避免 1080p 画布下出现 170+ 的画布像素值，让用户按手机观感调字号。
 */
const PHONE_SHORT_SIDE_PX = 390;

function withDisplayScale({
	param,
	canvasSize,
}: {
	param: ElementParamDefinition;
	canvasSize: { width: number; height: number } | null;
}): ElementParamDefinition {
	if (param.type !== "number" || param.key !== "fontSize" || !canvasSize) {
		return param;
	}
	const shortSide = Math.min(canvasSize.width, canvasSize.height);
	if (!Number.isFinite(shortSide) || shortSide <= 0) return param;
	const multiplier =
		(canvasSize.height / FONT_SIZE_SCALE_REFERENCE) *
		(PHONE_SHORT_SIDE_PX / shortSide);
	return {
		...param,
		displayMultiplier: multiplier,
		min: param.min !== undefined ? param.min * multiplier : undefined,
		max: param.max !== undefined ? param.max * multiplier : undefined,
	} as ElementParamDefinition;
}

function areParamValuesEqual({
	left,
	right,
}: {
	left: ParamValue | undefined;
	right: ParamValue;
}): boolean {
	return left === right;
}
