/**
 * [INPUT]: 依赖 R3F Canvas、组件注册表与 World/WorldFrame 的解析结果。
 * [OUTPUT]: 对外提供 WorldScene；同时承载主预览与非交互的 render-target 快照 portal。
 * [POS]: runtime 的场景装配层；节点注册仅属于主预览，快照树与编辑交互严格隔离。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { componentsRegistry } from "./component-registry";
import { getRenderedNodeObject, registerNodeObject } from "./node-registry";
import { compositeFrame, type CompositeLayer } from "./blend-composite";
import { SceneTextureContext } from "./components/effects/shared/scene-texture";
import { PASSTHROUGH_VERTEX } from "./shader-effects/shared/glsl";
import { worldPosition, worldRotationZ } from "./components/plane";
import { HtmlObject } from "./components/html-object";
import { activeContentSurfaces } from "./components/html-surface";
import { waitForVisualMediaFrames } from "./texture";
import {
	ComponentErrorBoundary,
	ComponentErrorFallback,
} from "./error-boundary";
import { anim } from "./anim";
import {
	createThreeTransformAdapter,
	MotionTargetRegistry,
	selectMotionProgram,
} from "./motion-runtime";
import {
	FrameTimeContext,
	MotionProgramContext,
	useMotionProgram,
} from "./timeline";
import { ElementShaderHost } from "./shader-effects";
import type {
	ComponentRenderContext,
	ResolvedWorldObject,
	World,
	WorldFrame,
	WorldObject,
	WorldObjectKind,
} from "./types";

/** 正交相机对齐世界尺寸（R3F 不主动 updateProjectionMatrix）。 */
function CameraRig({ world }: { world: World }) {
	const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
	useEffect(() => {
		camera.left = -world.width / 2;
		camera.right = world.width / 2;
		camera.top = world.height / 2;
		camera.bottom = -world.height / 2;
		camera.near = -10000;
		camera.far = 10000;
		camera.position.set(0, 0, 1000);
		camera.lookAt(0, 0, 0);
		camera.updateProjectionMatrix();
	}, [camera, world.width, world.height]);
	return null;
}

/**
 * 场景背景：普通世界用 environment.background 不透明填充；
 * "transparent"（封面透明捕获等）时 scene.background 置空并用 alpha 0 clear，
 * 让 canvas.toDataURL 输出带 alpha 的 PNG（组件 DOM 纹理的透明区透出）。
 */
function SceneBackground({ background }: { background: string }) {
	const gl = useThree((state) => state.gl);
	useEffect(() => {
		if (background === "transparent") {
			gl.setClearColor(0x000000, 0);
		} else {
			gl.setClearColor(background, 1);
		}
	}, [gl, background]);
	if (background === "transparent") return null;
	return <color attach="background" args={[background]} />;
}

function isEffectObject(resolved: ResolvedWorldObject): boolean {
	const { object } = resolved;
	if (object.kind !== "component" || !object.componentId) return false;
	const state = componentsRegistry.getState(object.componentId);
	if (state?.status !== "loaded" || state.definition.category !== "effect") return false;
	// 内容型组件（group: bg/scene/demo，程序化生成"提供内容"）按普通 layer 参与轨道序，
	// 背景垫底、上层元素可见；只有纯覆盖特效（无 group）才进最上层 effects 通道。
	return !state.definition.group;
}

/**
 * 场景捕获：每帧把底层内容（content group）渲染进 WebGLRenderTarget。
 * 渲染到 target 时 three 强制 outputColorSpace=LinearSRGB（内容为 linear），
 * 因此加一个 linear→sRGB 编码 pass，让特效纹理与画布显示一致 ——
 * remotion-kit 的 post shader（按 sRGB 纹理假设）可原样使用，无需逐 shader 改色域。
 * content 之外的 children（特效）不进入目标，避免自递归。useFrame 在 R3F
 * 场景绘制前运行，因此特效平面当帧即可读到最新内容。
 * contentTexture 存在时（混合模式合成管线提供已编码内容）不再自捕获。
 */
