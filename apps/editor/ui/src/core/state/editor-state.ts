import type { EditorCore } from "@/core";
import type { SceneTracks } from "@/timeline";
import { EphemeralLayer } from "./ephemeral-layer";

const EMPTY_TRACKS: SceneTracks = {
	overlay: [],
	main: {
		id: "empty-main",
		name: "Main",
		type: "video",
		elements: [],
		muted: false,
		hidden: false,
	},
	audio: [],
};

/**
 * EditorState：临时状态层（不持久化）。
 * 持有 EphemeralLayer（交互瞬时覆盖）与选区引用，并对外提供"单一解析视图" getResolvedTracks()。
 * DocumentData 的唯一真相在 ScenesManager.active.tracks；本层只做叠加。
 */
export class EditorState {
	readonly ephemeral = new EphemeralLayer();
	private listeners = new Set<() => void>();
	private cachedTracks: SceneTracks | null = null;
	private cachedCommitted: SceneTracks | null = null;
	private cachedEphemeralVersion = -1;

	constructor(private readonly editor: EditorCore) {}

	/**
	 * 当前提交 tracks + ephemeral 覆盖后的单一解析视图（渲染 / 选择框 / 命中测试共用）。
	 * 幂等返回稳定引用（committed 或 ephemeral 未变化时复用缓存），
	 * 避免 useSyncExternalStore 每次 getSnapshot 拿到新对象导致无限重渲染。
	 */
	getResolvedTracks(): SceneTracks {
		const committed =
			this.editor.scenes.getActiveSceneOrNull()?.tracks ?? EMPTY_TRACKS;
		const version = this.ephemeral.version;
		if (
			this.cachedTracks &&
			this.cachedCommitted === committed &&
			this.cachedEphemeralVersion === version
		) {
			return this.cachedTracks;
		}
		this.cachedCommitted = committed;
		this.cachedEphemeralVersion = version;
		this.cachedTracks = this.ephemeral.resolveTracks(committed);
		return this.cachedTracks;
	}

	/** 选区属于 State 而非 Model。 */
	get selection() {
		return this.editor.selection;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	notify(): void {
		this.listeners.forEach((fn) => fn());
	}
}
