import { useEffect, useImperativeHandle, useMemo, forwardRef, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { ResolvedLayer } from "./render-model";
import { BLEND_FRAGMENT_SHADER, BLEND_MODE_INDEX, FULLSCREEN_VERTEX_SHADER } from "./blend-modes";
import { containFit } from "./media-texture";
import { DomTextSurface, isHtmlInCanvasSupported } from "./dom-text-surface";

const BLUR_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec2 uResolution;
uniform vec2 uDirection;
uniform float uSigma;
uniform float uStep;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float sigma = max(uSigma, 0.5);
  float stepSize = max(uStep, 1.0);
  float total = 0.0;
  vec4 acc = vec4(0.0);
  for (int i = -30; i <= 30; i++) {
    float pos = float(i) * stepSize;
    float w = exp(-(pos * pos) / (2.0 * sigma * sigma));
    vec2 off = uDirection * pos / uResolution;
    acc += texture(uMap, clamp(vUv + off, 0.001, 0.999)) * w;
    total += w;
  }
  fragColor = acc / max(total, 1e-5);
}
`;

const COPY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = texture(uMap, vUv);
}
`;

// 图层 quad：clip-space 定位（像素→NDC），绕开相机，与背景/混合 pass 同源可靠
const LAYER_VERTEX_SHADER = /* glsl */ `
precision highp float;
uniform vec2 uCanvasSize;
uniform vec2 uCenter;
uniform vec2 uSize;
uniform float uRotation;
out vec2 vUv;
void main() {
  vUv = uv;
  vec2 halfSize = uSize * 0.5;
  // 编辑器约定：正角度为屏幕顺时针（与选择框 / 导出一致）。NDC 为 y 向上，
  // 此处取反使正 uRotation 在画布上表现为顺时针。
  float rad = -uRotation * 3.14159265 / 180.0;
  vec2 p = position.xy * halfSize;
  vec2 rp = vec2(p.x * cos(rad) - p.y * sin(rad), p.x * sin(rad) + p.y * cos(rad));
  vec2 center = vec2(uCenter.x, uCanvasSize.y - uCenter.y);
  vec2 clip = ((center + rp) / uCanvasSize) * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const LAYER_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec4 c = texture(uMap, vUv);
  c.a *= uOpacity;
  fragColor = c;
}
`;

interface CompositorResources {
	accumA: THREE.WebGLRenderTarget;
	accumB: THREE.WebGLRenderTarget;
	layerRT: THREE.WebGLRenderTarget;
	tempRT: THREE.WebGLRenderTarget;
	blendQuad: THREE.Mesh;
	blurQuad: THREE.Mesh;
	copyQuad: THREE.Mesh;
	layerQuad: THREE.Mesh;
	scene: THREE.Scene;
	camera: THREE.Camera;
	/** 组件图层渲染相机（像素单位、原点居中、y 向上），对应 ComponentStage 的坐标约定。 */
	componentCamera: THREE.OrthographicCamera;
	backgroundTexture: THREE.CanvasTexture | null;
	layerTextures: Map<string, { texture: THREE.CanvasTexture; version?: number }>;
	domSurfaces: Map<string, DomTextSurface>;
	pendingTextRepaints: Set<string>;
}

function makeRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
	const rt = new THREE.WebGLRenderTarget(width, height, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
	});
	rt.texture.colorSpace = THREE.NoColorSpace;
	rt.texture.flipY = false;
	return rt;
}

function makeFullscreenQuad(fragmentShader: string): THREE.Mesh {
	const geometry = new THREE.PlaneGeometry(2, 2);
	const material = new THREE.ShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: FULLSCREEN_VERTEX_SHADER,
		fragmentShader,
		uniforms: {
			uMap: { value: null },
			uBackdrop: { value: null },
			uMask: { value: null },
			uMode: { value: 0 },
			uUseMask: { value: 0 },
			uInvert: { value: 0 },
			uResolution: { value: new THREE.Vector2(1, 1) },
			uDirection: { value: new THREE.Vector2(1, 0) },
			uSigma: { value: 1 },
			uStep: { value: 1 },
		},
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.frustumCulled = false;
	return mesh;
}

