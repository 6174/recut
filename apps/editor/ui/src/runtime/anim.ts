import type { AnimApi } from "./types";

/**
 * 确定性动画工具（anim）：t（localTime/progress）→ 值。
 * 全部为 t 的纯函数，禁止墙钟源；Preview 与 Export 逐帧一致的前提。
 * 供内置组件与 AI 临时组件共用（SDK `@recut/runtime` 的 anim 导出同此实现）。
 */

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

const EASINGS: Record<string, (u: number) => number> = {
	linear: (u) => u,
	easeOut: (u) => 1 - Math.pow(1 - u, 2),
	easeIn: (u) => u * u,
	easeInOut: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
	easeOutCubic: (u) => 1 - Math.pow(1 - u, 3),
	easeOutBack: (u) => {
		const c1 = 1.70158;
		const c3 = c1 + 1;
		return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
	},
};

function applyEase(u: number, ease?: string): number {
	const fn = (ease && EASINGS[ease]) || EASINGS.linear;
	return fn(clamp01(u));
}

function hexToRgb(hex: string): [number, number, number] {
	const normalized = hex.replace("#", "");
	const value = normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized;
	const int = parseInt(value.length === 6 ? value : "000000", 16);
	return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
	const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
}

export const anim: AnimApi = {
	lerp(a, b, u, opts) {
		return a + (b - a) * applyEase(u, opts?.ease);
	},
	lerpColor(c1, c2, u) {
		const [r1, g1, b1] = hexToRgb(c1);
		const [r2, g2, b2] = hexToRgb(c2);
		const t = applyEase(u);
		return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
	},
	seq(keys, u) {
		if (keys.length === 0) return 0;
		if (keys.length === 1) return keys[0][1];
		const sorted = [...keys].sort((a, b) => a[0] - b[0]);
		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		if (u <= first[0]) return first[1];
		if (u >= last[0]) return last[1];
		for (let i = 0; i < sorted.length - 1; i++) {
			const [k0, v0] = sorted[i];
			const [k1, v1] = sorted[i + 1];
			if (u >= k0 && u <= k1) {
				const span = k1 - k0;
				const t = span === 0 ? 0 : (u - k0) / span;
				return v0 + (v1 - v0) * t;
			}
		}
		return last[1];
	},
	pulse(u, opts) {
		const speed = opts?.speed ?? 1;
		const phase = opts?.phase ?? 0;
		const value = (u * speed + phase) % 1;
		// 0..1 三角波（平滑往返）
		return 1 - Math.abs(2 * value - 1);
	},
};
