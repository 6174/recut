import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { World } from "@/runtime";
import {
	buildWorld,
	registerBuiltinComponents,
	VisualRuntime,
	WorldScene,
} from "@/runtime";
import { TICKS_PER_SECOND } from "@/wasm";
import { buildDemoProject } from "../demo-project";
import { generateDemoImage, generateDemoVideo } from "../demo-media";

/**
 * /world.html：Visual Runtime 垂直切片演示。
 * 时间线（buildDemoProject）→ buildWorld → VisualRuntime.evaluate(time) → WorldScene(R3F)。
 * 加入一个真 3D 内置组件（glow-box：mesh + material + 点光源），验证组件即对象。
 */
registerBuiltinComponents();

class ErrorBoundary extends Component<
	{ children: ReactNode },
	{ error: Error | null }
> {
	state: { error: Error | null } = { error: null };
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	render() {
		if (this.state.error) {
			return (
				<pre style={{ color: "#ff7777", padding: 20, whiteSpace: "pre-wrap" }}>
					{this.state.error.message}
					{"\n\n"}
					{this.state.error.stack}
				</pre>
			);
		}
		return this.props.children;
	}
}

function buildFallbackWorld(): World {
	return {
		id: "fallback",
		width: 1920,
		height: 1080,
		fps: 30,
		duration: 8,
		environment: { background: "#f6f1ea" },
		objects: [
			{
				id: "fb-spline",
				kind: "component",
				componentId: "spline-scene",
				name: "Spline Scene",
				startTime: 0,
				duration: 8,
				params: { scale: 110, speed: 1 },
				transform: { position: { x: 0, y: 0, z: 0 }, scaleX: 1, scaleY: 1, rotationZ: 0 },
				renderOrder: 0,
			},
		],
	};
}

/** 用 demo 项目时间线构建真实世界（含视频 / 文本 / 图片 + 3D 组件）。 */
async function buildProjectWorld(): Promise<World> {
	const [imageAsset, videoAsset] = await Promise.all([
		generateDemoImage(),
		generateDemoVideo(),
	]);
	const assets = [imageAsset, videoAsset];
	const project = buildDemoProject(assets);
	const scene = project.scenes[0];
	const world = buildWorld({
		scene,
		mediaAssets: assets,
		canvasSize: project.settings.canvasSize,
		fps: project.settings.fps.numerator / project.settings.fps.denominator,
		duration: project.metadata.duration / TICKS_PER_SECOND,
		background: project.settings.background,
	});
	world.objects.push({
		id: "glow-box-1",
		kind: "component",
		componentId: "glow-box",
		name: "Glow Box",
		startTime: 0,
		duration: world.duration,
		params: { size: 240, color: "#ff6b6b", rotationSpeed: 1.5, intensity: 1.6 },
		transform: { position: { x: 320, y: 220, z: -240 }, scaleX: 1, scaleY: 1, rotationZ: 0 },
		renderOrder: 100,
	});
	// 全画布特效：放大镜（中心由可关键帧的 centerX/centerY UV 参数驱动）。
	world.objects.push({
		id: "magnify-effect-1",
		kind: "component",
		componentId: "effect.magnify",
		name: "Magnify",
		startTime: 0,
		duration: world.duration,
		params: { centerX: 0.615, centerY: 0.63, zoom: 1.7, radius: 150, hud: 0.8, aberration: 0.8, haze: 0.2 },
		transform: { position: { x: 0, y: 0, z: 0 }, scaleX: 1, scaleY: 1, rotationZ: 0 },
		renderOrder: 1000,
	});
	return world;
}

function bootstrap() {
	createRoot(document.getElementById("root")!).render(
		<ErrorBoundary>
			<WorldPlayground initialWorld={buildFallbackWorld()} />
		</ErrorBoundary>,
	);
}

function WorldPlayground({ initialWorld }: { initialWorld: World }) {
	const [world, setWorld] = useState(initialWorld);
	const runtimeRef = useRef<VisualRuntime | null>(null);
	const [time, setTime] = useState(0);
	const [playing, setPlaying] = useState(false);
	const timeRef = useRef(0);

	// 同步初始化 Runtime：首帧即有对象（Graph Build 只在 world 结构变化时发生）。
	if (!runtimeRef.current || runtimeRef.current.getWorld() !== world) {
		runtimeRef.current = new VisualRuntime();
		runtimeRef.current.load(world);
	}

	// 媒体就绪后升级为真实项目世界（时间线 → world）。
	useEffect(() => {
		let cancelled = false;
		void buildProjectWorld().then(
			(next) => {
				if (!cancelled) setWorld(next);
			},
			(error) => {
				console.error("[world] demo media failed, keeping fallback:", error);
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!playing) return;
		let raf = 0;
		let last = performance.now();
		const step = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			let next = timeRef.current + dt;
			if (next >= world.duration) next = 0;
			timeRef.current = next;
			setTime(next);
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [playing, world.duration]);

	const frame = runtimeRef.current?.evaluate(time) ?? { time, objects: [] };

	return (
		<div
			style={{
				display: "flex",
				height: "100%",
				flexDirection: "column",
				background: "#141517",
				color: "#e5e5e5",
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 16, padding: 10 }}>
				<button
					onClick={() => setPlaying((p) => !p)}
					style={{
						padding: "6px 14px",
						borderRadius: 8,
						border: "1px solid #3a3d43",
						background: "#232529",
						color: "#e5e5e5",
						cursor: "pointer",
					}}
				>
					{playing ? "⏸ 暂停" : "▶ 播放"} {/* TODO(i18n): demo 世界页按钮，脱离宿主运行，未纳入 zh/en 字典 */}
				</button>
				<input
					type="range"
					min={0}
					max={world.duration}
					step={1 / 60}
					value={time}
					onChange={(e) => {
						const value = Number(e.target.value);
						timeRef.current = value;
						setPlaying(false);
						setTime(value);
					}}
					style={{ flex: 1 }}
				/>
				<span style={{ fontSize: 13 }}>
					{time.toFixed(2)}s / {world.duration.toFixed(2)}s · {frame.objects.length}{" "}
					objects
				</span>
			</div>
			<div style={{ flex: 1, position: "relative" }}>
				<WorldScene world={world} frame={frame} />
			</div>
		</div>
	);
}

void bootstrap();
