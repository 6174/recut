export type AudioLibraryKind = "music" | "sfx";

export interface AudioLibraryItem {
	id: string;
	name: string;
	kind: AudioLibraryKind;
	moods: string[];
	styles: string[];
	category?: string;
	tags?: string[];
	duration: number;
	filesize: number;
	license: string;
	source: string;
	attribution: string;
	url: string;
}

export interface AudioLibraryCatalog {
	version: number;
	generatedAt: string;
	music: AudioLibraryItem[];
	sfx: AudioLibraryItem[];
}
