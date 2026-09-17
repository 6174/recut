import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { useThree } from "@react-three/fiber";
import type { ReactNode } from "react";
import * as THREE from "three";
import type { ComponentDefinition, ComponentRenderContext } from "../types";
import { num } from "../utils";
import { registerNodeContentBounds } from "../node-registry";
import { FrameTimeContext, MotionProgramContext, useMotionProgramContext } from "../timeline";
import type { MotionProgram } from "../motion-runtime";
import {
	type ContentBounds,
	DomContentSurface,
} from "./html-surface";

/**
 * [INPUT]: 组件定义、离屏 DomContentSurface 与节点 bbox 刷新通知
 * [OUTPUT]: HtmlObject；以稳定 ContentBounds 裁切纹理，并向 node registry 注册同一交互边界
 * [POS]: runtime/components 的 HTML/React 承载器；像素与选择框只共享 ContentBounds，不再经 mesh bbox 间接推导
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

const DEFAULT_SIZE = 512;
const DEFAULT_CAPTURE_PADDING = 48;

function areContentBoundsEqual(a: ContentBounds, b: ContentBounds): boolean {
	return (
		Math.abs(a.x - b.x) < 0.5 &&
		Math.abs(a.y - b.y) < 0.5 &&
		Math.abs(a.width - b.width) < 0.5 &&
		Math.abs(a.height - b.height) < 0.5
	);
}

/** 作者边界使用内容区左上角坐标；运行时把它映射到含 capturePadding 的完整纹理。 */
function resolveDeclaredContentBounds({
	definition,
	ctx,
	size,
	capturePadding,
}: {
	definition: ComponentDefinition;
	ctx: ComponentRenderContext;
	size: { width: number; height: number };
	capturePadding: number;
}): ContentBounds | null {
	if (!definition.getContentBounds) return null;
	const raw = definition.getContentBounds(ctx);
	if (
		!Number.isFinite(raw.x) ||
		!Number.isFinite(raw.y) ||
		!Number.isFinite(raw.width) ||
		!Number.isFinite(raw.height) ||
		raw.width <= 0 ||
		raw.height <= 0
	) {
		return null;
	}
	const left = Math.max(0, Math.min(size.width, raw.x));
	const top = Math.max(0, Math.min(size.height, raw.y));
	const right = Math.max(left, Math.min(size.width, raw.x + raw.width));
	const bottom = Math.max(top, Math.min(size.height, raw.y + raw.height));
	if (right <= left || bottom <= top) return null;
	return {
		x: left + capturePadding,
		y: top + capturePadding,
		width: right - left,
		height: bottom - top,
	};
}

/** 实例参数优先，其次作者定义；两者都未设置时每侧默认留 48px。 */
function resolveCapturePadding({
	definition,
	params,
}: {
	definition: ComponentDefinition;
	params: ComponentRenderContext["params"];
}): number {
	const instanceValue = params["render.capturePadding"];
	if (typeof instanceValue === "number" && Number.isFinite(instanceValue)) {
		return Math.max(0, Math.ceil(instanceValue));
	}
	const configured = definition.capturePadding;
	if (typeof configured === "number" && Number.isFinite(configured)) {
		return Math.max(0, Math.ceil(configured));
	}
	return DEFAULT_CAPTURE_PADDING;
}

/**
 * L1/L2 组件宿主：把 HTML 字符串模板（surface "html"）或 React 元素树（surface "react"）
 * 挂到离屏 DOM（DomContentSurface），captureElementImage 捕获为 HtmlTexture plane。
 * 动画走 ctx.anim（t 的纯函数），每帧 requestPaint 同步纹理。
 * L2 用独立的 react-dom root 而非 createPortal（见 ReactContent）。
 */
function HtmlStringContent({
	host,
	html,
}: {
	host: HTMLDivElement | null;
	html: string;
}) {
	useLayoutEffect(() => {
		if (!host) return;
		host.innerHTML = html;
	}, [host, html]);
	return null;
}

/**
 * L2 "react" 内容宿主：把组件 render 的元素树渲染到离屏 DOM host。
 * 不能直接 createPortal 进 host——portal 仍由 R3F reconciler 实例化，
 * `<div>` 会撞 "Div is not part of the THREE namespace"；
 * 必须用独立的 react-dom/client root，让 DOM reconciler 处理宿主元素。
 * 每帧 flushSync 同步提交：保证 requestPaint 捕获到当前帧的 DOM，
 * 避免异步调度让纹理滞后/抖动导致动画卡顿。
 */
