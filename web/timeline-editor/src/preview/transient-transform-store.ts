/*
 * [INPUT]: 无外部依赖；只存拖动中的瞬时 transform（渲染用绝对变换）。
 * [OUTPUT]: transientTransforms：set/clear/get/subscribe/version。刻意独立于 editor store——
 *           拖拽中间态不进 editor 状态层，避免每次 pointermove 触发全局 notify 与同步 React flush。
 * [POS]: preview 拖拽的本地瞬时层；pointerup 提交后才清空并落回 editor store。
 * [PROTOCOL]: 变更时更新此头部。
 */
import type { Transform } from "@timeline/rendering";

type Listener = () => void;

class TransientTransformStore {
	private transforms = new Map<string, Transform>();
	private listeners = new Set<Listener>();
	/** 每帧递增；供 useSyncExternalStore 判断快照是否变化。 */
	private _version = 0;

	get version(): number {
		return this._version;
	}

	set({ elementId, transform }: { elementId: string; transform: Transform }): void {
		this.transforms.set(elementId, transform);
		this._version += 1;
		this.emit();
	}

	get(elementId: string): Transform | undefined {
		return this.transforms.get(elementId);
	}

	clear(elementIds?: readonly string[]): void {
		if (this.transforms.size === 0) return;
		if (!elementIds) {
			this.transforms.clear();
		} else {
			for (const id of elementIds) this.transforms.delete(id);
		}
		this._version += 1;
		this.emit();
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}

export const transientTransforms = new TransientTransformStore();
