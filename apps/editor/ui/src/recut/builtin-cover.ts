/**
 * [INPUT]: 依赖组件注册表（平台内置组件定义）、component-harness 渲染与 IndexedDB 封面缓存。
 * [OUTPUT]: 对外提供 ensureBuiltinComponentCovers / getBuiltinCover / getBuiltinCovers；
 *           为平台内置组件（形状/发光盒子/样条场景/HTML 徽章/React 脉动卡片）生成透明封面并本地缓存。
 * [POS]: recut 平台内置组件素材库的封面缓存；内置组件无项目 DB 行，封面存 IndexedDB（按组件 id，一次性生成）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { componentsRegistry } from "@/runtime";
import type { ComponentDefinition } from "@/runtime/types";
import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";
import { captureComponentCover } from "./component-cover";

const coverStore = new IndexedDBAdapter<{ id: string; dataUrl: string }>({
	dbName: "recut-editor",
	storeName: "builtin-component-covers",
	version: 1,
});

/** 平台内置可插入组件（视频/图片/文本是媒体原语，特效全画布后处理，均跳过）。 */
function builtinLibraryComponents(): ComponentDefinition[] {
	return componentsRegistry
		.getAll()
		.filter((definition) => !["video", "image", "text"].includes(definition.id))
		.filter((definition) => definition.category !== "effect")
		.filter((definition) => definition.origin !== "asset");
}

export async function getBuiltinCover(componentId: string): Promise<string | null> {
	try {
		const row = await coverStore.get(componentId);
		return row?.dataUrl ?? null;
	} catch (error) {
		console.warn(`[builtin-cover] read ${componentId} failed:`, error);
		return null;
	}
}

export async function getBuiltinCovers(componentIds: string[]): Promise<Record<string, string>> {
	const map: Record<string, string> = {};
	for (const id of componentIds) {
		const cover = await getBuiltinCover(id);
		if (cover) map[id] = cover;
	}
	return map;
}

/** 为还没有封面的平台内置组件生成透明封面（一次渲染、IndexedDB 缓存，之后直接复用）。 */
export async function ensureBuiltinComponentCovers(): Promise<void> {
	for (const definition of builtinLibraryComponents()) {
		if (await getBuiltinCover(definition.id)) continue;
		try {
			const captured = await captureComponentCover({
				componentId: definition.id,
				name: definition.name,
				surface: definition.surface ?? "r3f",
				inputs: definition.inputs.map((input) => ({ key: input.key, default: input.default })),
			});
			if (captured?.dataUrl) {
				await coverStore.set({ key: definition.id, value: { id: definition.id, dataUrl: captured.dataUrl } });
				// 单张完成即通知，卡片增量刷新（保持稳定，不整块重排）。
				window.dispatchEvent(new Event("recut:builtin-covers-changed"));
			}
		} catch (error) {
			console.warn(`[builtin-cover] capture ${definition.id} failed:`, error);
		}
	}
}
