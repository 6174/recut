import type {
	AnimationPath,
	ElementAnimations,
} from "@/animation/types";
import type { TimelineTrack } from "@/timeline";
import { getElementKeyframes } from "@/animation";
import { KEYFRAME_LANE_HEIGHT_PX } from "./layout";
import { t, type I18nKey, type RecutLocale } from "@/i18n";

export interface ExpandedRow {
	propertyPath: AnimationPath;
	label: string;
}

interface PropertyGroupDefinition {
	matchesPath: (path: AnimationPath) => boolean;
}

const PROPERTY_GROUPS: PropertyGroupDefinition[] = [
	{ matchesPath: (path) => path.startsWith("transform.") || path === "opacity" },
	{ matchesPath: (path) => path === "volume" || path === "color" },
	{ matchesPath: (path) => path.startsWith("background.") },
	{ matchesPath: (path) => path.startsWith("params.") },
	{ matchesPath: (path) => path.startsWith("effects.") },
];

const PROPERTY_LABEL_KEYS: Partial<Record<string, I18nKey>> = {
	"transform.positionX": "prop.param.positionX",
	"transform.positionY": "prop.param.positionY",
	"transform.positionZ": "prop.param.positionZ",
	"transform.scaleX": "prop.param.scaleX",
	"transform.scaleY": "prop.param.scaleY",
	"transform.rotate": "prop.param.rotate",
	opacity: "prop.param.opacity",
	volume: "prop.param.volume",
	color: "prop.param.color",
	"background.color": "prop.param.color",
	"background.paddingX": "prop.param.paddingX",
	"background.paddingY": "prop.param.paddingY",
	"background.offsetX": "prop.param.offsetX",
	"background.offsetY": "prop.param.offsetY",
	"background.cornerRadius": "prop.param.backgroundRadius",
};

export function getPropertyLabelKey(path: AnimationPath): I18nKey | null {
	return PROPERTY_LABEL_KEYS[path] ?? null;
}

export function getPropertyLabel({
	path,
	locale,
}: {
	path: AnimationPath;
	locale: RecutLocale;
}): string {
	const key = PROPERTY_LABEL_KEYS[path];
	if (key) return t(locale, key);
	if (path.startsWith("params.")) return path.slice("params.".length);
	if (path.startsWith("effects.")) {
		const parts = path.split(".");
		return parts[parts.length - 1];
	}
	return path;
}

export function getExpandedRows({
	animations,
}: {
	animations: ElementAnimations | undefined;
}): ExpandedRow[] {
	const keyframes = getElementKeyframes({ animations });
	const propertyPaths = [...new Set(keyframes.map((kf) => kf.propertyPath))];
	if (propertyPaths.length === 0) return [];

	const rows: ExpandedRow[] = [];

	for (const group of PROPERTY_GROUPS) {
		const groupPaths = propertyPaths.filter((path) =>
			group.matchesPath(path),
		);
		for (const path of groupPaths) {
			rows.push({ propertyPath: path, label: path });
		}
	}

	return rows;
}

export function getExpansionHeight({ rows }: { rows: ExpandedRow[] }): number {
	return rows.length * KEYFRAME_LANE_HEIGHT_PX;
}

export function computeTrackExpansionHeight({
	track,
	expandedElementIds,
}: {
	track: TimelineTrack;
	expandedElementIds: Set<string>;
}): number {
	let maxHeight = 0;
	for (const element of track.elements) {
		if (!expandedElementIds.has(element.id)) continue;
		const rows = getExpandedRows({ animations: element.animations });
		maxHeight = Math.max(maxHeight, getExpansionHeight({ rows }));
	}
	return maxHeight;
}

export function getTrackExpandedRows({
	track,
	expandedElementIds,
}: {
	track: TimelineTrack;
	expandedElementIds: Set<string>;
}): ExpandedRow[] {
	let maxHeight = 0;
	let maxRows: ExpandedRow[] = [];

	for (const element of track.elements) {
		if (!expandedElementIds.has(element.id)) continue;
		const rows = getExpandedRows({ animations: element.animations });
		const height = getExpansionHeight({ rows });
		if (height > maxHeight) {
			maxHeight = height;
			maxRows = rows;
		}
	}

	return maxRows;
}
