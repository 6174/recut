"use client";

import { usePreviewViewport } from "@/preview/components/preview-viewport";
import type { SnapLine } from "@/preview/preview-snap";

/**
 * [INPUT]: 变换控制器计算出的画布逻辑 SnapLine 与预览坐标系
 * [OUTPUT]: 以高亮色绘制的横/纵向对齐辅助线
 * [POS]: preview/components 的吸附反馈层，始终位于画面与选择控制器之间
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

const SNAP_GUIDE_COLOR = "#8b3dff";
const SNAP_GUIDE_GLOW = "0 0 0 1px rgb(139 61 255 / 0.25), 0 0 8px rgb(139 61 255 / 0.6)";

export function SnapGuides({ lines }: { lines: SnapLine[] }) {
	const viewport = usePreviewViewport();

	if (lines.length === 0) {
		return null;
	}

	const toOverlayX = (logicalX: number) =>
		viewport.positionToOverlay({
			positionX: logicalX,
			positionY: 0,
		}).x;

	const toOverlayY = (logicalY: number) =>
		viewport.positionToOverlay({
			positionX: 0,
			positionY: logicalY,
		}).y;

	return (
		<div className="pointer-events-none absolute inset-0" aria-hidden>
			{lines.map((line) => {
				if (line.type === "vertical") {
					return (
						<div
							key={`vertical-${line.position}`}
							className="absolute top-0 bottom-0"
							style={{
								left: toOverlayX(line.position) - 1,
								width: 2,
								backgroundColor: SNAP_GUIDE_COLOR,
								boxShadow: SNAP_GUIDE_GLOW,
							}}
						/>
					);
				}
				return (
					<div
						key={`horizontal-${line.position}`}
						className="absolute left-0 right-0"
						style={{
							top: toOverlayY(line.position) - 1,
							height: 2,
							backgroundColor: SNAP_GUIDE_COLOR,
							boxShadow: SNAP_GUIDE_GLOW,
						}}
					/>
				);
			})}
		</div>
	);
}
