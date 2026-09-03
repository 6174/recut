import type { ParamDefinition } from "@/params";

export type GraphicStrokeAlign = "inside" | "center" | "outside";

export const STROKE_ALIGN_PARAM: ParamDefinition<"strokeAlign"> = {
	key: "strokeAlign",
	label: "Stroke align",
	labelKey: "prop.param.strokeAlign",
	type: "select",
	default: "center",
	group: "stroke",
	options: [
		{ value: "inside", label: "Inside", labelKey: "prop.option.inside" },
		{ value: "center", label: "Center", labelKey: "prop.option.center" },
		{ value: "outside", label: "Outside", labelKey: "prop.option.outside" },
	],
};