function SceneCapture({
	world,
	content,
	children,
	contentTexture = null,
}: {
	world: World;
	content: React.ReactNode;
	children: React.ReactNode;
	contentTexture?: THREE.Texture | null;
}) {
	const { gl, camera } = useThree();
	const contentRef = useRef<THREE.Group>(null);
	const linearTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
	const srgbTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
	const encodeSceneRef = useRef<THREE.Scene | null>(null);
	const [texture, setTexture] = useState<THREE.Texture | null>(null);

	useLayoutEffect(() => {
		// 合成管线（非 normal 混合模式）提供已 sRGB 编码的内容纹理：不自捕获。
		if (contentTexture) {
			linearTargetRef.current?.dispose();
			srgbTargetRef.current?.dispose();
			linearTargetRef.current = null;
			srgbTargetRef.current = null;
			encodeSceneRef.current = null;
			setTexture(contentTexture);
			return;
		}
		const options = {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			depthBuffer: true,
			stencilBuffer: false,
		};
		linearTargetRef.current?.dispose();
		srgbTargetRef.current?.dispose();
		const linear = new THREE.WebGLRenderTarget(world.width, world.height, options);
		const srgb = new THREE.WebGLRenderTarget(world.width, world.height, options);

		// linear→sRGB 编码 pass：全屏 quad 采样 linear target，输出 pow(1/2.2)。
		const encodeScene = new THREE.Scene();
		const encodeGeometry = new THREE.PlaneGeometry(world.width, world.height);
		const encodeMaterial = new THREE.ShaderMaterial({
			vertexShader: PASSTHROUGH_VERTEX,
			fragmentShader: `
				varying vec2 vUv;
				uniform sampler2D uMap;
				void main() {
					vec3 c = texture2D(uMap, vUv).rgb;
					gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
				}
			`,
			uniforms: { uMap: new THREE.Uniform(linear.texture) },
			toneMapped: false,
		});
		const encodeMesh = new THREE.Mesh(encodeGeometry, encodeMaterial);
		encodeMesh.frustumCulled = false;
		encodeScene.add(encodeMesh);

		linearTargetRef.current = linear;
		srgbTargetRef.current = srgb;
		encodeSceneRef.current = encodeScene;
		setTexture(srgb.texture);
		return () => {
			linear.dispose();
			srgb.dispose();
			encodeGeometry.dispose();
			encodeMaterial.dispose();
			linearTargetRef.current = null;
			srgbTargetRef.current = null;
			encodeSceneRef.current = null;
		};
	}, [world.width, world.height, contentTexture]);

	useFrame(() => {
		if (contentTexture) return;
		const content = contentRef.current;
		const linear = linearTargetRef.current;
		const srgb = srgbTargetRef.current;
		const encodeScene = encodeSceneRef.current;
		if (!content || !linear || !srgb || !encodeScene) return;

		const previousClear = new THREE.Color();
		gl.getClearColor(previousClear);
		const previousAlpha = gl.getClearAlpha();

		// 透明捕获（封面等）：world.environment.background === "transparent" 时用 alpha 0 clear。
		const transparent = world.environment.background === "transparent";

		// pass 1：内容 → linear target。先切 target 再 setClearColor，让背景按
		// workingColorSpace(linear) 写入，与 linear 内容一致。
		gl.setRenderTarget(linear);
		gl.setClearColor(transparent ? 0x000000 : world.environment.background, transparent ? 0 : 1);
		gl.render(content, camera);

		// pass 2：linear → sRGB target（特效采样用）。
		const previousAutoClear = gl.autoClear;
		gl.autoClear = false;
		gl.setRenderTarget(srgb);
		gl.render(encodeScene, camera);
		gl.autoClear = previousAutoClear;

		gl.setRenderTarget(null);
		gl.setClearColor(previousClear, previousAlpha);
	});

	return (
		<SceneTextureContext.Provider value={texture}>
			<group ref={contentRef}>{content}</group>
			{children}
		</SceneTextureContext.Provider>
	);
}

/** frameloop="always"：R3F 持续绘制当前场景状态，Runtime 驱动的 React 重渲即时生效。 */
function resolveComponentId(kind: WorldObjectKind, componentId?: string): string {
	return kind === "component" ? (componentId ?? kind) : kind;
}

/** 组件注册表变化（异步加载完成/失败）时强制重渲，让刚加载的 AI 组件即时上屏。 */
function useComponentRegistryTick(): void {
	const [, force] = useState(0);
	useEffect(() => componentsRegistry.subscribe(() => force((n) => n + 1)), []);
}

