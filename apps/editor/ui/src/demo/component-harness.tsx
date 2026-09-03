import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	VisualRuntime,
	WorldScene,
	componentsRegistry,
	ensureComponent,
	ensureRuntimeHost,
	installComponentResolver,
	registerBuiltinComponents,
} from "@/runtime";
import { captureComponentCover } from "@/recut/component-cover";
import {
	getRenderedNodeBounds,
	getRenderedNodeObject,
} from "@/runtime/node-registry";
import { buildTransformFromParams } from "@/rendering";
import { isHtmlInCanvasSupported } from "@/three/dom-text-surface";
import type { ElementMotion, MotionProgram, TextMotionBinding, World, WorldFrame } from "@/runtime";

/**
 * [INPUT]: 运行时组件 bundle、WorldScene 与节点 bbox 查询
 * [OUTPUT]: window.__recutHarness 的组件渲染、封面捕获、几何与 Motion transform 测试接口
 * [POS]: demo 的浏览器回归测试宿主，被 AI 组件 Playwright 用例消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

/**
 * /component-harness.html：AI 临时组件渲染链路验证宿主。
 * setComponent(注入 bundle) → installComponentResolver → ensureComponent(blob import + prelude) →
 * buildWorld → VisualRuntime.evaluate(t) → WorldScene(R3F)。供 Playwright 端到端断言。
 */
registerBuiltinComponents();

interface HarnessComponent {
	componentId: string;
	name: string;
	surface: string;
	inputs: Array<{ key: string; default: unknown }>;
	/** AI 组件 bundle；平台内置组件（registerBuiltinComponents 已注册）可省略。 */
	bundle?: string;
	bundleHash?: string;
	motionProgram?: MotionProgram;
	motion?: ElementMotion;
	textMotion?: TextMotionBinding;
}

interface HarnessState {
	status: string;
	error?: string;
	surface?: string;
	htmlInCanvas: boolean;
}

const state: { comp: HarnessComponent | null } = { comp: null };
const runtime = new VisualRuntime();
// ?transparent=1：封面等透明捕获（WorldScene 的 "transparent" 背景支持）。
const transparentBackground =
	new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("transparent") === "1";

