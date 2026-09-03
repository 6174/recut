/**
 * [INPUT]: 当前帧解析对象（根 Object3D + blendMode）、R3F 渲染器与画布尺寸。
 * [OUTPUT]: 17 种 Photoshop 混合模式的顺序 render-target 合成管线（GLSL 语义同 src/three/blend-modes）。
 *           末尾 blit 的 sRGB 编码按 target 二选一：sRGB 纹理 RT 由硬件编码（shader 输出 linear），
 *           默认帧缓冲/NoColorSpace RT 无硬件编码（shader 做精确 sRGB 编码）——两者不可混用，
 *           否则双重编码（快照变亮）或漏编码（画布发暗）。
 * [POS]: runtime 合成层。R3F 前向路径的材质默认 NormalBlending，会静默忽略 blendMode；
 *       非 normal 图层必须走本管线：逐层「layerRT → blend pass → 累积 RT」，末尾编码 blit 到屏幕/快照 target。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import {
	BLEND_FRAGMENT_SHADER,
	BLEND_MODE_INDEX,
	FULLSCREEN_VERTEX_SHADER,
} from "@/three/blend-modes";
import type { BlendMode } from "@/rendering";

/** 一个参与合成的图层：元素根节点（transform 已应用）+ 混合模式。 */
export interface CompositeLayer {
	root: THREE.Object3D;
	blendMode: BlendMode;
}

export interface CompositeInput {
	gl: THREE.WebGLRenderer;
	/** 主场景（R3F scene）：背景、正常图层与特效视图都挂在这里，管线通过可见性切换逐层渲染。 */
	scene: THREE.Scene;
	camera: THREE.Camera;
	/** 自底向上排序的全部可视图层（含 normal；normal 走 Porter-Duff over）。 */
	layers: CompositeLayer[];
	/** 全画布特效的根节点：不进逐层合成，最终结果之上叠加渲染。 */
	effectRoots?: THREE.Object3D[];
	/** CSS 颜色或 "transparent"。 */
	background: string;
	width: number;
	height: number;
	/** null = 默认帧缓冲（预览/导出画布）；否则快照 target。 */
	target?: THREE.WebGLRenderTarget | null;
	/** 场景存在全画布特效时产出 sRGB 内容纹理（供特效 shader 采样）。 */
	needContent?: boolean;
}

export interface CompositeOutput {
	/** 全部图层合成后的线性内容 RT。 */
	accum: THREE.WebGLRenderTarget;
	/** 线性内容的 sRGB 编码副本（特效 shader 按 sRGB 假设采样）。 */
	effectContent: THREE.WebGLRenderTarget;
}

/** 与 three 内置 LinearTosRGB 一致的精确 sRGB 编码（正常直出路径用的同一变换）。
 *  注意：step 选择器只能作为 mix 的 0/1 参数做分支选择，绝不能当标度参与插值
 *  （历史 bug：mix(b, a, 1.055) 外推导致全画布输出被压暗，「混合模式影响整个画面」）。 */
const LINEAR_TO_SRGB = /* glsl */ `
vec3 linearToSrgb(vec3 c) {
	vec3 clamped = clamp(c, vec3(0.0), vec3(1.0));
	vec3 a = pow(clamped, vec3(1.0 / 2.4)) * 1.055 - 0.055;
	vec3 b = clamped * 12.92;
	vec3 s = step(vec3(0.0031308), clamped);
	return clamp(mix(b, a, s), vec3(0.0), vec3(1.0));
}
`;

/** 最终 blit：线性 accum → target。
 *  uEncode=1：target 无硬件编码（默认帧缓冲/NoColorSpace RT）→ shader 做精确 sRGB 编码；
 *  uEncode=0：target 是 sRGB 纹理 RT（快照/封面路径）→ 硬件写入时已编码，shader 输出 linear，
 *  否则双重编码会让快照整体变亮（alpha 始终透传，透明背景封面依赖 alpha）。 */
