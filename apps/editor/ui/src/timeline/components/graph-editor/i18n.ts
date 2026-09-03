import { t, type I18nKey, type RecutLocale } from "@/i18n";

const MESSAGE_KEYS: Record<string, I18nKey> = {
	"Select at most two adjacent keyframes per property.": "graph.selectTwoAdjacent",
	"The selected keyframe has no editable graph.": "graph.noEditableGraph",
	"The selected keyframe has no editable graph channel.": "graph.noEditableChannel",
	"The selected keyframe is not editable as a graph segment.": "graph.notEditableSegment",
	"Selected properties do not share a graph-editable channel.": "graph.notSharedChannel",
	"Select a keyframe that has an outgoing segment.": "graph.selectWithOutgoing",
	"Selected keyframes must be adjacent on each property.": "graph.adjacentRequired",
	"Hold segments have a fixed value - easing has no effect here.": "graph.holdFixed",
	"Cannot edit a segment where both keyframes are at the same time.": "graph.sameTime",
	"Select a keyframe to edit its curve.": "graph.selectToEdit",
	"The selected keyframe could not be resolved.": "graph.notResolved",
	"Selected keyframes must be on the same element.": "graph.sameElement",
};

/** 将 session 产生的英文 message 映射为本地化文本；未命中则原样返回。 */
export function localizeGraphMessage({
	message,
	locale,
}: {
	message: string;
	locale: RecutLocale;
}): string {
	const key = MESSAGE_KEYS[message];
	return key ? t(locale, key) : message;
}

const LABEL_KEYS: Record<string, I18nKey> = {
	Value: "graph.value",
	Curve: "graph.curve",
};

/** 组件选项标签（"Value"/"Curve" 或通道字母如 "R"/"G"）本地化。 */
export function localizeGraphLabel({
	label,
	locale,
}: {
	label: string;
	locale: RecutLocale;
}): string {
	const key = LABEL_KEYS[label];
	return key ? t(locale, key) : label;
}