function ReactContent({
	host,
	render,
	ctx,
	program,
}: {
	host: HTMLDivElement | null;
	render: (c: ComponentRenderContext) => ReactNode;
	ctx: ComponentRenderContext;
	program?: MotionProgram;
}) {
	const rootRef = useRef<Root | null>(null);

	useLayoutEffect(() => {
		if (!host || rootRef.current) return;
		const root = createRoot(host);
		rootRef.current = root;
		return () => {
			root.unmount();
			if (rootRef.current === root) rootRef.current = null;
		};
	}, [host]);

	useLayoutEffect(() => {
		if (!host || !rootRef.current) return;
		flushSync(() => {
			// 用 FrameTimeContext 提供逐帧时间：组件可经 useTimeline/useFrameContext
			// 把 GSAP Timeline 驱动到当前帧 t（seek 先于本帧捕获，子 effect 先于父 effect）。
			rootRef.current?.render(
				<MotionProgramContext.Provider value={program}>
					<FrameTimeContext.Provider value={ctx}>
						{render(ctx)}
					</FrameTimeContext.Provider>
				</MotionProgramContext.Provider>,
			);
		});
	}, [host, render, ctx, program]);

	return null;
}

export function HtmlObject({
	definition,
	ctx,
	notifyBounds = true,
	onSurfaceCaptured,
}: {
	definition: ComponentDefinition;
	ctx: ComponentRenderContext;
	/** 快照 portal 的几何不属于编辑交互树，禁止触发选择框刷新。 */
	notifyBounds?: boolean;
	/** DOM 纹理异步就绪后触发所属合成器重绘。 */
	onSurfaceCaptured?: () => void;
}) {
	const { object, params } = ctx;
	const isHtml = definition.surface === "html";
	const Render = definition.render;
	const invalidate = useThree((state) => state.invalidate);
	const motionProgram = useMotionProgramContext();

	const size = useMemo(() => {
		const base =
			definition.getBaseSize?.({ params }) ?? { width: DEFAULT_SIZE, height: DEFAULT_SIZE };
		return {
			width: Math.max(1, Math.ceil(base.width)),
			height: Math.max(1, Math.ceil(base.height)),
		};
	}, [definition, params]);
	const capturePadding = useMemo(
		() => resolveCapturePadding({ definition, params }),
		[definition, params],
	);
	const surfaceSize = useMemo(
		() => ({
			width: size.width + capturePadding * 2,
			height: size.height + capturePadding * 2,
		}),
		[capturePadding, size.height, size.width],
	);

	// 超采样系数：跟随设备像素比，上限 2（同 remotion-kit HtmlInCanvas 的 pixelDensity）。
	// 让 DOM 内容以更高分辨率光栅化，大画布/retina/放大后仍清晰。
	const supersample = useMemo(() => {
		const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
		return Math.min(2, Math.max(1, dpr || 1));
	}, []);
	const contentSignature = useMemo(() => JSON.stringify(params), [params]);

	const [host, setHost] = useState<HTMLDivElement | null>(null);
	const surfaceRef = useRef<DomContentSurface | null>(null);
	const [measuredContentBounds, setMeasuredContentBounds] =
		useState<ContentBounds | null>(null);
	const onSurfaceCapturedRef = useRef(onSurfaceCaptured);
	const hasCommittedContentRef = useRef(false);
	const declaredContentBounds = resolveDeclaredContentBounds({
		definition,
		ctx,
		size,
		capturePadding,
	});
	const contentBounds = declaredContentBounds ?? measuredContentBounds;
	const visualBounds = declaredContentBounds;
	const interactionBounds = contentBounds
		? {
			x: contentBounds.x - capturePadding,
			y: contentBounds.y - capturePadding,
			width: contentBounds.width,
			height: contentBounds.height,
			baseWidth: size.width,
			baseHeight: size.height,
		}
		: null;

	useLayoutEffect(() => {
		onSurfaceCapturedRef.current = onSurfaceCaptured;
	}, [onSurfaceCaptured]);

	useLayoutEffect(() => {
		surfaceRef.current?.dispose();
		const surface = new DomContentSurface(
			surfaceSize.width,
			surfaceSize.height,
			supersample,
			capturePadding,
		);
		// 捕获完成 → invalidate：R3F 在纹理就绪后才重绘（demand frameloop）。
		// 对齐 remotion-kit HtmlSurfacePlane 的 captureVersion → invalidate。
		surface.onCaptured = (nextBounds) => {
			invalidate();
			// 首次捕获时 mesh 还未提交；等下面的 layout effect 后再合成，避免把
			// 空 group 缓存为当前帧。后续帧则可直接让合成器读取更新后的纹理。
			if (hasCommittedContentRef.current) onSurfaceCapturedRef.current?.();
			if (!nextBounds) return;
			setMeasuredContentBounds((current) =>
				current && areContentBoundsEqual(current, nextBounds)
					? current
					: nextBounds,
			);
		};
		surface.texture.repeat.set(1, 1);
		surface.texture.offset.set(0, 0);
		surface.texture.needsUpdate = true;
		surfaceRef.current = surface;
		setMeasuredContentBounds(null);
		hasCommittedContentRef.current = false;
		setHost(surface.contentElement);
		return () => {
			surface.onCaptured = null;
			surfaceRef.current?.dispose();
			surfaceRef.current = null;
			setHost(null);
		};
	}, [
		capturePadding,
		invalidate,
		supersample,
		surfaceSize.height,
		surfaceSize.width,
	]);

	useLayoutEffect(() => {
		hasCommittedContentRef.current = true;
		if (!notifyBounds) return;
		registerNodeContentBounds(object.id, interactionBounds);
	}, [interactionBounds, notifyBounds, object.id]);

	useLayoutEffect(
		() => () => {
			if (notifyBounds) registerNodeContentBounds(object.id, null);
		},
		[notifyBounds, object.id],
	);

	useLayoutEffect(() => {
		surfaceRef.current?.requestUpdate({
			// 作者已声明边界时，绝不为选择框读取整张纹理；逐像素扫描只服务旧组件。
			measureContentBounds: declaredContentBounds === null,
		});
	}, [contentSignature, declaredContentBounds, host]);

	useLayoutEffect(() => {
		surfaceRef.current?.requestUpdate();
	}, [ctx.time, ctx.localTime, ctx.progress]);

	useLayoutEffect(() => {
		const texture = surfaceRef.current?.texture;
		if (!texture) return;
		if (visualBounds) {
			texture.repeat.set(
				visualBounds.width / surfaceSize.width,
				visualBounds.height / surfaceSize.height,
			);
			texture.offset.set(
				visualBounds.x / surfaceSize.width,
				1 - (visualBounds.y + visualBounds.height) / surfaceSize.height,
			);
		} else {
			texture.repeat.set(1, 1);
			texture.offset.set(0, 0);
		}
		texture.needsUpdate = true;
	}, [surfaceSize.height, surfaceSize.width, visualBounds]);

	const rawHtml = isHtml
		? String((definition.render as (c: ComponentRenderContext) => ReactNode)(ctx) ?? "")
		: "";
	const contentCenterX = contentBounds
		? contentBounds.x + contentBounds.width / 2 - surfaceSize.width / 2
		: 0;
	const contentCenterY = contentBounds
		? surfaceSize.height / 2 - contentBounds.y - contentBounds.height / 2
		: 0;
	const visualPosition: [number, number, number] = visualBounds
		? [contentCenterX, contentCenterY, 0]
		: [0, 0, 0];
	const visualSize: [number, number] = visualBounds
		? [visualBounds.width, visualBounds.height]
		: [surfaceSize.width, surfaceSize.height];
	return (
		<group>
			{host ? (
				<>
					{/* 声明 ContentBounds 的组件用同一稳定范围裁切 pixels；旧组件保留完整纹理。 */}
					<mesh
						renderOrder={object.renderOrder}
						position={visualPosition}
						userData={{ recutIgnoreNodeBounds: true }}
					>
						<planeGeometry args={visualSize} />
						<meshBasicMaterial
							map={surfaceRef.current?.texture ?? undefined}
							transparent
							opacity={num(params.opacity, 1)}
							depthWrite={false}
							side={THREE.DoubleSide}
						/>
					</mesh>
				</>
			) : null}
			{isHtml ? <HtmlStringContent host={host} html={rawHtml} /> : null}
			{!isHtml ? <ReactContent host={host} render={Render as (c: ComponentRenderContext) => ReactNode} ctx={ctx} program={motionProgram} /> : null}
		</group>
	);
}
