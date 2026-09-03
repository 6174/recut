import type {
	ParamDefinition,
	ParamValue,
	ParamValues,
} from "@/params";
import type { I18nKey } from "@/i18n";
import { MIN_TRANSFORM_SCALE } from "@/animation/transform";
import type { BlendMode } from "@/rendering";
import type {
	ElementType,
	TimelineElement,
} from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/timeline/audio-constants";
import {
	CORNER_RADIUS_MAX,
	CORNER_RADIUS_MIN,
} from "@/text/background";

export type ElementParamDefinition<TKey extends string = string> =
	ParamDefinition<TKey> & {
		read?: ({ element }: { element: TimelineElement }) => ParamValue | null;
		write?: ({
			element,
			value,
		}: {
			element: TimelineElement;
			value: ParamValue;
		}) => TimelineElement;
	};

export function buildDefaultParamValues(
	params: readonly ParamDefinition[],
): ParamValues {
	const values: ParamValues = {};
	for (const param of params) {
		values[param.key] = param.default;
	}
	return values;
}

export class DefinitionRegistry<TKey extends string, TDefinition> {
	private definitions = new Map<TKey, TDefinition>();
	private entityName: string;

	constructor(entityName: string) {
		this.entityName = entityName;
	}

	register({
		key,
		definition,
	}: {
		key: TKey;
		definition: TDefinition;
	}): void {
		this.definitions.set(key, definition);
	}

	has(key: TKey): boolean {
		return this.definitions.has(key);
	}

	get(key: TKey): TDefinition {
		const def = this.definitions.get(key);
		if (!def) {
			throw new Error(`Unknown ${this.entityName}: ${key}`);
		}
		return def;
	}

	getAll(): TDefinition[] {
		return Array.from(this.definitions.values());
	}
}

const BLEND_MODE_OPTIONS: Array<{
	value: BlendMode;
	label: string;
	labelKey: I18nKey;
}> = [
	{ value: "normal", label: "Normal", labelKey: "prop.blend.normal" },
	{ value: "darken", label: "Darken", labelKey: "prop.blend.darken" },
	{ value: "multiply", label: "Multiply", labelKey: "prop.blend.multiply" },
	{ value: "color-burn", label: "Color Burn", labelKey: "prop.blend.colorBurn" },
	{ value: "lighten", label: "Lighten", labelKey: "prop.blend.lighten" },
	{ value: "screen", label: "Screen", labelKey: "prop.blend.screen" },
	{
		value: "plus-lighter",
		label: "Plus Lighter",
		labelKey: "prop.blend.plusLighter",
	},
	{
		value: "color-dodge",
		label: "Color Dodge",
		labelKey: "prop.blend.colorDodge",
	},
	{ value: "overlay", label: "Overlay", labelKey: "prop.blend.overlay" },
	{ value: "soft-light", label: "Soft Light", labelKey: "prop.blend.softLight" },
	{ value: "hard-light", label: "Hard Light", labelKey: "prop.blend.hardLight" },
	{ value: "difference", label: "Difference", labelKey: "prop.blend.difference" },
	{ value: "exclusion", label: "Exclusion", labelKey: "prop.blend.exclusion" },
	{ value: "hue", label: "Hue", labelKey: "prop.blend.hue" },
	{ value: "saturation", label: "Saturation", labelKey: "prop.blend.saturation" },
	{ value: "color", label: "Color", labelKey: "prop.blend.color" },
	{ value: "luminosity", label: "Luminosity", labelKey: "prop.blend.luminosity" },
];

