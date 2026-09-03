/**
 * [INPUT]: 依赖 Recut Host 的 asset.list/component.resolve、runtime 组件注册表与 ai-components 的测试 seam（无宿主降级）。
 * [OUTPUT]: 对外提供安装 Resolver 与按 asset 引用、时间线引用同步组件的 syncTimelineComponents。
 * [POS]: recut Host 组件数据到 UI runtime 的桥；只有 asset 引用或已有时间线引用才能触发动态加载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import {
	componentsRegistry,
	ensureComponent,
	installComponentResolver,
	type ComponentResolveResult,
} from "@/runtime";
import type { TProject } from "@/project/types";
import { recut } from "./sdk";
import {
	getTestSeam,
	listComponentAssets,
	type AiComponentResolveSeam,
	type ComponentAssetRef,
} from "./ai-components";

/**
 * Recut Host 桥：把组件解析器接到 background 的 component.resolve。
 * 项目加载后 syncTimelineComponents 同步已验证的项目组件，并额外扫描时间线兼容旧项目。
 */
let installed = false;

export function installRecutComponentResolver(): void {
	if (installed) return;
	installed = true;
	// 测试 seam（demo/Playwright 无宿主）：用注入的 resolve 表服务 bundle，避免背景桥挂起。
	const seamResolve = getTestSeam()?.resolve;
	if (seamResolve) {
		installComponentResolver(
			async (componentId): Promise<ComponentResolveResult | null> => {
				const entry: AiComponentResolveSeam | undefined = seamResolve[componentId];
				if (!entry) return null;
				return {
					componentId: componentId,
					name: componentId,
					surface: entry.surface,
					inputs: entry.inputs as unknown as ComponentResolveResult["inputs"],
					bundle: entry.bundle,
					bundleHash: entry.bundleHash,
				};
			},
		);
		return;
	}
	installComponentResolver(
		async (componentId): Promise<ComponentResolveResult | null> => {
			// 桥不可达时（无宿主/断连）快速降级为 null，避免 ensureComponent 永久挂起。
			const timer = new Promise<null>((resolve) =>
				setTimeout(() => resolve(null), 3000),
			);
			try {
				const result = await Promise.race([
					recut.background.call("component.resolve", { ids: [componentId] }),
					timer,
				]);
				if (!result) return null;
				const comp = result.components?.[0];
				if (!comp) return null;
				return {
					componentId: comp.componentId,
					name: comp.name,
					surface: comp.surface,
					inputs: comp.inputs ?? [],
					bundle: comp.bundle,
					bundleHash: comp.bundleHash,
					coverUrl: comp.coverUrl,
				};
			} catch (error) {
				console.warn(`[recut] component.resolve 失败 ${componentId}:`, error);
				return null;
			}
		},
	);
}

function collectAiComponentIds(project: TProject | null): string[] {
	const ids = new Set<string>();
	for (const scene of project?.scenes ?? []) {
		const tracks = [
			scene.tracks?.main,
			...(scene.tracks?.overlay ?? []),
			...(scene.tracks?.audio ?? []),
		];
		for (const track of tracks) {
			if (!track?.elements) continue;
			for (const element of track.elements) {
				// 未注册/未加载的 componentId 一律尝试解析（内置组件已同步注册，天然被 isLoaded 排除）
				if (element.type === "component" && element.componentId && !componentsRegistry.isLoaded(element.componentId)) {
					ids.add(element.componentId);
				}
			}
		}
	}
	return Array.from(ids);
}

async function collectProjectComponentIds(project: TProject | null): Promise<string[]> {
	const ids = new Set(collectAiComponentIds(project));
	try {
		// 经 seam 感知的 listComponentAssets（demo 用注入数据，宿主走 asset.list）。
		const refs: ComponentAssetRef[] | null = await listComponentAssets();
		if (refs != null) {
			// 只收集"尚未加载且未失败"的组件资产：已加载或已失败（load 抛错置 failed）的
			// 若再收集，syncTimelineComponents 会无条件 dispatch recut:components-changed
			// → 素材库 refresh → sync → dispatch…… 死循环（asset.list 被疯狂请求）。
			// 失败组件永远无法 isLoaded，必须显式排除，否则循环无法终止。
			for (const asset of refs) {
				if (
					asset.status === "active" &&
					asset.componentId &&
					!componentsRegistry.isLoaded(asset.componentId) &&
					!componentsRegistry.isFailed(asset.componentId)
				) {
					ids.add(asset.componentId);
				}
			}
		}
	} catch (error) {
		console.warn("[recut] asset.list 失败，回退到时间线组件：", error);
	}
	return Array.from(ids);
}

/** 项目加载后调用：同步已验证组件库与时间线引用，确保组件可预览和插入。 */
export async function syncTimelineComponents(project: TProject | null): Promise<void> {
	installRecutComponentResolver();
	const ids = await collectProjectComponentIds(project);
	if (ids.length === 0) return;
	const results = await Promise.allSettled(ids.map((id) => ensureComponent(id)));
	// 只有"至少成功加载了一个新组件"才通知素材库刷新；全部失败/已存在则不发事件，
	// 否则失败组件会让 collect 每次仍返回非空 → dispatch → 无限自触发循环。
	const anyNewlyLoaded = results.some((r) => r.status === "fulfilled" && r.value != null);
	if (!anyNewlyLoaded) return;
	if (typeof window !== "undefined") {
		window.dispatchEvent(new Event("recut:components-changed"));
	}
}
