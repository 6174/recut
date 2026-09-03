/**
 * [INPUT]: 依赖 runtime-host、动态 bundle、组件注册表与 ParamDefinition 契约。
 * [OUTPUT]: 对外提供受校验的组件动态加载、resolver 注册与项目 asset 来源元数据。
 * [POS]: runtime 的动态组件装载边界；从 Host 取得 bundle/封面，不写入项目或时间线。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createElement, type ComponentType } from "react";
import type { ParamDefinition } from "@/params";
import { componentsRegistry } from "./component-registry";
import type { ComponentModule } from "./component-registry";
import type { ComponentDefinition, ComponentRenderContext, ComponentSurface } from "./types";

/**
 * AI 组件动态加载器：
 * 1. ensureRuntimeHost() 把 runtime-host（与宿主同一 React/R3F/three 实例）挂到 globalThis.__recutRuntime。
 * 2. 组件 bundle 的 @recut/runtime 裸 import 重写为 prelude blob URL（prelude 从 __recutRuntime 取命名导出）。
 * 3. Blob import + 契约校验 + 按 bundleHash 缓存。
 * 永远单 React 实例；只读 ctx；加载失败由消费方降级为占位。
 */

let runtimeReady: Promise<void> | null = null;

export function ensureRuntimeHost(): Promise<void> {
	if (!runtimeReady) {
		runtimeReady = import("./runtime-host").then((ns) => {
			(globalThis as Record<string, unknown>).__recutRuntime = ns;
		});
	}
	return runtimeReady;
}

const PRELUDE_SOURCE = `
const __R = globalThis.__recutRuntime;
export const jsx = __R.jsx;
export const jsxs = __R.jsxs;
export const Fragment = __R.Fragment;
export const useState = __R.useState;
export const useMemo = __R.useMemo;
export const useRef = __R.useRef;
export const useCallback = __R.useCallback;
export const useEffect = __R.useEffect;
export const useThree = __R.useThree;
export const THREE = __R.THREE;
export const useCanvasTexture = __R.useCanvasTexture;
export const anim = __R.anim;
export const num = __R.num;
export const str = __R.str;
export const bool = __R.bool;
export const gsap = __R.gsap;
export const useGSAP = __R.useGSAP;
export const useTimeline = __R.useTimeline;
export const useFrameContext = __R.useFrameContext;
export const useMotionProgramContext = __R.useMotionProgramContext;
export const MotionTargetRegistry = __R.MotionTargetRegistry;
export const createShaderUniformAdapter = __R.createShaderUniformAdapter;
export const selectMotionProgram = __R.selectMotionProgram;
export const useMotionProgram = __R.useMotionProgram;
export const useMotionTextSegments = __R.useMotionTextSegments;
export const segmentText = __R.segmentText;
export const plugins = __R.plugins;
`;

let preludeUrl: string | null = null;
function getPreludeUrl(): string {
	if (!preludeUrl) {
		preludeUrl = URL.createObjectURL(
			new Blob([PRELUDE_SOURCE], { type: "text/javascript" }),
		);
	}
	return preludeUrl;
}

function rewriteRuntimeImports(bundle: string, url: string): string {
	return bundle
		.split('"@recut/runtime/jsx-runtime"')
		.join(`"${url}"`)
		.split("'@recut/runtime/jsx-runtime'")
		.join(`'${url}'`)
		.split('"@recut/runtime"')
		.join(`"${url}"`)
		.split("'@recut/runtime'")
		.join(`'${url}'`);
}

const bundleCache = new Map<string, Promise<ComponentModule>>();

/** 加载组件 bundle（内容寻址缓存），返回原始模块（default 或定义）。 */
export async function loadComponentModule(
	bundle: string,
	bundleHash: string,
): Promise<ComponentModule> {
	const cached = bundleCache.get(bundleHash);
	if (cached) return cached;
	const promise = (async () => {
		await ensureRuntimeHost();
		const rewritten = rewriteRuntimeImports(bundle, getPreludeUrl());
		const blob = new Blob([rewritten], { type: "text/javascript" });
		const blobUrl = URL.createObjectURL(blob);
		try {
			return (await import(/* @vite-ignore */ blobUrl)) as ComponentModule;
		} finally {
			URL.revokeObjectURL(blobUrl);
		}
	})();
	bundleCache.set(bundleHash, promise);
	return promise;
}

/** 纯函数组件 default export 上可选的静态元数据属性。 */
type FunctionComponentModule = ComponentType<ComponentRenderContext> & {
	surface?: ComponentSurface;
	keywords?: string[];
	inputs?: ParamDefinition[];
	category?: ComponentDefinition["category"];
	color?: ComponentDefinition["color"];
	selectable?: ComponentDefinition["selectable"];
	capturePadding?: ComponentDefinition["capturePadding"];
	getBaseSize?: ComponentDefinition["getBaseSize"];
	getContentBounds?: ComponentDefinition["getContentBounds"];
	dispose?: ComponentDefinition["dispose"];
};

