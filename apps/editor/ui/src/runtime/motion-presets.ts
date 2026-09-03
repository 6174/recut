/**
 * [INPUT]: MotionRuntime 的 track/program 契约、文本分段结果与时间线元素。
 * [OUTPUT]: 预设 catalog（含 Shader component capability gate）、绑定操作、参数校验与 Motion Program compiler。
 * [POS]: runtime 的产品层动画处方；声明动画意图，不直接触碰 R3F/DOM 对象。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { TimelineElement } from "@/timeline/types";
import type { MotionBlend, MotionKey, MotionProgram, MotionTargetKind, MotionTrack } from "./motion-runtime";
import { segmentText, type TextSegmentMode } from "./text-segmentation";

export type MotionSlot = "enter" | "exit" | "loop";
export type MotionPresetCategory = "element" | "text";

export interface MotionBinding {
	presetId: string;
	presetVersion: string;
	params?: Record<string, string | number | boolean>;
	enabled?: boolean;
	durationSec?: number;
}

export interface ElementMotion {
	version: 1;
	enter?: MotionBinding | null;
	exit?: MotionBinding | null;
	loop?: MotionBinding | null;
}

export interface TextMotionBinding extends MotionBinding {
	slot?: MotionSlot;
	segment: {
		mode: TextSegmentMode;
		order?: "forward" | "reverse";
		staggerSec?: number;
		maxSegments?: number;
	};
	layout?: "preserve" | "reflow";
}

export interface PresetParameter {
	key: string;
	type: "number" | "string" | "boolean";
	default: string | number | boolean;
	min?: number;
	max?: number;
}

export interface PresetChannel {
	target: MotionTargetKind;
	path: string;
	blend: MotionBlend;
	keys: MotionKey[];
	/** text channels are expanded once per selected segment. */
	segment?: boolean;
}

export interface MotionPresetDefinition {
	id: string;
	version: string;
	name: string;
	category: MotionPresetCategory;
	slots: readonly MotionSlot[];
	targets: readonly string[];
	defaultDurationSec: number;
	parameters?: readonly PresetParameter[];
	textMode?: TextSegmentMode;
	channels: readonly PresetChannel[];
	/** 限定组件实现，避免把依赖专用 material 的预设展示给不兼容组件。 */
	componentIds?: readonly string[];
}

export type MotionPresetStatus =
	| { status: "ok"; definition: MotionPresetDefinition }
	| { status: "missing"; presetId: string }
	| { status: "invalid"; presetId: string; reason: string };

const key = (at: number, value: number, ease = "none"): MotionKey => ({ at, value, ease });

const THREE = (path: string, keys: MotionKey[], _blend: MotionBlend = "replace"): PresetChannel => ({
	// v1 的 MotionRuntime 只允许单 owner replace；预设变换挂在 identity layer，
	// 因此 replace 等价于相对基础姿态，避免多个 GSAP owner 争写同一路径。
	target: "three", path, blend: "replace", keys,
});
const DOM = (path: string, keys: MotionKey[], segment = false): PresetChannel => ({
	target: "dom", path, blend: "replace", keys, segment,
});
const SHADER = (path: string, keys: MotionKey[]): PresetChannel => ({
	target: "shader", path, blend: "replace", keys,
});

