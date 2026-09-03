import { DefinitionRegistry } from "@/params/registry";
import { t, type RecutLocale } from "@/i18n";
import type { ComponentDefinition } from "./types";

/** 优先使用 nameKey 翻译，缺省回退到 name。 */
export function getComponentName({
	definition,
	locale,
}: {
	definition: ComponentDefinition;
	locale: RecutLocale;
}): string {
	return definition.nameKey ? t(locale, definition.nameKey) : definition.name;
}

export type ComponentLoadState =
	| { status: "loaded"; definition: ComponentDefinition }
	| { status: "loading" }
	| { status: "failed"; error: Error };

export type ComponentModule = { default?: ComponentDefinition } | ComponentDefinition;

/**
 * 组件注册表：内置组件同步注册（register），AI 临时组件异步加载（registerAsync + load）。
 * 消费方必须经 getState / isLoaded 守卫，未加载时渲染占位，绝不裸调 get()。
 */
export class ComponentRegistry extends DefinitionRegistry<string, ComponentDefinition> {
	private loaders = new Map<string, () => Promise<ComponentModule>>();
	private states = new Map<string, ComponentLoadState>();
	private inflight = new Map<string, Promise<ComponentDefinition>>();
	private listeners = new Set<() => void>();

	constructor() {
		super("component");
	}

	/** 注册异步加载器（loader 返回组件模块，default 或直接是定义）。 */
	registerAsync(componentId: string, loader: () => Promise<ComponentModule>): void {
		this.loaders.set(componentId, loader);
	}

	/** 幂等加载：已同步注册直接返回；加载中返回同一 Promise（并发去重）。 */
	load(componentId: string): Promise<ComponentDefinition> {
		if (this.has(componentId)) {
			return Promise.resolve(this.get(componentId));
		}
		const current = this.states.get(componentId);
		if (current?.status === "loaded") return Promise.resolve(current.definition);
		if (current?.status === "failed") return Promise.reject(current.error);
		const inflight = this.inflight.get(componentId);
		if (inflight) return inflight;
		const promise = this.performLoad(componentId);
		this.inflight.set(componentId, promise);
		void promise.finally(() => {
			this.inflight.delete(componentId);
		});
		return promise;
	}

	private async performLoad(componentId: string): Promise<ComponentDefinition> {
		const loader = this.loaders.get(componentId);
		if (!loader) {
			const error = new Error(`Unknown component: ${componentId}`);
			this.states.set(componentId, { status: "failed", error });
			this.notify();
			throw error;
		}
		this.states.set(componentId, { status: "loading" });
		this.notify();
		try {
			const module = await loader();
			const definition =
				module && typeof module === "object" && "default" in (module as object)
					? (module as { default: ComponentDefinition }).default
					: (module as ComponentDefinition);
			if (!definition) {
				throw new Error(`Component module ${componentId} has no definition export`);
			}
			const key = definition.id || componentId;
			if (!this.has(key)) {
				this.register({ key, definition });
			}
			this.states.set(componentId, { status: "loaded", definition });
			this.notify();
			return definition;
		} catch (error) {
			const e = error instanceof Error ? error : new Error(String(error));
			this.states.set(componentId, { status: "failed", error: e });
			this.notify();
			throw e;
		}
	}

	/** 当前加载状态：同步注册的组件视为 loaded。 */
	getState(componentId: string): ComponentLoadState | null {
		if (this.has(componentId)) {
			return { status: "loaded", definition: this.get(componentId) };
		}
		return this.states.get(componentId) ?? null;
	}

	isLoaded(componentId: string): boolean {
		return this.has(componentId) || this.states.get(componentId)?.status === "loaded";
	}

	/** 已尝试加载但失败（load 抛错置 failed）。失败的组件无法 isLoaded，需在同步时排除以免死循环。 */
	isFailed(componentId: string): boolean {
		return this.states.get(componentId)?.status === "failed";
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

export const componentsRegistry = new ComponentRegistry();
