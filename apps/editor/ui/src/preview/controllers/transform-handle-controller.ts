import type { PointerEvent as ReactPointerEvent } from "react";
import type { MediaAsset } from "@/media/types";
import type { MediaTime } from "@/wasm";
import {
	getVisibleElementsWithBounds,
	type Corner,
	type Edge,
	type ElementBounds,
	type ElementWithBounds,
} from "@/preview/element-bounds";
import {
	MIN_SCALE,
	SNAP_THRESHOLD_SCREEN_PIXELS,
	snapRotation,
	snapScale,
	snapScaleAxes,
	type ScaleEdgePreference,
	type SnapLine,
} from "@/preview/preview-snap";
import { isVisualElement } from "@/timeline/element-utils";
import { getElementLocalTime } from "@/animation";
import type { ParamValues } from "@/params";
import { buildTransformFromParams, type Transform } from "@/rendering";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import type {
	ElementRef,
	SceneTracks,
	TimelineElement,
	VisualElement,
} from "@/timeline";

/**
 * [INPUT]: 元素 bounds、预览坐标、吸附规则与时间线预览更新能力
 * [OUTPUT]: 单选元素的拖拽、四边/四角缩放与旋转控制器
 * [POS]: preview/controllers 的变换状态机，被 useTransformHandles 适配为 React 指针事件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

type Point = { readonly x: number; readonly y: number };
type CanvasSize = { readonly width: number; readonly height: number };
type HandleType = Corner | Edge | "rotation";

interface CapturedPointerState {
	readonly pointerId: number;
	readonly captureTarget: HTMLElement;
}

interface CornerScaleSession extends CapturedPointerState {
	readonly kind: "corner-scale";
	readonly corner: Corner;
	readonly trackId: string;
	readonly elementId: string;
	readonly initialTransform: Transform;
	readonly initialParams: ParamValues;
	readonly initialDistance: number;
	readonly initialBoundsCx: number;
	readonly initialBoundsCy: number;
	readonly baseWidth: number;
	readonly baseHeight: number;
}

interface EdgeScaleSession extends CapturedPointerState {
	readonly kind: "edge-scale";
	readonly edge: Edge;
	readonly trackId: string;
	readonly elementId: string;
	readonly initialTransform: Transform;
	readonly initialParams: ParamValues;
	readonly initialBoundsCx: number;
	readonly initialBoundsCy: number;
	readonly baseWidth: number;
	readonly baseHeight: number;
	readonly rotationRad: number;
	/** 文本盒宽拖拽修改的是 params（boxWidth），松手需走 commitPreview 提交。 */
	readonly commitsParams: boolean;
}

interface RotationSession extends CapturedPointerState {
	readonly kind: "rotation";
	readonly trackId: string;
	readonly elementId: string;
	readonly initialTransform: Transform;
	readonly initialParams: ParamValues;
	readonly initialAngle: number;
	readonly initialBoundsCx: number;
	readonly initialBoundsCy: number;
}

type TransformSession =
	| { readonly kind: "idle" }
	| CornerScaleSession
	| EdgeScaleSession
	| RotationSession;

const IDLE_SESSION: TransformSession = { kind: "idle" };

interface VisualSelectionContext {
	readonly trackId: string;
	readonly elementId: string;
	readonly element: VisualElement;
	readonly bounds: ElementBounds;
	readonly resolvedTransform: Transform;
}

export interface PreviewViewportAdapter {
	screenToCanvas: ({
		clientX,
		clientY,
	}: {
		clientX: number;
		clientY: number;
	}) => Point | null;
	screenPixelsToLogicalThreshold: ({
		screenPixels,
	}: {
		screenPixels: number;
	}) => Point;
}

export interface InputAdapter {
	isShiftHeld: () => boolean;
}

export interface SceneReader {
	getSelectedElements: () => readonly ElementRef[];
	getTracks: () => SceneTracks;
	getCurrentTime: () => number;
	getMediaAssets: () => MediaAsset[];
	getCanvasSize: () => CanvasSize;
}

