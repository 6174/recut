import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { EditorCore } from "@timeline/core";

const SNAPSHOT_UNSET = Symbol("snapshotUnset");

function isShallowEqual({
	a,
	b,
}: {
	a: unknown;
	b: unknown;
}): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
		return false;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((item, i) => Object.is(item, b[i]));
	}
	// 普通对象按浅比较：selector 返回新建对象但字段未变时（如 project.getActive 的
	// 身份抖动、派生对象）不触发重渲染。manager 均为不可变更新，浅比较安全。
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	return keysA.every((key) =>
		Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
	);
}

const subscribeNone = () => () => {};

/** 可订阅的 editor 状态源（各 manager 都实现了 subscribe）。 */
export type EditorSource = { subscribe: (listener: () => void) => () => void };

/**
 * 按「状态源」订阅的窄版 useEditor：只订阅给定 manager，而不是全部 manager。
 *
 * 全局 useEditor(selector) 会订阅所有 manager，任何一处的 notify（seek / selection /
 * media）都会唤醒编辑器内所有 selector。对只依赖单一状态源的组件（播放头时间、
 * 选中集合、某份 tracks），用本 hook 把广播面收窄到该源。
 */
export function useEditorSource<T>(source: EditorSource, selector: () => T): T {
	const cacheRef = useRef<T | typeof SNAPSHOT_UNSET>(SNAPSHOT_UNSET);

	const subscribe = useCallback(
		(onChange: () => void) => source.subscribe(onChange),
		[source],
	);

	const getSnapshot = useCallback((): T => {
		const next = selector();
		if (
			cacheRef.current !== SNAPSHOT_UNSET &&
			isShallowEqual({ a: cacheRef.current, b: next })
		) {
			return cacheRef.current as T;
		}
		cacheRef.current = next;
		return next;
	}, [selector]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useEditor(): EditorCore;
export function useEditor<T>(selector: (editor: EditorCore) => T): T;
export function useEditor<T>(
	selector?: (editor: EditorCore) => T,
): EditorCore | T {
	const editor = useMemo(() => EditorCore.getInstance(), []);
	const snapshotCacheRef = useRef<T | typeof SNAPSHOT_UNSET>(SNAPSHOT_UNSET);

	const subscribeAll = useCallback(
		(onChange: () => void) => {
			const unsubscribers = [
				editor.playback.subscribe(onChange),
				editor.timeline.subscribe(onChange),
				editor.scenes.subscribe(onChange),
				editor.project.subscribe(onChange),
				editor.media.subscribe(onChange),
				editor.renderer.subscribe(onChange),
				editor.selection.subscribe(onChange),
				editor.clipboard.subscribe(onChange),
				editor.diagnostics.subscribe(onChange),
				editor.state.subscribe(onChange),
			];
			return () => {
				unsubscribers.forEach((unsubscribe) => {
					unsubscribe();
				});
			};
		},
		[editor],
	);

	const getSnapshot = useCallback((): EditorCore | T => {
		if (!selector) {
			return editor;
		}

		const next = selector(editor);
		if (
			snapshotCacheRef.current !== SNAPSHOT_UNSET &&
			isShallowEqual({
				a: snapshotCacheRef.current,
				b: next,
			})
		) {
			return snapshotCacheRef.current;
		}

		snapshotCacheRef.current = next;
		return next;
	}, [editor, selector]);

	return useSyncExternalStore(
		selector ? subscribeAll : subscribeNone,
		getSnapshot,
		getSnapshot,
	);
}
