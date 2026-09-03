import type { ParamDefinition, ParamValues } from "@/params";
import type { I18nKey } from "@/i18n";

export const DEFAULT_GRAPHIC_SOURCE_SIZE = 512;

export interface GraphicRenderContext {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	params: ParamValues;
	width: number;
	height: number;
}

export interface GraphicDefinition {
	id: string;
	name: string;
	/** 当设置时，渲染端优先用 nameKey 通过 i18n 翻译，name 作为兜底。 */
	nameKey?: I18nKey;
	keywords: string[];
	params: ParamDefinition[];
	render(context: GraphicRenderContext): void;
}

export interface GraphicInstance {
	definitionId: string;
	params: ParamValues;
}
