"use client";

/**
 * [INPUT]: 依赖运行时组件加载、WorldScene 画布渲染与组件 render 函数。
 * [OUTPUT]: 对外提供 ComponentPreview；按 surface 自动选择 DOM 或 R3F 画布预览。
 * [POS]: assets/views 的预览适配层；组件库弹窗唯一的预览入口，不暴露渲染方式选择。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { VisualRuntime, WorldScene, anim, componentsRegistry, ensureComponent, installComponentResolver, FrameTimeContext } from "@/runtime";
import type {
	ComponentDefinition,
	ComponentRenderContext,
	World,
	WorldObject,
} from "@/runtime/types";
import type { ParamDefinition } from "@/params";
import { installRecutComponentResolver } from "@/recut/components";
import { buildEffectPreviewBaseContent } from "./effect-preview-base";
import { cn } from "@/utils/ui";
import { t, useRecutLocale } from "@/i18n";
import type {
	AiComponentInput,
	AiComponentResolveSeam,
	AiComponentSurface,
} from "@/recut/ai-components";

type ComponentPreviewProps = {
	componentId: string;
	name: string;
	surface: AiComponentSurface;
	inputs: AiComponentInput[];
	width?: number;
	height?: number;
	duration?: number;
};

/** 预览入口：R3F 必须走 WorldScene，其他承载面直接渲染真实 DOM。 */
export function ComponentPreview(props: ComponentPreviewProps) {
	// ComponentDefinition 的 surface 缺省即 r3f；内置 3D 组件不会重复写这个默认值。
	return (props.surface ?? "r3f") === "r3f" ? (
		<ComponentPreviewCanvas {...props} />
	) : (
		<ComponentDomPreview {...props} />
	);
}

