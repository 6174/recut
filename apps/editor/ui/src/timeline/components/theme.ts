import type { TrackType } from "@/timeline";

export const TIMELINE_AUDIO_WAVEFORM_COLOR = "rgba(255, 255, 255, 0.7)";

export const TIMELINE_TRACK_THEME: Record<
	TrackType,
	{
		elementClassName: string;
		waveformColor?: string;
	}
> = {
	video: {
		elementClassName: "transparent",
		waveformColor: TIMELINE_AUDIO_WAVEFORM_COLOR,
	},
	text: { elementClassName: "bg-[oklch(0.6_0.12_151)]" },
	audio: {
		elementClassName: "bg-[oklch(0.6_0.12_290)]",
		waveformColor: TIMELINE_AUDIO_WAVEFORM_COLOR,
	},
	graphic: { elementClassName: "bg-[oklch(0.6_0.12_355)]" },
	effect: { elementClassName: "bg-[oklch(0.6_0.12_230)]" },
} as const;

export const SELECTED_TRACK_ROW_CLASS = "bg-accent/50";
export const DEFAULT_TIMELINE_BOOKMARK_COLOR = "oklch(0.6 0.15 151)";

export function getTimelineElementClassName({
	type,
}: {
	type: TrackType;
}): string {
	return TIMELINE_TRACK_THEME[type]?.elementClassName.trim() ?? "";
}