export interface TimelinePreviewUpdate {
	readonly trackId: string;
	readonly elementId: string;
	readonly updates: Partial<TimelineElement>;
}

export interface TimelineOps {
	previewElements: (updates: readonly TimelinePreviewUpdate[]) => void;
	/** Model API：把瞬时层中最终 transform 以 D1 关键帧策略落地。 */
	setElementsTransform: (
		updates: readonly { trackId: string; elementId: string }[],
		atTime: MediaTime,
	) => void;
	commitPreview: () => void;
	discardPreview: () => void;
}

export interface PreviewOptions {
	onSnapLinesChange?: (lines: SnapLine[]) => void;
}

export interface TransformHandleDeps {
	viewport: PreviewViewportAdapter;
	input: InputAdapter;
	scene: SceneReader;
	timeline: TimelineOps;
	preview: PreviewOptions;
}

export interface TransformHandleDepsRef {
	readonly current: TransformHandleDeps;
}

function getPreferredEdge({ edge }: { edge: Edge }): ScaleEdgePreference {
	return edge === "right"
		? { right: true }
		: edge === "left"
			? { left: true }
			: edge === "top"
				? { top: true }
				: { bottom: true };
}

function clampScaleNonZero(scale: number): number {
	if (Math.abs(scale) < MIN_SCALE) {
		return scale < 0 ? -MIN_SCALE : MIN_SCALE;
	}
	return scale;
}

function getCornerDistance({
	bounds,
	corner,
}: {
	bounds: ElementBounds;
	corner: Corner;
}): number {
	const halfWidth = bounds.width / 2;
	const halfHeight = bounds.height / 2;
	const angleRad = (bounds.rotation * Math.PI) / 180;
	const cos = Math.cos(angleRad);
	const sin = Math.sin(angleRad);

	const localX =
		corner === "top-left" || corner === "bottom-left" ? -halfWidth : halfWidth;
	const localY =
		corner === "top-left" || corner === "top-right" ? -halfHeight : halfHeight;

	const rotatedX = localX * cos - localY * sin;
	const rotatedY = localX * sin + localY * cos;
	return Math.sqrt(rotatedX * rotatedX + rotatedY * rotatedY) || 1;
}

function buildSelectedWithBounds({
	selectedElements,
	elementsWithBounds,
}: {
	selectedElements: readonly ElementRef[];
	elementsWithBounds: readonly ElementWithBounds[];
}): ElementWithBounds | null {
	if (selectedElements.length !== 1) return null;

	return (
		elementsWithBounds.find(
			(entry) =>
				entry.trackId === selectedElements[0].trackId &&
				entry.elementId === selectedElements[0].elementId,
		) ?? null
	);
}

export class TransformHandleController {
	private readonly depsRef: TransformHandleDepsRef;
	private readonly subscribers = new Set<() => void>();

	private session: TransformSession = IDLE_SESSION;

	constructor({ depsRef }: { depsRef: TransformHandleDepsRef }) {
		this.depsRef = depsRef;

		this.onCornerPointerDown = this.onCornerPointerDown.bind(this);
		this.onEdgePointerDown = this.onEdgePointerDown.bind(this);
		this.onRotationPointerDown = this.onRotationPointerDown.bind(this);
		this.onPointerMove = this.onPointerMove.bind(this);
		this.onPointerUp = this.onPointerUp.bind(this);
	}

	private get deps(): TransformHandleDeps {
		return this.depsRef.current;
	}

	get selectedWithBounds(): ElementWithBounds | null {
		return buildSelectedWithBounds({
			selectedElements: this.deps.scene.getSelectedElements(),
			elementsWithBounds: this.getVisibleElementsWithBounds(),
		});
	}

	get activeHandle(): HandleType | null {
		switch (this.session.kind) {
			case "corner-scale":
				return this.session.corner;
			case "edge-scale":
				return this.session.edge;
			case "rotation":
				return "rotation";
			default:
				return null;
		}
	}

	get isActive(): boolean {
		return this.session.kind !== "idle";
	}

