/**
 * [INPUT]: 依赖 GSAP、FrameTime，以及由 DOM/Three/Shader 各自注册的目标适配器。
 * [OUTPUT]: 对外提供 MotionProgram、MotionTargetRegistry、compileMotionProgram、MotionRuntime 及 DOM/Three/Shader adapters。
 * [POS]: runtime 的数据驱动动画核心；把引擎中立的 Motion Program 编译为 paused GSAP Timeline，
 *        不负责 React 生命周期、不直接创建 DOM/Three/Shader 目标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { gsap } from "gsap";
import type { FrameTime } from "./timeline";

export type MotionTargetKind = "dom" | "three" | "shader";
export type MotionValue = number | string | boolean | number[];
export type MotionBlend = "replace" | "add" | "multiply";

export interface MotionKey {
	at: number;
	value: MotionValue;
	ease?: string;
}

export interface MotionTrack {
	target: { kind: MotionTargetKind; ref: string };
	path: string;
	blend: MotionBlend;
	keys: MotionKey[];
}

export interface MotionProgram {
	schemaVersion: 1;
	durationSec: number;
	mode: "once" | "loop";
	tracks: MotionTrack[];
}

export interface MotionTargetAdapter {
	kind: MotionTargetKind;
	/** rawPath 让一个语义 target（例如 object:root）能解析到实际的 Vector3/Euler。 */
	resolveTarget(ref: string, rawPath?: string): object | null;
	normalizePath(path: string): string;
	canAnimate(path: string, value: MotionValue): boolean;
	dispose?(): void;
}

/** Motion Program 所需的最小 Object3D transform 形状，避免核心 runtime 绑定 Three 包。 */
export interface TransformTarget {
	position: { x: number; y: number; z: number };
	rotation: { x: number; y: number; z: number };
	scale: { x: number; y: number; z: number };
}

export interface ShaderUniformTarget {
	value: unknown;
}

export interface ShaderMaterialTarget {
	uniforms: Readonly<Record<string, ShaderUniformTarget>>;
}

const THREE_TRANSFORM_PATH = /^(position|rotation|scale)\.(x|y|z)$/;

/**
 * 将 `object:root / position.x` 映射到稳定 Object3D 的 `position.x`。
 * Program 只认识根对象；Vector3/Euler 是 renderer 私有实现细节，不能泄漏进持久化格式。
 */
export function createThreeTransformAdapter(
	targets: Readonly<Record<string, TransformTarget>>,
): MotionTargetAdapter {
	return {
		kind: "three",
		resolveTarget: (ref, rawPath) => {
			const target = targets[ref];
			const match = rawPath?.match(THREE_TRANSFORM_PATH);
			if (!target || !match) return null;
			return target[match[1] as "position" | "rotation" | "scale"];
		},
		normalizePath: (path) => path.match(THREE_TRANSFORM_PATH)?.[2] ?? path,
		canAnimate: (path, value) =>
			["x", "y", "z"].includes(path) && typeof value === "number" && Number.isFinite(value),
	};
}

const DOM_MOTION_PATHS = new Set([
	"x",
	"y",
	"rotation",
	"scale",
	"scaleX",
	"scaleY",
	"opacity",
	"filter",
	"clipPath",
	"transform",
	"color",
	"backgroundColor",
	"fontWeight",
	"letterSpacing",
	"fontStyle",
	"textDecorationColor",
	"textShadow",
	"fontSize",
	"lineHeight",
]);
const DOM_LAYOUT_PATH = /^(width|height|top|left|right|bottom|margin|padding|fontSize|lineHeight)/;

export interface DomMotionAdapterOptions {
	/** 文本显式选择 style channel 时允许 fontSize/lineHeight；默认仍禁止布局属性。 */
	allowTypographyLayout?: boolean;
}

/** DOM/React 文本 adapter：默认只允许合成属性，文本样式由显式选项放开。 */
export function createDomMotionAdapter(
	targets:
		| Readonly<Record<string, object>>
		| (() => Readonly<Record<string, object>>),
	options: DomMotionAdapterOptions = {},
): MotionTargetAdapter {
	return {
		kind: "dom",
		resolveTarget: (ref) => {
			const resolved = typeof targets === "function" ? targets() : targets;
			return resolved[ref] ?? null;
		},
		normalizePath: (path) => {
			if (path.startsWith("style.")) return path.slice("style.".length);
			if (path.startsWith("transform.")) return path.slice("transform.".length);
			return path;
		},
		canAnimate: (path, value) => {
			if (DOM_LAYOUT_PATH.test(path) && !(options.allowTypographyLayout && (path === "fontSize" || path === "lineHeight"))) return false;
			const cssVariable = path.startsWith("--");
			const allowed = cssVariable || DOM_MOTION_PATHS.has(path);
			return allowed && (typeof value === "number" || typeof value === "string");
		},
	};
}

const UNIFORM_PATH = /^uniforms\.([A-Za-z_][\w]*)(?:\.([A-Za-z_][\w]*))?$/;

