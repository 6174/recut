"use client";

import { usePreviewViewport } from "@/preview/components/preview-viewport";
import { useTransformHandles } from "@/preview/hooks/use-transform-handles";
import { isVisualElement } from "@/timeline/element-utils";
import {
	getCornerPosition,
	getEdgeHandlePosition,
	ROTATION_HANDLE_OFFSET,
	type Corner,
	type Edge,
} from "@/preview/element-bounds";
import type { OnSnapLinesChange } from "@/preview/hooks/use-preview-interaction";
import {
	BoundingBoxOutline,
	CornerHandle,
	EdgeHandle,
	IconHandle,
	getResizeCursor,
} from "./handle-primitives";
import { Rotate01Icon } from "@hugeicons/core-free-icons";

const CORNERS: Corner[] = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
];
const EDGES: Edge[] = ["top", "right", "bottom", "left"];

export function TransformHandles({
	onSnapLinesChange,
}: {
	onSnapLinesChange?: OnSnapLinesChange;
}) {
	const viewport = usePreviewViewport();
	const {
		selectedWithBounds,
		hasVisualSelection,
		handleCornerPointerDown,
		handleEdgePointerDown,
		handleRotationPointerDown,
		handlePointerMove,
		handlePointerUp,
	} = useTransformHandles({ onSnapLinesChange });

	if (!hasVisualSelection || !selectedWithBounds) return null;

	const { bounds, element } = selectedWithBounds;
	if (!isVisualElement(element)) return null;

	const displayScale = viewport.getDisplayScale();

	const toOverlay = ({
		canvasX,
		canvasY,
	}: {
		canvasX: number;
		canvasY: number;
	}) =>
		viewport.canvasToOverlay({
			canvasX,
			canvasY,
		});

	const center = toOverlay({ canvasX: bounds.cx, canvasY: bounds.cy });
	const outlineWidth = Math.abs(bounds.width) * displayScale.x;
	const outlineHeight = Math.abs(bounds.height) * displayScale.y;

	const rotationAngleRad = (bounds.rotation * Math.PI) / 180;
	const topCenterLocalY = -bounds.height / 2;
	const topCenterScreen = toOverlay({
		canvasX: bounds.cx - topCenterLocalY * Math.sin(rotationAngleRad),
		canvasY: bounds.cy + topCenterLocalY * Math.cos(rotationAngleRad),
	});
	const rotationHandleScreen = {
		x: topCenterScreen.x + Math.sin(rotationAngleRad) * ROTATION_HANDLE_OFFSET,
		y: topCenterScreen.y - Math.cos(rotationAngleRad) * ROTATION_HANDLE_OFFSET,
	};

	const onPointerMove = (event: React.PointerEvent) =>
		handlePointerMove({ event });
	const onPointerUp = () => handlePointerUp();

	return (
		<div
			className="pointer-events-none absolute inset-0 overflow-hidden"
			aria-hidden
		>
			<BoundingBoxOutline
				center={center}
				outlineWidth={outlineWidth}
				outlineHeight={outlineHeight}
				rotation={bounds.rotation}
			/>
			{CORNERS.map((corner) => {
				const cornerPosition = getCornerPosition({ bounds, corner });
				const screen = toOverlay({
					canvasX: cornerPosition.x,
					canvasY: cornerPosition.y,
				});
				// 角光标沿盒子对角线方向：宽扁元素下 atan2 到中心的夹角会趋近水平，
				// 导致角光标错误显示为 ew；改用旋转角 ±45° 的对角方向。
				const diagonalAngle =
					bounds.rotation +
					(corner === "top-left" || corner === "bottom-right" ? 45 : -45);
				return (
					<CornerHandle
						key={corner}
						cursor={getResizeCursor({ angleDeg: diagonalAngle })}
						screen={screen}
						onPointerDown={(event) =>
							handleCornerPointerDown({ event, corner })
						}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
					/>
				);
			})}
			{EDGES.map((edge) => {
				const edgePosition = getEdgeHandlePosition({ bounds, edge });
				const screen = toOverlay({
					canvasX: edgePosition.x,
					canvasY: edgePosition.y,
				});
				return (
					<EdgeHandle
						key={edge}
						edge={edge}
						screen={screen}
						rotation={bounds.rotation}
						onPointerDown={(event) => handleEdgePointerDown({ event, edge })}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
					/>
				);
			})}
			<IconHandle
				icon={Rotate01Icon}
				screen={rotationHandleScreen}
				onPointerDown={(event) => handleRotationPointerDown({ event })}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			/>
		</div>
	);
}
