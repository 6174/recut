import type { ParamValues } from "@/params";
import {
	VisualNode,
	type ResolvedVisualNodeState,
	type VisualNodeParams,
} from "./visual-node";

export interface ComponentNodeParams extends VisualNodeParams {
	componentId: string;
}

export interface ResolvedComponentNodeState extends ResolvedVisualNodeState {
	/** 该时刻求值后的完整参数（含组件输入与 transform/opacity）。 */
	params: ParamValues;
}

export class ComponentNode extends VisualNode<
	ComponentNodeParams,
	ResolvedComponentNodeState
> {}