function waitFrames(n: number): Promise<void> {
	return new Promise<void>((resolve) => {
		let count = 0;
		const tick = () => {
			count += 1;
			if (count >= n) resolve();
			else requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

function Harness() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [world, setWorld] = useState<World | null>(null);
	const [frame, setFrame] = useState<WorldFrame | null>(null);
	const lastRef = useRef<HarnessState>({ status: "idle", htmlInCanvas: false });

const win = (window as unknown) as Record<string, unknown>;
win.__recutHarness = {
		supported: () => ({ htmlInCanvas: isHtmlInCanvasSupported() }),
		setComponent: (comp: HarnessComponent) => {
			state.comp = comp;
			// 内置组件（registerBuiltinComponents 已注册）直接命中 registry，不走 bundle resolver。
			const isBuiltin = componentsRegistry.has(comp.componentId);
			installComponentResolver((componentId) =>
				!isBuiltin && componentId === comp.componentId
					? Promise.resolve({
							componentId: comp.componentId,
							name: comp.name,
							surface: comp.surface,
							inputs: comp.inputs,
							bundle: comp.bundle,
							bundleHash: comp.bundleHash,
						})
					: Promise.resolve(null),
			);
			lastRef.current = { status: "set", htmlInCanvas: isHtmlInCanvasSupported() };
			return true;
		},
		render: async (t: number, duration = 5) => {
			const comp = state.comp;
			if (!comp) {
				lastRef.current = { status: "no-component", htmlInCanvas: isHtmlInCanvasSupported() };
				return lastRef.current;
			}
			try {
				await ensureRuntimeHost();
				const definition = await ensureComponent(comp.componentId);
				const params: Record<string, string | number | boolean> = {};
				for (const input of comp.inputs || []) {
					params[input.key] = input.default as string | number | boolean;
				}
				const nextWorld: World = {
					id: "harness",
					width: 640,
					height: 360,
					fps: 30,
					duration,
					environment: { background: transparentBackground ? "transparent" : "#101014" },
					objects: [
						{
							id: "c1",
							kind: "component",
							componentId: comp.componentId,
							name: comp.name,
							startTime: 0,
							duration,
						params,
						motionProgram: comp.motionProgram,
						motion: comp.motion,
						textMotion: comp.textMotion,
						transform: {
							position: { x: 0, y: 0, z: 0 },
							scaleX: 1,
							scaleY: 1,
							rotationZ: 0,
						},
						renderOrder: 0,
						},
					],
				};
				runtime.load(nextWorld);
				setWorld(nextWorld);
				setFrame(runtime.evaluate(t));
				await waitFrames(3);
				lastRef.current = {
					status: "rendered",
					surface: definition.surface,
					htmlInCanvas: isHtmlInCanvasSupported(),
				};
			} catch (error) {
				lastRef.current = {
					status: "failed",
					error: String((error && error.message) || error),
					htmlInCanvas: isHtmlInCanvasSupported(),
				};
			}
			return lastRef.current;
		},
		getStatus: () => lastRef.current,
		hasNodeObject: () => getRenderedNodeObject("c1") != null,
		getNodeBounds: () =>
			getRenderedNodeBounds({
				elementId: "c1",
				canvasWidth: 640,
				canvasHeight: 360,
				transform: buildTransformFromParams({ params: {} }),
			}),
		getMotionTransform: () => {
			const motion = getRenderedNodeObject("c1")?.children[0];
			return motion
				? { identity: motion.uuid, x: motion.position.x, y: motion.position.y }
				: null;
		},
		readPixel: (x: number, y: number) => {
			const canvas = canvasRef.current;
			if (!canvas) return null;
			const out = document.createElement("canvas");
			out.width = canvas.width;
			out.height = canvas.height;
			const ctx = out.getContext("2d");
			if (!ctx) return null;
			ctx.drawImage(canvas, 0, 0);
			return Array.from(ctx.getImageData(x, y, 1, 1).data);
		},
		countNonBackground: (x: number, y: number, w: number, h: number) => {
			const canvas = canvasRef.current;
			if (!canvas) return 0;
			const out = document.createElement("canvas");
			out.width = canvas.width;
			out.height = canvas.height;
			const ctx = out.getContext("2d");
			if (!ctx) return 0;
			ctx.drawImage(canvas, 0, 0);
			const data = ctx.getImageData(x, y, w, h).data;
			let count = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i + 3] > 16 && !(Math.abs(data[i] - 16) < 8 && Math.abs(data[i + 1] - 16) < 8 && Math.abs(data[i + 2] - 20) < 8)) {
					count += 1;
				}
			}
			return count;
		},
		getCanvas: () =>
			canvasRef.current
				? { width: canvasRef.current.width, height: canvasRef.current.height }
				: null,
		capturePng: () => canvasRef.current?.toDataURL("image/png") ?? null,
		captureBuiltinCover: async (componentId: string) => {
			const definition = await ensureComponent(componentId);
			const captured = await captureComponentCover({
				componentId,
				name: definition.name,
				surface: definition.surface ?? "r3f",
				inputs: definition.inputs.map((input) => ({
					key: input.key,
					default: input.default,
				})),
			});
			return captured?.dataUrl ?? null;
		},
	};

	return (
		<div style={{ width: 640, height: 360, position: "relative" }}>
			<canvas
				ref={canvasRef}
				width={640}
				height={360}
				style={{ width: 640, height: 360 }}
				data-recut-harness-canvas
			/>
			{world && frame && canvasRef.current ? (
				<WorldScene world={world} frame={frame} canvas={canvasRef.current} />
			) : null}
		</div>
	);
}

void ensureRuntimeHost();
createRoot(document.getElementById("root")!).render(<Harness />);
