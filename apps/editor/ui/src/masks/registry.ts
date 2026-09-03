import { MAX_FEATHER } from "@/masks/feather";
import type { ParamDefinition } from "@/params";
import { t, type I18nKey, type RecutLocale } from "@/i18n";
import type {
	BaseMaskParams,
	Mask,
	MaskDefaultContext,
	MaskDefinition,
	MaskParamUpdateArgs,
	MaskRenderer,
	MaskType,
} from "@/masks/types";
import type { HugeiconsIconProps } from "@hugeicons/react";
import { DefinitionRegistry } from "@/params/registry";

export type MaskIconProps = {
	icon: HugeiconsIconProps["icon"];
	strokeWidth?: number;
};

type RegisteredMaskWithoutId = Mask extends infer TMask
	? TMask extends Mask
		? Omit<TMask, "id">
		: never
	: never;

export type MaskDefinitionForRegistration = {
	[TType in MaskType]: MaskDefinition<TType>;
}[MaskType];

export const BASE_MASK_PARAM_DEFINITIONS: ParamDefinition<
	keyof BaseMaskParams & string
>[] = [
	{
		key: "feather",
		label: "Feather",
		labelKey: "prop.param.feather",
		type: "number",
		default: 0,
		min: 0,
		max: MAX_FEATHER,
		step: 1,
		unit: "percent",
	},
	{
		key: "strokeWidth",
		label: "Stroke width",
		labelKey: "prop.param.strokeWidth",
		type: "number",
		default: 0,
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "strokeColor",
		label: "Stroke color",
		labelKey: "prop.param.strokeColor",
		type: "color",
		default: "#ffffff",
	},
];

export interface RegisteredMaskDefinition {
	type: MaskType;
	name: string;
	nameKey?: I18nKey;
	features: MaskDefinition["features"];
	params: ParamDefinition<string>[];
	renderer: MaskRenderer<BaseMaskParams>;
	interaction: MaskDefinition["interaction"];
	isActive?(params: BaseMaskParams): boolean;
	buildDefault(context: MaskDefaultContext): RegisteredMaskWithoutId;
	computeParamUpdate(
		args: MaskParamUpdateArgs<BaseMaskParams>,
	): Partial<BaseMaskParams>;
	icon: MaskIconProps;
}

export class MasksRegistry extends DefinitionRegistry<
	MaskType,
	RegisteredMaskDefinition
> {
	constructor() {
		super("mask");
	}

	registerMask({
		definition,
		icon,
	}: {
		definition: MaskDefinitionForRegistration;
		icon: MaskIconProps;
	}): void {
		const withBaseParams: RegisteredMaskDefinition = {
			type: definition.type,
			name: definition.name,
			nameKey: definition.nameKey,
			features: definition.features,
			params: [...definition.params, ...BASE_MASK_PARAM_DEFINITIONS],
			renderer: definition.renderer,
			interaction: definition.interaction,
			isActive: definition.isActive,
			buildDefault: definition.buildDefault,
			computeParamUpdate: definition.computeParamUpdate,
			icon,
		};
		this.register({
			key: definition.type,
			definition: withBaseParams,
		});
	}
}

export const masksRegistry = new MasksRegistry();

export function getMaskName({
	definition,
	locale,
}: {
	definition: RegisteredMaskDefinition;
	locale: RecutLocale;
}): string {
	return definition.nameKey ? t(locale, definition.nameKey) : definition.name;
}