/** Shader adapter：uniform 容器和 material identity 不变，GSAP 只写 scalar/value 或向量分量。 */
export function createShaderUniformAdapter(
	targets: Readonly<Record<string, ShaderUniformTarget | ShaderMaterialTarget>>,
): MotionTargetAdapter {
	return {
		kind: "shader",
		resolveTarget: (ref, rawPath) => {
			const source = targets[ref];
			const match = rawPath?.match(UNIFORM_PATH);
			if (!source || !match) return null;
			const uniform = "uniforms" in source ? source.uniforms[match[1]] : source;
			if (!uniform) return null;
			return match[2] ? (uniform.value as object | null) : uniform;
		},
		normalizePath: (path) => path.match(UNIFORM_PATH)?.[2] ?? "value",
		canAnimate: (path, value) =>
			(path === "value" || /^[xyzwrgba]$/.test(path)) &&
			(typeof value === "number" || typeof value === "string" || Array.isArray(value)),
	};
}

/** 从共享程序中选出某一 adapter 的轨道，保证多目标 program 可被分层挂载。 */
export function selectMotionProgram(
	program: MotionProgram | undefined,
	kind: MotionTargetKind,
): MotionProgram | undefined {
	if (!program) return undefined;
	const tracks = program.tracks.filter((track) => track.target.kind === kind);
	return tracks.length > 0 ? { ...program, tracks } : undefined;
}

export class MotionTargetRegistry {
	private readonly adapters = new Map<MotionTargetKind, MotionTargetAdapter>();

	register(adapter: MotionTargetAdapter): void {
		this.adapters.set(adapter.kind, adapter);
	}

	get(kind: MotionTargetKind): MotionTargetAdapter | undefined {
		return this.adapters.get(kind);
	}

	clear(): void {
		for (const adapter of this.adapters.values()) adapter.dispose?.();
		this.adapters.clear();
	}
}

function assertProgram(program: MotionProgram): void {
	if (program.schemaVersion !== 1) throw new Error("motion-schema-version");
	if (!Number.isFinite(program.durationSec) || program.durationSec <= 0) {
		throw new Error("motion-duration");
	}
	for (const track of program.tracks) {
		if (!track.keys.length) throw new Error("motion-empty-track");
		let previous = -Infinity;
		for (const key of track.keys) {
			if (!Number.isFinite(key.at) || key.at < 0 || key.at > program.durationSec) {
				throw new Error("motion-key-out-of-range");
			}
			if (key.at < previous) throw new Error("motion-keys-unsorted");
			previous = key.at;
		}
	}
}

function tweenValue(target: object, path: string, value: MotionValue): Record<string, unknown> {
	return { [path]: value };
}

/** 将一个稳定的 Motion Program 编译成可 seek 的 GSAP timeline。 */
export function compileMotionProgram(
	program: MotionProgram,
	registry: MotionTargetRegistry,
): gsap.core.Timeline {
	assertProgram(program);
	const timeline = gsap.timeline({ paused: true });
	const claimedPaths = new Set<string>();

	for (const track of program.tracks) {
		if (track.blend !== "replace") {
			throw new Error(`motion-blend-not-supported:${track.blend}`);
		}
		const claim = `${track.target.kind}:${track.target.ref}:${track.path}`;
		if (claimedPaths.has(claim)) throw new Error(`motion-path-conflict:${claim}`);
		claimedPaths.add(claim);
		const adapter = registry.get(track.target.kind);
		if (!adapter) throw new Error(`motion-adapter:${track.target.kind}`);
		const path = adapter.normalizePath(track.path);
		const target = adapter.resolveTarget(track.target.ref, track.path);
		if (!target) throw new Error(`motion-target:${track.target.kind}:${track.target.ref}`);
		for (const key of track.keys) {
			if (!adapter.canAnimate(path, key.value)) {
				throw new Error(`motion-path:${track.target.kind}:${track.path}`);
			}
		}
		const first = track.keys[0];
		if (track.keys.length === 1) {
			timeline.set(target, tweenValue(target, path, first.value), first.at);
		}
		for (let index = 1; index < track.keys.length; index += 1) {
			const key = track.keys[index];
			const previous = track.keys[index - 1];
			timeline.fromTo(
				target,
				tweenValue(target, path, previous.value),
				{
					...tweenValue(target, path, key.value),
					duration: Math.max(0, key.at - previous.at),
					ease: key.ease ?? "none",
				},
				previous.at,
			);
		}
	}
	return timeline;
}

function clampTime(time: number, duration: number, mode: MotionProgram["mode"]): number {
	if (duration <= 0) return 0;
	if (mode === "loop") {
		const wrapped = time % duration;
		return wrapped < 0 ? wrapped + duration : wrapped;
	}
	return Math.min(duration, Math.max(0, time));
}

export class MotionRuntime {
	private timeline: gsap.core.Timeline;
	private program: MotionProgram;

	constructor(program: MotionProgram, registry: MotionTargetRegistry) {
		this.program = program;
		this.timeline = compileMotionProgram(program, registry);
	}

	seek(frame: Pick<FrameTime, "localTime">): void {
		this.timeline.seek(clampTime(frame.localTime, this.program.durationSec, this.program.mode));
	}

	getTimeline(): gsap.core.Timeline {
		return this.timeline;
	}

	rebuild(program: MotionProgram, registry: MotionTargetRegistry): void {
		this.timeline.kill();
		this.program = program;
		this.timeline = compileMotionProgram(program, registry);
	}

	dispose(): void {
		this.timeline.kill();
	}
}