/**
 * 基础变换由父 group 保持；预设只驱动这层 identity transform。
 * 这消除了 React props 与 GSAP 对同一 Object3D 争写的特殊情况，且 motion 值天然是相对基础姿态的偏移。
 */
function MotionTransformLayer({
	program,
	children,
}: {
	program: ResolvedWorldObject["object"]["motionProgram"];
	children: React.ReactNode;
}) {
	const groupRef = useRef<THREE.Group>(null);
	const createRegistry = useCallback(() => {
		const group = groupRef.current;
		if (!group) throw new Error("motion-three-target-unmounted");
		const registry = new MotionTargetRegistry();
		registry.register(createThreeTransformAdapter({ "object:root": group }));
		return registry;
	}, []);

	const threeProgram = useMemo(() => selectMotionProgram(program, "three"), [program]);
	const shaderProgram = useMemo(() => selectMotionProgram(program, "shader"), [program]);
	useMotionProgram(threeProgram, createRegistry);
	return (
		<group ref={groupRef}>
			{children}
			<ElementShaderHost groupRef={groupRef} program={shaderProgram} />
		</group>
	);
}

function WorldObjectView({
	world,
	frame,
	resolved,
	registerNode = true,
	bindRoot,
}: {
	world: World;
	frame: WorldFrame;
	resolved: ResolvedWorldObject;
	/** 快照场景不属于编辑交互树，绝不写入 node registry。 */
	registerNode?: boolean;
	/** 快照 pass 用：把根节点登记到调用方自己的 Map（供合成管线切换可见性）。 */
	bindRoot?: (id: string, node: THREE.Group | null) => void;
}) {
	const object = resolved.object;
	const componentId = resolveComponentId(object.kind, object.componentId);
	const state = componentsRegistry.getState(componentId);
	const { scaleX, scaleY, rotationZ } = object.transform;
	// WorldScene 因后台 snapshot commit 会重渲；ref 需保持身份稳定，不能让 React 先
	// null 再注册同一个 Object3D，否则 registry 的短暂空洞会让 selection 闪一下。
	const registerRef = useCallback(
		(group: THREE.Group | null) => {
			if (registerNode) registerNodeObject(object.id, group);
			bindRoot?.(object.id, group);
		},
		[object.id, registerNode, bindRoot],
	);
	const progress =
		object.duration > 0
			? Math.min(1, Math.max(0, resolved.localTime / object.duration))
			: 0;
	const ctx: ComponentRenderContext = {
		world,
		object,
		params: resolved.params,
		time: frame.time,
		localTime: resolved.localTime,
		progress,
		anim,
	};
	if (!state || state.status !== "loaded") {
		// 未知或尚未加载的组件：保留稳定动画层与 wrapper（占位），绝不裸 get() 抛错。
		return (
			<group
				position={worldPosition(object.transform)}
				scale={[scaleX, scaleY, 1]}
				rotation={[0, 0, worldRotationZ(rotationZ)]}
				ref={registerRef}
			>
				<MotionProgramContext.Provider value={object.motionProgram}>
				<FrameTimeContext.Provider value={ctx}>
					<MotionTransformLayer program={object.motionProgram}>
						{/* 空内容保持 Object3D 身份，待组件异步加载后原地填充。 */}
						{null}
					</MotionTransformLayer>
				</FrameTimeContext.Provider>
				</MotionProgramContext.Provider>
			</group>
		);
	}
	const definition = state.definition;
	const Render = definition.render;
	const isHtmlSurface =
		definition.surface === "html" || definition.surface === "react";
	return (
		<group
			position={worldPosition(object.transform)}
			scale={[scaleX, scaleY, 1]}
			rotation={[0, 0, worldRotationZ(rotationZ)]}
			ref={registerRef}
		>
			<MotionProgramContext.Provider value={object.motionProgram}>
			<FrameTimeContext.Provider value={ctx}>
				<MotionTransformLayer program={object.motionProgram}>
					<ComponentErrorBoundary
						name={definition.name}
						fallback={<ComponentErrorFallback object={object} />}
					>
						{isHtmlSurface ? (
							<HtmlObject
								definition={definition}
								ctx={ctx}
								notifyBounds={registerNode}
							/>
						) : (
							<Render {...ctx} />
						)}
					</ComponentErrorBoundary>
				</MotionTransformLayer>
			</FrameTimeContext.Provider>
			</MotionProgramContext.Provider>
		</group>
	);
}

