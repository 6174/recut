/**
 * [INPUT]: 依赖文字布局测量、Canvas 文字绘制与 runtime CanvasTexture。
 * [OUTPUT]: 对外提供 TextObject 组件。
 * [POS]: runtime/components 的文字承载面；背景和文字使用同一纹理键原子更新。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import type { ComponentRenderContext } from "../types";
import { useCanvasTexture } from "../texture";
import { num, str } from "../utils";
import {
	getTextMeasurementContext,
	measureTextElement,
} from "@/text/measure-element";
import { drawMeasuredTextLayout } from "@/text/primitives";
import type { TextElement } from "@/timeline";

/**
 * 文字组件（D6）：与编辑器同源布局（measureTextElement + drawMeasuredTextLayout），
 * plane 按内容 visualRect 定尺寸 —— 渲染几何 bbox 即文字真实范围，与其它元素统一走 D5 几何 bbox。
 */
export function TextObject({
	world,
	object,
	params,
	localTime,
}: ComponentRenderContext) {
	const color = str(params.color, "#ffffff");
	const bgColor = str(params["background.color"], "#00000099");
	const opacity = num(params.opacity, 1);

	// 用解析后的参数测量布局（fontSize 相对 canvasHeight 缩放，与编辑器一致）。
	const element = { ...object, params } as unknown as TextElement;
	const measured = measureTextElement({
		element,
		canvasHeight: world.height,
		localTime,
		ctx: getTextMeasurementContext(),
	});
	const rect = measured.visualRect;
	const width = Math.max(1, Math.ceil(rect.width));
	const height = Math.max(1, Math.ceil(rect.height));
	const textureKey = JSON.stringify({
		color,
		bgColor,
		layout: {
			font: measured.fontString,
			letterSpacing: measured.letterSpacing,
			lineHeight: measured.lineHeightPx,
			lines: measured.lines,
			textAlign: measured.textAlign,
			textDecoration: measured.textDecoration,
		},
		background: measured.resolvedBackground,
	});

	const texture = useCanvasTexture(
		(ctx, w, h) => {
			ctx.save();
			// visualRect 是相对布局中心（原点）的文本范围；平移到画布 [0..w]×[0..h]。
			ctx.translate(-rect.left, -rect.top);
			drawMeasuredTextLayout({
				ctx,
				layout: measured,
				textColor: color,
				background: measured.resolvedBackground,
				backgroundColor: bgColor,
				textBaseline: "middle",
			});
			ctx.restore();
		},
		width,
		height,
		textureKey,
	);

	return (
		<mesh key={texture.uuid} renderOrder={object.renderOrder}>
			<planeGeometry args={[width, height]} />
			<meshBasicMaterial
				map={texture}
				transparent
				opacity={opacity}
				depthWrite={false}
				side={THREE.DoubleSide}
			/>
		</mesh>
	);
}
