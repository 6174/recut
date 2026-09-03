import { useEffect, useState } from "react";
import { componentsRegistry } from "./component-registry";
import type { ComponentLoadState } from "./component-registry";

/**
 * 组件定义 hook：订阅注册表状态，懒加载组件。
 * 未加载 → { status: "loading" }；失败 → { status: "failed", error }；就绪 → { status: "loaded", definition }。
 */
export function useComponentDefinition(
	componentId: string,
): ComponentLoadState | null {
	const [state, setState] = useState<ComponentLoadState | null>(() =>
		componentsRegistry.getState(componentId),
	);

	useEffect(() => {
		let alive = true;
		const sync = () => {
			if (alive) {
				setState(componentsRegistry.getState(componentId));
			}
		};
		const unsubscribe = componentsRegistry.subscribe(sync);
		sync();
		componentsRegistry.load(componentId).catch(() => {
			/* 失败状态已写入 registry，sync 会推送 */
		});
		return () => {
			alive = false;
			unsubscribe();
		};
	}, [componentId]);

	return state;
}
