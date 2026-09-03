/**
 * [INPUT]: 依赖 MotionRuntime、DomContentSurface、Three Object3D/ShaderMaterial 与 CanvasDrawElement。
 * [OUTPUT]: 提供 motion-runtime-harness.html 的 DOM/Three/Shader 同帧 seek 测试夹具与 window seam。
 * [POS]: demo 的动画 runtime 验证宿主；只供 Playwright 使用，不进入生产 Editor UI。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import {
	MotionRuntime,
	MotionTargetRegistry,
	type MotionTargetAdapter,
} from "@/runtime";
import { DomContentSurface } from "@/runtime/components/html-surface";
import "@/globals.css";

const WIDTH = 640;
const HEIGHT = 360;

type HarnessApi = {
	setTime: (seconds: number) => Promise<void>;
	advanceFrame: () => Promise<void>;
	getTextSegments: () => Array<{ id: string; x: number; opacity: number }>;
	getThreeState: () => { identity: string; x: number; rotationY: number };
	getShaderState: () => { identity: string; uProgress: number };
	getCanvasHashes: () => { dom: string; three: string };
};

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function adapter(
	kind: "dom" | "three" | "shader",
	targets: Record<string, object>,
	allowed: string[],
): MotionTargetAdapter {
	return {
		kind,
		resolveTarget: (ref) => targets[ref] ?? null,
		normalizePath: (path) => (kind === "shader" ? "value" : path),
		canAnimate: (path) => allowed.includes(path) || kind === "shader",
	};
}

function hashCanvas(canvas: HTMLCanvasElement): string {
	const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
	if (!data) return "";
	let hash = 2166136261;
	for (const value of data) hash = Math.imul(hash ^ value, 16777619);
	return (hash >>> 0).toString(16);
}

function MotionRuntimeHarness() {
	const domPreviewRef = useRef<HTMLCanvasElement>(null);
	const threeCanvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const domSurface = new DomContentSurface(320, 180, 1, 12);
		const spans = ["动", "画", "Runtime"].map((value, index) => {
			const span = document.createElement("span");
			span.dataset.segmentId = `g-${index}`;
			span.textContent = value;
			span.style.cssText = "display:inline-block;margin-right:8px;font:700 42px system-ui;color:#ffffff;transform-origin:50% 50%;";
			domSurface.contentElement.appendChild(span);
			return span;
		});
		domSurface.contentElement.style.cssText += "display:flex;align-items:center;justify-content:center;background:#182236;";

		const domPreview = domPreviewRef.current!;
		domPreview.width = 320;
		domPreview.height = 180;
		domPreview.style.cssText = "width:320px;height:180px;border:1px solid #3b82f6;";

		const threeCanvas = threeCanvasRef.current!;
		threeCanvas.width = WIDTH;
		threeCanvas.height = HEIGHT;
		threeCanvas.style.cssText = "width:640px;height:360px;border:1px solid #22c55e;";
		const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: false, alpha: false });
		renderer.setSize(WIDTH, HEIGHT, false);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color("#0b1220");
		const camera = new THREE.OrthographicCamera(-320, 320, 180, -180, 0.1, 100);
		camera.position.z = 10;
		const material = new THREE.ShaderMaterial({
			uniforms: { uProgress: { value: 0 } },
			vertexShader: "void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
			fragmentShader: "uniform float uProgress; void main(){gl_FragColor=vec4(0.1+uProgress*0.8,0.45,0.9-uProgress*0.5,1.0);}",
		});
		const object = new THREE.Mesh(new THREE.PlaneGeometry(160, 100), material);
		scene.add(object);

		const registry = new MotionTargetRegistry();
		registry.register(adapter("dom", { "text:g-0": spans[0] }, ["x", "opacity"]));
		registry.register(adapter("three", { "object:position": object.position, "object:rotation": object.rotation }, ["x", "y"]));
		registry.register(adapter("shader", { "material:main": material.uniforms.uProgress }, ["value"]));
		const runtime = new MotionRuntime(
			{
				schemaVersion: 1,
				durationSec: 1,
				mode: "once",
				tracks: [
					{ target: { kind: "dom", ref: "text:g-0" }, path: "x", blend: "replace", keys: [{ at: 0, value: -80 }, { at: 1, value: 0 }] },
					{ target: { kind: "dom", ref: "text:g-0" }, path: "opacity", blend: "replace", keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }] },
					{ target: { kind: "three", ref: "object:position" }, path: "x", blend: "replace", keys: [{ at: 0, value: -140 }, { at: 1, value: 140 }] },
					{ target: { kind: "three", ref: "object:rotation" }, path: "y", blend: "replace", keys: [{ at: 0, value: -0.6 }, { at: 1, value: 0.6 }] },
					{ target: { kind: "shader", ref: "material:main" }, path: "uniforms.uProgress", blend: "replace", keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }] },
				],
			},
			registry,
		);

		const render = async () => {
			renderer.render(scene, camera);
			domSurface.requestUpdate();
			await domSurface.waitForCapture();
			const source = domSurface.texture.image as HTMLCanvasElement;
			const context = domPreview.getContext("2d")!;
			context.clearRect(0, 0, domPreview.width, domPreview.height);
			context.drawImage(source, 0, 0, domPreview.width, domPreview.height);
		};
		const getDomX = (span: HTMLElement) => {
			const match = span.style.transform.match(/translate\(([-\d.]+)/);
			return Number.parseFloat(match?.[1] ?? "0");
		};
		const api: HarnessApi = {
			async setTime(seconds) {
				runtime.seek({ localTime: seconds });
				await render();
				await nextFrame();
				await render();
			},
			async advanceFrame() { await nextFrame(); },
			getTextSegments: () => spans.map((span) => ({ id: span.dataset.segmentId ?? "", x: getDomX(span), opacity: Number.parseFloat(span.style.opacity || "1") })),
			getThreeState: () => ({ identity: object.uuid, x: object.position.x, rotationY: object.rotation.y }),
			getShaderState: () => ({ identity: material.uuid, uProgress: Number(material.uniforms.uProgress.value) }),
			getCanvasHashes: () => ({ dom: hashCanvas(domPreview), three: hashCanvas(threeCanvas) }),
		};
		(window as unknown as { __recutAnimationHarness: HarnessApi }).__recutAnimationHarness = api;
		void render();
		return () => {
			runtime.dispose();
			domSurface.dispose();
			renderer.dispose();
			delete (window as unknown as { __recutAnimationHarness?: HarnessApi }).__recutAnimationHarness;
		};
	}, []);

	return (
		<main style={{ minHeight: "100vh", background: "#070b14", color: "white", padding: 24, fontFamily: "system-ui" }}>
			<h1>Motion Runtime Harness</h1>
			<p id="canvas-capability">CanvasDrawElement: {typeof HTMLCanvasElement.prototype.captureElementImage === "function" ? "enabled" : "disabled"}</p>
			<div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
				<div><h2>HTML-in-CANVAS</h2><canvas ref={domPreviewRef} data-motion-dom /></div>
				<div><h2>Three + Shader</h2><canvas ref={threeCanvasRef} data-motion-three /></div>
			</div>
		</main>
	);
}

createRoot(document.getElementById("root")!).render(<MotionRuntimeHarness />);
