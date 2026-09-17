/**
 * [INPUT]: 依赖 MotionRuntime/compileMotionProgram 与 GSAP 的 Node 可执行对象。
 * [OUTPUT]: 验证 Motion Program 编译、seek、loop、target adapter 和 schema 边界。
 * [POS]: runtime 的单元测试；不依赖浏览器、R3F 或 CanvasDrawElement，浏览器像素验证见 tests/e2e。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { describe, expect, it } from "vitest";
import {
	MotionRuntime,
	MotionTargetRegistry,
	compileMotionProgram,
	createDomMotionAdapter,
	createShaderUniformAdapter,
	createThreeTransformAdapter,
	type MotionTargetAdapter,
	type MotionTargetKind,
} from "./motion-runtime";

function adapter(
	kind: MotionTargetKind,
	targets: Record<string, Record<string, unknown>>,
	allowed: string[] = ["x", "opacity", "value", "uProgress"],
): MotionTargetAdapter {
	return {
		kind,
		resolveTarget: (ref) => targets[ref] ?? null,
		normalizePath: (path) => (kind === "shader" ? "value" : path),
		canAnimate: (path) => allowed.includes(path) || kind === "shader",
	};
}

function registryFor(target: Record<string, unknown>): MotionTargetRegistry {
	const registry = new MotionTargetRegistry();
	registry.register(adapter("dom", { text: target }));
	registry.register(adapter("three", { object: target }));
	registry.register(adapter("shader", { material: target }));
	return registry;
}

describe("MotionRuntime", () => {
	it("编译 replace track 并在任意 seek 顺序下得到相同状态", () => {
		const target: Record<string, unknown> = { x: 0 };
		const runtime = new MotionRuntime(
			{
				schemaVersion: 1,
				durationSec: 1,
				mode: "once",
				tracks: [
					{
						target: { kind: "three", ref: "object" },
						path: "x",
						blend: "replace",
						keys: [
							{ at: 0, value: 0 },
							{ at: 1, value: 100, ease: "none" },
						],
					},
				],
			},
			registryFor(target),
		);

		runtime.seek({ localTime: 0.5 });
		expect(target.x).toBeCloseTo(50);
		runtime.seek({ localTime: 0 });
		runtime.seek({ localTime: 0.5 });
		expect(target.x).toBeCloseTo(50);
		expect(runtime.getTimeline().paused()).toBe(true);
		runtime.dispose();
	});

	it("loop program 以局部时间取模，不使用无限 repeat", () => {
		const target: Record<string, unknown> = { x: 0 };
		const runtime = new MotionRuntime(
			{
				schemaVersion: 1,
				durationSec: 1,
				mode: "loop",
				tracks: [
					{
						target: { kind: "dom", ref: "text" },
						path: "x",
						blend: "replace",
						keys: [{ at: 0, value: 0 }, { at: 1, value: 10 }],
					},
				],
			},
			registryFor(target),
		);
		runtime.seek({ localTime: 0.25 });
		const first = target.x;
		runtime.seek({ localTime: 1.25 });
		expect(target.x).toBeCloseTo(Number(first));
		expect(runtime.getTimeline().repeat()).toBe(0);
		runtime.dispose();
	});

	it("shader adapter 把 program path 归一化到 uniform.value", () => {
		const uniform: Record<string, unknown> = { value: 0 };
		const runtime = new MotionRuntime(
			{
				schemaVersion: 1,
				durationSec: 1,
				mode: "once",
				tracks: [
					{
						target: { kind: "shader", ref: "material" },
						path: "uniforms.uProgress",
						blend: "replace",
						keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }],
					},
				],
			},
			registryFor(uniform),
		);
		runtime.seek({ localTime: 0.75 });
		expect(uniform.value).toBeCloseTo(0.75);
		runtime.dispose();
	});

	it("Three adapter 将根对象路径解析到稳定的 Vector3/Euler，并拒绝重复 owner", () => {
		const object = {
			position: { x: 0, y: 0, z: 0 },
			rotation: { x: 0, y: 0, z: 0 },
			scale: { x: 1, y: 1, z: 1 },
		};
		const registry = new MotionTargetRegistry();
		registry.register(createThreeTransformAdapter({ "object:root": object }));
		const runtime = new MotionRuntime(
			{
				schemaVersion: 1,
				durationSec: 1,
				mode: "once",
				tracks: [
					{
						target: { kind: "three", ref: "object:root" },
						path: "position.x",
						blend: "replace",
						keys: [{ at: 0, value: 0 }, { at: 1, value: 40 }],
					},
				],
			},
			registry,
		);
		runtime.seek({ localTime: 0.5 });
		expect(object.position.x).toBeCloseTo(20);
		runtime.dispose();
		expect(() =>
			compileMotionProgram(
				{
					schemaVersion: 1,
					durationSec: 1,
					mode: "once",
					tracks: [
						{
							target: { kind: "three", ref: "object:root" },
							path: "position.x",
							blend: "replace",
							keys: [{ at: 0, value: 0 }],
						},
						{
							target: { kind: "three", ref: "object:root" },
							path: "position.x",
							blend: "replace",
							keys: [{ at: 0, value: 1 }],
						},
					],
				},
				registry,
			),
		).toThrow("motion-path-conflict");
	});

	it("DOM adapter 只允许合成属性，Shader adapter 保持 uniform 容器与向量 identity", () => {
		const dom = { opacity: 0, x: 0 };
		const uniform = { value: 0 };
		const vectorUniform = { value: { x: 0, y: 0 } };
		const registry = new MotionTargetRegistry();
		registry.register(createDomMotionAdapter({ "text:root": dom }));
		registry.register(
			createShaderUniformAdapter({
				"material:progress": uniform,
				"material:offset": vectorUniform,
			}),
		);
		const vectorIdentity = vectorUniform.value;
		const runtime = new MotionRuntime(
			{
				schemaVersion: 1,
				durationSec: 1,
				mode: "once",
				tracks: [
					{
						target: { kind: "dom", ref: "text:root" },
						path: "style.opacity",
						blend: "replace",
						keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }],
					},
					{
						target: { kind: "shader", ref: "material:progress" },
						path: "uniforms.uProgress",
						blend: "replace",
						keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }],
					},
					{
						target: { kind: "shader", ref: "material:offset" },
						path: "uniforms.uOffset.x",
						blend: "replace",
						keys: [{ at: 0, value: 0 }, { at: 1, value: 20 }],
					},
				],
			},
			registry,
		);
		runtime.seek({ localTime: 0.5 });
		expect(dom.opacity).toBeCloseTo(0.5);
		expect(uniform.value).toBeCloseTo(0.5);
		expect(vectorUniform.value.x).toBeCloseTo(10);
		expect(vectorUniform.value).toBe(vectorIdentity);
		runtime.dispose();
		expect(() =>
			compileMotionProgram(
				{
					schemaVersion: 1,
					durationSec: 1,
					mode: "once",
					tracks: [{
						target: { kind: "dom", ref: "text:root" },
						path: "style.width",
						blend: "replace",
						keys: [{ at: 0, value: 10 }],
					}],
				},
				registry,
			),
		).toThrow("motion-path");
	});

	it("拒绝未知目标、空轨道和越界 key", () => {
		const registry = registryFor({ x: 0 });
		const base = {
			schemaVersion: 1 as const,
			durationSec: 1,
			mode: "once" as const,
		};
		expect(() =>
			compileMotionProgram({ ...base, tracks: [{ target: { kind: "three", ref: "missing" }, path: "x", blend: "replace", keys: [{ at: 0, value: 0 }] }] }, registry),
		).toThrow("motion-target");
		expect(() =>
			compileMotionProgram({ ...base, tracks: [{ target: { kind: "three", ref: "object" }, path: "x", blend: "replace", keys: [] }] }, registry),
		).toThrow("motion-empty-track");
		expect(() =>
			compileMotionProgram({ ...base, tracks: [{ target: { kind: "three", ref: "object" }, path: "x", blend: "replace", keys: [{ at: 2, value: 0 }] }] }, registry),
		).toThrow("motion-key-out-of-range");
		expect(() =>
			compileMotionProgram({ ...base, tracks: [{ target: { kind: "three", ref: "object" }, path: "x", blend: "add", keys: [{ at: 0, value: 1 }] }] }, registry),
		).toThrow("motion-blend-not-supported");
	});
});