const visualElementParams: ElementParamDefinition[] = [
	{
		key: "transform.positionX",
		label: "Position X",
		labelKey: "prop.param.positionX",
		type: "number",
		default: DEFAULTS.element.transform.position.x,
		min: -100_000,
		step: 1,
	},
	{
		key: "transform.positionY",
		label: "Position Y",
		labelKey: "prop.param.positionY",
		type: "number",
		default: DEFAULTS.element.transform.position.y,
		min: -100_000,
		step: 1,
	},
	{
		key: "transform.positionZ",
		label: "Position Z",
		labelKey: "prop.param.positionZ",
		type: "number",
		default: DEFAULTS.element.transform.position.z,
		min: -100_000,
		step: 1,
	},
	{
		key: "transform.scaleX",
		label: "Scale X",
		labelKey: "prop.param.scaleX",
		type: "number",
		default: DEFAULTS.element.transform.scaleX,
		min: MIN_TRANSFORM_SCALE,
		step: 0.01,
	},
	{
		key: "transform.scaleY",
		label: "Scale Y",
		labelKey: "prop.param.scaleY",
		type: "number",
		default: DEFAULTS.element.transform.scaleY,
		min: MIN_TRANSFORM_SCALE,
		step: 0.01,
	},
	{
		key: "transform.rotate",
		label: "Rotate",
		labelKey: "prop.param.rotate",
		type: "number",
		default: DEFAULTS.element.transform.rotate,
		min: -360,
		max: 360,
		step: 1,
	},
	{
		key: "opacity",
		label: "Opacity",
		labelKey: "prop.param.opacity",
		type: "number",
		default: DEFAULTS.element.opacity,
		min: 0,
		max: 1,
		step: 0.01,
	},
	{
		key: "blendMode",
		label: "Blend Mode",
		labelKey: "prop.param.blendMode",
		type: "select",
		default: DEFAULTS.element.blendMode,
		keyframable: false,
		options: BLEND_MODE_OPTIONS,
	},
];

const audioElementParams: ElementParamDefinition[] = [
	{
		key: "volume",
		label: "Volume",
		labelKey: "prop.param.volume",
		type: "number",
		default: DEFAULTS.element.volume,
		min: VOLUME_DB_MIN,
		max: VOLUME_DB_MAX,
		step: 0.01,
	},
	{
		key: "muted",
		label: "Muted",
		labelKey: "prop.param.muted",
		type: "boolean",
		default: false,
		keyframable: false,
	},
];

