/**
 * [INPUT]: 世界对象的基础参数、元素内关键帧通道与全局时间。
 * [OUTPUT]: VisualRuntime；以统一的元素局部时基求值参数、动画与 transform。
 * [POS]: runtime 的纯求值边界，被 WorldRenderer 和预览画布共同消费。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import { resolveAnimationPathValueAtTime } from "@/animation";
import type { ElementAnimations } from "@/animation/types";
import type { ParamValues } from "@/params";
import { TICKS_PER_SECOND } from "@/wasm";
import { num } from "./utils";
import type {
	ResolvedWorldObject,
	World,
	WorldFrame,
	WorldTransform,
} from "./types";
import { compileElementMotion } from "./motion-presets";

/** 按 localTime（ticks，与关键帧通道时间单位一致）求值参数；无动画时原样返回。 */
function resolveParamsAtTime({
	params,
	animations,
	animationTimeTicks,
}: {
	params: ParamValues;
	animations: ElementAnimations | undefined;
	/** 正常为 localTimeTicks；仅旧 Agent 数据保留其错误写入的时间线绝对 tick。 */
	animationTimeTicks: number;
}): ParamValues {
	if (!animations) return params;
	const resolved: ParamValues = {};
	for (const [key, value] of Object.entries(params)) {
		resolved[key] = resolveAnimationPathValueAtTime({
			animations,
			propertyPath: key,
			localTime: animationTimeTicks,
			fallbackValue: value,
		});
	}
	return resolved;
}

/**
 * 早期 Agent bridge 把 `keyframe-upsert.atSec`（时间线时刻）直接存进了一个
 * 本应相对元素起点的通道。只有当一个元素的所有 key 都完整落在自身的时间线
 * 区间内，才把它判作这种旧数据；正常局部 key（例如 0、0.4、2）不会命中。
 */
function usesLegacyTimelineKeyframes({
	animations,
	startTimeTicks,
	durationTicks,
}: {
	animations: ElementAnimations | undefined;
	startTimeTicks: number;
	durationTicks: number;
}): boolean {
	if (!animations || startTimeTicks <= 0 || durationTicks <= 0) return false;
	const times: number[] = [];
	const collectTimes = (value: unknown) => {
		if (!value || typeof value !== "object") return;
		if ("keys" in value && Array.isArray(value.keys)) {
			for (const key of value.keys) {
				if (key && typeof key === "object" && typeof key.time === "number") {
					times.push(key.time);
				}
			}
			return;
		}
		for (const child of Object.values(value)) collectTimes(child);
	};
	for (const channel of Object.values(animations)) collectTimes(channel);
	return (
		times.length > 0 &&
		times.every(
			(time) => time >= startTimeTicks && time <= startTimeTicks + durationTicks,
		)
	);
}

/** 从求值后的 params 重建元素 transform（含 transform.* 关键帧）。 */
function resolveTransformFromParams({
	baseTransform,
	params,
}: {
	baseTransform: WorldTransform;
	params: ParamValues;
}): WorldTransform {
	return {
		position: {
			x: num(params["transform.positionX"], baseTransform.position.x),
			y: num(params["transform.positionY"], baseTransform.position.y),
			z: num(params["transform.positionZ"], baseTransform.position.z),
		},
		scaleX: num(params["transform.scaleX"], baseTransform.scaleX),
		scaleY: num(params["transform.scaleY"], baseTransform.scaleY),
		rotationZ: num(params["transform.rotate"], baseTransform.rotationZ),
	};
}

/**
 * VisualRuntime：世界对象图的宿主。
 * load 一次，之后逐帧 evaluate(time)；Graph Build 不进 Frame Loop。
 */
export class VisualRuntime {
	private world: World | null = null;

	load(world: World): void {
		this.world = world;
	}

	getWorld(): World | null {
		return this.world;
	}

	evaluate(time: number): WorldFrame {
		if (!this.world) {
			return { time, objects: [] };
		}
		const objects: ResolvedWorldObject[] = [];
		// 时间与对象边界都源自 ticks→秒 的浮点转换，直接比较会在接缝处
		// 留出约 1e-9 秒的微缝隙并闪出空白帧；先量化回 tick 网格再用整数比较。
		const timeTicks = Math.round(time * TICKS_PER_SECOND);
		for (const object of this.world.objects) {
			const startTicks = Math.round(object.startTime * TICKS_PER_SECOND);
			const durationTicks = Math.round(object.duration * TICKS_PER_SECOND);
			if (timeTicks < startTicks || timeTicks >= startTicks + durationTicks) {
				continue;
			}
			const localTimeTicks = timeTicks - startTicks;
			const localTime = localTimeTicks / TICKS_PER_SECOND;
			const animationTimeTicks = usesLegacyTimelineKeyframes({
				animations: object.animations,
				startTimeTicks: startTicks,
				durationTicks,
			})
				? startTimeTicks + localTimeTicks
				: localTimeTicks;
			const params = resolveParamsAtTime({
				params: object.params,
				animations: object.animations,
				animationTimeTicks,
			});
			const compiledMotion = compileElementMotion({
				motion: object.motion,
				textMotion: object.textMotion,
				elementDuration: object.duration,
				text: typeof params.text === "string" ? params.text : undefined,
			});
			objects.push({
				// transform 由求值后的 params 重建，使 transform.* 关键帧真正驱动渲染。
				object: {
					...object,
					transform: resolveTransformFromParams({
						baseTransform: object.transform,
						params,
					}),
					motionProgram: compiledMotion ?? object.motionProgram,
				},
				params,
				localTime,
			});
		}
		return { time, objects };
	}

	dispose(): void {
		this.world = null;
	}
}