/** 单个 R3F 对象的世界 + 时间循环 → WorldScene 渲染。 */
function ComponentPreviewCanvas({
	componentId,
	name,
	inputs,
	width = 320,
	height = 180,
	duration = 6,
}: ComponentPreviewProps) {
	const [world, setWorld] = useState<import("@/runtime/types").World | null>(null);
	const [time, setTime] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const locale = useRecutLocale();

	// 挂上解析器并构建默认参数世界：测试注入 bundle（无宿主）或走 host component.resolve。
	useEffect(() => {
		let alive = true;
		const seam = (window as Window & { __recutTest?: { aiComponents?: { resolve?: Record<string, AiComponentResolveSeam> } } })
			.__recutTest?.aiComponents?.resolve?.[componentId];
		if (seam) {
			installComponentResolver(() =>
				Promise.resolve({
					componentId,
					name,
					surface: seam.surface,
					inputs: seam.inputs as unknown as ParamDefinition[],
					bundle: seam.bundle,
					bundleHash: seam.bundleHash,
				}),
			);
		} else {
			installRecutComponentResolver();
		}
		(async () => {
			try {
				await ensureComponent(componentId);
				if (!alive) return;
				const params: Record<string, string | number | boolean> = {};
				for (const input of inputs ?? []) {
					params[input.key] = input.default;
				}
				// 采样底层场景纹理的后处理特效需要底图内容，否则预览是一片纯色。
				// 用确定性案例内容（渐变底图 + 文字 + 形状）作为特效底下的场景。
				const definition = componentsRegistry.get(componentId);
				const isEffect = definition?.category === "effect";
				setWorld({
					id: `preview-${componentId}`,
					width,
					height,
				fps: 30,
				duration,
				environment: { background: "#101014" },
				isPreview: true,
					objects: [
						...(isEffect ? buildEffectPreviewBaseContent(width, height, duration) : []),
						{
							id: "preview-c1",
							kind: "component",
							componentId,
							name,
							startTime: 0,
							duration,
							params,
							transform: {
								position: { x: 0, y: 0, z: 0 },
								scaleX: 1,
								scaleY: 1,
								rotationZ: 0,
							},
							renderOrder: isEffect ? 100 : 0,
						},
					],
				});
			} catch (loadError) {
				if (!alive) return;
				setError(String((loadError as Error)?.message ?? loadError));
			}
		})();
		return () => {
			alive = false;
		};
	}, [componentId, width, height, duration, name, inputs]);

	// 时间循环（预览允许墙钟；导出仍确定性）。
	useEffect(() => {
		if (!world) return;
		let raf = 0;
		let last = performance.now();
		let t = 0;
		const step = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			t = (t + dt) % duration;
			setTime(t);
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [world, duration]);

	const runtime = useMemo(() => new VisualRuntime(), []);
	if (world && runtime.getWorld() !== world) {
		runtime.load(world);
	}
	const frame = world ? runtime.evaluate(time) : null;

	return (
		<div
			className={cn(
				"relative overflow-hidden rounded-lg bg-[#101014]",
				"flex items-center justify-center",
			)}
			style={{ width, height }}
		>
			{error ? (
				<div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-red-400">
					{t(locale, "panel.component.loadFailed", { error })}
				</div>
			) : world && frame ? (
				<div className="absolute inset-0 [&_canvas]:size-full">
					<WorldScene world={world} frame={frame} />
				</div>
			) : (
				<div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
					{t(locale, "panel.component.loading")}
				</div>
			)}
		</div>
	);
}

/** 直接渲染 html/react 的真实 DOM 输出，不经过画布捕获。 */
function ComponentDomPreview({
	componentId,
	name,
	surface,
	inputs,
	width = 320,
	height = 180,
	duration = 6,
}: ComponentPreviewProps) {
	const [definition, setDefinition] = useState<ComponentDefinition | null>(null);
	const [time, setTime] = useState(0);
	const locale = useRecutLocale();

	useEffect(() => {
		let alive = true;
		ensureComponent(componentId)
			.then((definition) => {
				if (alive && definition) setDefinition(definition);
			})
			.catch(() => undefined);
		return () => {
			alive = false;
		};
	}, [componentId]);

	// 时间循环（预览允许墙钟；导出仍确定性）。
	useEffect(() => {
		if (!definition) return;
		let raf = 0;
		let last = performance.now();
		let t = 0;
		const step = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			t = (t + dt) % duration;
			setTime(t);
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [definition, duration]);

	const params = useMemo(() => {
		const result: Record<string, string | number | boolean> = {};
		for (const input of inputs ?? []) result[input.key] = input.default;
		return result;
	}, [inputs]);

	if (!definition) {
		return (
			<div
				className="flex items-center justify-center overflow-hidden rounded-lg bg-[#101014]"
				style={{ width, height }}
			>
				<span className="text-xs text-muted-foreground">
					{t(locale, "panel.component.loading")}
				</span>
			</div>
		);
	}

	const Render = definition.render;
	const base = definition.getBaseSize?.({ params }) ?? { width, height };
	const scale = Math.min(1, width / base.width, height / base.height);
	const localTime = time;
	const progress = duration > 0 ? Math.min(1, Math.max(0, localTime / duration)) : 0;
	const world: World = {
		id: `dom-preview-${componentId}`,
		width,
		height,
		fps: 30,
		duration,
		environment: { background: "#101014" },
		objects: [],
	};
	const object: WorldObject = {
		id: "preview-c1",
		kind: "component",
		componentId,
		name,
		startTime: 0,
		duration,
		params,
		transform: {
			position: { x: 0, y: 0, z: 0 },
			scaleX: 1,
			scaleY: 1,
			rotationZ: 0,
		},
		renderOrder: 0,
	};
	const ctx: ComponentRenderContext = { world, object, params, time, localTime, progress, anim };

	return (
		<div
			className="relative flex items-center justify-center overflow-hidden rounded-lg bg-[#101014]"
			style={{ width, height }}
		>
			{surface === "react" ? (
				<div
					style={{
						width: base.width,
						height: base.height,
						flexShrink: 0,
						transform: `scale(${scale})`,
						transformOrigin: "center",
					}}
				>
					{/* 提供逐帧时间：组件内 useTimeline/useFrameContext 依此 seek。
					    缺 Provider 时上下文恒为 t=0，入场动画停在 from 态（autoAlpha:0）→ 预览永久空白。 */}
					<FrameTimeContext.Provider value={ctx}>
						<Render {...ctx} />
					</FrameTimeContext.Provider>
				</div>
			) : surface === "html" ? (
				<div
					style={{
						width: base.width,
						height: base.height,
						flexShrink: 0,
						transform: `scale(${scale})`,
						transformOrigin: "center",
					}}
					dangerouslySetInnerHTML={{
						__html: String((Render as (c: ComponentRenderContext) => ReactNode)(ctx) ?? ""),
					}}
				/>
			) : null}
		</div>
	);
}