const textElementParams: ElementParamDefinition[] = [
	{
		key: "content",
		label: "Content",
		labelKey: "prop.param.content",
		type: "text",
		default: "Default text",
		keyframable: false,
	},
	{
		key: "fontFamily",
		label: "Font Family",
		labelKey: "prop.param.fontFamily",
		type: "font",
		default: "Arial",
		keyframable: false,
	},
	{
		key: "fontSize",
		label: "Font Size",
		labelKey: "prop.param.fontSize",
		type: "number",
		default: 15,
		min: 1,
		step: 1,
	},
	{
		key: "color",
		label: "Color",
		labelKey: "prop.param.color",
		type: "color",
		default: "#ffffff",
	},
	{
		key: "textAlign",
		label: "Text Align",
		labelKey: "prop.param.textAlign",
		type: "select",
		default: "center",
		keyframable: false,
		options: [
			{ value: "left", label: "Left", labelKey: "prop.option.left" },
			{ value: "center", label: "Center", labelKey: "prop.option.center" },
			{ value: "right", label: "Right", labelKey: "prop.option.right" },
		],
	},
	{
		key: "fontWeight",
		label: "Font Weight",
		labelKey: "prop.param.fontWeight",
		type: "select",
		default: "normal",
		keyframable: false,
		options: [
			{ value: "normal", label: "Normal", labelKey: "prop.option.normal" },
			{ value: "bold", label: "Bold", labelKey: "prop.option.bold" },
		],
	},
	{
		key: "fontStyle",
		label: "Font Style",
		labelKey: "prop.param.fontStyle",
		type: "select",
		default: "normal",
		keyframable: false,
		options: [
			{ value: "normal", label: "Normal", labelKey: "prop.option.normal" },
			{ value: "italic", label: "Italic", labelKey: "prop.option.italic" },
		],
	},
	{
		key: "textDecoration",
		label: "Text Decoration",
		labelKey: "prop.param.textDecoration",
		type: "select",
		default: "none",
		keyframable: false,
		options: [
			{ value: "none", label: "None", labelKey: "prop.option.none" },
			{ value: "underline", label: "Underline", labelKey: "prop.option.underline" },
			{
				value: "line-through",
				label: "Line Through",
				labelKey: "prop.option.lineThrough",
			},
		],
	},
	{
		key: "letterSpacing",
		label: "Letter Spacing",
		labelKey: "prop.param.letterSpacing",
		type: "number",
		default: DEFAULTS.text.letterSpacing,
		min: -100,
		step: 0.1,
	},
	{
		key: "lineHeight",
		label: "Line Height",
		labelKey: "prop.param.lineHeight",
		type: "number",
		default: DEFAULTS.text.lineHeight,
		min: 0.1,
		step: 0.1,
	},
	{
		key: "stroke.enabled",
		label: "Stroke",
		labelKey: "prop.param.strokeEnabled",
		group: "stroke",
		type: "boolean",
		default: DEFAULTS.text.stroke.enabled,
		keyframable: false,
	},
	{
		key: "stroke.color",
		label: "Stroke Color",
		labelKey: "prop.param.strokeColor",
		group: "stroke",
		type: "color",
		default: DEFAULTS.text.stroke.color,
		dependencies: [{ param: "stroke.enabled", equals: true }],
	},
	{
		key: "stroke.width",
		label: "Stroke Width",
		labelKey: "prop.param.strokeWidth",
		group: "stroke",
		type: "number",
		default: DEFAULTS.text.stroke.width,
		min: 0,
		step: 0.1,
		dependencies: [{ param: "stroke.enabled", equals: true }],
	},
	{
		key: "background.enabled",
		label: "Enabled",
		labelKey: "prop.param.backgroundEnabled",
		group: "background",
		type: "boolean",
		default: DEFAULTS.text.background.enabled,
		keyframable: false,
	},
	{
		key: "background.color",
		label: "Color",
		labelKey: "prop.param.color",
		group: "background",
		type: "color",
		default: DEFAULTS.text.background.color,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.cornerRadius",
		label: "Radius",
		labelKey: "prop.param.backgroundRadius",
		group: "background",
		type: "number",
		default: DEFAULTS.text.background.cornerRadius,
		min: CORNER_RADIUS_MIN,
		max: CORNER_RADIUS_MAX,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.paddingX",
		label: "Padding X",
		labelKey: "prop.param.paddingX",
		group: "background",
		type: "number",
		default: DEFAULTS.text.background.paddingX,
		min: 0,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.paddingY",
		label: "Padding Y",
		labelKey: "prop.param.paddingY",
		group: "background",
		type: "number",
		default: DEFAULTS.text.background.paddingY,
		min: 0,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.offsetX",
		label: "Offset X",
		labelKey: "prop.param.offsetX",
		group: "background",
		type: "number",
		default: DEFAULTS.text.background.offsetX,
		min: -100_000,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.offsetY",
		label: "Offset Y",
		labelKey: "prop.param.offsetY",
		group: "background",
		type: "number",
		default: DEFAULTS.text.background.offsetY,
		min: -100_000,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
];

export const elementParamRegistry = new DefinitionRegistry<
	ElementType,
	readonly ElementParamDefinition[]
>("element params");

elementParamRegistry.register({
	key: "video",
	definition: [...visualElementParams, ...audioElementParams],
});
elementParamRegistry.register({ key: "image", definition: visualElementParams });
elementParamRegistry.register({
	key: "text",
	definition: [...textElementParams, ...visualElementParams],
});
elementParamRegistry.register({
	key: "graphic",
	definition: visualElementParams,
});
elementParamRegistry.register({
	key: "component",
	definition: visualElementParams,
});
elementParamRegistry.register({ key: "audio", definition: audioElementParams });
elementParamRegistry.register({ key: "effect", definition: [] });

export function getElementParams({
	element,
}: {
	element: TimelineElement;
}): readonly ElementParamDefinition[] {
	return elementParamRegistry.has(element.type)
		? elementParamRegistry.get(element.type)
		: [];
}

export function getBuiltInElementParams({
	type,
}: {
	type: ElementType;
}): readonly ElementParamDefinition[] {
	return elementParamRegistry.has(type) ? elementParamRegistry.get(type) : [];
}

export function getElementParam({
	element,
	key,
}: {
	element: TimelineElement;
	key: string;
}): ElementParamDefinition | null {
	return (
		getElementParams({ element }).find((param) => param.key === key) ?? null
	);
}

export function readElementParamValue({
	element,
	param,
}: {
	element: TimelineElement;
	param: ElementParamDefinition;
}): ParamValue | null {
	if (param.read) {
		return param.read({ element });
	}
	if ("params" in element) {
		return element.params[param.key] ?? param.default;
	}
	return null;
}

export function writeElementParamValue({
	element,
	param,
	value,
}: {
	element: TimelineElement;
	param: ElementParamDefinition;
	value: ParamValue;
}): TimelineElement {
	if (param.write) {
		return param.write({ element, value });
	}
	if ("params" in element) {
		return {
			...element,
			params: {
				...element.params,
				[param.key]: value,
			},
		};
	}
	return element;
}

export function buildElementParamValues({
	element,
}: {
	element: TimelineElement;
}): ParamValues {
	const values: ParamValues = {};
	for (const param of getElementParams({ element })) {
		const value = readElementParamValue({ element, param });
		if (value !== null) {
			values[param.key] = value;
		}
	}
	return values;
}
