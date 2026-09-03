import type { ElementType, TrackType } from "@/timeline";

const ELEMENT_TRACK_MAP: Record<ElementType, TrackType> = {
	audio: "audio",
	text: "text",
	graphic: "graphic",
	component: "graphic",
	effect: "effect",
	video: "video",
	image: "video",
};

export function getTrackTypeForElementType({
	elementType,
}: {
	elementType: ElementType;
}): TrackType {
	// 防御：旧项目可能残留已移除的元素类型（如 sticker），回退到 graphic 避免渲染崩溃。
	return ELEMENT_TRACK_MAP[elementType] ?? "graphic";
}

export function canElementGoOnTrack({
	elementType,
	trackType,
}: {
	elementType: ElementType;
	trackType: TrackType;
}): boolean {
	return getTrackTypeForElementType({ elementType }) === trackType;
}

export function validateElementTrackCompatibility({
	element,
	track,
}: {
	element: { type: ElementType };
	track: { type: TrackType };
}): { isValid: boolean; errorMessage?: string } {
	const isValid = canElementGoOnTrack({
		elementType: element.type,
		trackType: track.type,
	});

	if (!isValid) {
		return {
			isValid: false,
			errorMessage: `${element.type} elements cannot be placed on ${track.type} tracks`,
		};
	}

	return { isValid: true };
}