interface SnapshotFrame {
	id: number;
	world: World;
	frame: WorldFrame;
}

/**
 * 帧导演：正优先级 useFrame 接管 R3F 默认渲染（internal.priority > 0 时 R3F 跳过 auto render）。
 * - 无非 normal 混合：直接 gl.render(scene, camera) —— 与 R3F auto render 等价，像素不变；
 * - 有非 normal 混合：blend-composite 管线（17 模式顺序合成），全画布特效叠在最终结果之上。
 */
function BlendCompositor({
	world,
	frame,
	onEffectContent,
}: {
	world: World;
	frame: WorldFrame;
	onEffectContent: (texture: THREE.Texture | null) => void;
}) {
	const gl = useThree((state) => state.gl);
	const scene = useThree((state) => state.scene);
	const camera = useThree((state) => state.camera);

	const entries = useMemo(() => {
		const layers: Array<{ object: WorldObject; root: THREE.Object3D | null }> = [];
		const effects: Array<{ object: WorldObject; root: THREE.Object3D | null }> = [];
		for (const resolved of frame.objects) {
			const entry = {
				object: resolved.object,
				root: getRenderedNodeObject(resolved.object.id),
			};
			(isEffectObject(resolved) ? effects : layers).push(entry);
		}
		layers.sort((a, b) => a.object.renderOrder - b.object.renderOrder);
		return { layers, effects };
	}, [frame.objects]);

	const hasBlend = entries.layers.some(
		(entry) => (entry.object.blendMode ?? "normal") !== "normal",
	);
	const lastContentTextureRef = useRef<THREE.Texture | null>(null);

	useFrame(() => {
		const layerRoots: CompositeLayer[] = [];
		for (const entry of entries.layers) {
			if (entry.root) {
				layerRoots.push({
					root: entry.root,
					blendMode: entry.object.blendMode ?? "normal",
				});
			}
		}
		const effectRoots: THREE.Object3D[] = [];
		for (const entry of entries.effects) {
			if (entry.root) effectRoots.push(entry.root);
		}

		if (!hasBlend) {
			// 管线未激活：恢复恒真可见（防上一帧管线残留），再等价于 R3F auto render。
			for (const entry of [...entries.layers, ...entries.effects]) {
				if (entry.root) entry.root.visible = true;
			}
			gl.render(scene, camera);
			if (lastContentTextureRef.current !== null) {
				lastContentTextureRef.current = null;
				onEffectContent(null);
			}
			return;
		}

		try {
			const output = compositeFrame({
				gl,
				scene,
				camera,
				layers: layerRoots,
				effectRoots,
				background: world.environment.background,
				width: world.width,
				height: world.height,
				target: null,
				needContent: effectRoots.length > 0,
			});
			const contentTexture =
				effectRoots.length > 0 ? output.effectContent.texture : null;
			if (contentTexture !== lastContentTextureRef.current) {
				lastContentTextureRef.current = contentTexture;
				onEffectContent(contentTexture);
			}
		} catch (error) {
			// 管线异常时回退到直接前向渲染（混合被忽略，但画面完整、不残留中间态）。
			console.error("[blend-composite] pipeline failed; fallback to direct render", error);
			for (const entry of [...entries.layers, ...entries.effects]) {
				if (entry.root) entry.root.visible = true;
			}
			gl.render(scene, camera);
		}
	}, 1);

	return null;
}

function waitForAnimationFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * 同 context 首帧快照：R3F portal 把 t=0 的对象树放进独立 THREE.Scene，
 * 随后仅把该 scene 渲染进 WebGLRenderTarget。它从不挂进主 scene，也不注册节点，
 * 所以快照生命周期与预览/选择/播放头完全正交。
 */
