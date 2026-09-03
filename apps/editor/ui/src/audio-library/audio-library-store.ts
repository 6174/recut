import { create } from "zustand";
import type { AudioLibraryItem, AudioLibraryKind } from "@/audio-library/types";

export type AudioDownloadState =
	| { status: "idle" }
	| { status: "downloading"; progress: number }
	| { status: "downloaded" }
	| { status: "error"; message: string };

interface AudioLibraryStore {
	kind: AudioLibraryKind;
	setKind: (kind: AudioLibraryKind) => void;
	searchQuery: string;
	setSearchQuery: (query: string) => void;
	activeFilter: string | null;
	setActiveFilter: (filter: string | null) => void;
	/** itemId -> 下载状态（持久化下载记录到 localStorage）。 */
	downloadStates: Record<string, AudioDownloadState>;
	setDownloadState: (args: {
		itemId: string;
		state: AudioDownloadState;
	}) => void;
}

const DOWNLOAD_STATE_KEY = "recut-audio-library-downloads";

function loadPersistedStates(): Record<string, AudioDownloadState> {
	try {
		const raw = localStorage.getItem(DOWNLOAD_STATE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Record<string, AudioDownloadState>;
		// 只保留已下载/出错记录；进行中的状态不持久化。
		const restored: Record<string, AudioDownloadState> = {};
		for (const [id, state] of Object.entries(parsed)) {
			if (state.status === "downloaded") {
				restored[id] = { status: "downloaded" };
			}
		}
		return restored;
	} catch {
		return {};
	}
}

function persistStates(states: Record<string, AudioDownloadState>): void {
	const toSave: Record<string, AudioDownloadState> = {};
	for (const [id, state] of Object.entries(states)) {
		if (state.status === "downloaded") {
			toSave[id] = { status: "downloaded" };
		}
	}
	try {
		localStorage.setItem(DOWNLOAD_STATE_KEY, JSON.stringify(toSave));
	} catch {
		// Ignore storage write failures (private mode, quota, etc.).
	}
}

export const useAudioLibraryStore = create<AudioLibraryStore>((set, get) => ({
	kind: "music",
	setKind: (kind) => set({ kind }),
	searchQuery: "",
	setSearchQuery: (query) => set({ searchQuery: query }),
	activeFilter: null,
	setActiveFilter: (filter) => set({ activeFilter: filter }),
	downloadStates: loadPersistedStates(),
	setDownloadState: ({ itemId, state }) =>
		set((current) => {
			const downloadStates = {
				...current.downloadStates,
				[itemId]: state,
			};
			persistStates(downloadStates);
			return { downloadStates };
		}),
}));

export function getItemFilters({ item }: { item: AudioLibraryItem }): string[] {
	if (item.kind === "music") {
		return [...item.moods, ...item.styles];
	}
	return item.category ? [item.category, ...(item.tags ?? [])] : [...(item.tags ?? [])];
}
