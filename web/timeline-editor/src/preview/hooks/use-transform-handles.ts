import { useEffect, useMemo, useReducer, useState } from "react";
import { usePreviewViewport } from "@timeline/preview/components/preview-viewport";
import type { OnSnapLinesChange } from "@timeline/preview/hooks/use-preview-interaction";
import { useEditor, useEditorSource } from "@timeline/editor/use-editor";
import { useCommittedRef } from "@timeline/hooks/use-committed-ref";
import { useShiftKey } from "@timeline/hooks/use-shift-key";
import { registerCanceller } from "@timeline/editor/cancel-interaction";
import { subscribeNodeRegistry } from "@timeline/runtime/node-registry";
import { getVisibleElementsWithBounds } from "@timeline/preview/element-bounds";
import {
	TransformHandleController,
	type TransformHandleDeps,
} from "@timeline/preview/controllers/transform-handle-controller";

/**
 * [INPUT]: 编辑器状态、预览坐标系、变换控制器与运行时节点 bbox 通知
 * [OUTPUT]: TransformHandles 所需的选中 bounds 与指针处理器
 * [POS]: preview/hooks 的 React 适配层，保证异步组件纹理就绪后控制框即时重算
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export function useTransformHandles({
	onSnapLinesChange,
}: {
	onSnapLinesChange?: OnSnapLinesChange;
}) {
	const viewport = usePreviewViewport();
	const editor = useEditor();
	const isShiftHeldRef = useShiftKey();
	// 按 source 订阅：selection 变化不再叫醒 tracks/media/project 的 selector，
	// media/project 变化也不会让控制框重渲染。currentTime 仅在该源 seek 时更新。
	const selectedElements = useEditorSource(editor.selection, () =>
		editor.selection.getSelectedElements(),
	);
	const tracks = useEditor(
		(e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveScene().tracks,
	);
	const currentTime = useEditorSource(editor.playback, () =>
		editor.playback.getCurrentTime(),
	);
	const mediaAssets = useEditorSource(editor.media, () =>
		editor.media.getAssets(),
	);
	const canvasSize = useEditorSource(editor.project, () =>
		editor.project.getActive().settings.canvasSize,
	);
	const deps: TransformHandleDeps = {
		viewport,
		input: {
			isShiftHeld: () => isShiftHeldRef.current,
		},
		scene: {
			getSelectedElements: () => selectedElements,
			getTracks: () => tracks,
			getCurrentTime: () => currentTime,
			getMediaAssets: () => mediaAssets,
			getCanvasSize: () => canvasSize,
		},
		timeline: {
			previewElements: (updates) =>
				editor.timeline.previewElements({ updates }),
			setElementsTransform: (updates, atTime) =>
				editor.timeline.setElementsTransform({ updates, atTime }),
			commitPreview: () => editor.timeline.commitPreview(),
			discardPreview: () => editor.timeline.discardPreview(),
		},
		preview: {
			onSnapLinesChange,
		},
	};
	const depsRef = useCommittedRef(deps);
	const [controller] = useState(
		() => new TransformHandleController({ depsRef }),
	);

	const [, rerender] = useReducer((n: number) => n + 1, 0);
	useEffect(() => controller.subscribe(rerender), [controller]);
	useEffect(() => subscribeNodeRegistry(rerender), []);

	useEffect(() => {
		if (!controller.isActive) return;
		return registerCanceller({ fn: () => controller.cancel() });
	}, [controller, controller.isActive]);

	useEffect(() => () => controller.destroy(), [controller]);

	// 用「当前渲染」的 tracks 直接算 bounds，而不是读 controller 的 depsRef：
	// depsRef 在 layout effect 后才更新，拖拽中间态不进 store 时，pointerup 那次
	// commit 渲染会读到拖拽前的 tracks，导致选框停留在旧位置。
	const selectedWithBounds = useMemo(() => {
		if (selectedElements.length !== 1) return null;
		const elementsWithBounds = getVisibleElementsWithBounds({
			tracks,
			currentTime,
			canvasSize,
			mediaAssets,
		});
		const selected = selectedElements[0];
		return (
			elementsWithBounds.find(
				(entry) =>
					entry.trackId === selected.trackId &&
					entry.elementId === selected.elementId,
			) ?? null
		);
	}, [selectedElements, tracks, currentTime, canvasSize, mediaAssets]);
	const hasVisualSelection = selectedWithBounds !== null;

	return {
		selectedWithBounds,
		hasVisualSelection,
		activeHandle: controller.activeHandle,
		handleCornerPointerDown: controller.onCornerPointerDown,
		handleEdgePointerDown: controller.onEdgePointerDown,
		handleRotationPointerDown: controller.onRotationPointerDown,
		handlePointerMove: controller.onPointerMove,
		handlePointerUp: controller.onPointerUp,
	};
}
