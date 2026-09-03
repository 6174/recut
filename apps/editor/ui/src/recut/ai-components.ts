/**
 * [INPUT]: 依赖 recut-sdk 的 asset.list/asset.archive/component.list/component.source，以及测试 seam。
 * [OUTPUT]: 提供组件 asset 引用、AI 组件元数据、源码读取和组件 asset 归档 API。
 * [POS]: recut 数据桥中的组件素材契约，被素材面板与组件预览消费。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { recut } from "./sdk";

export type AiComponentSurface = "html" | "react" | "r3f";
export type AiComponentStatus = "draft" | "verified" | "failed";

export interface AiComponentInput {
	key: string;
	label?: string;
	type: string;
	default: number | string | boolean;
}

export interface AiComponentMeta {
	componentId: string;
	name: string;
	surface: AiComponentSurface;
	keywords: string[];
	version: number | null;
	versionId?: string | null;
	latestVersionId?: string | null;
	status: AiComponentStatus;
	coverUrl?: string | null;
	inputs: AiComponentInput[];
	testReport: { ok?: boolean; checks?: unknown[]; error?: string } | null;
}

export interface ComponentAssetRef {
	assetId: string;
	type: "component";
	refId: string;
	refVersionId: string | null;
	componentId: string;
	name: string;
	status: "active" | "archived";
	version?: number | null;
	componentStatus?: AiComponentStatus;
	coverUrl?: string | null;
}

interface ListResult {
	components?: AiComponentMeta[];
}

interface AssetListResult {
	assets?: ComponentAssetRef[];
}

/** 测试注入点：无宿主时（demo/test）用 window.__recutTest.aiComponents 提供列表与源码。 */
export interface AiComponentResolveSeam {
	surface: AiComponentSurface;
	inputs: AiComponentInput[];
	bundle: string;
	bundleHash: string;
}

export interface AiComponentsTestSeam {
	list: AiComponentMeta[];
	source: Record<string, string>;
	/** 可选：提供可加载的 bundle，让详情预览在无宿主时也能真实渲染。 */
	resolve?: Record<string, AiComponentResolveSeam>;
}

declare global {
	interface Window {
		__recutTest?: {
			aiComponents?: AiComponentsTestSeam;
		};
	}
}

function testSeam(): AiComponentsTestSeam | null {
	if (typeof window === "undefined") return null;
	return window.__recutTest?.aiComponents ?? null;
}

/** 测试 seam 读取（demo/Playwright 注入 window.__recutTest.aiComponents 时返回非 null）。 */
export function getTestSeam(): AiComponentsTestSeam | null {
	return testSeam();
}

export async function listAiComponents(): Promise<AiComponentMeta[]> {
	const seam = testSeam();
	if (seam) return seam.list;
	try {
		const result = (await recut.background.call(
			"component.list",
			{},
		)) as ListResult;
		return Array.isArray(result?.components) ? result.components : [];
	} catch (error) {
		console.warn("[ai-components] component.list 失败:", error);
		return [];
	}
}

/** 读取项目素材索引中的组件引用；asset.list 失败时返回 null，让 UI 使用已加载 runtime 定义降级。 */
export async function listComponentAssets(): Promise<ComponentAssetRef[] | null> {
	const seam = testSeam();
	if (seam) {
		return seam.list.map((component) => ({
			assetId: `component:${component.componentId}`,
			type: "component" as const,
			refId: component.componentId,
			refVersionId: component.versionId ?? null,
			componentId: component.componentId,
			name: component.name,
			status: "active" as const,
			version: component.version,
			componentStatus: component.status,
			coverUrl: component.coverUrl,
		}));
	}
	try {
		// 桥不可达时（demo/Playwright 无宿主）快速降级为 null，与 component.resolve 同样式：
		// 否则 renderFrameDataUrl（封面/快照）链路会永久挂起在 host 连接等待上。
		const timer = new Promise<null>((resolve) =>
			setTimeout(() => resolve(null), 3000),
		);
		const result = (await Promise.race([
			recut.background.call("asset.list", {}),
			timer,
		])) as AssetListResult | null;
		if (!result) return null;
		return Array.isArray(result.assets)
			? result.assets.filter((asset) => asset.type === "component")
			: [];
	} catch (error) {
		console.warn("[ai-components] asset.list 失败:", error);
		return null;
	}
}

export async function getComponentSource(
	componentId: string,
): Promise<{ versionId: string; version: number; source: string } | null> {
	const seam = testSeam();
	if (seam) {
		const source = seam.source[componentId];
		return source
			? { versionId: `${componentId}@1`, version: 1, source }
			: null;
	}
	try {
		const result = await recut.background.call("component.source", {
			componentId,
		});
		if (!result || typeof result.source !== "string") return null;
		return result as { versionId: string; version: number; source: string };
	} catch (error) {
		console.warn(`[ai-components] component.source 失败 ${componentId}:`, error);
		return null;
	}
}

/** 归档项目组件 asset；组件数据与时间线引用保留，素材库只隐藏这条引用。 */
export async function archiveAiComponent(componentId: string): Promise<void> {
	const seam = testSeam();
	if (seam) {
		seam.list = seam.list.filter((component) => component.componentId !== componentId);
		return;
	}
	await recut.background.call("asset.archive", { type: "component", refId: componentId });
}