const FINAL_BLIT_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uEncode;
in vec2 vUv;
out vec4 fragColor;
${LINEAR_TO_SRGB}
void main() {
	vec4 c = texture(uMap, vUv);
	fragColor = vec4(mix(c.rgb, linearToSrgb(c.rgb), uEncode), c.a);
}
`;

/** 全画布特效内容纹理：与 SceneCapture 相同的 linear→sRGB 编码（1/2.2 近似），alpha 固定 1。 */
const CONTENT_ENCODE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
in vec2 vUv;
out vec4 fragColor;
void main() {
	vec3 c = texture(uMap, vUv).rgb;
	fragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`;

/** [诊断] 一帧缓冲采样记录。 */
interface DebugFrame {
	stage: string;
	mode?: string;
	r?: number;
	g?: number;
	b?: number;
	a?: number;
}

/** [诊断] 采样 render target（或默认帧缓冲）九点区域均值；仅在测试开启 __recutDebugBlend 时使用。 */
function sampleRenderTarget(
	gl: THREE.WebGLRenderer,
	target: THREE.WebGLRenderTarget | null,
): { r: number; g: number; b: number; a: number } {
	const w = target ? target.width : gl.domElement.width;
	const h = target ? target.height : gl.domElement.height;
	const px = new Uint8Array(8 * 8 * 4);
	let r = 0;
	let g = 0;
	let b = 0;
	let a = 0;
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			const x = Math.round((i / 3) * (w - 16));
			const y = Math.round((j / 3) * (h - 16));
			gl.readRenderTargetPixels(target, x, y, 8, 8, px);
			for (let k = 0; k < px.length; k += 4) {
				r += px[k];
				g += px[k + 1];
				b += px[k + 2];
				a += px[k + 3];
			}
		}
	}
	const n = 16 * 64;
	return { r: r / n, g: g / n, b: b / n, a: a / n / 255 };
}

interface PipelineResources {
	width: number;
	height: number;
	accumA: THREE.WebGLRenderTarget;
	accumB: THREE.WebGLRenderTarget;
	layerRT: THREE.WebGLRenderTarget;
	contentRT: THREE.WebGLRenderTarget;
	quadScene: THREE.Scene;
	quadCamera: THREE.Camera;
	blendQuad: THREE.Mesh;
	encodeQuad: THREE.Mesh;
	blitQuad: THREE.Mesh;
}

function makeRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
	const rt = new THREE.WebGLRenderTarget(width, height, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
		depthBuffer: true,
		stencilBuffer: false,
	});
	// NoColorSpace：写入/采样都不做 sRGB 变换 —— RT 保存 linear 工作空间像素，
	// 与直出路径的材质输出一致；仅在最终 blit 做一次精确 sRGB 编码。
	rt.texture.colorSpace = THREE.NoColorSpace;
	rt.texture.flipY = false;
	return rt;
}

function makeQuad(fragment: string): THREE.Mesh {
	const geometry = new THREE.PlaneGeometry(2, 2);
	const material = new THREE.ShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: FULLSCREEN_VERTEX_SHADER,
		fragmentShader: fragment,
		uniforms: {
			uBackdrop: { value: null },
			uMap: { value: null },
			uMask: { value: null },
			uMode: { value: 0 },
			uUseMask: { value: 0 },
			uInvert: { value: 0 },
			uEncode: { value: 1 },
		},
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.frustumCulled = false;
	mesh.visible = false;
	return mesh;
}

function disposeResources(res: PipelineResources): void {
	res.accumA.dispose();
	res.accumB.dispose();
	res.layerRT.dispose();
	res.contentRT.dispose();
	for (const quad of [res.blendQuad, res.encodeQuad, res.blitQuad]) {
		quad.geometry.dispose();
		(quad.material as THREE.ShaderMaterial).dispose();
	}
}

