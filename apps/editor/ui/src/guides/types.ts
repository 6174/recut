import type { ReactNode } from "react";
import type { I18nKey } from "@/i18n";

export interface GridConfig {
	rows: number;
	cols: number;
}

export interface GuideRenderProps {
	width: number;
	height: number;
}

export interface GuideDefinition {
	id: string;
	label: string;
	/** 当设置时，渲染端优先用 labelKey 通过 i18n 翻译，label 作为兜底。 */
	labelKey?: I18nKey;
	renderPreview: () => ReactNode;
	renderTriggerIcon: () => ReactNode;
	renderOverlay: (props: GuideRenderProps) => ReactNode;
	renderOptions?: () => ReactNode;
}
