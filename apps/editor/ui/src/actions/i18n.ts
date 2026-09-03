import { t, type I18nKey, type RecutLocale } from "@/i18n";
import type { TActionCategory } from "./definitions";

const DESCRIPTION_KEYS: Record<string, I18nKey> = {
	"Play/Pause": "shortcut.playPause",
	"Stop playback": "shortcut.stop",
	"Seek forward 1 second": "shortcut.seekFwd1",
	"Seek backward 1 second": "shortcut.seekBack1",
	"Frame step forward": "shortcut.frameFwd",
	"Frame step backward": "shortcut.frameBack",
	"Jump forward 5 seconds": "shortcut.jumpFwd5",
	"Jump backward 5 seconds": "shortcut.jumpBack5",
	"Go to timeline start": "shortcut.toStart",
	"Go to timeline end": "shortcut.toEnd",
	"Split elements at playhead": "shortcut.splitAtPlayhead",
	"Split and remove left": "shortcut.splitRemoveLeft",
	"Split and remove right": "shortcut.splitRemoveRight",
	"Delete current selection": "shortcut.deleteSelection",
	"Copy selected elements": "shortcut.copyElements",
	"Paste elements at playhead": "shortcut.pasteAtPlayhead",
	"Toggle snapping": "shortcut.toggleSnapping",
	"Toggle ripple editing": "shortcut.toggleRipple",
	"Extract or recover source audio": "shortcut.extractAudio",
	"Select all elements": "shortcut.selectAll",
	"Cancel current interaction": "shortcut.cancelInteraction",
	"Deselect all elements": "shortcut.deselectAll",
	"Duplicate selected element": "shortcut.duplicateElement",
	"Mute/unmute selected elements": "shortcut.toggleMute",
	"Show/hide selected elements": "shortcut.toggleShow",
	"Toggle bookmark at playhead": "shortcut.toggleBookmark",
	Undo: "shortcut.undo",
	Redo: "shortcut.redo",
	"Remove media asset": "shortcut.removeAsset",
	"Remove media assets": "shortcut.removeAssets",
};

export function localizeActionDescription({
	description,
	locale,
}: {
	description: string;
	locale: RecutLocale;
}): string {
	const key = DESCRIPTION_KEYS[description];
	return key ? t(locale, key) : description;
}

const CATEGORY_KEYS: Record<TActionCategory, I18nKey> = {
	playback: "shortcut.cat.playback",
	navigation: "shortcut.cat.navigation",
	editing: "shortcut.cat.editing",
	selection: "shortcut.cat.selection",
	history: "shortcut.cat.history",
	timeline: "shortcut.cat.timeline",
	controls: "shortcut.cat.controls",
	assets: "shortcut.cat.assets",
};

export function localizeActionCategory({
	category,
	locale,
}: {
	category: TActionCategory | string;
	locale: RecutLocale;
}): string {
	return t(locale, CATEGORY_KEYS[category as TActionCategory] ?? "shortcut.cat.controls");
}
