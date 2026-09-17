import type { ComponentRenderContext } from "../types";
import { num, str } from "../utils";

/** 基础形状组件（box / sphere / plane），meshStandardMaterial 受场景光照影响。元素 transform 由 wrapper 施加。 */
export function ShapeObject({ object, params }: ComponentRenderContext) {
	const color = str(params.color, "#4ecdc4");
	const shape = str(params.shape, "box");
	const size = num(params.size, 200);
	const opacity = num(params.opacity, 1);

	return (
		<mesh renderOrder={object.renderOrder}>
			{shape === "sphere" ? (
				<sphereGeometry args={[size / 2, 32, 16]} />
			) : shape === "plane" ? (
				<planeGeometry args={[size, size]} />
			) : (
				<boxGeometry args={[size, size, size]} />
			)}
			<meshStandardMaterial color={color} transparent opacity={opacity} />
		</mesh>
	);
}