/** 每个 renderer + 尺寸一套资源；WebGL context 丢失/重建会换 renderer 实例，自动重建。 */
const resourceCache = new WeakMap<THREE.WebGLRenderer, PipelineResources>();

function getOrCreateResources(
	gl: THREE.WebGLRenderer,
	width: number,
	height: number,
): PipelineResources {
	let res = resourceCache.get(gl);
	if (res && res.width === width && res.height === height) return res;
	if (res) {
		disposeResources(res);
		resourceCache.delete(gl);
	}
	res = {
		width,
		height,
		accumA: makeRenderTarget(width, height),
		accumB: makeRenderTarget(width, height),
		layerRT: makeRenderTarget(width, height),
		contentRT: makeRenderTarget(width, height),
		quadScene: new THREE.Scene(),
		quadCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1),
		blendQuad: makeQuad(BLEND_FRAGMENT_SHADER),
		encodeQuad: makeQuad(CONTENT_ENCODE_FRAGMENT),
		blitQuad: makeQuad(FINAL_BLIT_FRAGMENT),
	};
	res.quadScene.add(res.blendQuad, res.encodeQuad, res.blitQuad);
	resourceCache.set(gl, res);
	return res;
}

function isTransparentBackground(background: string): boolean {
	return background === "transparent";
}

/**
 * 顺序合成一帧：背景 → 逐层（layerRT → 混合 pass → 累积）→ 特效叠加 → blit。
 * 全程保存/恢复渲染器与场景状态，调用返回后可直接继续 R3F 生命周期。
 */