/**
 * 归一化纯函数组件（default export 是函数）：
 * 把函数组件包成定义对象，运行时 ctx 与 params 展开为 props 传入。
 * 这样「export default function Hello(props) {...}」与定义对象两种形态都可用。
 */
function normalizeFunctionComponent(
	raw: FunctionComponentModule,
	componentId: string,
): ComponentDefinition {
	const surface = raw.surface ?? "react";
	if (!["html", "react", "r3f"].includes(surface)) {
		throw new Error(`组件 ${componentId} 的 surface 非法: ${surface}`);
	}
	if (
		raw.getContentBounds !== undefined &&
		typeof raw.getContentBounds !== "function"
	) {
		throw new Error(`组件 ${componentId} 的 getContentBounds 必须是函数`);
	}
	const inputs: ParamDefinition[] = Array.isArray(raw.inputs) ? raw.inputs : [];
	const name =
		typeof raw.displayName === "string" && raw.displayName !== ""
			? raw.displayName
			: typeof raw.name === "string" && raw.name !== ""
				? raw.name
				: componentId;
	return {
		id: componentId,
		origin: "asset",
		name,
		surface,
		inputs,
		keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
		category: raw.category,
		color: raw.color,
		selectable: raw.selectable,
		capturePadding: raw.capturePadding,
		getBaseSize: raw.getBaseSize,
		getContentBounds: raw.getContentBounds,
		dispose: raw.dispose,
		// 函数组件即 render：ctx + params 都作为 props 展开，参数名可直接解构。
		render: (ctx) => createElement(raw, { ...ctx, ...ctx.params }),
	};
}

/** 契约校验：导出 shape 合法 → 组件定义（id 覆盖为注册键）。 */
export function validateComponentDefinition(
	module: ComponentModule,
	componentId: string,
): ComponentDefinition {
	const raw =
		module &&
		typeof module === "object" &&
		"default" in (module as object) &&
		(module as { default?: unknown }).default != null
			? (module as { default: unknown }).default
			: (module as unknown);
	// 纯函数组件 default export（子 Agent 自然产物）：包成定义对象。
	if (typeof raw === "function") {
		return normalizeFunctionComponent(raw as FunctionComponentModule, componentId);
	}
	if (!raw || typeof raw !== "object") {
		throw new Error(`组件 ${componentId} 模块未导出定义`);
	}
	const object = raw as ComponentDefinition;
	if (typeof object.render !== "function") {
		throw new Error(`组件 ${componentId} 的 render 必须是函数`);
	}
	if (
		object.getContentBounds !== undefined &&
		typeof object.getContentBounds !== "function"
	) {
		throw new Error(`组件 ${componentId} 的 getContentBounds 必须是函数`);
	}
	const surface = object.surface ?? "r3f";
	if (!["html", "react", "r3f"].includes(surface)) {
		throw new Error(`组件 ${componentId} 的 surface 非法: ${surface}`);
	}
	const inputs: ParamDefinition[] = Array.isArray(object.inputs)
		? object.inputs
		: [];
	return { ...object, id: componentId, origin: "asset", surface, inputs };
}

/** 由 bundle 解析组件定义（hash 缓存 + 校验）。 */
export async function loadComponentDefinition({
	componentId,
	bundle,
	bundleHash,
}: {
	componentId: string;
	bundle: string;
	bundleHash: string;
}): Promise<ComponentDefinition> {
	const module = await loadComponentModule(bundle, bundleHash);
	return validateComponentDefinition(module, componentId);
}

export interface ComponentResolveResult {
	componentId: string;
	name: string;
	surface: string;
	inputs: ParamDefinition[];
	bundle: string;
	bundleHash: string;
	coverUrl?: string | null;
}

export type ComponentResolver = (componentId: string) => Promise<ComponentResolveResult | null>;

let resolver: ComponentResolver | null = null;

/** 注入解析器：UI 用 recut-sdk 调 component.resolve；测试/演示可用文件/内存实现。 */
export function installComponentResolver(r: ComponentResolver | null): void {
	resolver = r;
}

/** 确保组件定义可渲染：已注册/已加载直接返回；否则经 resolver 取 bundle 加载。 */
export async function ensureComponent(
	componentId: string,
): Promise<ComponentDefinition | null> {
	if (componentsRegistry.isLoaded(componentId)) {
		return componentsRegistry.get(componentId);
	}
	if (componentsRegistry.has(componentId)) {
		return componentsRegistry.get(componentId);
	}
	if (!resolver) {
		return null;
	}
	const result = await resolver(componentId);
	if (!result) {
		return null;
	}
	componentsRegistry.registerAsync(componentId, async () => {
		const module = await loadComponentModule(result.bundle, result.bundleHash);
		const definition = validateComponentDefinition(module, componentId);
		return { default: { ...definition, coverUrl: result.coverUrl ?? undefined } };
	});
	return componentsRegistry.load(componentId);
}
