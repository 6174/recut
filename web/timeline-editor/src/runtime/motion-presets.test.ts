/**
 * [INPUT]: 内置预设 catalog、绑定操作与 Motion compiler。
 * [OUTPUT]: 预设时间槽、参数校验、文本错峰和 CRUD 行为的纯单元回归。
 * [POS]: runtime 预设产品层测试；浏览器像素验证见 tests/e2e。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { describe, expect, it } from "vitest";
import {
	MOTION_PRESETS,
	applyMotionPreset,
	compileElementMotion,
	compileMotionBinding,
	getMotionPreset,
	removeMotionPreset,
	updateMotionPresetParams,
} from "./motion-presets";
import { createDomMotionAdapter } from "./motion-runtime";

describe("motion preset catalog/compiler", () => {
	it("覆盖基础元素族和文本族", () => {
		for (const id of ["fade-in", "fade-out", "slide-left", "slide-right", "slide-up", "slide-down", "scale-in", "scale-out", "rotate-in", "bounce-in", "pulse", "float", "sway", "text-fade-up", "text-type-on", "text-word-reveal", "text-character-reveal"]) {
			expect(getMotionPreset(id).status).toBe("ok");
		}
		expect(MOTION_PRESETS.length).toBeGreaterThanOrEqual(17);
	});

	it("shader 预设声明 uniform 兼容性并生成 shader tracks", () => {
		for (const id of ["effect-glitch-loop", "effect-ripple-loop", "effect-crt-loop", "effect-vhs-loop"]) {
			const status = getMotionPreset(id);
			expect(status.status).toBe("ok");
			if (status.status !== "ok") continue;
				const program = compileMotionBinding({ binding: { presetId: id, presetVersion: "1.0.0" }, slot: "loop", elementDuration: 2 });
				expect(program?.tracks[0].target.kind).toBe("shader");
			}
	});

	it("文本预设可以驱动样式属性，而不是只驱动 transform", () => {
		const color = compileMotionBinding({ binding: { presetId: "text-color-shift", presetVersion: "1.0.0", segment: { mode: "whole" } }, slot: "enter", elementDuration: 1, text: "ABC" });
		const size = compileMotionBinding({ binding: { presetId: "text-size-pop", presetVersion: "1.0.0", segment: { mode: "whole" } }, slot: "enter", elementDuration: 1, text: "ABC" });
		expect(color?.tracks[0].path).toBe("color");
		expect(size?.tracks[0].path).toBe("fontSize");
		const adapter = createDomMotionAdapter({ text: {} }, { allowTypographyLayout: true });
		expect(adapter.canAnimate("fontSize", 24)).toBe(true);
		expect(adapter.canAnimate("width", 24)).toBe(false);
	});

	it("按 enter/exit/loop 映射局部时间", () => {
		const enter = compileMotionBinding({ binding: { presetId: "slide-left", presetVersion: "1.0.0" }, slot: "enter", elementDuration: 4 });
		expect(enter?.durationSec).toBe(4);
		expect(enter?.tracks[0].keys[0].at).toBe(0);
		expect(enter?.tracks[0].keys.at(-1)?.at).toBeCloseTo(0.5);

		const exit = compileMotionBinding({ binding: { presetId: "slide-right", presetVersion: "1.0.0" }, slot: "exit", elementDuration: 4 });
		expect(exit?.tracks[0].keys[0].at).toBeCloseTo(3.5);

		const loop = compileMotionBinding({ binding: { presetId: "pulse", presetVersion: "1.0.0" }, slot: "loop", elementDuration: 4 });
		expect(loop?.tracks[0].keys.some((item) => item.at > 2)).toBe(true);
	});

	it("支持参数校验和 missing fallback", () => {
		expect(getMotionPreset("does-not-exist").status).toBe("missing");
		const invalid = compileMotionBinding({ binding: { presetId: "slide-left", presetVersion: "1.0.0", params: { distance: 99999 } }, slot: "enter", elementDuration: 2 });
		expect(invalid).toBeUndefined();
	});

	it("文本分段生成稳定 ref 并应用 stagger", () => {
		const program = compileMotionBinding({
			binding: { presetId: "text-fade-up", presetVersion: "1.0.0", segment: { mode: "grapheme", staggerSec: 0.1 } },
			slot: "enter",
			elementDuration: 2,
			text: "你A🙂",
		});
		const refs = new Set(program?.tracks.map((track) => track.target.ref));
		expect(refs).toEqual(new Set(["text:g-0", "text:g-1", "text:g-2"]));
		const second = program?.tracks.find((track) => track.target.ref === "text:g-1");
		expect(second?.keys[0].at).toBeCloseTo(0.1);
	});

	it("文本绑定保留 Enter/Exit/Loop 槽位", () => {
		const program = compileElementMotion({
			textMotion: {
				presetId: "text-fade-up",
				presetVersion: "1.0.0",
				slot: "exit",
				segment: { mode: "grapheme" },
			},
			elementDuration: 3,
			text: "ABC",
		});
		expect(program?.tracks[0].keys[0].at).toBeCloseTo(2.5);
	});

	it("绑定操作保持不可变并可更新参数", () => {
		const element = { id: "e", type: "text", name: "Text", duration: 100, startTime: 0, trimStart: 0, trimEnd: 100, params: {} } as any;
		const applied = applyMotionPreset({ element, slot: "enter", binding: { presetId: "fade-in", presetVersion: "1.0.0" } });
		expect(applied).not.toBe(element);
		const updated = updateMotionPresetParams({ element: applied, slot: "enter", params: { from: 0.8 } });
		expect(updated.motion?.enter?.params?.from).toBe(0.8);
		const removed = removeMotionPreset({ element: updated, slot: "enter" });
		expect(removed.motion?.enter).toBeNull();
	});

	it("合并 enter/exit/loop 为一个 deterministic program", () => {
		const program = compileElementMotion({
			motion: {
				version: 1,
				enter: { presetId: "fade-in", presetVersion: "1.0.0" },
				exit: { presetId: "fade-out", presetVersion: "1.0.0" },
				loop: { presetId: "pulse", presetVersion: "1.0.0" },
			},
			elementDuration: 3,
		});
		expect(program?.durationSec).toBe(3);
		expect(program?.mode).toBe("once");
		expect(program?.tracks.length).toBeGreaterThan(0);
	});
});