	subscribe(fn: () => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	destroy(): void {
		if (this.session.kind !== "idle") {
			const session = this.session;
			this.session = IDLE_SESSION;
			this.deps.timeline.discardPreview();
			this.clearSnapLines();
			this.releaseCapturedPointer(session);
		}

		this.subscribers.clear();
	}

	cancel(): void {
		if (this.session.kind === "idle") return;

		const session = this.session;
		this.session = IDLE_SESSION;
		this.deps.timeline.discardPreview();
		this.clearSnapLines();
		this.releaseCapturedPointer(session);
		this.notify();
	}

	onCornerPointerDown({
		event,
		corner,
	}: {
		event: ReactPointerEvent;
		corner: Corner;
	}): void {
		const context = this.getSelectedVisualContext();
		if (!context) return;

		event.stopPropagation();

		this.session = {
			kind: "corner-scale",
			corner,
			trackId: context.trackId,
			elementId: context.elementId,
			initialTransform: context.resolvedTransform,
			initialParams: context.element.params,
			initialDistance: getCornerDistance({
				bounds: context.bounds,
				corner,
			}),
			initialBoundsCx: context.bounds.cx,
			initialBoundsCy: context.bounds.cy,
			baseWidth: context.bounds.width / context.resolvedTransform.scaleX,
			baseHeight: context.bounds.height / context.resolvedTransform.scaleY,
			pointerId: event.pointerId,
			captureTarget: this.capturePointer({
				target: event.currentTarget as HTMLElement,
				pointerId: event.pointerId,
			}),
		};

		this.notify();
	}

	onRotationPointerDown({ event }: { event: ReactPointerEvent }): void {
		const context = this.getSelectedVisualContext();
		if (!context) return;

		event.stopPropagation();

		const position = this.deps.viewport.screenToCanvas({
			clientX: event.clientX,
			clientY: event.clientY,
		});
		if (!position) return;

		const deltaX = position.x - context.bounds.cx;
		const deltaY = position.y - context.bounds.cy;
		const initialAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;

		this.session = {
			kind: "rotation",
			trackId: context.trackId,
			elementId: context.elementId,
			initialTransform: context.resolvedTransform,
			initialParams: context.element.params,
			initialAngle,
			initialBoundsCx: context.bounds.cx,
			initialBoundsCy: context.bounds.cy,
			pointerId: event.pointerId,
			captureTarget: this.capturePointer({
				target: event.currentTarget as HTMLElement,
				pointerId: event.pointerId,
			}),
		};

		this.notify();
	}

	onEdgePointerDown({
		event,
		edge,
	}: {
		event: ReactPointerEvent;
		edge: Edge;
	}): void {
		const context = this.getSelectedVisualContext();
		if (!context) return;

		event.stopPropagation();

		this.session = {
			kind: "edge-scale",
			edge,
			trackId: context.trackId,
			elementId: context.elementId,
			initialTransform: context.resolvedTransform,
			initialParams: context.element.params,
			initialBoundsCx: context.bounds.cx,
			initialBoundsCy: context.bounds.cy,
			baseWidth: context.bounds.width / context.resolvedTransform.scaleX,
			baseHeight: context.bounds.height / context.resolvedTransform.scaleY,
			rotationRad: (context.bounds.rotation * Math.PI) / 180,
			commitsParams:
				context.element.type === "text" &&
				(edge === "left" || edge === "right"),
			pointerId: event.pointerId,
			captureTarget: this.capturePointer({
				target: event.currentTarget as HTMLElement,
				pointerId: event.pointerId,
			}),
		};

		this.notify();
	}

	onPointerMove({ event }: { event: ReactPointerEvent }): void {
		if (this.session.kind === "idle") return;

		const position = this.deps.viewport.screenToCanvas({
			clientX: event.clientX,
			clientY: event.clientY,
		});
		if (!position) return;

		switch (this.session.kind) {
			case "corner-scale":
				this.previewCornerScale({
					session: this.session,
					position,
				});
				return;
			case "edge-scale":
				this.previewEdgeScale({
					session: this.session,
					position,
				});
				return;
			case "rotation":
				this.previewRotation({
					session: this.session,
					position,
				});
				return;
			default:
				return;
		}
	}

	onPointerUp(): void {
		if (this.session.kind === "idle") return;

		const session = this.session;
		this.session = IDLE_SESSION;
		if (session.kind === "edge-scale" && session.commitsParams) {
			// 文本盒宽拖拽改的是 params（boxWidth），走快照提交（含瞬时层），
			// 不能 discard —— 否则松手回弹到拖拽前。
			this.deps.timeline.commitPreview();
		} else {
			// D1：关键帧感知提交瞬时层中的最终 transform，再清空瞬时层。
			this.deps.timeline.setElementsTransform(
				[{ trackId: session.trackId, elementId: session.elementId }],
				this.deps.scene.getCurrentTime() as MediaTime,
			);
			this.deps.timeline.discardPreview();
		}
		this.clearSnapLines();
		this.releaseCapturedPointer(session);
		this.notify();
	}

	private notify(): void {
		for (const fn of this.subscribers) fn();
	}

	private clearSnapLines(): void {
		this.deps.preview.onSnapLinesChange?.([]);
	}

	private capturePointer({
		target,
		pointerId,
	}: {
		target: HTMLElement;
		pointerId: number;
	}): HTMLElement {
		target.setPointerCapture(pointerId);
		return target;
	}

	private releaseCapturedPointer(pointerState: CapturedPointerState): void {
		if (!pointerState.captureTarget.hasPointerCapture(pointerState.pointerId)) {
			return;
		}

		pointerState.captureTarget.releasePointerCapture(pointerState.pointerId);
	}

	private getVisibleElementsWithBounds(): ElementWithBounds[] {
		return getVisibleElementsWithBounds({
			tracks: this.deps.scene.getTracks(),
			currentTime: this.deps.scene.getCurrentTime(),
			canvasSize: this.deps.scene.getCanvasSize(),
			mediaAssets: this.deps.scene.getMediaAssets(),
		});
	}

	private getSelectedVisualContext(): VisualSelectionContext | null {
		const selectedWithBounds = this.selectedWithBounds;
		if (!selectedWithBounds) return null;
		if (!isVisualElement(selectedWithBounds.element)) return null;

		const localTime = getElementLocalTime({
			timelineTime: this.deps.scene.getCurrentTime(),
			elementStartTime: selectedWithBounds.element.startTime,
			elementDuration: selectedWithBounds.element.duration,
		});

		return {
			trackId: selectedWithBounds.trackId,
			elementId: selectedWithBounds.elementId,
			element: selectedWithBounds.element,
			bounds: selectedWithBounds.bounds,
			resolvedTransform: resolveTransformAtTime({
				baseTransform: buildTransformFromParams({
					params: selectedWithBounds.element.params,
				}),
				animations: selectedWithBounds.element.animations,
				localTime,
			}),
		};
	}

	private previewCornerScale({
		session,
		position,
	}: {
		session: CornerScaleSession;
		position: Point;
	}): void {
		const deltaX = position.x - session.initialBoundsCx;
		const deltaY = position.y - session.initialBoundsCy;
		const currentDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
		const scaleFactor = currentDistance / session.initialDistance;

		// Use actual element dimensions (base * current scale) so snapping is
		// computed from the rendered geometry when scaleX != scaleY.
		const effectiveWidth = session.baseWidth * session.initialTransform.scaleX;
		const effectiveHeight =
			session.baseHeight * session.initialTransform.scaleY;

		const snapThreshold = this.deps.viewport.screenPixelsToLogicalThreshold({
			screenPixels: SNAP_THRESHOLD_SCREEN_PIXELS,
		});
		const { snappedScale, activeLines } = this.deps.input.isShiftHeld()
			? { snappedScale: scaleFactor, activeLines: [] as SnapLine[] }
			: snapScale({
					proposedScale: scaleFactor,
					position: session.initialTransform.position,
					baseWidth: effectiveWidth,
					baseHeight: effectiveHeight,
					rotation: session.initialTransform.rotate,
					canvasSize: this.deps.scene.getCanvasSize(),
					snapThreshold,
				});

		this.deps.preview.onSnapLinesChange?.(activeLines);

		this.deps.timeline.previewElements([
			{
				trackId: session.trackId,
				elementId: session.elementId,
				updates: {
					params: buildParamsWithTransform({
						params: session.initialParams,
						transform: {
							...session.initialTransform,
							scaleX: clampScaleNonZero(
								session.initialTransform.scaleX * snappedScale,
							),
							scaleY: clampScaleNonZero(
								session.initialTransform.scaleY * snappedScale,
							),
						},
					}),
				},
			},
		]);
	}

	private previewEdgeScale({
		session,
		position,
	}: {
		session: EdgeScaleSession;
		position: Point;
	}): void {
		const deltaX = position.x - session.initialBoundsCx;
		const deltaY = position.y - session.initialBoundsCy;
		const xProjection =
			deltaX * Math.cos(session.rotationRad) +
			deltaY * Math.sin(session.rotationRad);
		const yProjection =
			-deltaX * Math.sin(session.rotationRad) +
			deltaY * Math.cos(session.rotationRad);
		const projection =
			session.edge === "right"
				? xProjection
				: session.edge === "left"
					? -xProjection
					: session.edge === "top"
						? -yProjection
						: yProjection;

		// 文本（剪映模式）：左右边=改盒宽，内部自动重排换行，字号不变不模糊；
		// 上下边=整体等比 scale（盒高由排版决定，单轴拉伸会变形，这里给与角点一致的反馈）。
		if (typeof session.initialParams.fontSize === "number") {
			if (session.edge === "top" || session.edge === "bottom") {
				const halfH =
					(session.baseHeight * session.initialTransform.scaleY) / 2 || 1;
				const factor = clampScaleNonZero((halfH + projection) / halfH);
				this.deps.preview.onSnapLinesChange?.([]);
				this.deps.timeline.previewElements([
					{
						trackId: session.trackId,
						elementId: session.elementId,
						updates: {
							params: buildParamsWithTransform({
								params: session.initialParams,
								transform: {
									...session.initialTransform,
									scaleX: clampScaleNonZero(
										session.initialTransform.scaleX * factor,
									),
									scaleY: clampScaleNonZero(
										session.initialTransform.scaleY * factor,
									),
								},
							}),
						},
					},
				]);
				return;
			}
			const canvasHeight = this.deps.scene.getCanvasSize().height || 1;
			const pxToBox = 90 / canvasHeight;
			const initialBoxParam = session.initialParams.boxWidth as
				| number
				| undefined;
			const fontSize = (session.initialParams.fontSize as number) || 15;
			const fontSizeRatio = fontSize / 15;
			// 初始盒宽（fontSize 坐标系 px）：优先用已保存的 boxWidth（按当前
			// scaleX 补偿到视觉宽度，归一 scale 后几何不变）；否则从当前渲染
			// 宽度反推 —— 背景开启时扣掉左右 padding，避免首次 move 突跳。
			const visualScaleX = session.initialTransform.scaleX;
			let initialBoxPx: number;
			if (typeof initialBoxParam === "number" && initialBoxParam > 0) {
				initialBoxPx = (initialBoxParam * canvasHeight * visualScaleX) / 90;
			} else {
				const visualWidthPx = session.baseWidth * visualScaleX;
				const backgroundEnabled =
					session.initialParams["background.enabled"] === true;
				const paddingX = backgroundEnabled
					? ((session.initialParams["background.paddingX"] as number) ?? 30) *
						fontSizeRatio *
						(canvasHeight / 90)
					: 0;
				initialBoxPx = Math.max(10, visualWidthPx - paddingX * 2);
			}
			const sign = session.edge === "right" ? 1 : -1;
			// 双边对称：投影×2；保留 1 位小数防抖，最小 10px
			const newBoxPx = Math.max(10, initialBoxPx + sign * projection * 2);
			const boxWidth = Math.round(newBoxPx * pxToBox * 10) / 10;
			// 归一 transform scale：盒宽按当前视觉宽度反推，归一前后几何一致；
			// 防止历史遗留的 scaleX/scaleY 残留继续把文本压扁/拉伸。
			this.deps.preview.onSnapLinesChange?.([]);
			this.deps.timeline.previewElements([
				{
					trackId: session.trackId,
					elementId: session.elementId,
					updates: {
						params: {
							...session.initialParams,
							boxWidth,
							"transform.scaleX": 1,
							"transform.scaleY": 1,
						},
					},
				},
			]);
			return;
		}

		const baseAxisHalf =
			session.edge === "right" || session.edge === "left"
				? session.baseWidth / 2
				: session.baseHeight / 2;
		const proposedScale = clampScaleNonZero(projection / baseAxisHalf);

		const proposedScaleX =
			session.edge === "right" || session.edge === "left"
				? proposedScale
				: session.initialTransform.scaleX;
		const proposedScaleY =
			session.edge === "top" || session.edge === "bottom"
				? proposedScale
				: session.initialTransform.scaleY;

		const snapThreshold = this.deps.viewport.screenPixelsToLogicalThreshold({
			screenPixels: SNAP_THRESHOLD_SCREEN_PIXELS,
		});
		const { x: xSnap, y: ySnap } = this.deps.input.isShiftHeld()
			? {
					x: {
						snappedScale: proposedScaleX,
						snapDistance: Infinity,
						activeLines: [] as SnapLine[],
					},
					y: {
						snappedScale: proposedScaleY,
						snapDistance: Infinity,
						activeLines: [] as SnapLine[],
					},
				}
			: snapScaleAxes({
					proposedScaleX,
					proposedScaleY,
					position: session.initialTransform.position,
					baseWidth: session.baseWidth,
					baseHeight: session.baseHeight,
					rotation: session.initialTransform.rotate,
					canvasSize: this.deps.scene.getCanvasSize(),
					snapThreshold,
					preferredEdges: getPreferredEdge({ edge: session.edge }),
				});

		const relevantSnap =
			session.edge === "right" || session.edge === "left" ? xSnap : ySnap;
		this.deps.preview.onSnapLinesChange?.(relevantSnap.activeLines);

		this.deps.timeline.previewElements([
			{
				trackId: session.trackId,
				elementId: session.elementId,
				updates: {
					params: buildParamsWithTransform({
						params: session.initialParams,
						transform: {
							...session.initialTransform,
							scaleX:
								session.edge === "right" || session.edge === "left"
									? xSnap.snappedScale
									: session.initialTransform.scaleX,
							scaleY:
								session.edge === "top" || session.edge === "bottom"
									? ySnap.snappedScale
									: session.initialTransform.scaleY,
						},
					}),
				},
			},
		]);
	}

	private previewRotation({
		session,
		position,
	}: {
		session: RotationSession;
		position: Point;
	}): void {
		const deltaX = position.x - session.initialBoundsCx;
		const deltaY = position.y - session.initialBoundsCy;
		const currentAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
		let deltaAngle = currentAngle - session.initialAngle;
		if (deltaAngle > 180) deltaAngle -= 360;
		if (deltaAngle < -180) deltaAngle += 360;

		const newRotate = session.initialTransform.rotate + deltaAngle;
		const { snappedRotation } = this.deps.input.isShiftHeld()
			? { snappedRotation: newRotate }
			: snapRotation({ proposedRotation: newRotate });

		this.deps.timeline.previewElements([
			{
				trackId: session.trackId,
				elementId: session.elementId,
				updates: {
					params: buildParamsWithTransform({
						params: session.initialParams,
						transform: {
							...session.initialTransform,
							rotate: snappedRotation,
						},
					}),
				},
			},
		]);
	}
}

function buildParamsWithTransform({
	params,
	transform,
}: {
	params: ParamValues;
	transform: Transform;
}): ParamValues {
	return {
		...params,
		"transform.positionX": transform.position.x,
		"transform.positionY": transform.position.y,
		"transform.positionZ": transform.position.z,
		"transform.scaleX": transform.scaleX,
		"transform.scaleY": transform.scaleY,
		"transform.rotate": transform.rotate,
	};
}
