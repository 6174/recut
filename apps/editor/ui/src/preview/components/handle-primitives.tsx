"use client";

import { cn } from "@/utils/ui";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";

/**
 * [INPUT]: 预览坐标、指针回调与 Hugeicons 图标
 * [OUTPUT]: 选框描边、角/边/旋转控制点和方向光标
 * [POS]: preview/components 的无状态控制点原语；白底与深色画面均保持清晰对比
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const HANDLE_SIZE = 14;
export const HANDLE_HIT_AREA_SIZE = 26;
export const ICON_HANDLE_RADIUS = 14;
export const EDGE_HANDLE_THIN_SIZE = 10;
export const EDGE_HANDLE_THICK_SIZE = 20;
export const LINE_HIT_AREA_SIZE = 48;
const SELECTION_COLOR = "#8b3dff";
const CONTROL_SHADOW = "0 1px 4px rgb(15 23 42 / 0.35)";

export function getResizeCursor({ angleDeg }: { angleDeg: number }): string {
	const normalized = ((angleDeg % 180) + 180) % 180;
	if (normalized < 22.5 || normalized >= 157.5) return "ew-resize";
	if (normalized < 67.5) return "nwse-resize";
	if (normalized < 112.5) return "ns-resize";
	return "nesw-resize";
}

export function HandleButton({
	screen,
	cursor,
	hitAreaSize,
	className,
	style,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	children,
}: {
	screen: { x: number; y: number };
	cursor?: string;
	hitAreaSize: number;
	className?: string;
	style?: React.CSSProperties;
	onPointerDown: (event: React.PointerEvent) => void;
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: (event: React.PointerEvent) => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			className={cn(
				"absolute flex items-center justify-center outline-none",
				className,
			)}
			style={{
				left: screen.x - hitAreaSize / 2,
				top: screen.y - hitAreaSize / 2,
				width: hitAreaSize,
				height: hitAreaSize,
				pointerEvents: "auto",
				cursor,
				...style,
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerLeave={onPointerUp}
			onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
			onKeyUp={(event) => event.key === "Enter" && event.preventDefault()}
		>
			{children}
		</button>
	);
}

export function CornerHandle({
	cursor,
	screen,
	onPointerDown,
	onPointerMove,
	onPointerUp,
}: {
	cursor?: string;
	screen: { x: number; y: number };
	onPointerDown: (event: React.PointerEvent) => void;
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: (event: React.PointerEvent) => void;
}) {
	return (
		<HandleButton
			screen={screen}
			cursor={cursor}
			hitAreaSize={HANDLE_HIT_AREA_SIZE}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
		>
			<div
				className="rounded-full bg-foreground"
				style={{
					width: HANDLE_SIZE,
					height: HANDLE_SIZE,
					border: `2px solid ${SELECTION_COLOR}`,
					boxShadow: CONTROL_SHADOW,
				}}
			/>
		</HandleButton>
	);
}

export function CircleHandle({
	cursor,
	screen,
	size = HANDLE_SIZE,
	isSelected = false,
	onPointerDown,
	onPointerMove,
	onPointerUp,
}: {
	cursor?: string;
	screen: { x: number; y: number };
	size?: number;
	isSelected?: boolean;
	onPointerDown: (event: React.PointerEvent) => void;
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: (event: React.PointerEvent) => void;
}) {
	return (
		<HandleButton
			screen={screen}
			cursor={cursor}
			hitAreaSize={HANDLE_HIT_AREA_SIZE}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
		>
			<div
				className={cn("rounded-full", isSelected ? "bg-primary" : "bg-foreground")}
				style={{ width: size, height: size }}
			/>
		</HandleButton>
	);
}

export function EdgeHandle({
	edge,
	screen,
	rotation,
	onPointerDown,
	onPointerMove,
	onPointerUp,
}: {
	edge: "right" | "left" | "top" | "bottom";
	screen: { x: number; y: number };
	rotation: number;
	onPointerDown: (event: React.PointerEvent) => void;
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: (event: React.PointerEvent) => void;
}) {
	const isHorizontalEdge = edge === "right" || edge === "left";
	const width = isHorizontalEdge
		? EDGE_HANDLE_THIN_SIZE
		: EDGE_HANDLE_THICK_SIZE;
	const height = isHorizontalEdge
		? EDGE_HANDLE_THICK_SIZE
		: EDGE_HANDLE_THIN_SIZE;
	const cursor = getResizeCursor({
		angleDeg: isHorizontalEdge ? rotation : rotation + 90,
	});

	return (
		<HandleButton
			screen={screen}
			cursor={cursor}
			hitAreaSize={HANDLE_HIT_AREA_SIZE}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
		>
			<div
				className="rounded-full bg-foreground"
				style={{
					width,
					height,
					border: `2px solid ${SELECTION_COLOR}`,
					boxShadow: CONTROL_SHADOW,
					transform: `rotate(${rotation}deg)`,
				}}
			/>
		</HandleButton>
	);
}

export function IconHandle({
	icon,
	screen,
	onPointerDown,
	onPointerMove,
	onPointerUp,
}: {
	icon: IconSvgElement;
	screen: { x: number; y: number };
	onPointerDown: (event: React.PointerEvent) => void;
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: (event: React.PointerEvent) => void;
}) {
	return (
		<HandleButton
			screen={screen}
			hitAreaSize={ICON_HANDLE_RADIUS * 2}
			className="rounded-full bg-foreground"
			style={{
				border: `2px solid ${SELECTION_COLOR}`,
				boxShadow: CONTROL_SHADOW,
				color: SELECTION_COLOR,
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
		>
			<HugeiconsIcon icon={icon} className="size-3" strokeWidth={2.5} />
		</HandleButton>
	);
}

export function BoundingBoxOutline({
	center,
	outlineWidth,
	outlineHeight,
	rotation,
	cursor,
	dashed = false,
	onPointerDown,
	onPointerMove,
	onPointerUp,
}: {
	center: { x: number; y: number };
	outlineWidth: number;
	outlineHeight: number;
	rotation: number;
	cursor?: string;
	dashed?: boolean;
	onPointerDown?: (event: React.PointerEvent) => void;
	onPointerMove?: (event: React.PointerEvent) => void;
	onPointerUp?: (event: React.PointerEvent) => void;
}) {
	return (
		<svg
			className="absolute overflow-visible"
			aria-hidden="true"
			focusable="false"
			style={{
				left: center.x - outlineWidth / 2,
				top: center.y - outlineHeight / 2,
				width: outlineWidth,
				height: outlineHeight,
				transform: `rotate(${rotation}deg)`,
				transformOrigin: "center center",
				pointerEvents: onPointerDown ? "auto" : "none",
				cursor,
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerLeave={onPointerUp}
		>
			<rect
				x={0.5}
				y={0.5}
				width={Math.max(outlineWidth - 1, 0)}
				height={Math.max(outlineHeight - 1, 0)}
				fill="transparent"
				stroke={SELECTION_COLOR}
				strokeWidth={2}
				strokeDasharray={dashed ? "4 4" : undefined}
				strokeOpacity={1}
				vectorEffect="non-scaling-stroke"
				style={{ pointerEvents: onPointerDown ? "all" : "none" }}
			/>
		</svg>
	);
}

export function ShapeOutline({
	center,
	outlineWidth,
	outlineHeight,
	rotation,
	pathData,
	cursor,
	onPointerDown,
	onPointerMove,
	onPointerUp,
}: {
	center: { x: number; y: number };
	outlineWidth: number;
	outlineHeight: number;
	rotation: number;
	pathData: string;
	cursor?: string;
	onPointerDown?: (event: React.PointerEvent) => void;
	onPointerMove?: (event: React.PointerEvent) => void;
	onPointerUp?: (event: React.PointerEvent) => void;
}) {
	return (
		<svg
			className="absolute overflow-visible"
			aria-hidden="true"
			focusable="false"
			style={{
				left: center.x - outlineWidth / 2,
				top: center.y - outlineHeight / 2,
				width: outlineWidth,
				height: outlineHeight,
				transform: `rotate(${rotation}deg)`,
				transformOrigin: "center center",
				pointerEvents: onPointerDown ? "auto" : "none",
				cursor,
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerLeave={onPointerUp}
		>
			<path
				d={pathData}
				fill="transparent"
				stroke={SELECTION_COLOR}
				strokeOpacity={1}
				vectorEffect="non-scaling-stroke"
				style={{ pointerEvents: onPointerDown ? "all" : "none" }}
			/>
		</svg>
	);
}

export function CanvasPathOutline({
	pathData,
	translateX = 0,
	translateY = 0,
	scaleX = 1,
	scaleY = 1,
	cursor,
	strokeWidth = 1,
	strokeOpacity = 0.75,
	onPointerDown,
	onPointerMove,
	onPointerUp,
}: {
	pathData: string;
	translateX?: number;
	translateY?: number;
	scaleX?: number;
	scaleY?: number;
	cursor?: string;
	strokeWidth?: number;
	strokeOpacity?: number;
	onPointerDown?: (event: React.PointerEvent) => void;
	onPointerMove?: (event: React.PointerEvent) => void;
	onPointerUp?: (event: React.PointerEvent) => void;
}) {
	return (
		<svg
			className="absolute inset-0 overflow-visible"
			aria-hidden="true"
			focusable="false"
			style={{
				pointerEvents: onPointerDown ? "auto" : "none",
				cursor,
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerLeave={onPointerUp}
		>
			<g
				transform={`translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})`}
			>
				<path
					d={pathData}
					fill="transparent"
					stroke={SELECTION_COLOR}
					strokeWidth={strokeWidth}
					strokeOpacity={strokeOpacity}
					vectorEffect="non-scaling-stroke"
					style={{ pointerEvents: onPointerDown ? "stroke" : "none" }}
				/>
			</g>
		</svg>
	);
}

export function LineOverlay({
	start,
	end,
	cursor,
	onPointerDown,
	onPointerMove,
	onPointerUp,
}: {
	start: { x: number; y: number };
	end: { x: number; y: number };
	cursor?: string;
	onPointerDown?: (event: React.PointerEvent) => void;
	onPointerMove?: (event: React.PointerEvent) => void;
	onPointerUp?: (event: React.PointerEvent) => void;
}) {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.sqrt(dx * dx + dy * dy);
	const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
	const cx = (start.x + end.x) / 2;
	const cy = (start.y + end.y) / 2;

	const sharedStyle = {
		left: cx - length / 2,
		width: length,
		transform: `rotate(${angleDeg}deg)`,
		transformOrigin: "center center",
	};

	return (
		<>
			{onPointerDown && (
				<div
					className="absolute"
					style={{
						...sharedStyle,
						top: cy - LINE_HIT_AREA_SIZE / 2,
						height: LINE_HIT_AREA_SIZE,
						pointerEvents: "auto",
						cursor,
					}}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerLeave={onPointerUp}
				/>
			)}
			<div
				className="pointer-events-none absolute"
				style={{
					...sharedStyle,
					top: cy - 0.5,
					height: 1,
					backgroundColor: SELECTION_COLOR,
					opacity: 1,
				}}
			/>
		</>
	);
}