/** 内置 P0 catalog：所有处方均为纯数据，可离线缓存、校验和版本化。 */
export const MOTION_PRESETS: readonly MotionPresetDefinition[] = [
	{ id: "fade-in", version: "1.0.0", name: "Fade In", category: "element", slots: ["enter"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.45, channels: [THREE("scale.x", [key(0, 0.96), key(1, 1)]), THREE("scale.y", [key(0, 0.96), key(1, 1)])] },
	{ id: "fade-out", version: "1.0.0", name: "Fade Out", category: "element", slots: ["exit"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.45, channels: [THREE("scale.x", [key(0, 1), key(1, 0.96)]), THREE("scale.y", [key(0, 1), key(1, 0.96)])] },
	{ id: "slide-left", version: "1.0.0", name: "Slide Left", category: "element", slots: ["enter", "exit"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.5, parameters: [{ key: "distance", type: "number", default: 320, min: 0, max: 4000 }], channels: [THREE("position.x", [key(0, -320, "power3.out"), key(1, 0, "power3.out")], "add")] },
	{ id: "slide-right", version: "1.0.0", name: "Slide Right", category: "element", slots: ["enter", "exit"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.5, parameters: [{ key: "distance", type: "number", default: 320, min: 0, max: 4000 }], channels: [THREE("position.x", [key(0, 320, "power3.out"), key(1, 0, "power3.out")], "add")] },
	{ id: "slide-up", version: "1.0.0", name: "Slide Up", category: "element", slots: ["enter", "exit"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.5, parameters: [{ key: "distance", type: "number", default: 180, min: 0, max: 4000 }], channels: [THREE("position.y", [key(0, 180, "power3.out"), key(1, 0, "power3.out")], "add")] },
	{ id: "slide-down", version: "1.0.0", name: "Slide Down", category: "element", slots: ["enter", "exit"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.5, parameters: [{ key: "distance", type: "number", default: 180, min: 0, max: 4000 }], channels: [THREE("position.y", [key(0, -180, "power3.out"), key(1, 0, "power3.out")], "add")] },
	{ id: "scale-in", version: "1.0.0", name: "Scale In", category: "element", slots: ["enter"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.45, parameters: [{ key: "from", type: "number", default: 0.7, min: 0.01, max: 2 }], channels: [THREE("scale.x", [key(0, 0.7, "back.out(1.7)"), key(1, 1, "back.out(1.7)")], "multiply"), THREE("scale.y", [key(0, 0.7, "back.out(1.7)"), key(1, 1, "back.out(1.7)")], "multiply")] },
	{ id: "scale-out", version: "1.0.0", name: "Scale Out", category: "element", slots: ["exit"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.45, channels: [THREE("scale.x", [key(0, 1), key(1, 0.7, "power2.in")], "multiply"), THREE("scale.y", [key(0, 1), key(1, 0.7, "power2.in")], "multiply")] },
	{ id: "rotate-in", version: "1.0.0", name: "Rotate In", category: "element", slots: ["enter"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.55, parameters: [{ key: "degrees", type: "number", default: -90, min: -360, max: 360 }], channels: [THREE("rotation.z", [key(0, -1.5708, "power3.out"), key(1, 0, "power3.out")], "add")] },
	{ id: "bounce-in", version: "1.0.0", name: "Bounce In", category: "element", slots: ["enter"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.7, channels: [THREE("position.y", [key(0, -240, "bounce.out"), key(0.72, 16, "bounce.out"), key(1, 0, "bounce.out")], "add")] },
	{ id: "pulse", version: "1.0.0", name: "Pulse", category: "element", slots: ["loop"], targets: ["video", "image", "text", "component"], defaultDurationSec: 1.2, channels: [THREE("scale.x", [key(0, 1), key(0.5, 1.06, "sine.inOut"), key(1, 1, "sine.inOut")], "multiply"), THREE("scale.y", [key(0, 1), key(0.5, 1.06, "sine.inOut"), key(1, 1, "sine.inOut")], "multiply")] },
	{ id: "float", version: "1.0.0", name: "Float", category: "element", slots: ["loop"], targets: ["video", "image", "text", "component"], defaultDurationSec: 2, channels: [THREE("position.y", [key(0, -10, "sine.inOut"), key(0.5, 10, "sine.inOut"), key(1, -10, "sine.inOut")], "add")] },
	{ id: "sway", version: "1.0.0", name: "Sway", category: "element", slots: ["loop"], targets: ["video", "image", "text", "component"], defaultDurationSec: 2, channels: [THREE("rotation.z", [key(0, -0.06, "sine.inOut"), key(0.5, 0.06, "sine.inOut"), key(1, -0.06, "sine.inOut")], "add")] },
	{ id: "effect-glitch-loop", version: "1.0.0", name: "Glitch", category: "element", slots: ["loop"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.65, channels: [SHADER("effects.glitch.progress", [key(0, 0), key(0.12, 0.32, "power3.out"), key(0.42, 0.72, "power2.inOut"), key(1, 1, "power3.in")]), SHADER("effects.glitch.intensity", [key(0, 0), key(0.08, 4.5, "power3.out"), key(0.24, 1.8, "power2.inOut"), key(0.55, 0, "power3.in")]) ] },
	{ id: "effect-ripple-loop", version: "1.0.0", name: "Ripple", category: "element", slots: ["loop"], targets: ["video", "image", "text", "component"], defaultDurationSec: 1, channels: [SHADER("effects.ripple.progress", [key(0, 0), key(0.35, 1, "power2.out"), key(1, 0, "power2.in")]), SHADER("effects.ripple.strength", [key(0, 0), key(0.35, 1, "power2.out"), key(1, 0, "power2.in")]) ] },
	{ id: "effect-crt-loop", version: "1.0.0", name: "CRT", category: "element", slots: ["loop"], targets: ["video", "image", "text", "component"], defaultDurationSec: 2, channels: [SHADER("effects.crt.time", [key(0, 0), key(1, 2)])] },
	{ id: "effect-vhs-loop", version: "1.0.0", name: "VHS", category: "element", slots: ["loop"], targets: ["video", "image", "text", "component"], defaultDurationSec: 0.8, channels: [SHADER("effects.vhs.progress", [key(0, 0), key(0.35, 0.42, "power2.out"), key(1, 1, "power2.in")]) ] },
	{ id: "text-fade-up", version: "1.0.0", name: "Text Fade Up", category: "text", slots: ["enter", "exit"], targets: ["text"], defaultDurationSec: 0.5, textMode: "grapheme", channels: [DOM("opacity", [key(0, 0), key(1, 1)], true), DOM("y", [key(0, 18, "power3.out"), key(1, 0, "power3.out")], true)] },
	{ id: "text-type-on", version: "1.0.0", name: "Type On", category: "text", slots: ["enter", "exit"], targets: ["text"], defaultDurationSec: 0.8, textMode: "grapheme", channels: [DOM("opacity", [key(0, 0), key(0.35, 0), key(1, 1)], true)] },
	{ id: "text-word-reveal", version: "1.0.0", name: "Word Reveal", category: "text", slots: ["enter", "exit"], targets: ["text"], defaultDurationSec: 0.65, textMode: "word", channels: [DOM("opacity", [key(0, 0), key(1, 1)], true), DOM("y", [key(0, 12), key(1, 0)], true)] },
	{ id: "text-character-reveal", version: "1.0.0", name: "Character Reveal", category: "text", slots: ["enter", "exit"], targets: ["text"], defaultDurationSec: 0.7, textMode: "grapheme", channels: [DOM("opacity", [key(0, 0), key(1, 1)], true), DOM("scale", [key(0, 0.8), key(1, 1)], true)] },
	{ id: "text-color-shift", version: "1.0.0", name: "Color Shift", category: "text", slots: ["enter", "exit", "loop"], targets: ["text"], defaultDurationSec: 0.8, textMode: "whole", channels: [DOM("color", [{ at: 0, value: "#ffffff" }, { at: 1, value: "#38bdf8", ease: "sine.inOut" }], true)] },
	{ id: "text-weight-pop", version: "1.0.0", name: "Weight Pop", category: "text", slots: ["enter", "exit"], targets: ["text"], defaultDurationSec: 0.35, textMode: "whole", channels: [DOM("fontWeight", [{ at: 0, value: "400" }, { at: 1, value: "800", ease: "power2.out" }], true)] },
	{ id: "text-size-pop", version: "1.0.0", name: "Size Pop", category: "text", slots: ["enter", "exit"], targets: ["text"], defaultDurationSec: 0.45, textMode: "whole", channels: [DOM("fontSize", [key(0, 0.8, "back.out(1.7)"), key(1, 1, "back.out(1.7)")], true)] },
];

export function getMotionPreset(id: string, version?: string): MotionPresetStatus {
	const candidates = MOTION_PRESETS.filter((preset) => preset.id === id);
	if (!candidates.length) return { status: "missing", presetId: id };
	const definition = candidates.find((preset) => !version || preset.version === version);
	if (!definition) return { status: "invalid", presetId: id, reason: "version" };
	return { status: "ok", definition };
}

function validateParams(definition: MotionPresetDefinition, params: MotionBinding["params"]): string | null {
	for (const parameter of definition.parameters ?? []) {
		const value = params?.[parameter.key] ?? parameter.default;
		if (typeof value !== parameter.type) return `parameter:${parameter.key}`;
		if (typeof value === "number" && ((parameter.min !== undefined && value < parameter.min) || (parameter.max !== undefined && value > parameter.max))) return `parameter-range:${parameter.key}`;
	}
	return null;
}

function paramScale(definition: MotionPresetDefinition, binding: MotionBinding): Record<string, number> {
	const values: Record<string, number> = {};
	for (const parameter of definition.parameters ?? []) {
		const value = binding.params?.[parameter.key] ?? parameter.default;
		if (typeof value === "number") values[parameter.key] = value;
	}
	return values;
}

function scaleValue(path: string, value: MotionKey["value"], params: Record<string, number>): MotionKey["value"] {
	if (typeof value !== "number") return value;
	if (path === "position.x" || path === "position.y") {
		if (params.distance !== undefined) return Math.sign(value) * params.distance * (Math.abs(value) / 320);
	}
	if (path === "scale.x" || path === "scale.y") {
		if (params.from !== undefined && value !== 1) return params.from;
	}
	if (path === "rotation.z" && params.degrees !== undefined) return params.degrees * Math.PI / 180 * (value / (-Math.PI / 2));
	return value;
}

function buildTrack(channel: PresetChannel, binding: MotionBinding, slot: MotionSlot, elementDuration: number, refs: string[], definitionDuration: number): MotionTrack[] {
	const duration = Math.max(0.001, definitionDuration);
	const params = paramScale(MOTION_PRESETS.find((preset) => preset.id === binding.presetId)!, binding);
	const tracks: MotionTrack[] = [];
	const targets = channel.segment ? refs : [channel.target === "three" ? "object:root" : channel.target === "shader" ? "material:main" : "object:root"];
	for (const ref of targets) {
		const keys: MotionKey[] = [];
		const pushCycle = (offset: number) => channel.keys.forEach((item) => {
			const at = offset + item.at * duration;
			if (at <= elementDuration + 1e-6) keys.push({ ...item, at, value: scaleValue(channel.path, item.value, params) });
		});
		if (slot === "loop") for (let offset = 0; offset < elementDuration; offset += duration) pushCycle(offset);
		else pushCycle(slot === "exit" ? Math.max(0, elementDuration - duration) : 0);
		if (keys.length) tracks.push({ target: { kind: channel.target, ref }, path: channel.path, blend: channel.blend, keys: keys.sort((a, b) => a.at - b.at) });
	}
	return tracks;
}

export function compileMotionBinding({ binding, slot, elementDuration, text }: { binding: MotionBinding; slot: MotionSlot; elementDuration: number; text?: string }): MotionProgram | undefined {
	if (binding.enabled === false) return undefined;
	const status = getMotionPreset(binding.presetId, binding.presetVersion);
	if (status.status !== "ok" || !Number.isFinite(elementDuration) || elementDuration <= 0) return undefined;
	const definition = status.definition;
	if (!definition.slots.includes(slot) || validateParams(definition, binding.params)) return undefined;
	const textBinding = binding as TextMotionBinding;
	const segmentLimit = textBinding.segment?.maxSegments;
	const refs = definition.category === "text" ? segmentText(text ?? "", textBinding.segment?.mode ?? definition.textMode ?? "grapheme").slice(0, segmentLimit && segmentLimit > 0 ? segmentLimit : undefined).map((item) => `text:${item.id}`) : [];
	const orderedRefs = (binding as TextMotionBinding).segment?.order === "reverse" ? refs.reverse() : refs;
	const stagger = Math.max(0, (binding as TextMotionBinding).segment?.staggerSec ?? 0);
	const tracks = definition.channels.flatMap((channel) => {
		const result = buildTrack(channel, binding, slot, elementDuration, orderedRefs, binding.durationSec ?? definition.defaultDurationSec);
		if (!channel.segment || !stagger) return result;
		return result.map((track) => ({ ...track, keys: track.keys.map((item) => ({ ...item, at: item.at + orderedRefs.indexOf(track.target.ref) * stagger })).filter((item) => item.at <= elementDuration) }));
	}).filter((track) => track.keys.length);
	return tracks.length ? { schemaVersion: 1, durationSec: elementDuration, mode: "once", tracks } : undefined;
}

export function compileElementMotion({ motion, textMotion, elementDuration, text }: { motion?: ElementMotion; textMotion?: TextMotionBinding; elementDuration: number; text?: string }): MotionProgram | undefined {
	const bindings: Array<[MotionSlot, MotionBinding | null | undefined]> = [["enter", motion?.enter], ["exit", motion?.exit], ["loop", motion?.loop]];
	if (textMotion) bindings.push([textMotion.slot ?? "enter", textMotion]);
	const tracks = bindings.flatMap(([slot, binding]) => {
		if (!binding) return [];
		return compileMotionBinding({ binding, slot, elementDuration, text })?.tracks ?? [];
	});
	const merged = new Map<string, MotionTrack>();
	for (const track of tracks) {
		const id = `${track.target.kind}:${track.target.ref}:${track.path}`;
		const previous = merged.get(id);
		if (previous) previous.keys = [...previous.keys, ...track.keys].sort((a, b) => a.at - b.at);
		else merged.set(id, { ...track, keys: [...track.keys] });
	}
	return merged.size ? { schemaVersion: 1, durationSec: elementDuration, mode: "once", tracks: [...merged.values()] } : undefined;
}

export function applyMotionPreset<T extends TimelineElement>({ element, slot, binding }: { element: T; slot: MotionSlot; binding: MotionBinding }): T {
	const motion: ElementMotion = element.motion ? { ...element.motion } : { version: 1 };
	motion[slot] = binding;
	return { ...element, motion } as T;
}

export function removeMotionPreset<T extends TimelineElement>({ element, slot }: { element: T; slot: MotionSlot }): T {
	if (!element.motion) return element;
	const motion = { ...element.motion, [slot]: null };
	return { ...element, motion } as T;
}

export function replaceMotionPreset<T extends TimelineElement>({ element, slot, binding }: { element: T; slot: MotionSlot; binding: MotionBinding }): T {
	return applyMotionPreset({ element: removeMotionPreset({ element, slot }), slot, binding });
}

export function updateMotionPresetParams<T extends TimelineElement>({ element, slot, params }: { element: T; slot: MotionSlot; params: MotionBinding["params"] }): T {
	const binding = element.motion?.[slot];
	if (!binding) return element;
	return applyMotionPreset({ element, slot, binding: { ...binding, params: { ...binding.params, ...params } } });
}