function SnapshotPass({
	snapshot,
	onComplete,
}: {
	snapshot: SnapshotFrame | null;
	onComplete: (id: number, dataUrl: string | null) => void;
}) {
	const { gl, invalidate } = useThree();
	const snapshotScene = useMemo(() => new THREE.Scene(), []);
	const snapshotCamera = useMemo(() => new THREE.OrthographicCamera(), []);
	const targetRef = useRef<THREE.WebGLRenderTarget | null>(null);
	// 快照视图的根节点（不进 node registry）：供混合合成管线逐层切换可见性。
	const snapshotRootsRef = useRef(new Map<string, THREE.Object3D>());
	const bindSnapshotRoot = useCallback((id: string, node: THREE.Group | null) => {
		if (node) snapshotRootsRef.current.set(id, node);
		else snapshotRootsRef.current.delete(id);
	}, []);
	// 混合模式快照：特效需要采样「已合成」的内容（与主预览的 BlendCompositor 同语义）。
	const [effectContentTexture, setEffectContentTexture] = useState<
		THREE.Texture | null
	>(null);

	useLayoutEffect(() => {
		if (!snapshot) return;
		const { width, height } = snapshot.world;
		snapshotCamera.left = -width / 2;
		snapshotCamera.right = width / 2;
		snapshotCamera.top = height / 2;
		snapshotCamera.bottom = -height / 2;
		snapshotCamera.near = -10000;
		snapshotCamera.far = 10000;
		snapshotCamera.position.set(0, 0, 1000);
		snapshotCamera.lookAt(0, 0, 0);
		snapshotCamera.updateProjectionMatrix();

		const target = targetRef.current;
		if (target && (target.width !== width || target.height !== height)) {
			target.dispose();
			targetRef.current = null;
		}
		if (!targetRef.current) {
			targetRef.current = new THREE.WebGLRenderTarget(width, height, {
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				depthBuffer: true,
				stencilBuffer: false,
			});
			// target 直接被读回 2D canvas，必须按显示输出编码，不能留下 linear 像素。
			targetRef.current.texture.colorSpace = THREE.SRGBColorSpace;
		}
		snapshotScene.background =
			snapshot.world.environment.background === "transparent"
				? null
				: new THREE.Color(snapshot.world.environment.background);
	}, [snapshot, snapshotCamera, snapshotScene]);

	useEffect(
		() => () => {
			targetRef.current?.dispose();
			targetRef.current = null;
		},
		[],
	);

	const contentObjects = useMemo(
		() => snapshot?.frame.objects.filter((resolved) => !isEffectObject(resolved)) ?? [],
		[snapshot],
	);
	const effectObjects = useMemo(
		() => snapshot?.frame.objects.filter((resolved) => isEffectObject(resolved)) ?? [],
		[snapshot],
	);
	const contentViews = contentObjects.map((resolved) => (
		<WorldObjectView
			key={resolved.object.id}
			world={snapshot!.world}
			frame={snapshot!.frame}
			resolved={resolved}
			registerNode={false}
			bindRoot={bindSnapshotRoot}
		/>
	));
	const effectViews = effectObjects.map((resolved) => (
		<WorldObjectView
			key={resolved.object.id}
			world={snapshot!.world}
			frame={snapshot!.frame}
			resolved={resolved}
			registerNode={false}
			bindRoot={bindSnapshotRoot}
		/>
	));

	useEffect(() => {
		if (!snapshot) return;
		let cancelled = false;

		const capture = async () => {
			try {
				// 等 portal commit、HTML/React DOM 捕获与一次 R3F frame；不更改主预览帧。
				await waitForAnimationFrame();
				await Promise.all(
					[...activeContentSurfaces].map((surface) => surface.waitForCapture()),
				);
				await waitForVisualMediaFrames();
				invalidate();
				await waitForAnimationFrame();
				if (cancelled) return;

				const target = targetRef.current;
				if (!target) {
					onComplete(snapshot.id, null);
					return;
				}
				const { width, height } = snapshot.world;

				const previousTarget = gl.getRenderTarget();
				const previousClear = new THREE.Color();
				const previousAlpha = gl.getClearAlpha();
				const previousViewport = gl.getViewport(new THREE.Vector4());
				const previousScissor = gl.getScissor(new THREE.Vector4());
				const previousScissorTest = gl.getScissorTest();
				const previousAutoClear = gl.autoClear;
				gl.getClearColor(previousClear);

				try {
					gl.autoClear = true;
					gl.setRenderTarget(target);
					gl.setClearColor(
						snapshot.world.environment.background === "transparent"
							? 0x000000
							: snapshot.world.environment.background,
						snapshot.world.environment.background === "transparent" ? 0 : 1,
					);
					gl.clear(true, true, true);

					const hasBlend = contentObjects.some(
						(resolved) => (resolved.object.blendMode ?? "normal") !== "normal",
					);
					if (!hasBlend) {
						gl.render(snapshotScene, snapshotCamera);
					} else {
						// 混合模式快照：与主预览同一顺序 RT 合成管线（17 模式）。
						const layers: CompositeLayer[] = [];
						for (const resolved of contentObjects) {
							const root = snapshotRootsRef.current.get(resolved.object.id);
							if (root) {
								layers.push({
									root,
									blendMode: resolved.object.blendMode ?? "normal",
								});
							}
						}
						const effectRoots: THREE.Object3D[] = [];
						for (const resolved of effectObjects) {
							const root = snapshotRootsRef.current.get(resolved.object.id);
							if (root) effectRoots.push(root);
						}
						const output = compositeFrame({
							gl,
							scene: snapshotScene,
							camera: snapshotCamera,
							layers,
							effectRoots: [],
							background: snapshot.world.environment.background,
							width,
							height,
							target,
							needContent: false,
						});
						if (effectRoots.length > 0) {
							// 特效 shader 需采样「已合成」内容：替换 context，等材质 uniform 更新。
							setEffectContentTexture(output.effectContent.texture);
							invalidate();
							await waitForAnimationFrame();
							if (cancelled) return;
							// 特效视图叠加在合成结果之上（不清屏）。
							for (const [, root] of snapshotRootsRef.current) root.visible = false;
							for (const root of effectRoots) root.visible = true;
							const sceneBg = snapshotScene.background;
							snapshotScene.background = null;
							gl.autoClear = false;
							gl.render(snapshotScene, snapshotCamera);
							gl.autoClear = true;
							for (const [, root] of snapshotRootsRef.current) root.visible = true;
							snapshotScene.background = sceneBg;
						}
					}

					const pixels = new Uint8Array(target.width * target.height * 4);
					gl.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
					const output = document.createElement("canvas");
					output.width = target.width;
					output.height = target.height;
					const context = output.getContext("2d");
					if (!context) {
						onComplete(snapshot.id, null);
						return;
					}
					const image = context.createImageData(target.width, target.height);
					for (let y = 0; y < target.height; y += 1) {
						const sourceOffset = y * target.width * 4;
						const targetOffset = (target.height - y - 1) * target.width * 4;
						image.data.set(
							pixels.subarray(sourceOffset, sourceOffset + target.width * 4),
							targetOffset,
						);
					}
					context.putImageData(image, 0, 0);
					onComplete(snapshot.id, output.toDataURL("image/png"));
				} finally {
					gl.autoClear = previousAutoClear;
					gl.setRenderTarget(previousTarget);
					gl.setClearColor(previousClear, previousAlpha);
					gl.setViewport(previousViewport);
					gl.setScissor(previousScissor);
					gl.setScissorTest(previousScissorTest);
				}
			} catch (error) {
				console.warn("[WorldRenderer] snapshot pass failed:", error);
				if (!cancelled) onComplete(snapshot.id, null);
			}
		};

		void capture();
		return () => {
			cancelled = true;
		};
	}, [gl, invalidate, onComplete, snapshot, snapshotCamera, snapshotScene]);

	if (!snapshot) return null;
	const children = (
		<>
			<ambientLight intensity={0.15} />
			{effectViews.length > 0 ? (
				<SceneCapture
					world={snapshot.world}
					content={contentViews}
					contentTexture={effectContentTexture}
				>
					{effectViews}
				</SceneCapture>
			) : (
				contentViews
			)}
		</>
	);
	return createPortal(children, snapshotScene);
}