function makeLayerQuad(): THREE.Mesh {
	const geometry = new THREE.PlaneGeometry(2, 2);
	const material = new THREE.ShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: LAYER_VERTEX_SHADER,
		fragmentShader: LAYER_FRAGMENT_SHADER,
		uniforms: {
			uMap: { value: null },
			uCanvasSize: { value: new THREE.Vector2(1, 1) },
			uCenter: { value: new THREE.Vector2(0, 0) },
			uSize: { value: new THREE.Vector2(1, 1) },
			uRotation: { value: 0 },
			uOpacity: { value: 1 },
		},
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.frustumCulled = false;
	return mesh;
}

function parseColor(color: string): [number, number, number] {
	const hex = color.replace("#", "");
	const value = parseInt(hex.slice(0, 6), 16);
	if (Number.isNaN(value)) return [0, 0, 0];
	return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function renderCopy(
	gl: THREE.WebGLRenderer,
	res: CompositorResources,
	texture: THREE.Texture,
) {
	const mat = res.copyQuad.material as THREE.ShaderMaterial;
	mat.uniforms.uMap.value = texture;
	res.copyQuad.visible = true;
	gl.render(res.scene, res.camera);
	res.copyQuad.visible = false;
}

function applyBlurPasses(
	gl: THREE.WebGLRenderer,
	res: CompositorResources,
	passes: any[][],
	width: number,
	height: number,
	layerOnly: boolean,
) {
	const mat = res.blurQuad.material as THREE.ShaderMaterial;
	for (const group of passes) {
		for (const pass of group) {
			if (pass.shader !== "gaussian-blur") continue;
			const uniforms = pass.uniforms ?? {};
			mat.uniforms.uMap.value = layerOnly ? res.layerRT.texture : (res.accumA.texture);
			mat.uniforms.uResolution.value.set(width, height);
			const dir = uniforms.u_direction ?? [1, 0];
			mat.uniforms.uDirection.value.set(dir[0], dir[1]);
			mat.uniforms.uSigma.value = uniforms.u_sigma ?? 4;
			mat.uniforms.uStep.value = uniforms.u_step ?? 1;
			res.blurQuad.visible = true;
			gl.setRenderTarget(res.tempRT);
			gl.render(res.scene, res.camera);
			res.blurQuad.visible = false;
			if (layerOnly) {
				gl.setRenderTarget(res.layerRT);
				renderCopy(gl, res, res.tempRT.texture);
			} else {
				// 场景特效：tempRT 内容写回 accumA 作为新 backdrop
				gl.setRenderTarget(res.accumA);
				renderCopy(gl, res, res.tempRT.texture);
			}
		}
	}
}

function layerBaseSize(
	layer: ResolvedLayer,
	width: number,
	height: number,
): { width: number; height: number } {
	if (layer.fit === "none") return { width, height };
	if (layer.fit === "cover") {
		const cover = Math.max(width / layer.sourceWidth, height / layer.sourceHeight);
		return { width: layer.sourceWidth * cover, height: layer.sourceHeight * cover };
	}
	return containFit({
		sourceWidth: layer.sourceWidth,
		sourceHeight: layer.sourceHeight,
		canvasWidth: width,
		canvasHeight: height,
	});
}

/** 每层持久纹理：视频/图片按 source 更新，文字用 html-in-canvas（HIC）。 */
function ensureLayerTexture(
	res: CompositorResources,
	layer: ResolvedLayer,
	width: number,
	height: number,
	onCaptured?: () => void,
): THREE.CanvasTexture | null {
	// 文字：原生 HTML-in-Canvas（快）；不支持时返回 null（层跳过，UI 提示）
	if (layer.text) {
		if (!isHtmlInCanvasSupported()) return null;
		let surface = res.domSurfaces.get(layer.id);
		if (!surface) {
			surface = new DomTextSurface(width, height);
			res.domSurfaces.set(layer.id, surface);
		}
		surface.onCaptured = onCaptured ?? null;
		surface.update(layer.text, width, height);
		if (surface.wantsRepaint) {
			res.pendingTextRepaints.add(layer.id);
		}
		return surface.texture;
	}

	let entry = res.layerTextures.get(layer.id);
	if (!entry) {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.NoColorSpace;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.flipY = true;
		entry = { texture };
		res.layerTextures.set(layer.id, entry);
	}
	if (layer.source) {
		// 视频帧可能复用同一 canvas 对象（mediabunny 池化），仅靠对象身份判断会漏更新，
		// 所以叠加 sourceVersion（帧时间戳）比较。
		const version = layer.sourceVersion ?? 0;
		if (
			entry.version !== version ||
			entry.texture.image !== (layer.source as any)
		) {
			entry.texture.image = layer.source as any;
			entry.texture.needsUpdate = true;
			entry.version = version;
		}
	}
	return entry.texture;
}

function renderLayer(
	gl: THREE.WebGLRenderer,
	res: CompositorResources,
	layer: ResolvedLayer,
	ptr: number,
	width: number,
	height: number,
	componentGroups: Map<string, THREE.Group>,
	r3fScene: THREE.Scene,
	onCaptured?: () => void,
): boolean {
	const isComponent = layer.kind === "component";
	const usesGroupRender = isComponent;

	if (usesGroupRender) {
		// 组件层：把该层对应的组件 group 渲染进 layerRT（组件自带完整变换）。
		for (const [groupId, group] of componentGroups) {
			group.visible = groupId === layer.id;
		}
		r3fScene.updateMatrixWorld(true);
		gl.setRenderTarget(res.layerRT);
		gl.setClearColor(0x000000, 0);
		gl.clear(true, true, false);
		gl.render(r3fScene, res.componentCamera);
		for (const group of componentGroups.values()) {
			group.visible = true;
		}

		// 透明度：layerRT 无 layerQuad 通道，用 identity 全画布 pass 应用 opacity。
		if (layer.opacity < 1) {
			const mat = res.layerQuad.material as THREE.ShaderMaterial;
			mat.uniforms.uMap.value = res.layerRT.texture;
			mat.uniforms.uCenter.value.set(width / 2, height / 2);
			mat.uniforms.uSize.value.set(width, height);
			mat.uniforms.uRotation.value = 0;
			mat.uniforms.uOpacity.value = Math.max(0, Math.min(1, layer.opacity));
			mat.uniforms.uCanvasSize.value.set(width, height);
			res.layerQuad.visible = true;
			gl.setRenderTarget(res.tempRT);
			gl.render(res.scene, res.camera);
			res.layerQuad.visible = false;
			gl.setRenderTarget(res.layerRT);
			renderCopy(gl, res, res.tempRT.texture);
		}
	} else {
		const texture = ensureLayerTexture(res, layer, width, height, onCaptured);
		if (!texture) return false;
		const mat = res.layerQuad.material as THREE.ShaderMaterial;
		mat.uniforms.uMap.value = texture;
		const base = layerBaseSize(layer, width, height);
		mat.uniforms.uCenter.value.set(
			width / 2 + layer.transform.position.x,
			height / 2 + layer.transform.position.y,
		);
		mat.uniforms.uSize.value.set(
			base.width * layer.transform.scaleX,
			base.height * layer.transform.scaleY,
		);
		mat.uniforms.uRotation.value = layer.transform.rotate;
		mat.uniforms.uOpacity.value = Math.max(0, Math.min(1, layer.opacity));
		mat.uniforms.uCanvasSize.value.set(width, height);

		// layer pass → layerRT
		res.layerQuad.visible = true;
		gl.setRenderTarget(res.layerRT);
		gl.setClearColor(0x000000, 0);
		gl.clear(true, true, false);
		gl.render(res.scene, res.camera);
		res.layerQuad.visible = false;
	}

	// effect passes（gaussian-blur 等）
	applyBlurPasses(gl, res, layer.effectPasses, width, height, true);

	// blend pass：backdrop(accum[ptr]) + layerRT → accum[1-ptr]
	const blendMat = res.blendQuad.material as THREE.ShaderMaterial;
	blendMat.uniforms.uBackdrop.value = (ptr === 0 ? res.accumA : res.accumB).texture;
	blendMat.uniforms.uMap.value = res.layerRT.texture;
	blendMat.uniforms.uMode.value = BLEND_MODE_INDEX[layer.blendMode] ?? 0;
	blendMat.uniforms.uUseMask.value = layer.mask ? 1 : 0;
	blendMat.uniforms.uInvert.value = layer.mask?.inverted ? 1 : 0;
	blendMat.uniforms.uMask.value = layer.mask?.texture ?? null;
	res.blendQuad.visible = true;
	gl.setRenderTarget(ptr === 0 ? res.accumB : res.accumA);
	gl.render(res.scene, res.camera);
	res.blendQuad.visible = false;
	return true;
}

function runComposite(
	gl: THREE.WebGLRenderer,
	res: CompositorResources,
	layers: ResolvedLayer[],
	background: string | null,
	width: number,
	height: number,
	componentGroups: Map<string, THREE.Group>,
	r3fScene: THREE.Scene,
	onCaptured?: () => void,
) {
	// R3F 可能留下 scissor/viewport 状态，强制重置
	gl.setScissorTest(false);
	gl.setViewport(0, 0, width, height);

	// 清空 accum
	gl.setRenderTarget(res.accumA);
	gl.setClearColor(0x000000, 0);
	gl.clear(true, true, false);

	let ptr = 0;

	// 背景
	if (background) {
		const color = parseColor(background);
		const key = `${color[0]},${color[1]},${color[2]}`;
		if (!res.backgroundTexture || res.backgroundTexture.userData.key !== key) {
			const canvas = document.createElement("canvas");
			canvas.width = 2;
			canvas.height = 2;
			const ctx = canvas.getContext("2d")!;
			ctx.fillStyle = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
			ctx.fillRect(0, 0, 2, 2);
			res.backgroundTexture?.dispose();
			res.backgroundTexture = new THREE.CanvasTexture(canvas);
			res.backgroundTexture.colorSpace = THREE.NoColorSpace;
			res.backgroundTexture.userData.key = key;
		}
		gl.setRenderTarget(res.accumA);
		renderCopy(gl, res, res.backgroundTexture);
	}

	// 逐层
	for (const layer of layers) {
		if (layer.kind === "color") continue;
		if (layer.kind === "effect") {
			applyBlurPasses(gl, res, [layer.effectPasses[0] ?? []], width, height, false);
			continue;
		}
		if (renderLayer(gl, res, layer, ptr, width, height, componentGroups, r3fScene, onCaptured)) {
			ptr = 1 - ptr;
		}
	}

	// 最终 blit accum → 屏幕
	gl.setRenderTarget(null);
	gl.setClearColor(0x000000, 0);
	gl.clear(true, true, false);
	renderCopy(gl, res, (ptr === 0 ? res.accumA : res.accumB).texture);
}

export interface SceneCompositorHandle {
	renderComposite: () => void;
}

interface SceneCompositorProps {
	layers: ResolvedLayer[];
	width: number;
	height: number;
	background: string | null;
	componentGroups: Map<string, THREE.Group>;
	onComposited?: () => void;
	onError?: (error: unknown) => void;
}

export const SceneCompositor = forwardRef<SceneCompositorHandle, SceneCompositorProps>(
	function SceneCompositor(
		{ layers, width, height, background, componentGroups, onComposited, onError },
		ref,
	) {
		const { gl } = useThree();
		const r3fScene = useThree((state) => state.scene);

		const res = useMemo<CompositorResources>(() => {
			const scene = new THREE.Scene();
			const blendQuad = makeFullscreenQuad(BLEND_FRAGMENT_SHADER);
			const blurQuad = makeFullscreenQuad(BLUR_FRAGMENT_SHADER);
			const copyQuad = makeFullscreenQuad(COPY_FRAGMENT_SHADER);
			const layerQuad = makeLayerQuad();
			blendQuad.visible = false;
			blurQuad.visible = false;
			copyQuad.visible = false;
			layerQuad.visible = false;
			scene.add(blendQuad, blurQuad, copyQuad, layerQuad);

			const componentCamera = new THREE.OrthographicCamera(
				-width / 2,
				width / 2,
				height / 2,
				-height / 2,
				-10000,
				10000,
			);
			componentCamera.position.set(0, 0, 1000);
			componentCamera.lookAt(0, 0, 0);
			componentCamera.updateProjectionMatrix();

			return {
				accumA: makeRenderTarget(width, height),
				accumB: makeRenderTarget(width, height),
				layerRT: makeRenderTarget(width, height),
				tempRT: makeRenderTarget(width, height),
				blendQuad,
				blurQuad,
				copyQuad,
				layerQuad,
				scene,
				camera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1),
				componentCamera,
				backgroundTexture: null,
				layerTextures: new Map<string, { texture: THREE.CanvasTexture }>(),
				domSurfaces: new Map<string, DomTextSurface>(),
				pendingTextRepaints: new Set<string>(),
			};
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [width, height]);

		useEffect(() => {
			return () => {
				res.accumA.dispose();
				res.accumB.dispose();
				res.layerRT.dispose();
				res.tempRT.dispose();
				res.backgroundTexture?.dispose();
				for (const { texture } of res.layerTextures.values()) {
					texture.dispose();
				}
				res.layerTextures.clear();
				for (const surface of res.domSurfaces.values()) {
					surface.dispose();
				}
				res.domSurfaces.clear();
			};
		}, [res]);

		const layersRef = useRef(layers);
		layersRef.current = layers;
		const backgroundRef = useRef(background);
		backgroundRef.current = background;
		const repaintRafRef = useRef(0);
		const scheduleRecomposite = useMemo(
			() => () => {
				if (repaintRafRef.current) return;
				repaintRafRef.current = requestAnimationFrame(() => {
					repaintRafRef.current = 0;
					try {
						runComposite(
							gl,
							res,
							layersRef.current,
							backgroundRef.current,
							width,
							height,
							componentGroups,
							r3fScene,
							scheduleRecomposite,
						);
						onComposited?.();
					} catch (error) {
						onError?.(error);
					}
				});
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[gl, res, width, height, onComposited, onError],
		);

		const renderCompositeOnce = useMemo(
			() => () => {
				try {
					runComposite(
						gl,
						res,
						layersRef.current,
						backgroundRef.current,
						width,
						height,
						componentGroups,
						r3fScene,
						scheduleRecomposite,
					);
					onComposited?.();
					// 文字首帧 paint 是异步的：若仍有待捕获面，补一次合成
					if (
						res.pendingTextRepaints.size > 0 ||
						Array.from(res.domSurfaces.values()).some((s) => s.wantsRepaint)
					) {
						scheduleRecomposite();
					}
				} catch (error) {
					onError?.(error);
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[gl, res, width, height, onComposited, onError, scheduleRecomposite],
		);

		useImperativeHandle(
			ref,
			() => ({
				renderComposite: renderCompositeOnce,
			}),
			[renderCompositeOnce],
		);

		// 图层结构变化 → 提交后自动合成
		useEffect(() => {
			ref && (ref as any).current?.renderComposite();
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [layers, width, height]);

		return null;
	},
);