export function compositeFrame(input: CompositeInput): CompositeOutput {
	const { gl, scene, camera, layers, background, width, height } = input;
	const res = getOrCreateResources(gl, width, height);
	const transparent = isTransparentBackground(background);
	const backgroundColor = transparent ? new THREE.Color(0x000000) : new THREE.Color(background);

	const effectRoots = input.effectRoots ?? [];
	const allRoots = [...layers.map((layer) => layer.root), ...effectRoots];
	// 记录原始可见性：管线期间逐层切换，退出时恢复（选择框/命中测试依赖恒真）。
	const savedVisibility: Array<[THREE.Object3D, boolean]> = allRoots.map(
		(root) => [root, root.visible],
	);

	// [诊断] 缓冲内容采样；测试用 window.__recutDebugBlend 开启时生效。
	const debugFrames: DebugFrame[] | null =
		typeof window !== "undefined" && (window as any).__recutDebugBlend
			? []
			: null;

	const savedTarget = gl.getRenderTarget();
	const savedClearColor = new THREE.Color();
	gl.getClearColor(savedClearColor);
	const savedClearAlpha = gl.getClearAlpha();
	const savedAutoClear = gl.autoClear;
	const savedBackground = scene.background;
	const savedScissorTest = gl.getScissorTest();
	gl.setScissorTest(false);
	gl.setViewport(0, 0, width, height);

	// 累积 RT 指针（ping-pong）；声明在 try 外，管线末尾随输出返回。
	let accum = res.accumA;

	try {
		// 1) 背景种子（透明背景：alpha 0，供封面透明捕获）。
		scene.background = transparent ? null : backgroundColor;
		gl.setRenderTarget(accum);
		gl.setClearColor(backgroundColor, transparent ? 0 : 1);
		gl.clear(true, true, false);

		// 2) 逐层顺序合成（自底向上）。每层：仅该层可见渲染进 layerRT，再按模式混入 accum。
		for (const layer of layers) {
			for (const [root] of savedVisibility) root.visible = false;
			layer.root.visible = true;

			scene.background = null; // 背景绝不能烘进 layer 纹理
			gl.setRenderTarget(res.layerRT);
			gl.setClearColor(0x000000, 0);
			gl.clear(true, true, false);
			gl.render(scene, camera);
			scene.background = savedBackground;
			if (debugFrames) {
				debugFrames.push({ stage: "layerRT", mode: layer.blendMode, ...sampleRenderTarget(gl, res.layerRT) });
			}

			const blendMat = res.blendQuad.material as THREE.ShaderMaterial;
			blendMat.uniforms.uBackdrop.value = accum.texture;
			blendMat.uniforms.uMap.value = res.layerRT.texture;
			blendMat.uniforms.uMode.value =
				BLEND_MODE_INDEX[layer.blendMode] ?? 0;
			blendMat.uniforms.uUseMask.value = 0;
			blendMat.uniforms.uInvert.value = 0;
			const next = accum === res.accumA ? res.accumB : res.accumA;
			res.blendQuad.visible = true;
			gl.setRenderTarget(next);
			gl.render(res.quadScene, res.quadCamera);
			res.blendQuad.visible = false;
			accum = next;
			if (debugFrames) {
				debugFrames.push({ stage: "accum", mode: layer.blendMode, ...sampleRenderTarget(gl, accum) });
			}
		}

		// 恢复所有根可见性（含特效）。
		for (const [root, visible] of savedVisibility) root.visible = visible;

		// 3) 特效内容纹理：linear accum → sRGB 编码（与 SceneCapture 同语义）。
		if (input.needContent) {
			const encodeMat = res.encodeQuad.material as THREE.ShaderMaterial;
			encodeMat.uniforms.uMap.value = accum.texture;
			res.encodeQuad.visible = true;
			gl.setRenderTarget(res.contentRT);
			gl.setClearColor(0x000000, 1);
			gl.clear(true, false, false);
			gl.render(res.quadScene, res.quadCamera);
			res.encodeQuad.visible = false;
		}

		// 4) 最终 blit：accum（linear）→ target。
		// 编码策略按 target 决定：sRGB 纹理 RT 由硬件编码（shader 输出 linear），
		// 默认帧缓冲/NoColorSpace RT 无硬件编码（shader 做精确 sRGB 编码）。
		const finalTarget = input.target ?? null;
		gl.setRenderTarget(finalTarget);
		gl.setClearColor(backgroundColor, transparent ? 0 : 1);
		gl.clear(true, true, false);
		const blitMat = res.blitQuad.material as THREE.ShaderMaterial;
		blitMat.uniforms.uMap.value = accum.texture;
		blitMat.uniforms.uEncode.value =
			finalTarget != null &&
			finalTarget.texture.colorSpace === THREE.SRGBColorSpace
				? 0
				: 1;
		res.blitQuad.visible = true;
		gl.render(res.quadScene, res.quadCamera);
		res.blitQuad.visible = false;
		if (debugFrames) {
			debugFrames.push({ stage: "finalCanvas", ...sampleRenderTarget(gl, null) });
			(window as any).__recutLastBlendDebug = debugFrames;
		}

		// 5) 全画布特效：最终结果之上叠加（不清屏；内容纹理已在 context 中替换）。
		if (effectRoots.length > 0) {
			for (const [root] of savedVisibility) root.visible = false;
			for (const root of effectRoots) root.visible = true;
			scene.background = null;
			gl.autoClear = false;
			gl.render(scene, camera);
			gl.autoClear = savedAutoClear;
			for (const [root, visible] of savedVisibility) root.visible = visible;
			scene.background = savedBackground;
		}
	} finally {
		gl.setRenderTarget(savedTarget);
		gl.setClearColor(savedClearColor, savedClearAlpha);
		gl.autoClear = savedAutoClear;
		gl.setScissorTest(savedScissorTest);
		scene.background = savedBackground;
		// 管线期间可能把根节点置为不可见；无论异常与否都恢复。
		for (const [root, visible] of savedVisibility) root.visible = visible;
	}

	return { accum, effectContent: res.contentRT };
}

/** 当前帧是否存在需要管线合成的非 normal 混合模式。 */
export function hasNonNormalBlend(layers: { blendMode: BlendMode }[]): boolean {
	return layers.some((layer) => layer.blendMode !== "normal");
}