/**
 * demand frameloop 的帧失效器：WorldScene 每次 React 提交后 invalidate 一次，
 * R3F 在下一帧 rAF 绘制。与 HtmlObject 的捕获失效（texture 就绪才重绘）合并，
 * 保证绘制总发生在当前帧 DOM 捕获完成之后——对齐 remotion-kit 的 RemotionFrameInvalidator。
 * 对齐 remotion-kit HtmlSurfacePlane 的 captureVersion → invalidate 语义。
 */
function FrameInvalidator() {
	const invalidate = useThree((state) => state.invalidate);
	useLayoutEffect(() => {
		invalidate();
	});
	return null;
}

/**
 * 世界场景宿主：R3F 拥有整个场景，组件即对象，材质混合 / 深度排序由引擎处理。
 * frameloop="demand"：每次 React 提交（帧变化/组件加载/纹理捕获）后 invalidate，
 * R3F 才绘制——纹理未就绪时不渲染，避免 html/react 承载面闪动（同 remotion-kit）。
 * 特效组件（category === "effect"）渲染在最上层，经 SceneCapture 采样底层内容。
 */
export function WorldScene({
	world,
	frame,
	canvas,
	snapshot = null,
	onSnapshotComplete,
}: {
	world: World;
	frame: WorldFrame;
	/** 可选：输出到指定 canvas（预览挂载 / 导出读帧）。缺省 R3F 自建。 */
	canvas?: HTMLCanvasElement;
	/** 同 context 的隔离快照；仅常驻预览 renderer 注入。 */
	snapshot?: SnapshotFrame | null;
	onSnapshotComplete?: (id: number, dataUrl: string | null) => void;
}) {
	useComponentRegistryTick();
	// 混合模式合成管线产出的全画布特效内容纹理（sRGB）。无特效/无非 normal 混合时为 null。
	const [effectContentTexture, setEffectContentTexture] = useState<
		THREE.Texture | null
	>(null);
	const handleEffectContent = useCallback(
		(texture: THREE.Texture | null) => setEffectContentTexture(texture),
		[],
	);
	const contentObjects = useMemo(
		() => frame.objects.filter((resolved) => !isEffectObject(resolved)),
		[frame.objects],
	);
	const effectObjects = useMemo(
		() => frame.objects.filter((resolved) => isEffectObject(resolved)),
		[frame.objects],
	);

	const contentViews = contentObjects.map((resolved) => (
		<WorldObjectView
			key={resolved.object.id}
			world={world}
			frame={frame}
			resolved={resolved}
		/>
	));
	const effectViews = effectObjects.map((resolved) => (
		<WorldObjectView
			key={resolved.object.id}
			world={world}
			frame={frame}
			resolved={resolved}
		/>
	));

	return (
		<Canvas
			frameloop="demand"
			dpr={1}
			// 剪辑器处理的是已编码的 SDR 媒体，不是 HDR 3D 光照场景。R3F 默认的
			// ACES Filmic 会二次压缩白位和中间调，使屏幕录制像蒙灰；保持直通。
			flat
			orthographic
			camera={{
				position: [0, 0, 1000],
				left: -world.width / 2,
				right: world.width / 2,
				top: world.height / 2,
				bottom: -world.height / 2,
				near: -10000,
				far: 10000,
			}}
			// 不能传入 canvas: undefined：R3F 会把它展开进 WebGLRenderer 参数，
			// 覆盖自身挂载的 canvas，渲染器遂画到未接入 DOM 的画布而只留下黑底。
			gl={{
				...(canvas ? { canvas } : {}),
				antialias: true,
				alpha: true,
				preserveDrawingBuffer: true,
			}}
			onCreated={({ gl }) => {
				gl.domElement.style.width = "100%";
				gl.domElement.style.height = "100%";
				gl.domElement.style.display = "block";
			}}
		>
			<SceneBackground background={world.environment.background} />
			<CameraRig world={world} />
			<FrameInvalidator />
			{onSnapshotComplete ? (
				<SnapshotPass snapshot={snapshot} onComplete={onSnapshotComplete} />
			) : null}
			{/* 弱基准光；组件自发光源（spline 自带 π 环境光/方向光 + Lightformer）。 */}
			<ambientLight intensity={0.15} />
			{effectViews.length > 0 ? (
				<SceneCapture
					world={world}
					content={contentViews}
					contentTexture={effectContentTexture}
				>
					{effectViews}
				</SceneCapture>
			) : (
				contentViews
			)}
			<BlendCompositor
				world={world}
				frame={frame}
				onEffectContent={handleEffectContent}
			/>
		</Canvas>
	);
}
