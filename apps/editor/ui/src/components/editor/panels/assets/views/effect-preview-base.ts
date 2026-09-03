/**
 * [INPUT]: 依赖 runtime 的 WorldObject 契约。
 * [OUTPUT]: 对外提供 buildEffectPreviewBaseContent：为特效预览世界生成的确定性底图内容。
 * [POS]: assets/views 的特效预览底图；采样底层场景纹理的后处理特效（玻璃/放大镜/霜/CRT…）
 *      在纯色背景上无可采样内容，预览必然接近空白。此模块用离屏 canvas 生成渐变底图 +
 *      文字 + 形状的案例内容，让特效预览真实可见。全部离线、确定性，无网络依赖。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { WorldObject } from "@/runtime/types";
import type { ParamValues } from "@/params";

/** 预览底图渐变 dataURL（按尺寸惰性生成一次）。 */
function buildGradientDataUrl(width: number, height: number): string | null {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	// 多彩对角渐变：为折射 / 位移 / 模糊类特效提供连续色阶。
	const gradient = ctx.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, "#f472b6"); // pink
	gradient.addColorStop(0.45, "#2dd4bf"); // teal
	gradient.addColorStop(1, "#6366f1"); // indigo
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);

	// 色块与圆：提供硬边缘（位移 / 涟漪 / 卷曲类需要可辨轮廓）。
	ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
	ctx.fillRect(width * 0.12, height * 0.16, width * 0.2, height * 0.24);
	ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
	ctx.fillRect(width * 0.58, height * 0.52, width * 0.24, height * 0.3);
	ctx.beginPath();
	ctx.arc(width * 0.76, height * 0.24, Math.min(width, height) * 0.13, 0, Math.PI * 2);
	ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
	ctx.fill();
	ctx.beginPath();
	ctx.arc(width * 0.3, height * 0.72, Math.min(width, height) * 0.1, 0, Math.PI * 2);
	ctx.fillStyle = "rgba(244, 63, 94, 0.85)";
	ctx.fill();

	return canvas.toDataURL("image/png");
}

const baseParams: ParamValues = {
	opacity: 1,
	blendMode: "normal",
};

/**
 * 特效预览底图：满幅渐变 + 居中文字 + 两个形状。
 * 布局以世界坐标（width×height，原点中心，y 向下为正）为单位，
 * 与大多数特效的默认作用区（中心 0.5/0.5）重叠。
 */
export function buildEffectPreviewBaseContent(
	width: number,
	height: number,
	duration: number,
): WorldObject[] {
	const objects: WorldObject[] = [];
	const timing = { startTime: 0, duration, renderOrder: 0 };

	// 1) 满幅渐变底图（image：contain-fit，源尺寸 = 世界尺寸 → 铺满）。
	const url = buildGradientDataUrl(width, height);
	if (url) {
		objects.push({
			id: "preview-base-gradient",
			kind: "image",
			name: "Base Gradient",
			url,
			sourceWidth: width,
			sourceHeight: height,
			...timing,
			params: { ...baseParams },
			transform: { position: { x: 0, y: 0, z: 0 }, scaleX: 1, scaleY: 1, rotationZ: 0 },
		});
	}

	// 2) 居中标题文字：字符化 / 解密 / 焦点类特效的字形内容。
	//    fontSize 相对 canvasHeight 缩放（scaled = fontSize × H / 90），取 H 的 ~18%。
	objects.push({
		id: "preview-base-text",
		kind: "text",
		name: "Base Text",
		...timing,
		renderOrder: 1,
		params: {
			...baseParams,
			content: "Recut Effect",
			fontSize: 16,
			fontFamily: "Arial, sans-serif",
			fontWeight: "bold",
			textAlign: "center",
			color: "#ffffff",
			"background.enabled": false,
			"transform.positionY": -height * 0.08,
		},
		transform: {
			position: { x: 0, y: -height * 0.08, z: 0 },
			scaleX: 1,
			scaleY: 1,
			rotationZ: 0,
		},
	});

	// 3) 形状：左右各一，提供轮廓边缘。
	const shape = (
		id: string,
		name: string,
		shape: string,
		color: string,
		size: number,
		x: number,
		y: number,
		renderOrder: number,
	): WorldObject => ({
		id,
		kind: "component",
		componentId: "shape",
		name,
		...timing,
		renderOrder,
		params: { ...baseParams, shape, color, size, "transform.positionX": x, "transform.positionY": y },
		transform: {
			position: { x, y, z: 0 },
			scaleX: 1,
			scaleY: 1,
			rotationZ: 0,
		},
	});

	const shapeSize = Math.min(width, height) * 0.22;
	objects.push(
		shape(
			"preview-base-shape-box",
			"Base Box",
			"box",
			"#fb7185",
			shapeSize,
			-width * 0.26,
			height * 0.18,
			2,
		),
		shape(
			"preview-base-shape-sphere",
			"Base Sphere",
			"sphere",
			"#a3e635",
			shapeSize * 0.8,
			width * 0.28,
			height * 0.26,
			3,
		),
	);

	return objects;
}
