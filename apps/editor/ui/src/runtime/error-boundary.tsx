import { Component } from "react";
import type { ReactNode } from "react";
import type { WorldObject } from "./types";

/**
 * 组件级渲染错误兜底：捕获组件 render/生命周期/dispose 错误，只降级该组件，
 * 不影响整个场景与宿主。内置组件与 AI 临时组件共用。
 */
export class ComponentErrorBoundary extends Component<
	{ name: string; children: ReactNode; fallback: ReactNode },
	{ error: Error | null }
> {
	state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error): { error: Error } {
		return { error };
	}

	componentDidCatch(error: Error): void {
		console.warn(`[component] render error in "${this.props.name}":`, error);
	}

	render(): ReactNode {
		return this.state.error ? this.props.fallback : this.props.children;
	}
}

/** 通用兜底视觉：半透明红色方块（占 getBaseSize 尺寸），标识组件出错。 */
export function ComponentErrorFallback({ object }: { object: WorldObject }) {
	return (
		<mesh renderOrder={object.renderOrder}>
			<boxGeometry args={[120, 80, 10]} />
			<meshBasicMaterial color="#f43f5e" transparent opacity={0.55} />
		</mesh>
	);
}
